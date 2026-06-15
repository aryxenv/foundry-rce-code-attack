import safeArchitecture from "@/assets/safe_architecture.png";
import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ImageDialog } from "@/components/ui/image-dialog";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const defenses = [
  {
    label: "Gate",
    title: "Only get_market_data reaches PostgreSQL.",
  },
  {
    label: "Forge",
    title: "Foundry Code Interpreter receives sanitized rows.",
  },
  {
    label: "Courier",
    title: "Generated images return through private chart storage.",
  },
];

export function SecureCitadelArchitecture({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="The rebuilt citadel"
      isActive={isActive}
      title="Secure design separates data from generated code."
      titleClassName="lg:whitespace-normal"
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
                <p className="mt-4 text-lg font-semibold leading-snug tracking-[-0.02em]">
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
          <ImageDialog
            alt="Secure architecture diagram showing Foundry Code Interpreter isolated from database credentials"
            description="Expanded view of the secure agent architecture."
            src={safeArchitecture}
            title="Secure architecture"
          >
            <button
              className="block w-full overflow-hidden rounded-md border border-border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              type="button"
            >
              <img
                alt="Secure architecture diagram showing Foundry Code Interpreter isolated from database credentials"
                className="max-h-[42vh] w-full object-contain"
                src={safeArchitecture}
              />
            </button>
          </ImageDialog>
        </Card>
      </div>
    </SlideFrame>
  );
}
