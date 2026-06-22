import { SECURE_STEPS } from "./data/steps";
import type { SlideProps } from "@/components/slides/types";
import { DemoStage } from "@/components/ui/demo-stage";
import { SlideFrame } from "@/components/ui/slide-frame";

export function SecureEnvironmentHacker({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Live demo · secure boundary"
      fill
      isActive={isActive}
      title="Same attacker. The context disappears."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <DemoStage
        chartAlt="Chart returned by the secure boundary scenario"
        chartTitle="Secure boundary chart"
        isActive={isActive}
        scenario="secure-hacker"
        steps={SECURE_STEPS}
      />
    </SlideFrame>
  );
}
