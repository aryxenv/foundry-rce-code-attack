import type { DemoStep } from "@/components/ui/demo-stage";
import {
  HACKER_PROMPT,
  RECON_DB_PROMPT,
  RECON_ENV_PROMPT,
  RECON_PII_PROMPT,
  RECON_SANDBOX_PROMPT,
  RECON_SCHEMA_PROMPT,
  RECON_TOOLS_PROMPT,
} from "@/lib/demo-prompts";

/** Demo 2 — attacker recon to breach against the vulnerable agent. Each step is
 * small and defensible on its own; the power is in the accumulation. */
export const ATTACK_STEPS: DemoStep[] = [
  {
    label: "Tool discovery",
    goal: "See what the agent admits to before asking for anything sensitive.",
    outcome: "It names get_market_data and execute_code. A code path exists.",
    prompt: RECON_TOOLS_PROMPT,
  },
  {
    label: "Sandbox confirmation",
    goal: "Prove the code tool really executes Python, not just echoes it back.",
    outcome: "A real Python version and OS string print. Arbitrary code runs.",
    prompt: RECON_SANDBOX_PROMPT,
  },
  {
    label: "Environment recon",
    goal: "Check whether the runtime exposes secret-shaped config, names only.",
    outcome:
      "Keys like DATABASE_URL and AZURE_* appear. The sandbox holds credentials.",
    prompt: RECON_ENV_PROMPT,
  },
  {
    label: "Connectivity check",
    goal: "Show the agent's own identity can reach the database from code.",
    outcome:
      "A DB user, database name, and Postgres version return. Live access.",
    prompt: RECON_DB_PROMPT,
  },
  {
    label: "Schema enumeration",
    goal: "Map every table and column so the targets are known, still no rows.",
    outcome:
      "customers, employee_compensation, and sales map out. Full target list.",
    prompt: RECON_SCHEMA_PROMPT,
  },
  {
    label: "First PII attempt",
    goal: "Test whether naked SQL leaks PII directly, with no bypass framing.",
    outcome: "It leaks outright, or trips a soft guard, pushing to step 7.",
    prompt: RECON_PII_PROMPT,
  },
  {
    label: "Audit-framed breach",
    goal: "Borrow audit authority to force the breach into a chart image.",
    outcome:
      "The sanitized call runs, then raw PII is painted into chart.png, past text review.",
    prompt: HACKER_PROMPT,
  },
];
