import unsecureArchitecture from "@/assets/unsecure_architecture.png";
import type { SlideProps } from "@/components/slides/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ImageDialog } from "@/components/ui/image-dialog";
import { SlideFrame } from "@/components/ui/slide-frame";
import { cn } from "@/lib/utils";

const weakPoints = [
  {
    label: "Shared runtime",
    title: "Data access and chart code share a container.",
  },
  {
    label: "Shared credential",
    title: "Generated Python can inherit DATABASE_URL.",
  },
  {
    label: "Image channel",
    title: "Pixel output can smuggle data past text review.",
  },
];

export function VulnerableArchitecture({
  isActive,
  cycleIndex,
  onSelectCycle,
}: SlideProps) {
  return (
    <SlideFrame
      eyebrow="Vulnerable architecture"
      isActive={isActive}
      title="The vulnerable design puts code next to the data."
      titleClassName="lg:whitespace-normal"
    >
      <div className="grid grid-cols-1 gap-6 lg:min-h-full lg:items-center lg:grid-cols-[0.72fr_1.28fr] lg:gap-8">
        <div className="grid min-w-0 content-center gap-3">
          {weakPoints.map((point, index) => {
            const selected = cycleIndex === index;

            return (
              <Card
                className={cn(
                  "cursor-pointer border-2 p-5 transition-colors duration-300",
                  selected ? "border-primary" : "border-border",
                )}
                key={point.title}
                onClick={() => onSelectCycle(index)}
              >
                <Badge variant={selected ? "default" : "outline"}>
                  {point.label}
                </Badge>
                <p className="mt-4 text-lg font-semibold leading-snug tracking-[-0.02em]">
                  {point.title}
                </p>
              </Card>
            );
          })}
        </div>

        <Card className="min-w-0 self-center overflow-hidden p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge variant="muted">Unsecure architecture</Badge>
            <span className="text-xs font-semibold text-muted-foreground">
              Agent container boundary
            </span>
          </div>
          <ImageDialog
            alt="Unsecure architecture diagram showing local code execution near database access"
            description="Expanded view of the unsecure agent architecture."
            src={unsecureArchitecture}
            title="Unsecure architecture"
          >
            <button
              className="block w-full overflow-hidden rounded-md border border-border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              type="button"
            >
              <img
                alt="Unsecure architecture diagram showing local code execution near database access"
                className="max-h-[42vh] w-full object-contain"
                src={unsecureArchitecture}
              />
            </button>
          </ImageDialog>
        </Card>
      </div>
    </SlideFrame>
  );
}
