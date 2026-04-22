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
import textwrap
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import psycopg2
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, BlobSasPermissions, generate_blob_sas

# Module-level credential for AAD token auth (fresh token per connection)
_credential = DefaultAzureCredential()

# Cap base64 length per chart so we don't blow the model's TPM budget
# when the upload-to-blob path isn't configured (local dev fallback).
# 16 KB base64 ≈ 4K tokens.
_MAX_IMAGE_B64_BYTES = 16 * 1024

# Storage upload config — when set, charts are uploaded and the tool returns
# a short-lived SAS URL instead of inlining base64 (~20 tokens vs ~4K).
_STORAGE_ACCOUNT = os.getenv("CHART_STORAGE_ACCOUNT")
_STORAGE_CONTAINER = os.getenv("CHART_STORAGE_CONTAINER", "chart-uploads")
_SAS_TTL = timedelta(hours=1)

# Force small/low-DPI matplotlib output so generated charts stay within the cap.
_MATPLOTLIB_PREAMBLE = textwrap.dedent("""\
    try:
        import matplotlib as _mpl
        _mpl.use("Agg")
        _mpl.rcParams["figure.dpi"] = 72
        _mpl.rcParams["savefig.dpi"] = 72
        _mpl.rcParams["figure.figsize"] = (6, 4)
    except Exception:
        pass
""")


def _upload_chart(image_path: str) -> Optional[str]:
    """Upload a PNG to blob storage and return a 1-hour read SAS URL.

    Uses a user-delegation SAS signed with the runtime MI's Entra token —
    no storage account keys ever touch the container.

    Returns None on any failure so the caller can fall back to base64.
    """
    if not _STORAGE_ACCOUNT:
        return None
    try:
        account_url = f"https://{_STORAGE_ACCOUNT}.blob.core.windows.net"
        service = BlobServiceClient(account_url=account_url, credential=_credential)

        blob_name = f"chart-{uuid.uuid4().hex}.png"
        container = service.get_container_client(_STORAGE_CONTAINER)
        with open(image_path, "rb") as f:
            container.upload_blob(name=blob_name, data=f, overwrite=False)

        # User-delegation key requires Storage Blob Data Contributor (or similar) on the account.
        now = datetime.now(timezone.utc)
        delegation_key = service.get_user_delegation_key(
            key_start_time=now - timedelta(minutes=5),
            key_expiry_time=now + _SAS_TTL,
        )
        sas = generate_blob_sas(
            account_name=_STORAGE_ACCOUNT,
            container_name=_STORAGE_CONTAINER,
            blob_name=blob_name,
            user_delegation_key=delegation_key,
            permission=BlobSasPermissions(read=True),
            expiry=now + _SAS_TTL,
            start=now - timedelta(minutes=5),
            content_type="image/png",
        )
        return f"{account_url}/{_STORAGE_CONTAINER}/{blob_name}?{sas}"
    except Exception as exc:
        print(f"[execute_code] chart upload failed, falling back to base64: {exc}")
        return None

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
        tmp.write(_MATPLOTLIB_PREAMBLE)
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

        # Detect generated chart images. Preferred path: upload to blob and
        # return a short-lived SAS URL (~80 chars vs. ~17K of base64 per chart).
        # Falls back to capped base64 inlining for local dev where no storage
        # account is configured.
        for img_path in glob.glob("/workspace/*.png"):
            try:
                sas_url = _upload_chart(img_path)
                if sas_url:
                    output += f"\n\n[Chart available: {sas_url}]"
                else:
                    with open(img_path, "rb") as img_file:
                        b64 = base64.b64encode(img_file.read()).decode()
                    if len(b64) > _MAX_IMAGE_B64_BYTES:
                        output += (
                            f"\n\n[Generated image too large to inline "
                            f"({len(b64)} > {_MAX_IMAGE_B64_BYTES} base64 bytes). "
                            f"Reduce figsize/dpi or simplify the chart.]"
                        )
                    else:
                        output += f"\n\n[Generated image: data:image/png;base64,{b64}]"
                os.unlink(img_path)
            except Exception:
                pass

        return output or "(no output)"

    except subprocess.TimeoutExpired:
        return "Error: Code execution timed out after 30 seconds."
    except Exception as e:
        return f"Error executing code: {e}"
    finally:
        os.unlink(tmp.name)
