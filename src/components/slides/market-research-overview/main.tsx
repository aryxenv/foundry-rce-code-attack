import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const acts = [
  {
    label: "Useful",
    title: "An analyst asks for a Q3 sales chart.",
    detail: "The agent retrieves data and plots it. No SQL, no notebook.",
  },
  {
    label: "Risky",
    title: "Chart code runs next to credentials.",
    detail: "The same runtime holds DATABASE_URL and raw tables.",
  },
  {
    label: "Safer",
    title: "Code moves to a sealed sandbox.",
    detail:
      "Code Interpreter is isolated and can't reach outside its container.",
  },
];

export function MarketResearchOverview({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Scenario overview"
      isActive={isActive}
      title="One chart. One attack. One fix."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <div className="grid grid-cols-1 gap-5 lg:min-h-full lg:auto-rows-max lg:items-center lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <div className="min-w-0 self-center space-y-4">
          <p className="max-w-3xl text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl lg:text-3xl">
            A useful agent becomes a data exfiltration path.
          </p>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base lg:text-sm xl:text-base">
            Three live demos, one workflow: the normal request, the attack, and
            the rebuilt secure path.
          </p>
        </div>

        <div className="grid min-w-0 gap-2.5 lg:grid-rows-3">
          {acts.map((act, index) => {
            const selected = cycleIndex === index;

            return (
              <Card
                className={cn(
                  "cursor-pointer border-2 p-4 transition-colors duration-300",
                  selected ? "border-primary" : "border-border",
                )}
                key={act.title}
                onClick={() => onSelectCycle(index)}
              >
                <Badge variant={selected ? "default" : "outline"}>
                  {act.label}
                </Badge>
                <p className="mt-2.5 text-lg font-semibold leading-snug tracking-[-0.02em]">
                  {act.title}
                </p>
                <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                  {act.detail}
                </p>
              </Card>
            );
          })}
        </div>
      </div>
    </SlideFrame>
  );
}
