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

interface InfoCard {
  label: string;
  title: string;
  detail: string;
}

interface DemoChatWindowProps {
  isActive: boolean;
  scenario: DemoScenario;
  defaultPrompt: string;
  idleText: string;
  chartAlt: string;
  chartTitle: string;
  infoTitle: string;
  infoCards: InfoCard[];
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

function IconInfo({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
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
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground shadow-sm">
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
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function DemoChatWindow({
  isActive,
  scenario,
  defaultPrompt,
  idleText,
  chartAlt,
  chartTitle,
  infoTitle,
  infoCards,
  agentName = "Market Research Agent",
}: DemoChatWindowProps) {
  const exportMode = isPresentationExportMode();
  const secure = scenario.startsWith("secure");
  const [input, setInput] = useState(defaultPrompt);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const busy = messages.some(
    (message) => message.role === "agent" && message.status === "thinking",
  );

  const transcript: ChatMessage[] = exportMode
    ? [
        { id: "x-user", role: "user", text: defaultPrompt },
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
    setInput(defaultPrompt);
    setInfoOpen(false);
  }, [isActive, defaultPrompt]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Auto-size the composer to its content (capped). Recompute on resize and
  // activation so a transitional mount width can't leave it stuck too tall.
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

  const send = useCallback(async () => {
    if (!isActive || exportMode || busy) {
      return;
    }
    const text = input.trim();
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
    setInput("");

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
  }, [busy, exportMode, input, isActive, scenario]);

  const composerDisabled = exportMode || !isActive || busy;

  return (
    <div className="relative mx-auto flex h-full max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg">
      {/* Chat window — fills the slide body and scrolls internally */}
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border-2 border-border bg-card shadow-deck">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">
              {agentName}
            </p>
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
          </div>
          <button
            aria-label={infoOpen ? "Hide context" : "Show context"}
            aria-pressed={infoOpen}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              infoOpen
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setInfoOpen((open) => !open)}
            type="button"
          >
            <IconInfo className="h-4 w-4" />
          </button>
        </header>

        <div
          className="no-scrollbar flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto bg-background px-5 py-5"
          ref={transcriptRef}
        >
          {transcript.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
                {idleText}
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
                  void send();
                }
              }}
              placeholder="Message the agent…"
              ref={inputRef}
              rows={1}
              value={input}
            />
            <button
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
              disabled={composerDisabled || input.trim().length === 0}
              onClick={() => void send()}
              type="button"
            >
              <IconSend className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      {/* Context panel — floating overlay that slides in over the right side */}
      <aside
        aria-hidden={!infoOpen}
        className={cn(
          "absolute inset-y-0 right-0 z-10 w-[clamp(300px,40%,420px)] transition-transform duration-300 ease-out",
          infoOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <div className="m-3 flex h-[calc(100%-1.5rem)] flex-col rounded-lg border-2 border-border bg-card p-5 shadow-deck">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge variant="muted">Context</Badge>
              <h2 className="mt-3 text-lg font-semibold tracking-[-0.02em]">
                {infoTitle}
              </h2>
            </div>
            <button
              aria-label="Hide context"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => setInfoOpen(false)}
              type="button"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>

          <div className="no-scrollbar mt-4 grid gap-3 overflow-y-auto">
            {infoCards.map((card) => (
              <div
                className="rounded-xl border border-border bg-muted/60 p-3.5"
                key={card.title}
              >
                <Badge variant="outline">{card.label}</Badge>
                <p className="mt-3 text-sm font-semibold leading-snug">
                  {card.title}
                </p>
                <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                  {card.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
