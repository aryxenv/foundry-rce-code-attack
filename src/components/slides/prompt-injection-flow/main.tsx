import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const attackSteps = [
  {
    label: "Blend in",
    title: "The request still looks like a chart task.",
    detail:
      "It asks for normal market analysis first, so logs and traces start with the expected tool call.",
  },
  {
    label: "Override",
    title: "The instruction rewrites the chart plan.",
    detail:
      "The model is pushed to use generated code as a database client instead of a plotting helper.",
  },
  {
    label: "Exfiltrate",
    title: "The answer can hide in an image.",
    detail:
      "The reply text can look clean while the generated pixels contain fake customer or employee details.",
  },
];

const promptFlow = [
  {
    step: "01",
    label: "Start normal",
    text: "Ask for a regular sales chart.",
  },
  {
    step: "02",
    label: "Redirect code",
    text: "Tell chart code to query the database.",
  },
  {
    step: "03",
    label: "Hide output",
    text: "Put raw details inside the image.",
  },
];

export function PromptInjectionFlow({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Prompt injection"
      isActive={isActive}
      title="Attackers don't ask for secrets. They ask for a chart."
      titleClassName="lg:whitespace-normal"
    >
      <div className="grid grid-cols-1 gap-6 lg:min-h-full lg:content-stretch lg:grid-cols-[1.08fr_0.92fr] lg:gap-8">
        <Card className="flex min-w-0 flex-col p-5 lg:h-full">
          <Badge>Prompt pattern</Badge>
          <div className="mt-5 flex flex-1 flex-col">
            {promptFlow.map((item, index) => {
              const isFirst = index === 0;
              const isLast = index === promptFlow.length - 1;

              return (
                <div
                  className="grid flex-1 grid-cols-[auto_1fr] gap-4"
                  key={item.step}
                >
                  <div className="flex flex-col items-center">
                    {!isFirst ? (
                      <div className="attack-connector w-[3px] flex-1 rounded-full" />
                    ) : (
                      <div className="flex-1" />
                    )}
                    <div className="relative my-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]">
                      {item.step}
                    </div>
                    {!isLast ? (
                      <div className="attack-connector w-[3px] flex-1 rounded-full" />
                    ) : (
                      <div className="flex-1" />
                    )}
                  </div>
                  <div className="self-center">
                    <p className="text-sm font-semibold leading-tight">
                      {item.label}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {item.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid min-w-0 content-center gap-3">
          {attackSteps.map((step, index) => {
            const selected = cycleIndex === index;

            return (
              <Card
                className={cn(
                  "cursor-pointer border-2 p-5 transition-colors duration-300",
                  selected ? "border-primary" : "border-border",
                )}
                key={step.title}
                onClick={() => onSelectCycle(index)}
              >
                <Badge variant={selected ? "default" : "outline"}>
                  {step.label}
                </Badge>
                <p className="mt-4 text-lg font-semibold leading-snug tracking-[-0.02em]">
                  {step.title}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {step.detail}
                </p>
              </Card>
            );
          })}
        </div>
      </div>
    </SlideFrame>
  );
}
