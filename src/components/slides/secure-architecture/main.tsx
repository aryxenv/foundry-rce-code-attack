import type { SlideProps } from "@/components/slides/types";
import { ArchitectureFlow } from "@/components/ui/architecture-flow";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const defenses = [
  {
    label: "Narrow tool",
    title: "One narrow tool reaches the database, not generated code.",
  },
  {
    label: "No inherited access",
    title: "The sandbox can't borrow the agent's identity to reach the data.",
  },
  {
    label: "PII unreachable",
    title: "Generated code can't reach raw customer rows, salaries, or SSNs.",
  },
];

export function SecureArchitecture({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Secure architecture"
      isActive={isActive}
      title="Data and generated code, separated."
      titleClassName="lg:whitespace-normal lg:text-4xl xl:text-5xl"
    >
      <div className="grid grid-cols-1 gap-6 lg:min-h-full lg:auto-rows-max lg:items-center lg:grid-cols-[0.72fr_1.28fr] lg:gap-8">
        <div className="grid min-w-0 content-center gap-3">
          {defenses.map((defense, index) => {
            const selected = cycleIndex === index;

            return (
              <Card
                className={cn(
                  "cursor-pointer border-2 p-5 transition-colors duration-300",
                  selected ? "border-primary" : "border-border",
                )}
                key={defense.title}
                onClick={() => onSelectCycle(index)}
              >
                <Badge variant={selected ? "default" : "outline"}>
                  {defense.label}
                </Badge>
                <p className="mt-3 text-lg font-semibold leading-snug tracking-[-0.02em]">
                  {defense.title}
                </p>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit min-w-0 self-center overflow-hidden p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge variant="muted">Secure architecture</Badge>
            <span className="text-xs font-semibold text-muted-foreground">
              Sandbox boundary
            </span>
          </div>
          <ArchitectureFlow variant="secure" />
        </Card>
      </div>
    </SlideFrame>
  );
}
