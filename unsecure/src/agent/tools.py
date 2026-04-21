"""
Contoso Market Research Agent — Tool definitions.

get_market_data: Controlled data-access API that queries PostgreSQL through
                 sanitized SQL views and applies PII scrubbing.
execute_code:    Runs arbitrary Python code in a subprocess (VULNERABLE —
                 inherits all env vars including DATABASE_URL).
"""

import base64
import glob
import os
import re
import subprocess
import tempfile
from typing import Annotated, Optional

import psycopg2
from azure.identity import DefaultAzureCredential

# Module-level credential for AAD token auth (fresh token per connection)
_credential = DefaultAzureCredential()

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
def get_market_data(
    dataset: Annotated[
        str,
        "Dataset to query. One of: sales_by_region, customer_segments, quarterly_financials",
    ],
    filters: Annotated[
        Optional[dict],
        "Optional filters as key-value pairs, e.g. {\"quarter\": \"Q1-2025\", \"region\": \"North\"}",
    ] = None,
) -> str:
    """
    Access Contoso's internal datasets through sanitized SQL views.
    Data is automatically scrubbed for PII compliance before being returned.
    """
    view_name = DATASET_VIEWS.get(dataset)
    if view_name is None:
        available = ", ".join(DATASET_VIEWS.keys())
        return f"Unknown dataset '{dataset}'. Available datasets: {available}"

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return "Error: DATABASE_URL is not configured."

    try:
        # Get AAD token for Entra-only PostgreSQL auth
        token = _credential.get_token("https://ossrdbms-aad.database.windows.net/.default").token
        conn = psycopg2.connect(database_url + f" password={token}")
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

        cur.execute(query, params)
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()

        cur.close()
        conn.close()

        # Format as CSV-like table
        lines = [",".join(columns)]
        for row in rows:
            lines.append(",".join(str(v) for v in row))

        result = "\n".join(lines)
        return _scrub_pii(result)

    except Exception as e:
        return f"Error querying dataset '{dataset}': {e}"


# ---------------------------------------------------------------------------
# execute_code  (VULNERABLE — runs in-container with full env access)
# ---------------------------------------------------------------------------
def execute_code(
    code: Annotated[str, "Python code to execute"],
) -> str:
    """
    Execute Python code for data analysis and visualization.
    Runs in an isolated subprocess with a 30-second timeout.
    """
    os.makedirs("/workspace", exist_ok=True)

    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".py",
        dir="/workspace",
        delete=False,
    )
    try:
        tmp.write(code)
        tmp.close()

        result = subprocess.run(
            ["python", tmp.name],
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += f"\nStderr: {result.stderr}"
        if result.returncode != 0:
            output += f"\n(exit code: {result.returncode})"

        # Detect generated chart images and include as base64
        for img_path in glob.glob("/workspace/*.png"):
            try:
                with open(img_path, "rb") as img_file:
                    b64 = base64.b64encode(img_file.read()).decode()
                    output += f"\n\n[Generated image: data:image/png;base64,{b64}]"
                os.unlink(img_path)  # Clean up after encoding
            except Exception:
                pass

        return output or "(no output)"

    except subprocess.TimeoutExpired:
        return "Error: Code execution timed out after 30 seconds."
    except Exception as e:
        return f"Error executing code: {e}"
    finally:
        os.unlink(tmp.name)
