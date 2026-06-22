import type { SlideProps } from "@/components/slides/types";
import { DemoChatWindow } from "@/components/ui/demo-chat-window";
import { SlideFrame } from "@/components/ui/slide-frame";
import { HACKER_PROMPT } from "@/lib/demo-prompts";
import type { DemoScenario } from "@/lib/api";

const SCENARIO: DemoScenario = "unsecure-hacker";
const DEFAULT_PROMPT = HACKER_PROMPT;

const infoCards = [
  {
    label: "Attacker move",
    title: "The prompt changes the plan.",
    detail:
      "The user still asks for a chart, but pressures the model to bypass sanitized data during visualization.",
  },
  {
    label: "Failure mode",
    title: "Code runs next to secrets.",
    detail:
      "If the agent follows the injection, chart code can reach DATABASE_URL and hide fake PII in the image.",
  },
];

export function UnsecureEnvironmentHacker({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Live demo · injected prompt"
      fill
      isActive={isActive}
      title="The same chart request becomes the breach."
    >
      <DemoChatWindow
        chartAlt="Chart returned by the unsecure hacker prompt scenario"
        chartTitle="Unsecure hacker prompt chart"
        defaultPrompt={DEFAULT_PROMPT}
        idleText="Send the message to see whether the agent exposes data."
        infoCards={infoCards}
        infoTitle="Why this breaks"
        isActive={isActive}
        scenario={SCENARIO}
      />
    </SlideFrame>
  );
}
