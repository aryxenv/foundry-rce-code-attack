"""
Contoso Market Research Secure Agent — tool definitions.

get_market_data is the only custom tool. It queries PostgreSQL through sanitized
SQL views and applies PII scrubbing before the model sees any rows. Visualizations
are handled by Foundry's integrated Code Interpreter tool, not by custom Python
execution inside this hosted container.
"""

import os
import re
import sys
from typing import Annotated, Optional

import psycopg2
from agent_framework import tool
from azure.identity import DefaultAzureCredential

# Module-level credential for AAD token auth (fresh token per connection)
_credential = DefaultAzureCredential()


def _log(msg: str) -> None:
    """Unbuffered stderr logging for diagnostics. Visible in container log stream."""
    print(f"[TOOL] {msg}", file=sys.stderr, flush=True)


# DB connect timeout — bounds get_market_data so a wedged PG never hangs the
# agent turn. The agent will surface a string error and the next call recovers.
_DB_CONNECT_TIMEOUT = 5


# ---------------------------------------------------------------------------
# Dataset → SQL view mapping
# ---------------------------------------------------------------------------
DATASET_VIEWS = {
    "sales_by_region": "vw_sales_by_region",
    "customer_segments": "vw_customer_segments",
    "quarterly_financials": "vw_quarterly_financials",
}

# ---------------------------------------------------------------------------
# PII scrubbing patterns (second-layer defence)
# ---------------------------------------------------------------------------
PII_PATTERNS = [
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED-SSN]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[REDACTED-EMAIL]"),
    (re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"), "[REDACTED-PHONE]"),
]


def _scrub_pii(text: str) -> str:
    """Remove any PII that slipped through the SQL views."""
    for pattern, replacement in PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ---------------------------------------------------------------------------
# get_market_data
# ---------------------------------------------------------------------------
@tool(approval_mode="never_require")
def get_market_data(
    dataset: Annotated[
        str,
        "Dataset to query. One of: sales_by_region, customer_segments, quarterly_financials",
    ],
    filters: Annotated[
        Optional[dict],
        'Optional filters as key-value pairs, e.g. {"quarter": "Q1-2025", "region": "North"}',
    ] = None,
) -> str:
    """
    Access Contoso's internal datasets through sanitized SQL views.
    Data is automatically scrubbed for PII compliance before being returned.
    """
    _log(f"get_market_data ENTRY dataset={dataset!r} filters={filters!r}")
    view_name = DATASET_VIEWS.get(dataset)
    if view_name is None:
        available = ", ".join(DATASET_VIEWS.keys())
        msg = f"Unknown dataset '{dataset}'. Available datasets: {available}"
        _log(f"get_market_data EXIT-unknown {msg}")
        return msg

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        _log("get_market_data EXIT-no-db-url")
        return "Error: DATABASE_URL is not configured."

    try:
        # Get AAD token for Entra-only PostgreSQL auth
        token = _credential.get_token(
            "https://ossrdbms-aad.database.windows.net/.default"
        ).token
        _log(f"get_market_data got AAD token (len={len(token)})")
        conn = psycopg2.connect(
            database_url + f" password={token} connect_timeout={_DB_CONNECT_TIMEOUT}"
        )
        try:
            cur = conn.cursor()

            query = f"SELECT * FROM {view_name}"
            params: list = []

            if filters:
                clauses = []
                for key, value in filters.items():
                    clauses.append(f"{key} = %s")
                    params.append(value)
                if clauses:
                    query += " WHERE " + " AND ".join(clauses)

            _log(f"get_market_data SQL={query!r} params={params!r}")
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()

            cur.close()
        finally:
            conn.close()

        # Format as CSV-like table
        lines = [",".join(columns)]
        for row in rows:
            lines.append(",".join(str(v) for v in row))

        result = "\n".join(lines)
        scrubbed = _scrub_pii(result)
        _log(
            f"get_market_data EXIT-ok rows={len(rows)} chars={len(scrubbed)} preview={scrubbed[:150]!r}"
        )
        return scrubbed

    except Exception as e:
        _log(f"get_market_data EXIT-exception {type(e).__name__}: {e}")
        return f"Error querying dataset '{dataset}': {e}"
