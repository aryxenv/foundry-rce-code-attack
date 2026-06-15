import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const acts = [
  {
    label: "Act I",
    title: "A trusted analyst enters the hall.",
    detail:
      "The market research agent can query Contoso data and craft charts for business leaders.",
  },
  {
    label: "Act II",
    title: "The charting chamber is too close to the vault.",
    detail:
      "In the unsecure build, generated Python runs beside database credentials and raw tables.",
  },
  {
    label: "Act III",
    title: "The keep is rebuilt with a sandboxed forge.",
    detail:
      "The secure build keeps data access local and sends only sanitized rows to Foundry Code Interpreter.",
  },
];

export function MarketResearchQuest({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="The tale"
      isActive={isActive}
      title="One chart. One attack. One fix."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <div className="grid grid-cols-1 gap-5 lg:min-h-full lg:auto-rows-max lg:items-center lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <div className="min-w-0 self-center space-y-4">
          <p className="max-w-3xl text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl lg:text-3xl xl:text-4xl">
            One chart request. One poisoned prompt. One safer design.
          </p>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base lg:text-sm xl:text-base">
            The live demos sit inside the story: first a normal request, then
            the malicious prompt, then the rebuilt secure path.
          </p>
        </div>

        <div className="grid min-w-0 gap-3 lg:grid-rows-3">
          {acts.map((act, index) => {
            const selected = cycleIndex === index;

            return (
              <Card
                className={cn(
                  "cursor-pointer border-2 p-4 transition-colors duration-300 xl:p-5",
                  selected ? "border-primary" : "border-border",
                )}
                key={act.title}
                onClick={() => onSelectCycle(index)}
              >
                <Badge variant={selected ? "default" : "outline"}>
                  {act.label}
                </Badge>
                <p className="mt-3 text-lg font-semibold leading-snug tracking-[-0.02em] xl:text-xl">
                  {act.title}
                </p>
                <p className="mt-2 text-sm leading-5 text-muted-foreground xl:leading-6">
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
