#!/usr/bin/env sh
set -eu

# The infra provisions the container apps with minReplicas = 0 so the very first
# revision (a public placeholder image) can come up cleanly before azd deploy
# pushes the real images. Once the real images are deployed, bump both apps to
# minReplicas = 1 so the conference demo is always warm (no cold starts).

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
web_container_app_name="$(get_required_azd_env_value AZURE_WEB_CONTAINER_APP_NAME)"
api_container_app_name="$(get_required_azd_env_value AZURE_API_CONTAINER_APP_NAME)"

for container_app_name in "$api_container_app_name" "$web_container_app_name"; do
  echo "Ensuring $container_app_name stays warm (minReplicas = 1)..."
  az containerapp update \
    --name "$container_app_name" \
    --resource-group "$resource_group" \
    --min-replicas 1 \
    --max-replicas 1 \
    --output none
done

echo "Both container apps set to always-on (minReplicas = 1)."
