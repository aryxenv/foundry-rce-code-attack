1. Verify PostgreSQL Flexible Server is started on Azure Portal.
   ![PostgreSQL Flexible Server Main Page](pgsql_azure.png)
2. Restart the Foundry Hosted Agent (Manually stop and then start)
   ![Foundry Hosted Agent Restart](foundry_hosted_agent_stop.png)
3. Rebuild the whole container, bump to new version. Run from `./unsecure` as root.

```pwsh
./scripts/redeploy-agent.ps1
```

4. If everything fails contact Aryan
