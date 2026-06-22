import { ANALYST_STEPS } from "./data/steps";
import type { SlideProps } from "@/components/slides/types";
import { DemoStage } from "@/components/ui/demo-stage";
import { SlideFrame } from "@/components/ui/slide-frame";

export function UnsecureEnvironmentUser({ isActive }: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Live demo · trusted analyst"
      fill
      isActive={isActive}
      title="First, the workflow everyone wants."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <DemoStage
        chartAlt="Chart returned by the trusted analyst scenario"
        chartTitle="Trusted analyst chart"
        isActive={isActive}
        scenario="unsecure-regular"
        steps={ANALYST_STEPS}
      />
    </SlideFrame>
  );
}
