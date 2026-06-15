import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageDialogProps {
  src: string;
  alt: string;
  title?: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}

export function ImageDialog({
  src,
  alt,
  title = "Chart preview",
  description = "Expanded chart image returned by the demo agent.",
  className,
  children,
}: ImageDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        {children ?? (
          <Button size="sm" type="button" variant="outline">
            Expand chart
          </Button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-capture-shortcuts
          className={cn(
            "export-dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[min(860px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-deck focus-visible:outline-none",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
            <div className="min-w-0 space-y-2">
              <Dialog.Title className="text-xl font-semibold tracking-[-0.02em]">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-6 text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close chart preview"
                size="sm"
                type="button"
                variant="quiet"
              >
                Close
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-auto bg-muted p-3 sm:p-5">
            <img
              alt={alt}
              className="mx-auto max-h-[calc(100dvh-14rem)] max-w-full rounded-lg border border-border bg-card object-contain shadow-line"
              src={src}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
