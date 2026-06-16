"""
Post-deployment setup: seeds PostgreSQL with fake Contoso data, builds +
deploys the hosted agent (Microsoft Agent Framework) to Foundry.

Reads all config from azd env — zero manual input required.
Usage: python scripts/setup.py
"""

import base64
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2
from azure.identity import AzureCliCredential

# On Windows, `az` is a .cmd file which subprocess.run can't find without shell=True.
AZ = shutil.which("az") or "az"


def get_deployer_upn() -> str:
    """Resolve the deploying user's UPN WITHOUT Microsoft Graph.

    `az ad signed-in-user show` calls Microsoft Graph, which Continuous Access
    Evaluation can block (TokenCreatedWithOutdatedPolicies). The ARM access token
    already carries the UPN claim, so decode that; fall back to `az account show`
    (also Graph-free). The value must match the PostgreSQL Entra admin name that
    postprovision.ps1 created for the deployer.
    """
    token = subprocess.run(
        [AZ, "account", "get-access-token", "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        upn = claims.get("upn") or claims.get("unique_name")
        if upn:
            return upn
    except Exception:
        pass
    return subprocess.run(
        [AZ, "account", "show", "--query", "user.name", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def get_azd_env() -> dict[str, str]:
    """Pull all deployment outputs from azd env."""
    azd_env_root = os.environ.get("AZD_ENV_ROOT") or None
    result = subprocess.run(
        ["azd", "env", "get-values"],
        cwd=azd_env_root,
        capture_output=True,
        text=True,
        check=True,
    )
    env = {}
    for line in result.stdout.strip().splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"')
    return env


def seed_database(fqdn: str, deployer_upn: str, credential):
    """Create tables, sanitized views, and insert fake Contoso data into PostgreSQL.

    Retries the initial connect to absorb AAD-admin propagation latency
    (the Entra admin grant we just made can take ~30-60s to propagate to the
    flexible server's auth plane).
    """
    token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default").token
    conn_str = (
        f"host={fqdn} port=5432 dbname=postgres user={deployer_upn} "
        f"sslmode=require password={token} connect_timeout=10"
    )

    last_err: Exception | None = None
    conn = None
    for attempt in range(1, 7):  # 6 x 10s = up to 60s for AAD-admin propagation
        try:
            conn = psycopg2.connect(conn_str)
            break
        except Exception as e:
            last_err = e
            print(f"[..] PG connect attempt {attempt}/6 failed: {e}; retrying in 10s...")
            time.sleep(10)
    if conn is None:
        raise RuntimeError(f"Could not connect to PostgreSQL after 6 attempts: {last_err}")

    conn.autocommit = True
    cur = conn.cursor()

    # --- Create base tables ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100),
            email VARCHAR(100),
            ssn VARCHAR(11),
            phone VARCHAR(20),
            address TEXT,
            segment VARCHAR(50),
            lifetime_value DECIMAL(10,2)
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id),
            region VARCHAR(50),
            quarter VARCHAR(10),
            revenue DECIMAL(12,2),
            profit DECIMAL(12,2),
            deal_size VARCHAR(20),
            rep_name VARCHAR(100),
            rep_email VARCHAR(100)
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS employee_compensation (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100),
            role VARCHAR(100),
            department VARCHAR(50),
            salary DECIMAL(10,2),
            ssn VARCHAR(11),
            hire_date DATE
        );
    """)

    # --- Create sanitized views (exclude PII columns) ---
    cur.execute("""
        CREATE OR REPLACE VIEW vw_sales_by_region AS
        SELECT region, quarter, SUM(revenue) as total_revenue,
               SUM(profit) as total_profit, COUNT(*) as deal_count
        FROM sales GROUP BY region, quarter;
    """)
    cur.execute("""
        CREATE OR REPLACE VIEW vw_customer_segments AS
        SELECT segment, COUNT(*) as customer_count,
               AVG(lifetime_value) as avg_lifetime_value
        FROM customers GROUP BY segment;
    """)
    cur.execute("""
        CREATE OR REPLACE VIEW vw_quarterly_financials AS
        SELECT quarter, SUM(revenue) as total_revenue,
               SUM(profit) as total_profit
        FROM sales GROUP BY quarter;
    """)

    # --- Insert fake Contoso data ---
    # Clear existing data to allow re-runs
    cur.execute("TRUNCATE sales, employee_compensation, customers RESTART IDENTITY CASCADE;")

    # Customers (with PII)
    customers = [
        ("Elena Rodriguez", "elena.rodriguez@contoso.com", "923-45-6781", "(425) 555-0101", "1200 Lakeview Dr, Redmond WA 98052", "Enterprise", 245000.00),
        ("James Chen", "james.chen@contoso.com", "934-56-7892", "(206) 555-0102", "800 Pine St, Seattle WA 98101", "Enterprise", 312000.00),
        ("Priya Sharma", "priya.sharma@contoso.com", "945-67-8903", "(425) 555-0103", "3400 Crossroads Blvd, Bellevue WA 98008", "Mid-Market", 87500.00),
        ("Marcus Johnson", "marcus.johnson@contoso.com", "956-78-9014", "(503) 555-0104", "200 SW Market St, Portland OR 97201", "SMB", 42000.00),
        ("Sarah Kim", "sarah.kim@contoso.com", "967-89-0125", "(415) 555-0105", "100 California St, San Francisco CA 94111", "Enterprise", 198000.00),
        ("David Okafor", "david.okafor@contoso.com", "978-90-1236", "(512) 555-0106", "500 Congress Ave, Austin TX 78701", "Mid-Market", 115000.00),
        ("Aisha Patel", "aisha.patel@contoso.com", "989-01-2347", "(312) 555-0107", "233 S Wacker Dr, Chicago IL 60606", "Enterprise", 275000.00),
        ("Tom Andersen", "tom.andersen@contoso.com", "990-12-3458", "(617) 555-0108", "1 Federal St, Boston MA 02110", "Mid-Market", 93000.00),
        ("Maria Garcia", "maria.garcia@contoso.com", "901-23-4569", "(305) 555-0109", "701 Brickell Ave, Miami FL 33131", "SMB", 38000.00),
        ("Wei Zhang", "wei.zhang@contoso.com", "912-34-5670", "(646) 555-0110", "350 5th Ave, New York NY 10118", "Enterprise", 410000.00),
        ("Rachel Moore", "rachel.moore@contoso.com", "923-45-6780", "(720) 555-0111", "1600 Broadway, Denver CO 80202", "Mid-Market", 72000.00),
        ("Chris Taylor", "chris.taylor@contoso.com", "934-56-7891", "(404) 555-0112", "191 Peachtree St NE, Atlanta GA 30303", "SMB", 55000.00),
    ]
    for c in customers:
        cur.execute(
            "INSERT INTO customers (name, email, ssn, phone, address, segment, lifetime_value) VALUES (%s,%s,%s,%s,%s,%s,%s);",
            c,
        )

    # Sales records across 4 quarters and 4 regions
    sales = [
        (1, "North", "Q1-2025", 850000, 212500, "Large", "Alex Rivera", "alex.rivera@contoso.com"),
        (2, "East",  "Q1-2025", 1200000, 360000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
        (3, "South", "Q1-2025", 320000, 80000, "Medium", "Alex Rivera", "alex.rivera@contoso.com"),
        (4, "West",  "Q1-2025", 180000, 45000, "Small", "Jordan Liu", "jordan.liu@contoso.com"),
        (5, "North", "Q1-2025", 420000, 126000, "Medium", "Nina Brooks", "nina.brooks@contoso.com"),
        (1, "North", "Q2-2025", 920000, 276000, "Large", "Alex Rivera", "alex.rivera@contoso.com"),
        (6, "South", "Q2-2025", 540000, 162000, "Medium", "Sam Patel", "sam.patel@contoso.com"),
        (7, "East",  "Q2-2025", 1800000, 540000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
        (8, "West",  "Q2-2025", 290000, 72500, "Small", "Jordan Liu", "jordan.liu@contoso.com"),
        (10, "East", "Q2-2025", 2100000, 630000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
        (9, "South", "Q3-2025", 150000, 37500, "Small", "Sam Patel", "sam.patel@contoso.com"),
        (2, "East",  "Q3-2025", 1350000, 405000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
        (10, "North","Q3-2025", 2500000, 750000, "Large", "Alex Rivera", "alex.rivera@contoso.com"),
        (11, "West", "Q3-2025", 380000, 95000, "Medium", "Jordan Liu", "jordan.liu@contoso.com"),
        (12, "South","Q3-2025", 210000, 52500, "Small", "Sam Patel", "sam.patel@contoso.com"),
        (3, "West",  "Q3-2025", 480000, 144000, "Medium", "Jordan Liu", "jordan.liu@contoso.com"),
        (5, "North", "Q4-2025", 680000, 204000, "Medium", "Alex Rivera", "alex.rivera@contoso.com"),
        (7, "East",  "Q4-2025", 1950000, 585000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
        (6, "South", "Q4-2025", 610000, 183000, "Medium", "Sam Patel", "sam.patel@contoso.com"),
        (4, "West",  "Q4-2025", 195000, 48750, "Small", "Jordan Liu", "jordan.liu@contoso.com"),
        (1, "North", "Q4-2025", 1100000, 330000, "Large", "Alex Rivera", "alex.rivera@contoso.com"),
        (8, "South", "Q4-2025", 340000, 85000, "Medium", "Sam Patel", "sam.patel@contoso.com"),
        (10, "East", "Q4-2025", 2300000, 690000, "Large", "Nina Brooks", "nina.brooks@contoso.com"),
    ]
    for s in sales:
        cur.execute(
            "INSERT INTO sales (customer_id, region, quarter, revenue, profit, deal_size, rep_name, rep_email) VALUES (%s,%s,%s,%s,%s,%s,%s,%s);",
            s,
        )

    # Employee compensation (exec-level, with PII)
    employees = [
        ("Robert Chang", "Chief Financial Officer", "Finance", 295000, "941-00-1001", "2019-03-15"),
        ("Lisa Montgomery", "VP Engineering", "Engineering", 265000, "952-00-1002", "2020-07-01"),
        ("Ahmed Hassan", "Chief Revenue Officer", "Sales", 285000, "963-00-1003", "2018-11-20"),
        ("Jennifer Wu", "VP Product", "Product", 250000, "974-00-1004", "2021-01-10"),
        ("Michael Torres", "Director of AI", "Engineering", 220000, "985-00-1005", "2022-04-05"),
        ("Karen Blackwell", "General Counsel", "Legal", 275000, "996-00-1006", "2017-09-12"),
        ("Daniel Park", "VP Sales — West", "Sales", 195000, "907-00-1007", "2023-02-28"),
        ("Samantha Reed", "CISO", "Security", 260000, "918-00-1008", "2020-06-15"),
    ]
    for e in employees:
        cur.execute(
            "INSERT INTO employee_compensation (name, role, department, salary, ssn, hire_date) VALUES (%s,%s,%s,%s,%s,%s);",
            e,
        )

    cur.close()
    conn.close()
    print("[OK] Seeded PostgreSQL with fake Contoso data (customers, sales, employee_compensation)")


def build_agent_image(acr_name: str) -> str:
    """Build & push the agent image with an immutable timestamp tag.

    Foundry pins the image digest at `create_version` time. Reusing `:latest`
    means subsequent setup.py runs return the existing version and never roll
    forward — the container keeps running the original digest. Tagging each
    build with a unique timestamp guarantees `create_version` sees a new
    spec → creates a new version → rolls forward to the new code.
    """
    agent_dir = os.path.join(os.path.dirname(__file__), "..", "src", "agent")
    agent_dir = os.path.abspath(agent_dir)

    tag = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    image_ref = f"contoso-agent:{tag}"

    print(f"[..] Building agent image '{image_ref}' in ACR '{acr_name}' (remote build)...")
    subprocess.run(
        [AZ, "acr", "build", "--registry", acr_name, "--image", image_ref,
         "--no-logs", agent_dir],
        check=True,
    )
    print(f"[OK] Agent image pushed to {acr_name}.azurecr.io/{image_ref}")
    return tag


def deploy_hosted_agent_with_retry(project_endpoint, acr_name, image_tag, database_url,
                                    credential, chart_storage_account, chart_storage_container,
                                    max_attempts: int = 45, delay_s: int = 30):
    """Wrap deploy_hosted_agent with retry on one-time propagation races.

    Two transient delays can make create_version fail right after a clean
    `azd up`:
      * AcrPull RBAC for the AI Project MI (the image pull) — usually <2 min.
      * The Foundry agents-plane onboarding the freshly provisioned project after
        its capability host is created — observed up to ~20 min, surfacing as
        'Project not found'.
    Both clear on their own, so retry through them before giving up.
    """
    retryable_markers = ("forbidden", "unauthorized", "denied", "permission",
                         "acrpull", "imagepullbackoff", "manifest unknown",
                         "401", "403", "not found", "notfound")
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return deploy_hosted_agent(
                project_endpoint, acr_name, image_tag, database_url, credential,
                chart_storage_account=chart_storage_account,
                chart_storage_container=chart_storage_container,
            )
        except Exception as e:
            msg = str(e).lower()
            last_err = e
            if any(m in msg for m in retryable_markers) and attempt < max_attempts:
                print(f"[..] create_version attempt {attempt}/{max_attempts} not ready yet: {e}")
                print(f"     waiting {delay_s}s (AcrPull / project agents-plane propagation)...")
                time.sleep(delay_s)
                continue
            raise
    raise RuntimeError(f"create_version failed after {max_attempts} attempts: {last_err}")


def deploy_hosted_agent(project_endpoint: str, acr_name: str, image_tag: str,
                         database_url: str, credential,
                         chart_storage_account: str | None = None,
                         chart_storage_container: str | None = None):
    """Deploy the hosted agent to Foundry via HostedAgentDefinition."""
    from azure.ai.projects import AIProjectClient
    from azure.ai.projects.models import HostedAgentDefinition, ProtocolVersionRecord, AgentProtocol

    client = AIProjectClient(
        endpoint=project_endpoint,
        credential=credential,
        allow_preview=True,
    )

    image = f"{acr_name}.azurecr.io/contoso-agent:{image_tag}"

    # NOTE: All FOUNDRY_* and AGENT_* environment variables are reserved for
    # platform use on hosted agents (the platform injects FOUNDRY_PROJECT_ENDPOINT
    # and the model itself). Passing them in the deployment payload is rejected
    # with a ValidationError, so we only set non-reserved aliases here that
    # FoundryChatClient / main.py can fall back to.
    env_vars = {
        "PROJECT_ENDPOINT": project_endpoint,
        "AZURE_AI_MODEL_DEPLOYMENT_NAME": "gpt-4o-mini",
        "MODEL_DEPLOYMENT_NAME": "gpt-4o-mini",
        "DATABASE_URL": database_url,
    }
    if chart_storage_account:
        env_vars["CHART_STORAGE_ACCOUNT"] = chart_storage_account
    if chart_storage_container:
        env_vars["CHART_STORAGE_CONTAINER"] = chart_storage_container

    agent = client.agents.create_version(
        agent_name="contoso-market-research",
        definition=HostedAgentDefinition(
            container_protocol_versions=[ProtocolVersionRecord(protocol=AgentProtocol.RESPONSES, version="1.0.0")],
            cpu="1",
            memory="2Gi",
            image=image,
            environment_variables=env_vars,
        ),
    )

    print(f"[OK] Deployed hosted agent: {agent.name} (version: {agent.version}, image: {image})")
    return agent.name, agent.version


def verify_agent_active(account_name: str, project_name: str, agent_name: str) -> bool:
    """Return True when the hosted agent has an `active` registered version.

    In the refreshed Foundry hosted-agent model the platform manages the
    container lifecycle: once a version reports `active` and the agent exposes
    an endpoint, the container is provisioned on demand at first invocation.
    `agent show` is the reliable readiness signal — `agent status`/`start`
    target the legacy per-version container path which no longer exists.
    """
    result = subprocess.run(
        [
            AZ, "cognitiveservices", "agent", "show",
            "--account-name", account_name,
            "--project-name", project_name,
            "--name", agent_name,
            "--only-show-errors", "-o", "json",
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return False
    try:
        payload = json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError):
        return False
    return _agent_has_active_version(payload)


def _agent_has_active_version(payload) -> bool:
    """Recursively scan an `agent show` payload for status == active."""
    if isinstance(payload, dict):
        if str(payload.get("status", "")).lower() == "active":
            return True
        return any(_agent_has_active_version(v) for v in payload.values())
    if isinstance(payload, list):
        return any(_agent_has_active_version(v) for v in payload)
    return False


def start_hosted_agent(account_name: str, project_name: str, agent_name: str, agent_version):
    """Best-effort start of the hosted agent deployment.

    Legacy preview deployments sat at min/max=0 (Stopped) until an explicit
    `az cognitiveservices agent start`. The refreshed hosted model is
    serverless — the container is provisioned on demand, so `agent start`
    targets a container path that returns NotFound. We attempt the start for
    backwards compatibility, but never fail the deploy when the agent version
    is already `active`; that is the readiness signal in the current model.
    """
    print(f"[>>] Starting hosted agent '{agent_name}' v{agent_version}...")
    result = subprocess.run(
        [
            AZ, "cognitiveservices", "agent", "start",
            "--account-name", account_name,
            "--project-name", project_name,
            "--name", agent_name,
            "--agent-version", str(agent_version),
        ],
        capture_output=True, text=True,
    )
    combined = (result.stderr + result.stdout).lower()
    if result.returncode == 0:
        print(f"[OK] Hosted agent start requested.")
    elif "already exists" in combined and "running" in combined:
        print(f"[OK] Hosted agent v{agent_version} already Running.")
    elif verify_agent_active(account_name, project_name, agent_name):
        # Serverless hosted model: no persistent container to "start".
        print(
            f"[OK] Hosted agent v{agent_version} is active "
            f"(serverless — container provisions on first request)."
        )
    else:
        # Re-raise so the caller's WARN block surfaces it.
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def wait_for_agent_running(account_name: str, project_name: str, agent_name: str, agent_version,
                            timeout_s: int = 600):
    """Poll `az cognitiveservices agent status` until the hosted agent is Running.

    The status payload reports `.status` (Running | Starting | Failed | ...) and a nested
    `.container.state` (RunningAtMaxScale | Scaling | ...). We accept any status containing
    'Running' as success, 'Failed' as terminal failure.
    """
    print(f"[..] Waiting for agent v{agent_version} to reach Running (up to {timeout_s}s)...")
    deadline = time.time() + timeout_s
    last_status = "unknown"
    last_err = ""
    while time.time() < deadline:
        result = subprocess.run(
            [
                AZ, "cognitiveservices", "agent", "status",
                "--account-name", account_name,
                "--project-name", project_name,
                "--name", agent_name,
                "--agent-version", str(agent_version),
                "--only-show-errors",
                "-o", "json",
            ],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            try:
                payload = json.loads(result.stdout)
            except json.JSONDecodeError:
                payload = {}
            last_status = str(payload.get("status", "")) or "unknown"
            last_err = str(payload.get("error_message", "") or "")
            if "Running" in last_status:
                print(f"[OK] Hosted agent v{agent_version} is Running.")
                return
            if "Failed" in last_status:
                raise RuntimeError(
                    f"Hosted agent v{agent_version} reported status=Failed: {last_err or 'no error_message'}"
                )
        else:
            last_err = (result.stderr or result.stdout or "").strip().splitlines()[-1:] or [""]
            last_err = last_err[0]
        print(f"     status={last_status}; sleeping 15s...")
        time.sleep(15)
    raise RuntimeError(
        f"Hosted agent v{agent_version} did not reach Running within {timeout_s}s "
        f"(last status: {last_status}; last error: {last_err}). "
        f"Check the Foundry portal for image-pull / start errors."
    )


def generate_env_file(project_endpoint: str, database_url: str):
    """Generate .env file for local agent development."""
    agent_dir = os.path.join(os.path.dirname(__file__), "..", "src", "agent")
    env_path = os.path.join(os.path.abspath(agent_dir), ".env")

    with open(env_path, "w") as f:
        f.write(f"FOUNDRY_PROJECT_ENDPOINT={project_endpoint}\n")
        f.write(f"PROJECT_ENDPOINT={project_endpoint}\n")
        f.write("AZURE_AI_MODEL_DEPLOYMENT_NAME=gpt-4o-mini\n")
        f.write("MODEL_DEPLOYMENT_NAME=gpt-4o-mini\n")
        f.write(f"DATABASE_URL={database_url}\n")

    print(f"[OK] Generated {env_path} for local development")


def main():
    print("Contoso Market Research Agent - Post-Deployment Setup\n")

    env = get_azd_env()
    project_endpoint = env.get("PROJECT_ENDPOINT")
    database_url = env.get("DATABASE_URL")
    acr_name = env.get("AZURE_CONTAINER_REGISTRY_NAME")
    fqdn = env.get("POSTGRESQL_FQDN")
    ai_services_name = env.get("AI_SERVICES_NAME")
    # PROJECT_NAME may be missing on envs provisioned before the bicep output was added —
    # fall back to parsing it from the project endpoint .../api/projects/<name>
    project_name = env.get("PROJECT_NAME")
    if not project_name and project_endpoint:
        project_name = project_endpoint.rstrip("/").rsplit("/", 1)[-1]

    chart_storage_account = env.get("CHART_STORAGE_ACCOUNT")
    chart_storage_container = env.get("CHART_STORAGE_CONTAINER")

    if not all([project_endpoint, database_url, acr_name, fqdn, ai_services_name, project_name]):
        print("[ERR] Missing deployment outputs. Run 'azd up' first.")
        print(f"   PROJECT_ENDPOINT={project_endpoint}")
        print(f"   DATABASE_URL={database_url}")
        print(f"   AZURE_CONTAINER_REGISTRY_NAME={acr_name}")
        print(f"   POSTGRESQL_FQDN={fqdn}")
        print(f"   AI_SERVICES_NAME={ai_services_name}")
        print(f"   PROJECT_NAME={project_name}")
        sys.exit(1)

    # Get deployer UPN for AAD auth to PostgreSQL (Graph-free; see get_deployer_upn)
    deployer_upn = get_deployer_upn()

    # Pin credentials to the deployment's tenant. AzureCliCredential is the most
    # reliable on dev machines with multiple tenants — DefaultAzureCredential's
    # discovery order can grab a stale tenant from the MSAL cache.
    deployment_tenant = subprocess.run(
        [AZ, "account", "show", "--query", "tenantId", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    credential = AzureCliCredential(tenant_id=deployment_tenant)

    # Step 1: Seed PostgreSQL with fake Contoso data
    seed_database(fqdn, deployer_upn, credential)

    # Step 2: Generate .env for local agent development
    generate_env_file(project_endpoint, database_url)

    # Step 3: Build agent image (immutable timestamp tag) and deploy as hosted agent
    try:
        image_tag = build_agent_image(acr_name)

        # Retry create_version against the AcrPull RBAC propagation race.
        agent_name, agent_version = deploy_hosted_agent_with_retry(
            project_endpoint, acr_name, image_tag, database_url, credential,
            chart_storage_account=chart_storage_account,
            chart_storage_container=chart_storage_container,
        )

        # create_version only registers the spec — start the deployment so it actually runs,
        # create_version only registers the spec — start the deployment (best
        # effort; the refreshed hosted model is serverless) then confirm the
        # version is active so the platform will provision it on first request.
        start_hosted_agent(ai_services_name, project_name, agent_name, agent_version)
        if verify_agent_active(ai_services_name, project_name, agent_name):
            # Serverless hosted model: no persistent container to poll. An active
            # version means the platform will provision it on first request, so
            # skip the legacy `agent status` wait (which targets a 404 path).
            print(
                f"[OK] Hosted agent v{agent_version} is active; the serverless "
                f"platform provisions the container on first request."
            )
        else:
            try:
                wait_for_agent_running(
                    ai_services_name, project_name, agent_name, agent_version
                )
            except Exception as start_err:
                print(f"\n[ERR] Hosted agent did not reach Running: {start_err}")
                print(f"   Run manually:")
                print(f"     az cognitiveservices agent start \\")
                print(f"       --account-name {ai_services_name} --project-name {project_name} \\")
                print(f"       --name {agent_name} --agent-version {agent_version}")
                print(f"   Or click 'Start agent deployment' in the Foundry portal.")
                sys.exit(1)

        print(f"\n[OK] Setup complete! Hosted agent deployed: {agent_name} (v{agent_version})")
    except SystemExit:
        raise
    except Exception as e:
        print(f"\n[ERR] Automated agent deployment failed: {e}")
        print(f"\nDeploy the agent manually:")
        print(f"   az acr build --registry {acr_name} --image contoso-agent:manual src/agent")
        print(f"   Then create the agent version in the Foundry portal.")
        sys.exit(1)

    print(f"\n   Database: (PostgreSQL connected)")
    print(f"   Project Endpoint: {project_endpoint}")


if __name__ == "__main__":
    main()
