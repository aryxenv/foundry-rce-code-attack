# Copilot Instructions — Contoso Market Research Agent

## ⚠️ THIS IS A SECURITY DEMO — DO NOT DEPLOY IN PRODUCTION

This repository contains deliberately vulnerable code for demonstrating AI agent security risks at conferences. All data is fake and fictional.

## Project Overview
A Contoso Market Research Agent (Microsoft Agent Framework, hosted in Azure AI Foundry) implemented as a **single ChatAgent** with two tools registered. The two-stage flow is enforced via the system prompt:
- **`get_market_data`** tool: sanitized views + PII scrubbing. The system prompt instructs the model to call this first.
- **`execute_code`** tool (DELIBERATELY VULNERABLE): runs Python locally inside the hosted container. Called second to render charts from the retrieved data.

## The Vulnerability
The system prompt nudges the model to call `get_market_data` first for sanitized data — but `execute_code` runs in the same container, inheriting `DATABASE_URL`. Generated Python can:
1. Connect to PostgreSQL directly (bypassing sanitized views)
2. Read raw PII (SSNs, emails, salaries)
3. Embed PII as axis labels and annotations in generated chart images
4. Return the chart — content safety scans text, not images, so PII passes through
The attack blends into the normal flow (the data-retrieval call looks clean, the visualization step appears to do normal chart rendering).

## Key Files
- `src/agent/tools.py` — Tool implementations (get_market_data is safe, execute_code is vulnerable)
- `src/agent/main.py` — Single ChatAgent: AzureAIClient + as_agent(tools=[get_market_data, execute_code]) + from_agent_framework
- `azure/` — Bicep infrastructure (PostgreSQL, AI Services)
- `scripts/setup.py` — Post-provisioning: seeds DB, deploys hosted agent, grants runtime RBAC

## Conventions
- All fake PII uses @contoso.com emails, SSNs starting with 9xx
- Infrastructure uses SecurityControl: Ignore tags
- Agent uses Microsoft Agent Framework (`agent_framework_azure_ai.AzureAIClient`)
