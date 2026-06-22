import microsoftLogo from "@/assets/microsoft.svg";
import type { ReactNode } from "react";
import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

interface Verdict {
  label: string;
  title: string;
  detail: ReactNode;
}

const MicrosoftMark = () => (
  <img
    src={microsoftLogo}
    alt="Microsoft"
    className="mx-1 inline-block h-[0.95em] w-auto align-[-0.12em] object-contain"
  />
);

const verdicts: Verdict[] = [
  {
    label: "Narrow tools",
    title: "Keep data behind one tool.",
    detail:
      "get_market_data is the only path to the database, not generated code.",
  },
  {
    label: "Sandbox + inspect",
    title: "Images are output channels.",
    detail:
      "Run code on sanitized rows, and review every artifact, not just text.",
  },
  {
    label: "Built-in by default",
    title: "Prefer built-in tools.",
    detail: (
      <>
        Built-in tools from <MicrosoftMark />
        <span className="font-medium text-foreground">Microsoft</span>, like
        Foundry Code Interpreter, bring enterprise-grade security by design.
      </>
    ),
  },
];

export function KeyTakeaways({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Key takeaways"
      isActive={isActive}
      title="Tool boundaries beat prompt wording."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <div className="grid grid-cols-1 gap-5 lg:min-h-full lg:content-center lg:grid-cols-3 lg:gap-6">
        {verdicts.map((verdict, index) => {
          const selected = cycleIndex === index;

          return (
            <Card
              className={cn(
                "flex min-w-0 cursor-pointer flex-col border-2 p-6 transition-colors duration-300",
                selected ? "border-primary" : "border-border",
              )}
              key={verdict.title}
              onClick={() => onSelectCycle(index)}
            >
              <Badge variant={selected ? "default" : "outline"}>
                {verdict.label}
              </Badge>
              <p className="mt-5 text-2xl font-semibold leading-tight tracking-[-0.03em]">
                {verdict.title}
              </p>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {verdict.detail}
              </p>
            </Card>
          );
        })}
      </div>
    </SlideFrame>
  );
}
