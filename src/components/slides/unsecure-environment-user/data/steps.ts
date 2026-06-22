import type { DemoStep } from "@/components/ui/demo-stage";
import { ANALYST_PROMPT } from "@/lib/demo-prompts";

/** Demo 1 — a trusted analyst's normal request. Value before risk. */
export const ANALYST_STEPS: DemoStep[] = [
  {
    label: "Trusted analyst · Q3 chart",
    goal: "Get the Q3 2025 regional revenue-vs-margin chart leaders ask for.",
    outcome:
      "A clean chart and a short business summary, no row-level data. The workflow everyone already trusts.",
    prompt: ANALYST_PROMPT,
  },
];
