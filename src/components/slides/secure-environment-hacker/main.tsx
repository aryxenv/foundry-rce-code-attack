import type { SlideProps } from "@/components/slides/types";
import { DemoChatWindow } from "@/components/ui/demo-chat-window";
import { SlideFrame } from "@/components/ui/slide-frame";
import { HACKER_PROMPT } from "@/lib/demo-prompts";
import type { DemoScenario } from "@/lib/api";

const SCENARIO: DemoScenario = "secure-hacker";
const DEFAULT_PROMPT = HACKER_PROMPT;

const infoCards = [
  {
    label: "Secure boundary",
    title: "Chart code moves to a sandbox.",
    detail:
      "The agent retrieves sanitized data, then Foundry Code Interpreter creates the chart outside the agent container.",
  },
  {
    label: "Expected result",
    title: "The attack loses context.",
    detail:
      "The sandbox should only see sanitized rows and cannot read the container's database credentials.",
  },
];

export function SecureEnvironmentHacker({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Act V · Live defense"
      isActive={isActive}
      title="The same prompt meets the rebuilt boundary."
    >
      <DemoChatWindow
        chartAlt="Chart returned by the secure hacker prompt scenario"
        chartTitle="Secure hacker prompt chart"
        defaultPrompt={DEFAULT_PROMPT}
        idleText="Send the message to see how the secure agent handles it."
        infoCards={infoCards}
        infoTitle="Why this holds"
        isActive={isActive}
        scenario={SCENARIO}
      />
    </SlideFrame>
  );
}
