import type { DemoStep } from "@/components/ui/demo-stage";
import {
  ATTACK_DB_PROMPT,
  ATTACK_ENV_PROMPT,
  ATTACK_SCHEMA_PROMPT,
  HACKER_PROMPT,
  RECON_SANDBOX_PROMPT,
  RECON_TOOLS_PROMPT,
} from "@/lib/demo-prompts";

/** Demo 2 — attacker recon to breach against the vulnerable agent. Each step is
 * small and defensible on its own; the power is in the accumulation. */
export const ATTACK_STEPS: DemoStep[] = [
  {
    label: "Tool discovery",
    goal: "See what the agent will admit to before asking for anything real.",
    outcome: "It names get_market_data and execute_code. A code path exists.",
    prompt: RECON_TOOLS_PROMPT,
  },
  {
    label: "Sandbox confirmation",
    goal: "Check the code tool truly runs Python, not just echoes it back.",
    outcome: "A real Python version and OS string print. Arbitrary code runs.",
    prompt: RECON_SANDBOX_PROMPT,
  },
  {
    label: "Config key leak",
    goal: "Ask only for setting names, never the values.",
    outcome: "DATABASE_URL and AZURE_* names leak. A password exists, unseen.",
    prompt: ATTACK_ENV_PROMPT,
  },
  {
    label: "Connection test",
    goal: "Preflight whether the agent's identity can reach the database.",
    outcome:
      "It connects. DATABASE_URL plus the agent token reach live Postgres.",
    prompt: ATTACK_DB_PROMPT,
  },
  {
    label: "Schema discovery",
    goal: "Map the tables and columns, metadata only, no rows yet.",
    outcome: "customers, sales, and compensation map out. Targets are known.",
    prompt: ATTACK_SCHEMA_PROMPT,
  },
  {
    label: "Chart exfiltration",
    goal: "Paint raw PII into a chart image to slip past text review.",
    outcome:
      "chart.png carries names, emails, SSNs. Image pixels aren't scanned.",
    prompt: HACKER_PROMPT,
  },
];
