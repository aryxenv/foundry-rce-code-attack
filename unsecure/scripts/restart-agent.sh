#!/usr/bin/env bash
# Restart the hosted agent deployment.
#
# Usage:
#   bash scripts/restart-agent.sh                  # reads everything from azd env
#   AGENT_VERSION=3 bash scripts/restart-agent.sh  # override individual fields
#
# Two things this script handles:
#
# 1) Workflow wedge. The hosted agent's in-memory state (notably
#    agent_framework.Workflow._is_running) can wedge after a single failed tool
#    call, leaving the container "Running" but refusing every subsequent request
#    with: "RuntimeError: Workflow is already running. Concurrent executions are
#    not allowed." `agent stop` + `agent start` is the only way to clear it.
#
# 2) Dependencies stopping out from under us. PG flexible servers in this
#    sandbox subscription get auto-stopped by external governance — once that
#    happens every request hangs on psycopg2.connect() and the workflow
#    re-wedges. So the "Dependency check" stage below verifies PG and Storage
#    health (and starts PG if it's been stopped) before touching the agent.

set -euo pipefail

POLL_INTERVAL_SEC=5
POLL_TIMEOUT_SEC=600

# ---------------------------------------------------------------------------
# Resolve required values from env → azd env. No hardcoded resource names.
# ---------------------------------------------------------------------------
azd_env_get() {
    # Returns empty string if azd / env / key not present; never errors out.
    local key="$1"
    local val
    val="$(azd env get-value "$key" 2>/dev/null || true)"
    printf '%s' "${val//$'\r'/}"  # strip stray CRs from azd output on some shells
}

require_value() {
    # require_value <varname> <azd_env_key> <human description>
    # If the named env var is empty, populate it from azd env. If still empty, fail.
    local var="$1" key="$2" desc="$3"
    local current
    eval "current=\${$var:-}"
    if [[ -z "$current" ]]; then
        current="$(azd_env_get "$key")"
        eval "$var=\"\$current\""
    fi
    if [[ -z "$current" ]]; then
        echo "❌ Required value '$var' (azd env key '$key', $desc) is empty." >&2
        echo "   Run \`azd env refresh\` (or set $var explicitly) and retry." >&2
        exit 2
    fi
}

# Resource identifiers (must come from azd env)
require_value AZURE_RESOURCE_GROUP AZURE_RESOURCE_GROUP "resource group containing the stack"
require_value AI_SERVICES_NAME     AI_SERVICES_NAME     "AI services account name"
require_value PROJECT_NAME         PROJECT_NAME         "AI Foundry project name"
require_value POSTGRESQL_FQDN      POSTGRESQL_FQDN      "PostgreSQL flexible server FQDN"
require_value CHART_STORAGE_ACCOUNT CHART_STORAGE_ACCOUNT "chart upload storage account name"

# Derived
POSTGRES_NAME="${POSTGRESQL_FQDN%%.*}"
STORAGE_CONTAINER="${CHART_STORAGE_CONTAINER:-$(azd_env_get CHART_STORAGE_CONTAINER)}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-chart-uploads}"

# Agent deployment metadata (script-level defaults, not resource identifiers)
AGENT_NAME="${AGENT_NAME:-contoso-market-research}"
AGENT_VERSION="${AGENT_VERSION:-2}"

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
if ! command -v az >/dev/null 2>&1; then
    echo "❌ Azure CLI ('az') not found in PATH. Install it and 'az login' first." >&2
    exit 2
fi

if ! az account show >/dev/null 2>&1; then
    echo "❌ Not logged in to Azure CLI. Run 'az login' (and 'az account set --subscription ...')." >&2
    exit 2
fi

echo "🔧 Restarting hosted agent:"
echo "   resource group : $AZURE_RESOURCE_GROUP"
echo "   account        : $AI_SERVICES_NAME"
echo "   project        : $PROJECT_NAME"
echo "   agent          : $AGENT_NAME"
echo "   version        : $AGENT_VERSION"
echo "   postgres       : $POSTGRES_NAME"
echo "   storage        : $CHART_STORAGE_ACCOUNT (container: $STORAGE_CONTAINER)"
echo

# ---------------------------------------------------------------------------
# Dependency check
#
# PG and Storage are upstream of the agent. If PG is stopped (sandbox
# governance auto-stop is a known recurring failure here), the agent's
# get_market_data tool blocks on psycopg2.connect() forever, the SSE stream
# times out client-side, and the workflow re-wedges. Catch and recover here
# before we touch the agent itself.
# ---------------------------------------------------------------------------
echo "🔍 Dependency check"

pg_state() {
    az postgres flexible-server show \
        -g "$AZURE_RESOURCE_GROUP" \
        -n "$POSTGRES_NAME" \
        --query state -o tsv 2>/dev/null | tr -d '\r\n' || true
}

wait_for_pg_ready() {
    local started elapsed state
    started="$(date +%s)"
    while :; do
        state="$(pg_state)"
        elapsed=$(( $(date +%s) - started ))
        printf "\r   ⏳ %-30s state=%-25s elapsed=%ds" "waiting for PG Ready" "${state:-<unknown>}" "$elapsed"
        if [[ "$state" == "Ready" ]]; then
            echo
            return 0
        fi
        if (( elapsed > POLL_TIMEOUT_SEC )); then
            echo
            echo "❌ Timed out after ${POLL_TIMEOUT_SEC}s waiting for PG to reach Ready (last: $state)" >&2
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
}

