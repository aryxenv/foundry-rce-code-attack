import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  describeServerError,
  exportEditablePptx,
  exportImagePptx,
  exportPdf,
  fetchHealth,
  isDownloadedExportResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ExportKind = "pdf" | "pptx" | "pages" | "azure";
type ExportBadge = "Static" | "Private" | "Interactive" | "Public" | "Server";
type ExportStatus = "idle" | "exporting" | "success" | "error";

const savesLocalArtifacts = import.meta.env.DEV;

interface ExportOption {
  id: ExportKind;
  title: string;
  badges: ExportBadge[];
  info: string;
}

const fileExportOptions: ExportOption[] = [
  {
    id: "pdf",
    title: "PDF",
    badges: ["Static", "Private"],
    info: savesLocalArtifacts
      ? "Save a local PDF artifact to exports/webslides.pdf and download it."
      : "Download a PDF.",
  },
  {
    id: "pptx",
    title: "PowerPoint",
    badges: ["Static", "Private"],
    info: "Choose editable or image-based PowerPoint export.",
  },
];

const devExportOptions: ExportOption[] = import.meta.env.DEV
  ? [
      {
        id: "pages",
        title: "GitHub Pages",
        badges: ["Interactive", "Public"],
        info: "Publish the interactive deck with the existing GitHub Actions workflow.",
      },
      {
        id: "azure",
        title: "Azure",
        badges: ["Interactive", "Public", "Server"],
        info: "Deploy the interactive deck and FastAPI server to Azure with azd.",
      },
    ]
  : [];

const visibleExportOptions = [...fileExportOptions, ...devExportOptions];

function ExportIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function InfoIcon({ className, info }: { className?: string; info: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "group/info relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-bold text-muted-foreground",
        className,
      )}
    >
      i
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-64 -translate-y-1/2 -translate-x-1 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs font-medium leading-5 text-popover-foreground opacity-0 shadow-deck transition-all duration-150 group-hover/info:translate-x-0 group-hover/info:opacity-100">
        {info}
      </span>
    </span>
  );
}

