"""
Post-deployment setup: seeds PostgreSQL with fake Contoso data, builds +
deploys the hosted agent (Microsoft Agent Framework) to Foundry.

Reads all config from azd env — zero manual input required.
Usage: python scripts/setup.py
"""

import os
import shutil
import subprocess
import sys
import time

import psycopg2
from azure.identity import DefaultAzureCredential

# On Windows, `az` is a .cmd file which subprocess.run can't find without shell=True.
AZ = shutil.which("az") or "az"


def get_azd_env() -> dict[str, str]:
    """Pull all deployment outputs from azd env."""
    result = subprocess.run(
        ["azd", "env", "get-values"],
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
    """Create tables, sanitized views, and insert fake Contoso data into PostgreSQL."""
    token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default").token
    conn_str = f"host={fqdn} port=5432 dbname=postgres user={deployer_upn} sslmode=require password={token}"
    conn = psycopg2.connect(conn_str)
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
    print("✅ Seeded PostgreSQL with fake Contoso data (customers, sales, employee_compensation)")


def build_agent_image(acr_name: str):
    """Build the hosted agent image in ACR via remote build (no local Docker needed)."""
    agent_dir = os.path.join(os.path.dirname(__file__), "..", "src", "agent")
    agent_dir = os.path.abspath(agent_dir)

    print(f"📦 Building agent image in ACR '{acr_name}' (remote build)...")
    subprocess.run(
        [AZ, "acr", "build", "--registry", acr_name, "--image", "contoso-agent:latest",
         "--no-logs", agent_dir],
        check=True,
    )
    print(f"✅ Agent image pushed to {acr_name}.azurecr.io/contoso-agent:latest")


def deploy_hosted_agent(project_endpoint: str, acr_name: str, database_url: str, credential,
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

    image = f"{acr_name}.azurecr.io/contoso-agent:latest"

    env_vars = {
        "PROJECT_ENDPOINT": project_endpoint,
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
            container_protocol_versions=[ProtocolVersionRecord(protocol=AgentProtocol.RESPONSES, version="v1")],
            cpu="1",
            memory="2Gi",
            image=image,
            environment_variables=env_vars,
        ),
    )

    print(f"✅ Deployed hosted agent: {agent.name} (version: {agent.version})")
    return agent.name, agent.version


def start_hosted_agent(account_name: str, project_name: str, agent_name: str, agent_version):
    """Start the hosted agent deployment so it serves requests.

    create_version only registers the spec; the deployment sits at min/max=0 (Stopped)
    until you call `az cognitiveservices agent start`. There is no Python SDK for this
    yet — the docs use the az CLI. The `cognitiveservices agent` command group is built
    into core az CLI 2.83.0+ (preview, no extension install required).
    See: https://learn.microsoft.com/azure/foundry/agents/how-to/manage-hosted-agent
    """
    print(f"▶️  Starting hosted agent '{agent_name}' v{agent_version}...")
    # Note: --min-replicas/--max-replicas are accepted by `agent update` but not by `agent start`
    # in current az CLI (2.83.0). Start defaults to min=1/max=1 per docs, which is what we want.
    subprocess.run(
        [
            AZ, "cognitiveservices", "agent", "start",
            "--account-name", account_name,
            "--project-name", project_name,
            "--name", agent_name,
            "--agent-version", str(agent_version),
        ],
        check=True,
    )
    print(f"✅ Hosted agent started — should be Running in ~1 minute.")


def generate_env_file(project_endpoint: str, database_url: str):
    """Generate .env file for local agent development."""
    agent_dir = os.path.join(os.path.dirname(__file__), "..", "src", "agent")
    env_path = os.path.join(os.path.abspath(agent_dir), ".env")

    with open(env_path, "w") as f:
        f.write(f"PROJECT_ENDPOINT={project_endpoint}\n")
        f.write("MODEL_DEPLOYMENT_NAME=gpt-4o-mini\n")
        f.write(f"DATABASE_URL={database_url}\n")

    print(f"✅ Generated {env_path} for local development")


def main():
    print("🚀 Contoso Market Research Agent — Post-Deployment Setup\n")

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

    if not all([project_endpoint, database_url, acr_name, fqdn]):
        print("❌ Missing deployment outputs. Run 'azd up' first.")
        print(f"   PROJECT_ENDPOINT={project_endpoint}")
        print(f"   DATABASE_URL={database_url}")
        print(f"   AZURE_CONTAINER_REGISTRY_NAME={acr_name}")
        print(f"   POSTGRESQL_FQDN={fqdn}")
        sys.exit(1)

    # Get deployer UPN for AAD auth to PostgreSQL
    deployer_upn = subprocess.run(
        [AZ, "ad", "signed-in-user", "show", "--query", "userPrincipalName", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    # Pin DefaultAzureCredential to the deployment's tenant. Without this it picks up
    # whatever tenant is "default" in the local az/MSAL cache, which can mismatch the
    # Techorama tenant and cause "access token isn't valid for this server's tenant".
    deployment_tenant = subprocess.run(
        [AZ, "account", "show", "--query", "tenantId", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    credential = DefaultAzureCredential(
        additionally_allowed_tenants=["*"],
        # Force PG token to be issued in the deployment tenant.
    )
    # AzureCliCredential is the most reliable on dev machines with multiple tenants.
    from azure.identity import AzureCliCredential
    credential = AzureCliCredential(tenant_id=deployment_tenant)

    # Step 1: Seed PostgreSQL with fake Contoso data
    seed_database(fqdn, deployer_upn, credential)

    # Step 2: Generate .env for local agent development
    generate_env_file(project_endpoint, database_url)

    # Step 3: Build agent image and deploy as hosted agent
    try:
        build_agent_image(acr_name)

        # Allow RBAC role assignments (e.g. AcrPull for AI Project) to propagate
        # before the hosted agent attempts to pull the container image.
        print("⏳ Waiting 90 seconds for role assignments to propagate...")
        time.sleep(90)

        agent_name, agent_version = deploy_hosted_agent(
            project_endpoint, acr_name, database_url, credential,
            chart_storage_account=chart_storage_account,
            chart_storage_container=chart_storage_container,
        )

        # create_version only registers the spec — start the deployment so it actually runs.
        try:
            start_hosted_agent(ai_services_name, project_name, agent_name, agent_version)
        except Exception as start_err:
            print(f"\n⚠️  Auto-start failed: {start_err}")
            print(f"   Run manually:")
            print(f"     az cognitiveservices agent start \\")
            print(f"       --account-name {ai_services_name} --project-name {project_name} \\")
            print(f"       --name {agent_name} --agent-version {agent_version}")
            print(f"   Or click 'Start agent deployment' in the Foundry portal.")

        print(f"\n🎯 Setup complete! Hosted agent deployed: {agent_name}")
    except Exception as e:
        print(f"\n⚠️  Automated agent deployment failed: {e}")
        print(f"\n📋 Deploy the agent manually:")
        print(f"   Option 1: Open src/agent in VS Code and deploy via Foundry extension")
        print(f"   Option 2: cd src/agent && agent deploy")
        print(f"   Option 3: Build and push manually:")
        print(f"     az acr build --registry {acr_name} --image contoso-agent:latest src/agent")
        print(f"     Then create agent version in Foundry portal")

    print(f"\n   Database: (PostgreSQL connected)")
    print(f"   Project Endpoint: {project_endpoint}")


if __name__ == "__main__":
    main()
