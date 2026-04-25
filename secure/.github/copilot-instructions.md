# Copilot Instructions — Contoso Market Research Secure Agent

## Project Overview

This folder contains the secure variant of the Contoso Market Research hosted agent for Azure AI Foundry. It keeps the fake Contoso market data scenario, but removes custom in-container code execution.

The secure agent is implemented as a single Microsoft Agent Framework hosted agent:

- **`get_market_data`** custom tool: queries PostgreSQL through sanitized SQL views and applies PII scrubbing before returning data to the model.
- **Foundry integrated Code Interpreter**: creates charts and analysis in Foundry's managed sandbox from the sanitized data returned by `get_market_data`.

## Security Boundary

Do not add a custom Python execution tool back into the hosted container. The hosted container has `DATABASE_URL` so `get_market_data` can access PostgreSQL with Entra authentication; generated Python must run only in Foundry's integrated Code Interpreter sandbox, which should receive sanitized data rather than direct database credentials.

Visualizations should be returned through Code Interpreter's native outputs. Do not reintroduce external chart hosting or local subprocess execution.

## Key Files

- `src/agent/main.py` — Single ChatAgent that registers `get_market_data` plus Foundry Code Interpreter using the existing hosted-agent SDK pattern.
- `src/agent/tools.py` — Safe data-access tool only.
- `azure/` — Bicep infrastructure for PostgreSQL, AI Services, and ACR.
- `scripts/setup.py` — Post-provisioning: seeds DB, builds the image, deploys `contoso-market-research-secure`, and grants runtime RBAC.
- `scripts/redeploy-agent.ps1` — Rebuilds/redeploys the secure hosted agent version.

## Conventions

- Keep changes in this `secure` folder scoped to the secure hosted agent unless the user explicitly asks for cross-folder updates.
- All fake PII uses `@contoso.com` emails and SSNs starting with `9xx`.
- Infrastructure uses `SecurityControl: Ignore` tags.
- Preserve the existing hosted-agent SDK/deployment pattern unless the user explicitly asks for a larger migration.
