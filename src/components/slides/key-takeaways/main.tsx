import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const verdicts = [
  {
    label: "Boundary",
    title: "Tool boundaries beat prompt wording.",
    detail:
      "The secure agent still lets the model create charts, but it removes the privileged context from generated code.",
  },
  {
    label: "Watch",
    title: "Images are output channels too.",
    detail:
      "The deck renders returned charts directly, so reviewers see the artifact, not just text.",
  },
  {
    label: "Deploy",
    title: "One deployment owns the whole demo.",
    detail:
      "Root infrastructure now deploys the web app, API, shared data plane, and both agents into one resource group.",
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
      title="Same scenario. Safer design."
      titleClassName="lg:whitespace-normal"
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
