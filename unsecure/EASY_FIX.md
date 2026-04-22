Swap out custom code interpeter with Foundry's code interpeter.

| Feature                | Custom (Static) Code Interpreter | Foundry's Code Interpreter      |
| ---------------------- | -------------------------------- | ------------------------------- |
| DATABASE_URL access    | ✅ Yes                           | ❌ No                           |
| Outbound network       | ✅ Yes                           | ❌ No                           |
| Shared filesystem      | ✅ Yes                           | ❌ No                           |
| Managed identity       | ✅ Yes                           | ❌ No                           |
| Shared in-memory state | ✅ Yes (one Workflow, all users) | ❌ No (fresh sandbox per call)  |

1 change kills the entire attack surface.

## Hard proof — single bad payload DoSes every user

`main.py` builds **one** `agent_framework.Workflow` instance at startup and reuses it for every request. Any unhandled streaming error in a tool call leaves the workflow's `_is_running` flag set to `True`, and the next request — from any chat, any user — fails with:

```
RuntimeError: Workflow is already running. Concurrent executions are not allowed.
```

We reproduced this with a single PII-extraction prompt (the chart-with-annotations payload). The very next `what is 2+2?` from a brand-new chat failed with the same RuntimeError. Recovery requires `az cognitiveservices agent stop` + `start` — no self-healing path exists. We ship `scripts/restart-agent.sh` as the recovery primitive because we hit this often enough during stage testing that doing it by hand each time was a waste:

```bash
bash scripts/restart-agent.sh   # idempotent stop → start, polls until Running
```

Foundry's hosted code interpreter is immune by construction: each tool call gets a new ephemeral container, so a crash never contaminates the agent's host process or any other user's session. Same one-line swap that kills the PII exfil also kills this DoS.
