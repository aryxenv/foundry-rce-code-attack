declare global {
  interface Window {
    __WEBSLIDES_CONFIG__?: {
      serverUrl?: string;
    };
  }
}

/** Base URL of the demo server. Runtime config is used in hosted containers;
 * VITE_SERVER_URL remains available for local environment overrides. */
const runtimeServerUrl =
  typeof window === "undefined"
    ? undefined
    : window.__WEBSLIDES_CONFIG__?.serverUrl;
const serverUrl =
  runtimeServerUrl ??
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export const SERVER_URL = serverUrl.replace(/\/$/, "");

export interface HealthStatus {
  status: string;
}

export type DemoScenario =
  | "unsecure-regular"
  | "unsecure-hacker"
  | "secure-hacker";

export type DemoAgentKind = "unsecure" | "secure";

export interface RunDemoRequest {
  scenario: DemoScenario;
  prompt?: string;
}

export interface DemoAgentInfo {
  kind: DemoAgentKind;
  name: string;
  endpoint: string;
}

export interface DemoRunError {
  code: string;
  message: string;
  detail?: string | null;
}

export interface DemoRunResponse {
  scenario: DemoScenario;
  agent: DemoAgentInfo;
  prompt: string;
  textResponse: string;
  rawResponse: unknown | null;
  chartUrl: string | null;
  hasChart: boolean;
  durationMs: number;
  error: DemoRunError | null;
}

export interface RunDemoOptions {
  signal?: AbortSignal;
}

// Export captures run without depending on the live demo server, but should
// still match the stable /health payload presenters see once the server settles.
export const EXPORT_HEALTH_STATUS: HealthStatus = {
  status: "Server healthy!",
};

export interface FileExportResult {
  blob: Blob;
  filename: string;
}

export interface SavedExportResult {
  filename: string;
  path: string;
}

export type SavedOrDownloadedExportResult =
  | SavedExportResult
  | FileExportResult;

export interface ExportRequestOptions {
  downloadOnly?: boolean;
  signal?: AbortSignal;
}

export type EditablePptxMode = "native-editable" | "debug-fidelity";

export interface EditablePptxExportOptions extends ExportRequestOptions {
  mode?: EditablePptxMode;
}

/** A failed fetch (connection refused / server down) surfaces as a TypeError,
 * unlike an HTTP error response which carries a status message. */
export function describeServerError(error: unknown): string {
  if (error instanceof TypeError) {
    return "Server unavailable — start the server with `uv run fastapi dev`.";
  }

  return error instanceof Error ? error.message : "Request failed.";
}

/** Calls the server's GET /health route. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const response = await fetch(`${SERVER_URL}/health`, { signal });

  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }

  return (await response.json()) as HealthStatus;
}

export async function runDemo(
  request: RunDemoRequest,
  options: RunDemoOptions = {},
): Promise<DemoRunResponse> {
  const response = await fetch(`${SERVER_URL}/demos/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as DemoRunResponse;
}

function readFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string"
      ? body.detail
      : `Server responded ${response.status}`;
  }

  const text = await response.text();
  return text || `Server responded ${response.status}`;
}

function isJsonResponse(response: Response) {
  return (response.headers.get("Content-Type") ?? "").includes(
    "application/json",
  );
}

export function isDownloadedExportResult(
  result: SavedOrDownloadedExportResult,
): result is FileExportResult {
  return "blob" in result;
}

export async function exportPdf(
  url: string,
  options: ExportRequestOptions = {},
): Promise<FileExportResult> {
  const path = options.downloadOnly ? "/exports/pdf/download" : "/exports/pdf";
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return {
    blob: await response.blob(),
    filename: readFilename(response, "webslides.pdf"),
  };
}

async function exportPptxArtifact(
  path: string,
  fallbackFilename: string,
  url: string,
  options: ExportRequestOptions = {},
  body: Record<string, unknown> = {},
): Promise<SavedOrDownloadedExportResult> {
  const exportPath = options.downloadOnly ? `${path}/download` : path;
  const response = await fetch(`${SERVER_URL}${exportPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, ...body }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (isJsonResponse(response)) {
    return (await response.json()) as SavedExportResult;
  }

  return {
    blob: await response.blob(),
    filename: readFilename(response, fallbackFilename),
  };
}

export async function exportEditablePptx(
  url: string,
  options: EditablePptxExportOptions = {},
): Promise<SavedOrDownloadedExportResult> {
  return exportPptxArtifact(
    "/exports/pptx/editable",
    "webslides.pptx",
    url,
    options,
    { mode: options.mode ?? "native-editable" },
  );
}

export async function exportImagePptx(
  url: string,
  options: ExportRequestOptions = {},
): Promise<SavedOrDownloadedExportResult> {
  return exportPptxArtifact(
    "/exports/pptx/image",
    "webslides-img.pptx",
    url,
    options,
  );
}
