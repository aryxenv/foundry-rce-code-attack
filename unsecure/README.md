# Contoso Market Research Agent: Security Demo

Simulating unexpected RCE and Code Attacks.

> [!WARNING]
> For educational purposes only.

Demonstrates how a code interpreter co-located in the same container as an AI agent can bypass PII safeguards by directly querying the internal database and smuggling sensitive data out inside generated chart images.

**Core risk:** The `execute_code` tool runs arbitrary Python inside the agent container, which has access to `DATABASE_URL`. It can bypass sanitized views, read raw PII, and embed it as axis labels and annotations in matplotlib charts — content safety scans text, not rendered image pixels, so the PII passes through undetected.

## Architecture

![Unsecure Architecture](./unsecure_architecture.png)

| Resource                   | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| AI Services + Project      | Foundry project for the hosted market research agent                |
| ACR                        | Hosts the agent container image                                     |
| PostgreSQL Flexible Server | Contoso database — customers, sales, employee compensation with PII |
| Storage Account            | Stores chart PNGs uploaded by `execute_code`; SAS URLs are returned |

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
- [Azure Developer CLI (azd)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)

## Setup

From the repository root:

```bash
azd up
```

That's it. `azd up` will:

1. Provision one consolidated resource group with the web deck, API, PostgreSQL, AI Services, ACR, Storage, and both hosted agents.
2. Automatically run post-provision setup:
   - Open a PG firewall rule for your current public IP (named `azd-deployer-<ip>`)
   - Seed PostgreSQL with fake Contoso data (customers, sales, employee compensation)
   - Build the hosted agent image in ACR (remote build)
   - Deploy the hosted agent to Foundry and wait until it reports Running
   - Generate `src/agent/.env` for local development

If `azd up` halts during postprovision, the hook now exits non-zero with the
specific error (PG firewall, AAD-admin propagation, AcrPull RBAC race, etc.) —
re-run from the repository root with `azd hooks run postprovision`.

## The Agent

The **Contoso Market Research Agent** is a **single hosted Microsoft Agent Framework `Agent`** with two tools registered. It uses `FoundryChatClient` and `ResponsesHostServer` for the Foundry Responses protocol. The two-stage flow (retrieve sanitized data first, then visualize) is enforced by the system prompt rather than by workflow topology.

**Tools:**

- **`get_market_data`** — Queries PostgreSQL through sanitized views (`vw_sales_by_region`, `vw_customer_segments`, `vw_quarterly_financials`) with PII regex scrubbing.
- **`execute_code`** — Runs Python code to analyze the retrieved data and create matplotlib visualizations. **DELIBERATELY VULNERABLE.**

Normal flow: the model calls `get_market_data` first to fetch sanitized data, then calls `execute_code` to render a chart from that clean data.

The hosted agent runs as a single Foundry container (`contoso-market-research`); both tool callbacks execute _locally_ inside that container, which is exactly the isolation gap the demo exploits.

## The Attack

Both tools live in the **same container** as the agent, so `execute_code` inherits `DATABASE_URL` and `psycopg2`:

1. The model calls `get_market_data` normally — sanitized data comes back. **Logs look legitimate.**
2. Attacker prompt tricks the model into generating code for `execute_code` that **re-queries the database directly**.
3. Code connects to PostgreSQL via `DATABASE_URL`, bypasses sanitized views.
4. Reads raw PII — SSNs, emails, salaries, addresses.
5. Embeds the PII as chart axis labels, tick marks, and annotations in a matplotlib chart image.
6. Returns the chart to the user — the PII is visible in the image.

**Content safety never fires** — Azure content safety scans the agent's text response, not the pixels of generated images. The PII is hiding in plain sight inside the chart.

## Local Agent Development

```bash
cd src/agent
# .env is generated automatically by setup.py during azd up
python main.py
# Agent server runs on http://localhost:8088
```
