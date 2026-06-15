export function isPresentationExportMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("export") === "pdf";
}
