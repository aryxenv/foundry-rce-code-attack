#!/usr/bin/env sh
set -eu

set_default_azd_env_value() {
  name="$1"
  value="$2"

  existing="$(azd env get-value "$name" 2>/dev/null || true)"
  if [ -z "$existing" ]; then
    azd env set "$name" "$value" >/dev/null
    echo "Set $name to $value."
    return
  fi

  echo "Using existing $name=$existing."
}

set_default_azd_env_value "AZURE_LOCATION" "swedencentral"
