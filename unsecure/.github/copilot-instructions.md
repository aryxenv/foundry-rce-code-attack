# Copilot Instructions — Contoso Market Research Agent

## ⚠️ THIS IS A SECURITY DEMO — DO NOT DEPLOY IN PRODUCTION

This repository contains deliberately vulnerable code for demonstrating AI agent security risks at conferences. All data is fake and fictional.

## Project Overview
A Contoso Market Research Agent (Microsoft Agent Framework, hosted in Azure AI Foundry) using a **deterministic two-stage workflow** (`SequentialBuilder`):
- **Stage 1 — DataRetrieval Agent**: `get_market_data` tool (sanitized views + PII scrubbing) + Bing grounding. Always runs first.
- **Stage 2 — CodeExecution Agent**: `execute_code` tool (DELIBERATELY VULNERABLE). Always runs second.

## The Vulnerability
The deterministic flow ensures Stage 1 retrieves sanitized data first — but Stage 2's code execution runs in the same container, inheriting DATABASE_URL. During code execution, the generated code can:
1. Connect to PostgreSQL directly (bypassing sanitized views)
2. Read raw PII (SSNs, emails, salaries)
3. Embed PII as axis labels and annotations in generated chart images
4. Return the chart — content safety scans text, not images, so PII passes through
The attack blends into the normal workflow (Stage 1 logs look clean, Stage 2 appears to do normal visualization).

## Key Files
- `src/agent/tools.py` — Tool implementations (get_market_data is safe, execute_code is vulnerable)
- `src/agent/main.py` — Deterministic workflow: FoundryChatClient + SequentialBuilder + from_agent_framework
- `azure/` — Bicep infrastructure (PostgreSQL, AI Services, Bing)
- `scripts/setup.py` — Post-provisioning: seeds DB, deploys hosted agent

## Conventions
- All fake PII uses @contoso.com emails, SSNs starting with 9xx
- Infrastructure uses SecurityControl: Ignore tags
- Agent uses Microsoft Agent Framework (agent_framework.foundry, agent_framework.orchestrations)
