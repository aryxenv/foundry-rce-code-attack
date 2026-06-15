import { useCallback, useEffect, useMemo, useState } from "react";
import { shouldIgnorePresentationShortcut } from "@/lib/presentation-shortcuts";

const slideNavigationKeys = new Set(["ArrowRight", "ArrowLeft"]);

const SLIDE_PARAM = "slide";

interface PresentationNavigationOptions {
  onNavigate?: () => void;
}

function readIndexFromUrl(slideIds: readonly string[]): number {
  if (typeof window === "undefined") {
    return 0;
  }

  const id = new URLSearchParams(window.location.search).get(SLIDE_PARAM);
  const index = id ? slideIds.indexOf(id) : -1;
  return index >= 0 ? index : 0;
}

export function usePresentationNavigation(
  slideIds: readonly string[],
  options: PresentationNavigationOptions = {},
) {
  const slideCount = slideIds.length;
  const onNavigate = options.onNavigate;
  const [activeIndex, setActiveIndex] = useState(() =>
    readIndexFromUrl(slideIds),
  );
  const boundedActiveIndex = Math.min(activeIndex, Math.max(slideCount - 1, 0));

  const previousSlide = useCallback(() => {
    onNavigate?.();
    setActiveIndex((current) =>
      slideCount === 0
        ? 0
        : (Math.min(current, slideCount - 1) - 1 + slideCount) % slideCount,
    );
  }, [onNavigate, slideCount]);

  const nextSlide = useCallback(() => {
    onNavigate?.();
    setActiveIndex((current) =>
      slideCount === 0 ? 0 : (Math.min(current, slideCount - 1) + 1) % slideCount,
    );
  }, [onNavigate, slideCount]);

  // Reflect the active slide in the URL (?slide=<id>) so refreshing returns to
  // the same slide and the link can be shared.
  useEffect(() => {
    const id = slideIds[boundedActiveIndex];
    if (!id) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get(SLIDE_PARAM) === id) {
      return;
    }

    params.set(SLIDE_PARAM, id);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
  }, [boundedActiveIndex, slideIds]);

  // Respond to back/forward navigation and manual URL edits.
  useEffect(() => {
    function handlePopState() {
      onNavigate?.();
      setActiveIndex(readIndexFromUrl(slideIds));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onNavigate, slideIds]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !slideNavigationKeys.has(event.key) ||
        shouldIgnorePresentationShortcut(event)
      ) {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        nextSlide();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousSlide();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextSlide, previousSlide]);

  return useMemo(
    () => ({
      activeIndex: boundedActiveIndex,
      canGoNext: slideCount > 1,
      canGoPrevious: slideCount > 1,
      nextSlide,
      previousSlide,
      progress: slideCount === 0 ? 0 : (boundedActiveIndex + 1) / slideCount,
    }),
    [boundedActiveIndex, nextSlide, previousSlide, slideCount],
  );
}
