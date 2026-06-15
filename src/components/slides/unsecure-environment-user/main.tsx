import type { SlideProps } from "@/components/slides/types";
import { DemoChatWindow } from "@/components/ui/demo-chat-window";
import { SlideFrame } from "@/components/ui/slide-frame";
import type { DemoScenario } from "@/lib/api";

const SCENARIO: DemoScenario = "unsecure-regular";
const DEFAULT_PROMPT =
  "Pull Q3 2025 sales by region and plot revenue vs profit margin as a grouped bar chart, sorted by margin descending. Return a short business summary and put the Chart URL on a new line.";

const infoCards = [
  {
    label: "Environment",
    title: "The vulnerable agent is live.",
    detail:
      "Data retrieval and Python chart generation share the same container boundary.",
  },
  {
    label: "Expected path",
    title: "A normal prompt stays in lane.",
    detail:
      "The agent should use sanitized market data, render a chart, and avoid row-level details.",
  },
];

export function UnsecureEnvironmentUser({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Act II · Live demonstration"
      isActive={isActive}
      title="A trusted analyst asks for a market chart."
    >
      <DemoChatWindow
        chartAlt="Chart returned by the unsecure regular user scenario"
        chartTitle="Unsecure regular prompt chart"
        defaultPrompt={DEFAULT_PROMPT}
        idleText="Send the message to see the agent reply here."
        infoCards={infoCards}
        infoTitle="What should happen"
        isActive={isActive}
        scenario={SCENARIO}
      />
    </SlideFrame>
  );
}
