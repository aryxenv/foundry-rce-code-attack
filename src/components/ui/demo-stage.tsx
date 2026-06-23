import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { ImageDialog } from "@/components/ui/image-dialog";
import { describeServerError, runDemo } from "@/lib/api";
import type { DemoRunResponse, DemoScenario } from "@/lib/api";
import { isPresentationExportMode } from "@/lib/export-mode";
import { useFullscreen } from "@/hooks/useFullscreen";
import {
  isSpaceKey,
  shouldIgnorePresentationShortcut,
} from "@/lib/presentation-shortcuts";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type MessageStatus = "thinking" | "done" | "error";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  status?: MessageStatus;
  chartUrl?: string;
}

export interface DemoStep {
  /** Short step label, e.g. "Tool discovery". */
  label: string;
  /** What this prompt is trying to achieve. */
  goal: string;
  /** What to watch for when it runs. */
  outcome: string;
  /** Prompt sent to the agent for this step. */
  prompt: string;
}

interface DemoStageProps {
  isActive: boolean;
  scenario: DemoScenario;
  steps: DemoStep[];
  chartAlt: string;
  chartTitle: string;
  agentName?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseChartUrl(text: string) {
  const match = text.match(/Chart\s+URL:\s*(\S+)/i);
  return match?.[1]?.replace(/^[<("']+|[>)\].,'"]+$/g, "");
}

function stripChartLine(text: string) {
  return text.replace(/^\s*Chart\s+URL:\s*\S+\s*$/gim, "").trim() || text;
}

function toAgentMessage(id: string, response: DemoRunResponse): ChatMessage {
  if (response.error) {
    return {
      id,
      role: "agent",
      status: "error",
      text: response.error.detail
        ? `${response.error.message}\n${response.error.detail}`
        : response.error.message,
    };
  }

  const body = response.textResponse || "No response returned.";
  return {
    id,
    role: "agent",
    status: "done",
    text: stripChartLine(body),
    chartUrl: response.chartUrl ?? parseChartUrl(body),
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function IconSend({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

function IconExpand({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function IconCollapse({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 8h3a2 2 0 0 0 2-2V3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
    </svg>
  );
}

function FullscreenButton() {
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  return (
    <button
      aria-pressed={isFullscreen}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={toggleFullscreen}
      type="button"
    >
      {isFullscreen ? (
        <IconCollapse className="h-4 w-4" />
      ) : (
        <IconExpand className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      </span>
    </button>
  );
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Agent is typing">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Bubbles                                                             */
/* ------------------------------------------------------------------ */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-h-44 max-w-[85%] overflow-y-auto whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground shadow-sm">
        {text}
      </div>
    </div>
  );
}

function AgentBubble({
  message,
  chartAlt,
  chartTitle,
}: {
  message: ChatMessage;
  chartAlt: string;
  chartTitle: string;
}) {
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm",
          message.status === "error"
            ? "border-destructive/60"
            : "border-border",
        )}
      >
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Agent
        </p>

        {message.status === "thinking" ? (
          <TypingDots />
        ) : (
          <div
            aria-live="polite"
            className={cn(
              "whitespace-pre-wrap text-sm leading-6",
              message.status === "error"
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            {message.text}
          </div>
        )}

        {message.status === "done" && message.chartUrl ? (
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <Badge variant="muted">Returned chart</Badge>
              <a
                className="max-w-full truncate text-xs font-semibold text-primary underline-offset-4 hover:underline"
                href={message.chartUrl}
                onClick={(event) => event.stopPropagation()}
                rel="noreferrer"
                target="_blank"
              >
                Open ↗
              </a>
            </div>
            <ImageDialog
              alt={chartAlt}
              src={message.chartUrl}
              title={chartTitle}
            >
              <button
                className="block w-full overflow-hidden rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                type="button"
              >
                <img
                  alt={chartAlt}
                  className="max-h-60 w-full object-contain"
                  src={message.chartUrl}
                />
              </button>
            </ImageDialog>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Goal / Outcome rail                                                 */
/* ------------------------------------------------------------------ */

function StepRail({
  steps,
  stepIndex,
  done,
}: {
  steps: DemoStep[];
  stepIndex: number;
  done: boolean;
}) {
  const total = steps.length;
  const viewIndex = Math.min(stepIndex, total - 1);
  const step = steps[viewIndex];

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold tracking-[-0.01em]">
          {step.label}
        </p>
        <Badge variant="muted" className="shrink-0">
          {done ? `${total} / ${total}` : `${stepIndex + 1} / ${total}`}
        </Badge>
      </div>

      <div className="rounded-xl border-2 border-primary/45 bg-card p-4">
        <Badge>Goal</Badge>
        <p className="mt-2.5 text-sm font-medium leading-6 text-foreground sm:text-base">
          {step.goal}
        </p>
      </div>

      <div className="rounded-xl border-2 border-border bg-card p-4">
        <Badge variant="outline">Outcome</Badge>
        <p className="mt-2.5 text-sm leading-6 text-muted-foreground sm:text-base">
          {step.outcome}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function DemoStage({
  isActive,
  scenario,
  steps,
  chartAlt,
  chartTitle,
  agentName = "Market Research Agent",
}: DemoStageProps) {
  const exportMode = isPresentationExportMode();
  const secure = scenario.startsWith("secure");
  const total = steps.length;

  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState(() => steps[0]?.prompt ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const busy = messages.some(
    (message) => message.role === "agent" && message.status === "thinking",
  );
  const done = stepIndex >= total;

  const transcript: ChatMessage[] = exportMode
    ? [
        { id: "x-user", role: "user", text: steps[0]?.prompt ?? "" },
        {
          id: "x-agent",
          role: "agent",
          status: "done",
          text: "Static export preview. In the live deck the agent reply and any returned chart appear here.",
        },
      ]
    : messages;

  // Reset the demo whenever the slide is left so it re-opens clean.
  useEffect(() => {
    if (isActive) {
      return;
    }
    abortRef.current?.abort();
    setMessages([]);
    setStepIndex(0);
    setInput(steps[0]?.prompt ?? "");
  }, [isActive, steps]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Auto-size the composer to its content (capped).
  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useLayoutEffect(() => {
    autosize();
  }, [autosize, input]);

  useEffect(() => {
    if (isActive) {
      autosize();
    }
  }, [autosize, isActive]);

  useEffect(() => {
    window.addEventListener("resize", autosize);
    return () => window.removeEventListener("resize", autosize);
  }, [autosize]);

  // Keep the latest message in view.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const runStep = useCallback(async () => {
    if (!isActive || exportMode || busy || done) {
      return;
    }
    const current = steps[stepIndex];
    const text = (input.trim() || current.prompt).trim();
    if (!text) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const agentId = `a${++idRef.current}`;
    setMessages((prev) => [
      ...prev,
      { id: `u${++idRef.current}`, role: "user", text },
      { id: agentId, role: "agent", text: "", status: "thinking" },
    ]);

    // Advance the rail + composer to the next step immediately on send.
    const next = stepIndex + 1;
    setStepIndex(next);
    setInput(next < total ? steps[next].prompt : "");

    try {
      const response = await runDemo(
        { scenario, prompt: text },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        return;
      }
      const agentMessage = toAgentMessage(agentId, response);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === agentId ? agentMessage : message,
        ),
      );
    } catch (error) {
      if (isAbortError(error)) {
        setMessages((prev) => prev.filter((message) => message.id !== agentId));
        return;
      }
      setMessages((prev) =>
        prev.map((message) =>
          message.id === agentId
            ? {
                ...message,
                status: "error",
                text: describeServerError(error),
              }
            : message,
        ),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    busy,
    done,
    exportMode,
    input,
    isActive,
    scenario,
    stepIndex,
    steps,
    total,
  ]);

  // Spacebar drives the demo: run the current step, then auto-advance.
  useEffect(() => {
    if (!isActive || exportMode) {
      return;
    }
    function handleSpacebar(event: KeyboardEvent) {
      if (
        !isSpaceKey(event) ||
        event.repeat ||
        shouldIgnorePresentationShortcut(event)
      ) {
        return;
      }
      if (done) {
        return;
      }
      event.preventDefault();
      if (busy) {
        return;
      }
      void runStep();
    }

    window.addEventListener("keydown", handleSpacebar);
    return () => window.removeEventListener("keydown", handleSpacebar);
  }, [busy, done, exportMode, isActive, runStep]);

  const composerDisabled = exportMode || !isActive || busy || done;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-6">
      {/* Goal / Outcome rail */}
      <aside className="shrink-0 lg:flex lg:min-h-0 lg:flex-col lg:justify-center">
        <StepRail done={done} stepIndex={stepIndex} steps={steps} />
      </aside>

      {/* Chat */}
      <section className="flex min-h-[24rem] flex-1 flex-col overflow-hidden rounded-lg border-2 border-border bg-card shadow-deck lg:min-h-0">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <p className="truncate text-sm font-semibold tracking-[-0.01em]">
            {agentName}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              className={cn(
                "shrink-0",
                secure
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
              variant="outline"
            >
              {secure ? "Secure" : "Unsecure"}
            </Badge>
            {exportMode ? null : <FullscreenButton />}
          </div>
        </header>

        <div
          className="no-scrollbar flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto bg-background px-5 py-5"
          ref={transcriptRef}
        >
          {transcript.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
                Press{" "}
                <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground">
                  Space
                </kbd>{" "}
                to send prompts.
              </p>
            </div>
          ) : (
            transcript.map((message) =>
              message.role === "user" ? (
                <UserBubble key={message.id} text={message.text} />
              ) : (
                <AgentBubble
                  chartAlt={chartAlt}
                  chartTitle={chartTitle}
                  key={message.id}
                  message={message}
                />
              ),
            )
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-card px-5 py-4">
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 transition-shadow focus-within:ring-2 focus-within:ring-ring">
            <textarea
              className="no-scrollbar max-h-32 min-h-[40px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              disabled={composerDisabled}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void runStep();
                }
              }}
              placeholder={done ? "Demo complete." : "Message the agent…"}
              ref={inputRef}
              rows={1}
              value={done ? "" : input}
            />
            <button
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
              disabled={composerDisabled || input.trim().length === 0}
              onClick={() => void runStep()}
              type="button"
            >
              <IconSend className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