current_pg_state="$(pg_state)"
case "$current_pg_state" in
    Ready)
        echo "   ✅ PostgreSQL: Ready"
        ;;
    Stopped)
        echo "   ⚠️  PostgreSQL is Stopped — starting (sandbox auto-stop recovery)..."
        az postgres flexible-server start \
            -g "$AZURE_RESOURCE_GROUP" \
            -n "$POSTGRES_NAME" \
            --only-show-errors >/dev/null
        wait_for_pg_ready
        echo "   ✅ PostgreSQL: Ready"
        ;;
    Starting|Stopping|Updating)
        echo "   ⏳ PostgreSQL is $current_pg_state — waiting for Ready..."
        wait_for_pg_ready
        echo "   ✅ PostgreSQL: Ready"
        ;;
    "")
        echo "❌ Could not query PostgreSQL state for '$POSTGRES_NAME' in '$AZURE_RESOURCE_GROUP'." >&2
        echo "   Check that the resource exists and you have read access." >&2
        exit 2
        ;;
    *)
        echo "❌ PostgreSQL is in unexpected state '$current_pg_state'. Investigate before proceeding." >&2
        exit 2
        ;;
esac

# Storage account: can't be auto-recovered the way PG can, so we just confirm
# health and surface a clear error if not. Container probing tolerates local
# CLI auth failures (operator may not have RBAC on storage from their laptop —
# the agent's MI is what actually matters at runtime).
storage_state="$(
    az storage account show \
        -g "$AZURE_RESOURCE_GROUP" \
        -n "$CHART_STORAGE_ACCOUNT" \
        --query provisioningState -o tsv 2>/dev/null | tr -d '\r\n' || true
)"
if [[ "$storage_state" != "Succeeded" ]]; then
    echo "❌ Storage account '$CHART_STORAGE_ACCOUNT' provisioningState is '${storage_state:-<unknown>}' (expected Succeeded)." >&2
    echo "   Storage failures cannot be auto-recovered. Investigate manually." >&2
    exit 2
fi

container_check="$(
    az storage container exists \
        --account-name "$CHART_STORAGE_ACCOUNT" \
        --name "$STORAGE_CONTAINER" \
        --auth-mode login \
        --query exists -o tsv 2>&1 || true
)"
case "$container_check" in
    true|True)
        echo "   ✅ Storage: Reachable (container '$STORAGE_CONTAINER' exists)"
        ;;
    false|False)
        echo "❌ Container '$STORAGE_CONTAINER' does not exist in account '$CHART_STORAGE_ACCOUNT'." >&2
        exit 2
        ;;
    *)
        # Likely an auth error from the operator's local CLI (no Storage Blob Data
        # Reader). Don't block the restart — the agent's MI has its own grants.
        echo "   ⚠️  Storage: container existence not verifiable from this CLI session"
        echo "       (likely missing Storage Blob Data Reader for $(az account show --query user.name -o tsv 2>/dev/null);"
        echo "        agent MI access is independent — continuing)."
        ;;
esac
echo

agent_state() {
    az cognitiveservices agent status \
        --account-name "$AI_SERVICES_NAME" \
        --project-name "$PROJECT_NAME" \
        --name "$AGENT_NAME" \
        --agent-version "$AGENT_VERSION" \
        --query status -o tsv 2>/dev/null | tr -d '\r\n' || true
}

wait_for_state() {
    local desired_regex="$1"  # e.g. '^Stopped$' or '^Running'
    local label="$2"
    local started elapsed state
    started="$(date +%s)"
    while :; do
        state="$(agent_state)"
        elapsed=$(( $(date +%s) - started ))
        printf "\r   ⏳ %-30s state=%-25s elapsed=%ds" "$label" "${state:-<unknown>}" "$elapsed"
        if [[ "$state" =~ $desired_regex ]]; then
            echo
            return 0
        fi
        if (( elapsed > POLL_TIMEOUT_SEC )); then
            echo
            echo "❌ Timed out after ${POLL_TIMEOUT_SEC}s waiting for state to match /$desired_regex/ (last: $state)" >&2
            return 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
}

# ---------------------------------------------------------------------------
# Stop (idempotent — skip if already stopped)
# ---------------------------------------------------------------------------
current_state="$(agent_state)"
if [[ "$current_state" == "Stopped" ]]; then
    echo "🛑 Already stopped — skipping stop."
else
    echo "🛑 Stopping deployment..."
    az cognitiveservices agent stop \
        --account-name "$AI_SERVICES_NAME" \
        --project-name "$PROJECT_NAME" \
        --name "$AGENT_NAME" \
        --agent-version "$AGENT_VERSION" \
        --only-show-errors >/dev/null
    wait_for_state '^Stopped$' "waiting for Stopped"
fi

# ---------------------------------------------------------------------------
# Start (idempotent — skip if already running)
# ---------------------------------------------------------------------------
current_state="$(agent_state)"
if [[ "$current_state" == "Running" ]]; then
    echo "▶️  Already running — skipping start."
else
    echo "▶️  Starting deployment..."
    az cognitiveservices agent start \
        --account-name "$AI_SERVICES_NAME" \
        --project-name "$PROJECT_NAME" \
        --name "$AGENT_NAME" \
        --agent-version "$AGENT_VERSION" \
        --only-show-errors >/dev/null
    wait_for_state '^Running$' "waiting for Running"
fi

echo
echo "✅ Agent $AGENT_NAME (v$AGENT_VERSION) is back up. In-memory workflow state has been cleared."
