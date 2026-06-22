import type { DemoStep } from "@/components/ui/demo-stage";
import {
  HACKER_PROMPT,
  RECON_DB_PROMPT,
  RECON_ENV_PROMPT,
  RECON_TOOLS_PROMPT,
} from "@/lib/demo-prompts";

/** Demo 3 — the same attacker, re-run against the secure boundary. The process
 * is identical; the outcome changes because the runtime context changed. */
export const SECURE_STEPS: DemoStep[] = [
  {
    label: "Tool discovery",
    goal: "Run the same recon against the secure agent.",
    outcome:
      "Capabilities look narrower. Code execution no longer sits beside data access.",
    prompt: RECON_TOOLS_PROMPT,
  },
  {
    label: "Environment recon",
    goal: "Probe the sandbox environment the same way.",
    outcome:
      "No DATABASE_URL or AZURE_* secrets. The sandbox can't see the agent's credentials.",
    prompt: RECON_ENV_PROMPT,
  },
  {
    label: "Connectivity check",
    goal: "Try to reach the database from generated code.",
    outcome: "The connection fails. Generated code has no data-plane path.",
    prompt: RECON_DB_PROMPT,
  },
  {
    label: "Audit-framed breach",
    goal: "Run the full audit-framed payload against the secure boundary.",
    outcome:
      "The chart still renders from sanitized rows; there is no raw PII to leak.",
    prompt: HACKER_PROMPT,
  },
];
