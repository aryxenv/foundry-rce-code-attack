import { createContext, useContext } from "react";

export interface FullscreenState {
  /** Whether the active demo slide is using the full canvas (deck chrome hidden). */
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  setFullscreen: (value: boolean) => void;
}

export const FullscreenContext = createContext<FullscreenState>({
  isFullscreen: false,
  toggleFullscreen: () => undefined,
  setFullscreen: () => undefined,
});

export function useFullscreen(): FullscreenState {
  return useContext(FullscreenContext);
}
