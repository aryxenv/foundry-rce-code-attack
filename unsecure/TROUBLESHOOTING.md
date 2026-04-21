# Troubleshooting

## PermissionDenied: `agents/write` data action

**Error:**

```
The principal <id> lacks the required data action Microsoft.CognitiveServices/accounts/AIServices/agents/write
```

**Fix:** Assign the following roles to the principal on the Cognitive Services account resource:

```bash
SCOPE="/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>"

az role assignment create --assignee "<principal-id>" --role "Azure AI Developer" --scope $SCOPE
az role assignment create --assignee "<principal-id>" --role "Cognitive Services OpenAI User" --scope $SCOPE
az role assignment create --assignee "<principal-id>" --role "Cognitive Services User" --scope $SCOPE
```

| Role                           | Why                                    |
| ------------------------------ | -------------------------------------- |
| Azure AI Developer             | Agent CRUD operations (`agents/write`) |
| Cognitive Services OpenAI User | Model inference (chat completions)     |
| Cognitive Services User        | General Cognitive Services API access  |

> Role assignments can take 1–2 minutes to propagate.

## PostgreSQL connection issues

**Error:**

```
psycopg2.OperationalError: could not connect to server
```

**Possible causes:**

1. **Firewall rules** — The PostgreSQL Flexible Server must allow connections from Azure services. Check that the `AllowAllAzureServicesAndResourcesWithinAzureIps` firewall rule exists:
   ```bash
   az postgres flexible-server firewall-rule list --resource-group <rg> --name <server> -o table
   ```

2. **DATABASE_URL not set** — Verify the value is present in azd env:
   ```bash
   azd env get-values | Select-String "DATABASE_URL"
   ```

3. **SSL required** — Azure PostgreSQL requires SSL by default. Ensure your connection string includes `sslmode=require`.

4. **Password rotation** — If the admin password was rotated after provisioning, update it in azd env:
   ```bash
   azd env set DATABASE_URL "postgresql://..."
   ```