function VisibilityBadge({ label }: { label: ExportBadge }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportMenuOption({
  title,
  badges,
  info,
  onSelect,
}: {
  title: string;
  badges: ExportBadge[];
  info: string;
  onSelect: () => void;
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      onClick={onSelect}
      type="button"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {badges.map((badge) => (
          <VisibilityBadge key={badge} label={badge} />
        ))}
      </span>
      <InfoIcon className="shrink-0" info={info} />
    </button>
  );
}

function DialogShell({
  children,
  description,
  open,
  onOpenChange,
  title,
}: {
  children: ReactNode;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-capture-shortcuts
          className="export-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[min(620px,calc(100dvh-2rem))] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-deck focus-visible:outline-none sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Dialog.Title className="text-xl font-semibold tracking-[-0.02em]">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-6 text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close export dialog"
                size="sm"
                type="button"
                variant="quiet"
              >
                Close
              </Button>
            </Dialog.Close>
          </div>
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FileExportDialogContent({
  buttonLabel,
  disabled,
  exportingLabel,
  filename,
  savesLocalArtifacts,
  onExport,
  status,
  message,
}: {
  buttonLabel: string;
  disabled: boolean;
  exportingLabel: string;
  filename: string;
  savesLocalArtifacts: boolean;
  onExport: () => void;
  status: ExportStatus;
  message: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
        {savesLocalArtifacts ? (
          <>
            Generates the full deck locally, saves it to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
              exports/{filename}
            </code>
            , and downloads the same file.
          </>
        ) : (
          <>
            Generates the full deck and downloads{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
              {filename}
            </code>
            .
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          disabled={disabled || status === "exporting"}
          onClick={onExport}
          size="sm"
          type="button"
        >
          {status === "exporting" ? exportingLabel : buttonLabel}
        </Button>
        {message ? (
          <p
            className={cn(
              "min-w-0 whitespace-pre-wrap text-xs leading-5",
              status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PptxExportAction({
  title,
  description,
  filename,
  buttonLabel,
  exportingLabel,
  disabled,
  onExport,
  status,
  message,
  savesLocalArtifacts,
}: {
  title: string;
  description: string;
  filename: string;
  buttonLabel: string;
  exportingLabel: string;
  disabled: boolean;
  onExport: () => void;
  status: ExportStatus;
  message: string;
  savesLocalArtifacts: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {description}{" "}
            {savesLocalArtifacts ? (
              <>
                Saves to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                  exports/{filename}
                </code>
                .
              </>
            ) : (
              <>
                Downloads{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                  {filename}
                </code>
                .
              </>
            )}
          </p>
        </div>
        <Button
          className="shrink-0"
          disabled={disabled}
          onClick={onExport}
          size="sm"
          type="button"
        >
          {status === "exporting" ? exportingLabel : buttonLabel}
        </Button>
      </div>
      {message ? (
        <p
          className={cn(
            "mt-3 whitespace-pre-wrap text-xs leading-5",
            status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function PptxExportDialogContent({
  editableStatus,
  editableMessage,
  imageStatus,
  imageMessage,
  onEditableExport,
  onImageExport,
  serverReady,
  savesLocalArtifacts,
}: {
  editableStatus: ExportStatus;
  editableMessage: string;
  imageStatus: ExportStatus;
  imageMessage: string;
  onEditableExport: () => void;
  onImageExport: () => void;
  serverReady: boolean;
  savesLocalArtifacts: boolean;
}) {
  const isExporting =
    editableStatus === "exporting" || imageStatus === "exporting";
  const disabled = isExporting || !serverReady;

  return (
    <div className="space-y-3">
      <PptxExportAction
        buttonLabel="Export Editable PPTX"
        description="Best-effort editable PowerPoint objects, with quality details in webslides.pptx.report.json. Estimated time: 2 min."
        disabled={disabled}
        exportingLabel="Exporting..."
        filename="webslides.pptx"
        message={editableMessage}
        onExport={onEditableExport}
        savesLocalArtifacts={savesLocalArtifacts}
        status={editableStatus}
        title="Editable PPTX"
      />
      <PptxExportAction
        buttonLabel="Export Image PPTX"
        description="Pixel-perfect slide images. Estimated time: 1 min."
        disabled={disabled}
        exportingLabel="Exporting..."
        filename="webslides-img.pptx"
        message={imageMessage}
        onExport={onImageExport}
        savesLocalArtifacts={savesLocalArtifacts}
        status={imageStatus}
        title="Image-based PPTX"
      />
    </div>
  );
}

function ServerExportWarning({
  error,
  isChecking,
  isReady,
  onRetry,
}: {
  error: unknown;
  isChecking: boolean;
  isReady: boolean;
  onRetry: () => void;
}) {
  const failedHealthMessage =
    error instanceof TypeError
      ? "Start FastAPI first."
      : `Server check failed: ${describeServerError(error)}`;
  const message = isChecking
    ? "Checking FastAPI server..."
    : isReady
      ? "FastAPI server connected."
      : failedHealthMessage;
  const dotClassName = isChecking
    ? "animate-pulse bg-muted-foreground"
    : isReady
      ? "bg-success"
      : "bg-destructive";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClassName)} />
      <span>
        <strong className="text-foreground">
          {isChecking
            ? "Checking server."
            : isReady
              ? "Server ready."
              : "Server required."}
        </strong>{" "}
        {message}
        {!isChecking && !isReady ? (
          <>
            {" "}
            Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-foreground">
              uv run fastapi dev
            </code>
            .
          </>
        ) : null}
      </span>
      {!isReady ? (
        <Button
          className="h-auto px-1 py-0 text-xs underline underline-offset-2"
          disabled={isChecking}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="quiet"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

type CopyStatus = "idle" | "success" | "error";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 8h10v10H8zM6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m5 12 4 4L19 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CopyStatusIcon({ status }: { status: CopyStatus }) {
  const iconClassName = "h-4 w-4 animate-in fade-in-0 zoom-in-75 duration-150";

  if (status === "success") {
    return <CheckIcon className={cn(iconClassName, "text-success")} />;
  }

  if (status === "error") {
    return <XIcon className={cn(iconClassName, "text-destructive")} />;
  }

  return <CopyIcon className={iconClassName} />;
}

function CommandBlock({ command, label }: { command: string; label: string }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }

    window.setTimeout(() => setCopyStatus("idle"), 1600);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted py-3 pl-3 pr-20 text-xs leading-5 text-foreground">
          <code>{command}</code>
        </pre>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-px right-0 z-10 w-24 rounded-r-lg bg-gradient-to-l from-muted via-muted to-transparent"
        />
        <Button
          aria-label={`Copy ${label}`}
          className="absolute right-2 top-1/2 z-20 h-8 w-8 -translate-y-1/2 p-0"
          onClick={copyCommand}
          size="sm"
          type="button"
          variant="quiet"
        >
          <CopyStatusIcon key={copyStatus} status={copyStatus} />
        </Button>
      </div>
    </div>
  );
}

const DevDialogContent = import.meta.env.DEV
  ? function DevDialogContent({ dialog }: { dialog: ExportKind | null }) {
      if (dialog === "pages") {
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
              GitHub Pages keeps the deck interactive, but the published URL is
              public. Use this only for decks with no customer-specific data or
              local-only demo dependencies.
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              <li>
                In GitHub, set <strong>Settings → Pages</strong> source to{" "}
                <strong>GitHub Actions</strong>.
              </li>
              <li>Push changes to main so the existing Pages workflow runs.</li>
              <li>
                Share{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                  https://&lt;owner&gt;.github.io/&lt;repo&gt;/
                </code>
                .
              </li>
            </ol>
          </div>
        );
      }

      if (dialog === "azure") {
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
              From the repo root, run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                azd up
              </code>
              . That deploys the interactive deck and FastAPI backend as
              separate Azure Container Apps in Sweden Central with fixed 1/1
              replicas and a built-in ACR role propagation wait.
            </div>
            <CommandBlock command="azd up" label="Deploy from repo root" />
            <CommandBlock
              command="npm run azure:url"
              label="After azd up finishes, print the frontend Container App URL"
            />
          </div>
        );
      }

      return null;
    }
  : null;

export function ExportDialog() {
  const serverHealth = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ExportKind | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<
    "idle" | "exporting" | "success" | "error"
  >("idle");
  const [pdfMessage, setPdfMessage] = useState("");
  const [editablePptxStatus, setEditablePptxStatus] =
    useState<ExportStatus>("idle");
  const [editablePptxMessage, setEditablePptxMessage] = useState("");
  const [imagePptxStatus, setImagePptxStatus] = useState<ExportStatus>("idle");
  const [imagePptxMessage, setImagePptxMessage] = useState("");
  function selectDialog(dialog: ExportKind) {
    if (!visibleExportOptions.some((option) => option.id === dialog)) {
      return;
    }

    setMenuOpen(false);
    setActiveDialog(dialog);
    setDialogOpen(true);
  }

  async function handlePdfExport() {
    setPdfStatus("exporting");
    setPdfMessage("");

    try {
      const result = await exportPdf(window.location.origin, {
        downloadOnly: !savesLocalArtifacts,
      });
      downloadBlob(result.blob, result.filename);
      setPdfStatus("success");
      setPdfMessage(
        savesLocalArtifacts
          ? `Saved and downloaded exports/${result.filename}`
          : `Downloaded ${result.filename}`,
      );
    } catch (error) {
      setPdfStatus("error");
      setPdfMessage(describeServerError(error));
    }
  }

  async function handleEditablePptxExport() {
    setEditablePptxStatus("exporting");
    setEditablePptxMessage("");

    try {
      const result = await exportEditablePptx(window.location.origin, {
        downloadOnly: !savesLocalArtifacts,
        mode: "native-editable",
      });
      setEditablePptxStatus("success");
      if (isDownloadedExportResult(result)) {
        downloadBlob(result.blob, result.filename);
        setEditablePptxMessage(`Downloaded ${result.filename}`);
      } else {
        setEditablePptxMessage(`Saved ${result.path}`);
      }
    } catch (error) {
      setEditablePptxStatus("error");
      setEditablePptxMessage(describeServerError(error));
    }
  }

  async function handleImagePptxExport() {
    setImagePptxStatus("exporting");
    setImagePptxMessage("");

    try {
      const result = await exportImagePptx(window.location.origin, {
        downloadOnly: !savesLocalArtifacts,
      });
      setImagePptxStatus("success");
      if (isDownloadedExportResult(result)) {
        downloadBlob(result.blob, result.filename);
        setImagePptxMessage(`Downloaded ${result.filename}`);
      } else {
        setImagePptxMessage(`Saved ${result.path}`);
      }
    } catch (error) {
      setImagePptxStatus("error");
      setImagePptxMessage(describeServerError(error));
    }
  }

  const activeOption = visibleExportOptions.find(
    (option) => option.id === activeDialog,
  );
  const visibleActiveDialog = activeOption ? activeDialog : null;
  const serverChecking = serverHealth.isPending || serverHealth.isFetching;
  const serverReady =
    serverHealth.isSuccess && !serverChecking && !serverHealth.isRefetchError;

  return (
    <>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <Button
            aria-label="Open export options"
            className="h-8 w-8 p-0"
            size="sm"
            type="button"
            variant="outline"
          >
            <ExportIcon />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            className="z-30 w-[min(300px,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-deck data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-1 data-[state=open]:zoom-in-95"
            side="top"
            sideOffset={10}
          >
            <div className="grid gap-1">
              {visibleExportOptions.map((option) => (
                <ExportMenuOption
                  key={option.id}
                  badges={option.badges}
                  info={option.info}
                  onSelect={() => selectDialog(option.id)}
                  title={option.title}
                />
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <DialogShell
        description={
          activeOption
            ? `${activeOption.badges.join(" / ")}. ${activeOption.info}`
            : "Choose an export option."
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        title={activeOption?.title ?? "Export"}
      >
        {visibleActiveDialog === "pdf" || visibleActiveDialog === "pptx" ? (
          <ServerExportWarning
            error={serverHealth.error}
            isChecking={serverChecking}
            isReady={serverReady}
            onRetry={() => {
              void serverHealth.refetch();
            }}
          />
        ) : null}
        {visibleActiveDialog === "pdf" ? (
          <FileExportDialogContent
            buttonLabel="Download PDF"
            disabled={!serverReady}
            exportingLabel="Exporting PDF..."
            filename="webslides.pdf"
            message={pdfMessage}
            onExport={handlePdfExport}
            savesLocalArtifacts={savesLocalArtifacts}
            status={pdfStatus}
          />
        ) : null}
        {visibleActiveDialog === "pptx" ? (
          <PptxExportDialogContent
            editableMessage={editablePptxMessage}
            editableStatus={editablePptxStatus}
            imageMessage={imagePptxMessage}
            imageStatus={imagePptxStatus}
            onEditableExport={handleEditablePptxExport}
            onImageExport={handleImagePptxExport}
            serverReady={serverReady}
            savesLocalArtifacts={savesLocalArtifacts}
          />
        ) : null}
        {DevDialogContent ? (
          <DevDialogContent dialog={visibleActiveDialog} />
        ) : null}
      </DialogShell>
    </>
  );
}
