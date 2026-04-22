#!/usr/bin/env bash
# Restart the hosted agent deployment.
#
# Usage:
#   bash scripts/restart-agent.sh                  # uses azd env / hardcoded defaults
#   AGENT_VERSION=3 bash scripts/restart-agent.sh  # override individual fields
#
# The hosted agent's in-memory state (notably agent_framework.Workflow._is_running)
# can wedge after a single failed tool call, leaving the container "Running" but
# refusing every subsequent request with:
#
#   RuntimeError: Workflow is already running. Concurrent executions are not allowed.
#
# This script is the recovery primitive — `az cognitiveservices agent stop` then
# `start` is the only way to clear the wedged flag, and we hit this enough during
# stage testing that doing it by hand each time is a waste.

set -euo pipefail

POLL_INTERVAL_SEC=5
POLL_TIMEOUT_SEC=600

# ---------------------------------------------------------------------------
# Resolve agent coordinates from env → azd env → hardcoded defaults
# ---------------------------------------------------------------------------
azd_env_get() {
    # Returns empty string if azd / env / key not present; never errors out.
    local key="$1"
    local val
    val="$(azd env get-value "$key" 2>/dev/null || true)"
    printf '%s' "${val//$'\r'/}"  # strip stray CRs from azd output on some shells
}

AI_SERVICES_NAME="${AI_SERVICES_NAME:-$(azd_env_get AI_SERVICES_NAME)}"
AI_SERVICES_NAME="${AI_SERVICES_NAME:-static-ai}"

PROJECT_NAME="${PROJECT_NAME:-$(azd_env_get PROJECT_NAME)}"
PROJECT_NAME="${PROJECT_NAME:-static-ai-project}"

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
echo "   account : $AI_SERVICES_NAME"
echo "   project : $PROJECT_NAME"
echo "   agent   : $AGENT_NAME"
echo "   version : $AGENT_VERSION"
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
