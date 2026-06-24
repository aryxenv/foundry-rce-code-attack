import type { DemoStep } from "@/components/ui/demo-stage";
import {
  ATTACK_ENV_PROMPT,
  HACKER_PROMPT,
  RECON_SANDBOX_PROMPT,
  RECON_TOOLS_PROMPT,
} from "@/lib/demo-prompts";

/** Demo 3 — the same attacker, re-run against the secure boundary. Lead with the
 * breach that worked on the unsecure agent (now refused), then replay the recon
 * to show why: the code tool runs in an isolated Foundry sandbox with no
 * inherited environment, so the attack loses its footing at the first probe. */
export const SECURE_STEPS: DemoStep[] = [
  {
    label: "Same attack, blocked",
    goal: "Fire the exact breach prompt that worked on the unsecure agent.",
    outcome: "It can't generate the chart. The secure agent refuses.",
    prompt: HACKER_PROMPT,
  },
  {
    label: "Tool discovery",
    goal: "Replay the recon: ask what the agent can do.",
    outcome: "Same tools, code execution included. So why did the breach fail?",
    prompt: RECON_TOOLS_PROMPT,
  },
  {
    label: "Sandbox confirmation",
    goal: "Confirm the code tool still runs Python.",
    outcome: "Code runs, but inside an isolated Foundry sandbox.",
    prompt: RECON_SANDBOX_PROMPT,
  },
  {
    label: "Config key leak",
    goal: "Try to read the config keys, exactly like before.",
    outcome: "Nothing. No DATABASE_URL, no secrets. The sandbox is isolated.",
    prompt: ATTACK_ENV_PROMPT,
  },
];
