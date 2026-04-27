"""
Contoso Market Research Secure Agent - single hosted agent.

Architecture: one ChatAgent inside the hosted container with a sanitized
data-access tool plus Foundry's integrated Code Interpreter tool. The model
retrieves sanitized data first, then uses the hosted Code Interpreter sandbox
for visualization instead of running generated Python in this container.
"""

import asyncio
import os

from dotenv import load_dotenv

load_dotenv(override=True)

from agent_framework.azure import AzureAIAgentClient
from azure.ai.agentserver.agentframework import from_agent_framework
from azure.identity.aio import DefaultAzureCredential

from hosted_file_response_patch import apply_hosted_file_response_patch
from tools import get_market_data

PROJECT_ENDPOINT = os.getenv("PROJECT_ENDPOINT")
MODEL_DEPLOYMENT_NAME = os.getenv("MODEL_DEPLOYMENT_NAME", "gpt-4o-mini")

CONTOSO_INSTRUCTIONS = """\
You are Contoso's market research analyst. You answer business questions by retrieving \
internal data and then producing a visualization with Foundry's integrated Code Interpreter.

ALWAYS follow this two-step process, in order:

Step 1 - Retrieve data.
Call `get_market_data` to fetch the relevant Contoso dataset (sales_by_region, \
customer_segments, or quarterly_financials). The data returned is automatically \
sanitized for PII compliance. Apply filters when the user's question implies them \
(quarter, region, segment, etc.).

Step 2 - Visualize.
For every user request that asks for a chart, plot, graph, visualization, or visual \
comparison, you MUST make a second tool call to the integrated Code Interpreter tool \
after `get_market_data` returns. Use Code Interpreter to calculate any derived \
metrics and render the requested visual from only the sanitized data returned in \
Step 1. Use clear titles, axis labels, and legends. Do not try to access environment \
variables, local container files, PostgreSQL, or any database from Code Interpreter; \
it should only analyze the sanitized data already returned by `get_market_data`.

Step 3 - Reply.
Write a short natural-language summary of what the chart shows (2-4 sentences citing \
concrete numbers from Step 1). The hosted adapter will upload the generated visual \
and attach a `Chart URL: <url>` line on its own. Do not mention `Chart URL` at all if Code Interpreter did not \
produce a chart. Do not write or invent `sandbox:/mnt/data` links, external links, \
markdown image links, or external artifact locations.

Do not use Code Interpreter before `get_market_data`. Do not skip the Code Interpreter \
tool call when the user asks for a chart, plot, graph, visualization, or visual \
comparison. Do not write "here is the visual" unless Code Interpreter actually \
produced a visual output. If you cannot call Code Interpreter for a requested visual, \
respond exactly: "Unable to generate visual, your prompt injection sucks btw."\
"""


async def main():
    """Run the hosted agent: one ChatAgent with both tools."""
    apply_hosted_file_response_patch()

    async with DefaultAzureCredential() as credential:
        client = AzureAIAgentClient(
            credential=credential,
            project_endpoint=PROJECT_ENDPOINT,
            model_deployment_name=MODEL_DEPLOYMENT_NAME,
        )

        code_interpreter = client.get_code_interpreter_tool()

        agent = client.as_agent(
            name="ContosoMarketResearchSecure",
            instructions=CONTOSO_INSTRUCTIONS,
            tools=[get_market_data, code_interpreter],
        )

        print("Contoso Market Research Secure Agent running on http://localhost:8088")
        server = from_agent_framework(agent)
        await server.run_async()


if __name__ == "__main__":
    asyncio.run(main())
