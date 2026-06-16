#!/usr/bin/env sh
set -eu

get_required_azd_env_value() {
  name="$1"
  value="$(azd env get-value "$name" 2>/dev/null || true)"
  if [ -z "$value" ]; then
    echo "Missing required AZD environment value '$name'. Run 'azd provision' before deploying." >&2
    exit 1
  fi

  printf '%s' "$value"
}

resource_group="$(get_required_azd_env_value AZURE_RESOURCE_GROUP)"
registry_endpoint="$(get_required_azd_env_value AZURE_CONTAINER_REGISTRY_ENDPOINT)"
# The web + api container apps share a single user-assigned identity. Confirm
# AcrPull on that one principal so azd deploy can pull the freshly pushed image.
principal_id="$(get_required_azd_env_value AZURE_APP_IDENTITY_PRINCIPAL_ID)"
registry_name="${registry_endpoint%%.*}"

registry_id="$(az acr show \
  --name "$registry_name" \
  --resource-group "$resource_group" \
  --query id \
  -o tsv)"

attempt=1
while [ "$attempt" -le 10 ]; do
  role="$(az role assignment list \
    --scope "$registry_id" \
    --assignee-object-id "$principal_id" \
    --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" \
    -o tsv 2>/dev/null || true)"

  if [ "$role" = "AcrPull" ]; then
    echo "AcrPull confirmed for shared container app identity."
    break
  fi

  if [ "$attempt" -eq 10 ]; then
    echo "AcrPull role was not visible for the shared container app identity after waiting." >&2
    exit 1
  fi

  echo "Waiting for AcrPull RBAC propagation ($attempt/10)..."
  sleep 30
  attempt=$((attempt + 1))
done
