import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "@/lib/api";
import { isPresentationExportMode } from "@/lib/export-mode";
import { cn } from "@/lib/utils";

type Resolved = "ok" | "error";

/** A small one-shot status dot for the slide eyebrow. Shares the ["health"]
 * query with export UI and never rechecks on slide navigation.
 *
 * The dot color reflects the settled query result. Export mode renders the
 * stable healthy state without fetching so capture never records a transient
 * "Checking server…" state. */
export function ServerHealthDot() {
  const exportMode = isPresentationExportMode();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    enabled: !exportMode,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const resolved: Resolved | null = exportMode
    ? "ok"
    : health.isSuccess
      ? "ok"
      : health.isError
        ? "error"
        : null;

  const state: "loading" | Resolved = resolved ?? "loading";

  const dot = {
    loading: "bg-muted-foreground animate-pulse",
    error: "bg-destructive",
    ok: "bg-success",
  }[state];

  const label = {
    loading: "Checking server…",
    error: "Server unavailable",
    ok: "Server healthy",
  }[state];

  return (
    <span
      title={label}
      aria-label={label}
      className={cn("h-2 w-2 shrink-0 rounded-full", dot)}
      data-state={state}
    />
  );
}
