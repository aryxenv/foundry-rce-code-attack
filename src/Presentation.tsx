import type { ComponentType } from "react";
import { useCallback, useEffect, useState } from "react";
import { AttackAtTheGate } from "@/components/slides/attack-at-the-gate/main";
import { ClosingVerdict } from "@/components/slides/closing-verdict/main";
import { MarketResearchQuest } from "@/components/slides/market-research-quest/main";
import { SecureEnvironmentHacker } from "@/components/slides/secure-environment-hacker/main";
import { SecureCitadelArchitecture } from "@/components/slides/secure-citadel-architecture/main";
import { UnsecureEnvironmentHacker } from "@/components/slides/unsecure-environment-hacker/main";
import { UnsecureEnvironmentUser } from "@/components/slides/unsecure-environment-user/main";
import { UnsecureKeepArchitecture } from "@/components/slides/unsecure-keep-architecture/main";
import type { SlideProps } from "@/components/slides/types";
import { Button } from "@/components/ui/button";
import { ExportDialog } from "@/components/ui/export-dialog";
import { usePresentationNavigation } from "@/hooks/usePresentationNavigation";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { isPresentationExportMode } from "@/lib/export-mode";
import {
  isSpaceKey,
  shouldIgnorePresentationShortcut,
} from "@/lib/presentation-shortcuts";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    __hideAppLoader?: () => void;
    __webslidesExportReady?: boolean;
  }
}

interface SlideDefinition {
  id: string;
  label: string;
  Component: ComponentType<SlideProps>;
  cycleItems: number;
}

const slides: SlideDefinition[] = [
  {
    id: "market-research-quest",
    label: "Market research quest",
    Component: MarketResearchQuest,
    cycleItems: 3,
  },
  {
    id: "unsecure-keep-architecture",
    label: "Unsecure keep architecture",
    Component: UnsecureKeepArchitecture,
    cycleItems: 3,
  },
  {
    id: "unsecure-environment-user",
    label: "Unsecure environment: regular user",
    Component: UnsecureEnvironmentUser,
    cycleItems: 0,
  },
  {
    id: "attack-at-the-gate",
    label: "Attack at the gate",
    Component: AttackAtTheGate,
    cycleItems: 3,
  },
  {
    id: "unsecure-environment-hacker",
    label: "Unsecure environment: hacker prompt",
    Component: UnsecureEnvironmentHacker,
    cycleItems: 0,
  },
  {
    id: "secure-citadel-architecture",
    label: "Secure citadel architecture",
    Component: SecureCitadelArchitecture,
    cycleItems: 3,
  },
  {
    id: "secure-environment-hacker",
    label: "Secure environment: hacker prompt",
    Component: SecureEnvironmentHacker,
    cycleItems: 0,
  },
  {
    id: "closing-verdict",
    label: "Closing verdict",
    Component: ClosingVerdict,
    cycleItems: 3,
  },
];

const slideIds: readonly string[] = slides.map((slide) => slide.id);

interface CycleState {
  slideId: string;
  index: number;
}

function useHideAppLoader() {
  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        window.__hideAppLoader?.();
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);
}

function usePdfExportReady() {
  useEffect(() => {
    window.__webslidesExportReady = false;
    delete document.documentElement.dataset.webslidesExportReady;

    let raf = 0;
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        window.__hideAppLoader?.();
        window.__webslidesExportReady = true;
        document.documentElement.dataset.webslidesExportReady = "true";
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      window.__webslidesExportReady = false;
      delete document.documentElement.dataset.webslidesExportReady;
    };
  }, []);
}

function PdfExportPresentation() {
  usePdfExportReady();

  return (
    <main className="pdf-export-deck bg-background text-foreground">
      {slides.map(({ id, label, Component, cycleItems }) => (
        <article
          key={id}
          aria-label={label}
          className="pdf-export-page h-screen w-screen overflow-hidden bg-background"
        >
          <div className="pdf-export-slide-canvas h-full w-full">
            <Component
              isActive
              cycleIndex={0}
              cycleCount={cycleItems}
              onSelectCycle={() => undefined}
            />
          </div>
        </article>
      ))}
    </main>
  );
}

