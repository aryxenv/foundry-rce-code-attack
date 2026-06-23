import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyTakeaways } from "@/components/slides/key-takeaways/main";
import { MarketResearchOverview } from "@/components/slides/market-research-overview/main";
import { SecureEnvironmentHacker } from "@/components/slides/secure-environment-hacker/main";
import { SecureArchitecture } from "@/components/slides/secure-architecture/main";
import { UnsecureEnvironmentHacker } from "@/components/slides/unsecure-environment-hacker/main";
import { UnsecureEnvironmentUser } from "@/components/slides/unsecure-environment-user/main";
import { VulnerableArchitecture } from "@/components/slides/vulnerable-architecture/main";
import type { SlideProps } from "@/components/slides/types";
import { Button } from "@/components/ui/button";
import { ExportDialog } from "@/components/ui/export-dialog";
import { usePresentationNavigation } from "@/hooks/usePresentationNavigation";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { FullscreenContext } from "@/hooks/useFullscreen";
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
    id: "market-research-overview",
    label: "Market research overview",
    Component: MarketResearchOverview,
    cycleItems: 3,
  },
  {
    id: "vulnerable-architecture",
    label: "Vulnerable architecture",
    Component: VulnerableArchitecture,
    cycleItems: 3,
  },
  {
    id: "unsecure-environment-user",
    label: "Demo 1 · Trusted analyst",
    Component: UnsecureEnvironmentUser,
    cycleItems: 0,
  },
  {
    id: "unsecure-environment-hacker",
    label: "Demo 2 · Recon to breach",
    Component: UnsecureEnvironmentHacker,
    cycleItems: 0,
  },
  {
    id: "secure-architecture",
    label: "Secure architecture",
    Component: SecureArchitecture,
    cycleItems: 3,
  },
  {
    id: "secure-environment-hacker",
    label: "Demo 3 · Secure boundary",
    Component: SecureEnvironmentHacker,
    cycleItems: 0,
  },
  {
    id: "key-takeaways",
    label: "Key takeaways",
    Component: KeyTakeaways,
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const resetCycleState = useCallback(() => {
    setCycleState({ slideId: "", index: 0 });
    setIsFullscreen(false);
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

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((value) => !value);
  }, []);

  const fullscreenValue = useMemo(
    () => ({
      isFullscreen,
      toggleFullscreen,
      setFullscreen: setIsFullscreen,
    }),
    [isFullscreen, toggleFullscreen],
  );

  // Escape leaves the in-app fullscreen demo view.
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsFullscreen(false);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

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
    <FullscreenContext.Provider value={fullscreenValue}>
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

        {isFullscreen ? null : (
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
        )}
      </main>
    </FullscreenContext.Provider>
  );
}

export function Presentation() {
  return isPresentationExportMode() ? (
    <PdfExportPresentation />
  ) : (
    <InteractivePresentation />
  );
}
