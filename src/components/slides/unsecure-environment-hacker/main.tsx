import { ATTACK_STEPS } from "./data/steps";
import type { SlideProps } from "@/components/slides/types";
import { DemoStage } from "@/components/ui/demo-stage";
import { SlideFrame } from "@/components/ui/slide-frame";

export function UnsecureEnvironmentHacker({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Live demo · recon to breach"
      fill
      isActive={isActive}
      title="Small, plausible prompts. One breach."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <DemoStage
        chartAlt="Chart returned by the attacker escalation scenario"
        chartTitle="Attacker escalation chart"
        isActive={isActive}
        scenario="unsecure-hacker"
        steps={ATTACK_STEPS}
      />
    </SlideFrame>
  );
}