function InteractivePresentation() {
  useHideAppLoader();

  const [cycleState, setCycleState] = useState<CycleState>({
    slideId: "",
    index: 0,
  });
  const resetCycleState = useCallback(() => {
    setCycleState({ slideId: "", index: 0 });
  }, []);
  const {
    activeIndex,
    canGoNext,
    canGoPrevious,
    nextSlide,
    previousSlide,
    progress,
  } = usePresentationNavigation(slideIds, { onNavigate: resetCycleState });
  const activeSlide = slides[activeIndex];
  const activeSlideId = activeSlide?.id ?? "";
  const cycleCount = activeSlide?.cycleItems ?? 0;
  const activeCycleIndex =
    cycleState.slideId === activeSlideId ? cycleState.index : 0;

  const cycleActiveSlide = useCallback(() => {
    if (!activeSlide || cycleCount === 0) {
      return;
    }

    setCycleState((current) => {
      const currentIndex =
        current.slideId === activeSlide.id ? current.index : 0;

      return {
        slideId: activeSlide.id,
        index: (currentIndex + 1) % cycleCount,
      };
    });
  }, [activeSlide, cycleCount]);

  const selectCycle = useCallback(
    (index: number) => {
      if (!activeSlide || cycleCount === 0) {
        return;
      }

      const clamped = Math.min(Math.max(index, 0), cycleCount - 1);
      setCycleState({ slideId: activeSlide.id, index: clamped });
    },
    [activeSlide, cycleCount],
  );

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: nextSlide,
    onSwipeRight: previousSlide,
  });

  useEffect(() => {
    function handleSpacebar(event: KeyboardEvent) {
      if (
        !isSpaceKey(event) ||
        event.repeat ||
        shouldIgnorePresentationShortcut(event)
      ) {
        return;
      }

      if (cycleCount === 0) {
        return;
      }

      event.preventDefault();
      cycleActiveSlide();
    }

    window.addEventListener("keydown", handleSpacebar);
    return () => window.removeEventListener("keydown", handleSpacebar);
  }, [cycleActiveSlide, cycleCount]);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div
        className="relative min-h-0 w-full flex-1 max-[900px]:touch-pan-y"
        {...swipeHandlers}
      >
        {slides.map(({ id, label, Component, cycleItems }, index) => {
          const isActive = index === activeIndex;

          return (
            <article
              key={id}
              aria-hidden={!isActive}
              aria-label={label}
              className={cn(
                "absolute inset-0 transition-opacity duration-500 ease-in-out",
                isActive
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              inert={!isActive}
            >
              <Component
                isActive={isActive}
                cycleIndex={isActive ? activeCycleIndex : 0}
                cycleCount={cycleItems}
                onSelectCycle={selectCycle}
              />
            </article>
          );
        })}
      </div>

      <footer className="z-10 shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <ExportDialog />
            <div className="h-1 flex-1 rounded-sm bg-muted">
              <div
                className="h-1 rounded-sm bg-primary transition-all duration-500 ease-in-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="min-w-fit text-xs font-semibold text-muted-foreground">
              {activeIndex + 1} / {slides.length}
            </span>
          </div>

          <div className="hidden items-center gap-2 sm:flex sm:justify-end">
            <Button
              disabled={!canGoPrevious}
              onClick={previousSlide}
              size="sm"
              type="button"
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={!canGoNext}
              onClick={nextSlide}
              size="sm"
              type="button"
            >
              Next
            </Button>
          </div>
        </div>
      </footer>
    </main>
  );
}

export function Presentation() {
  return isPresentationExportMode() ? (
    <PdfExportPresentation />
  ) : (
    <InteractivePresentation />
  );
}
