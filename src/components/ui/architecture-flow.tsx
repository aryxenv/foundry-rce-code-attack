import aiAgentsMark from "@/assets/ai-agents.svg";
import managedIdentityMark from "@/assets/managed-identity.png";
import modelMark from "@/assets/model-mark.png";
import postgresMark from "@/assets/postgres.png";
import storageMark from "@/assets/storage.png";
import toolMark from "@/assets/tool-mark.png";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Native, animated architecture flow diagram                          */
/* Replaces the static architecture screenshots with a looping,        */
/* self-contained SVG that carries only the core security message.     */
/* ------------------------------------------------------------------ */

type Variant = "vulnerable" | "secure";
type Tone = "neutral" | "danger" | "safe" | "isolated";
type IconName = "bot" | "database" | "code" | "shield" | "lock" | "image";

const toneStroke: Record<Tone, string> = {
  neutral: "stroke-border",
  danger: "stroke-destructive/60",
  safe: "stroke-success/55",
  isolated: "stroke-primary/55",
};

const toneIcon: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  danger: "text-destructive",
  safe: "text-success",
  isolated: "text-primary",
};

const toneSub: Record<Tone, string> = {
  neutral: "fill-muted-foreground",
  danger: "fill-destructive",
  safe: "fill-success",
  isolated: "fill-primary",
};

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "bot":
      return (
        <g {...common}>
          <rect x={4} y={8} width={16} height={12} rx={3} />
          <path d="M12 8V4.5" />
          <circle cx={12} cy={4} r={1.3} fill="currentColor" stroke="none" />
          <path d="M9 13h.01M15 13h.01" />
          <path d="M9.5 16.5h5" />
        </g>
      );
    case "database":
      return (
        <g {...common}>
          <ellipse cx={12} cy={6} rx={7} ry={3} />
          <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
          <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
        </g>
      );
    case "code":
      return (
        <g {...common}>
          <path d="m9 8-4 4 4 4" />
          <path d="m15 8 4 4-4 4" />
        </g>
      );
    case "shield":
      return (
        <g {...common}>
          <path d="M12 3 5 6v5c0 4 3 6.6 7 8 4-1.4 7-4 7-8V6z" />
          <path d="m9.2 12 2 2 3.6-3.6" />
        </g>
      );
    case "lock":
      return (
        <g {...common}>
          <rect x={5} y={11} width={14} height={9} rx={2} />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </g>
      );
    case "image":
      return (
        <g {...common}>
          <rect x={4} y={5} width={16} height={14} rx={2} />
          <circle cx={9} cy={10} r={1.6} />
          <path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" />
        </g>
      );
  }
}

interface NodeProps {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  icon: IconName;
  title: string;
  subtitle?: string;
  badge?: string;
  tooltip?: string;
  logo?: "model" | "tool" | "storage";
}

function Node({
  x,
  y,
  w,
  h,
  tone,
  icon,
  title,
  subtitle,
  badge,
  tooltip,
  logo,
}: NodeProps) {
  const textX = x + 44;
  return (
    <g className={tooltip ? "cursor-help" : undefined}>
      {tooltip ? <title>{tooltip}</title> : null}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={13}
        className={cn("fill-card", toneStroke[tone])}
        strokeWidth={1.5}
      />
      <g
        className={toneIcon[tone]}
        transform={`translate(${x + 12}, ${y + h / 2 - 11})`}
      >
        <Icon name={icon} />
      </g>
      <text
        x={textX}
        y={subtitle ? y + h / 2 - 4 : y + h / 2 + 5}
        className="fill-foreground text-[15px] font-semibold"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        {title}
      </text>
      {subtitle ? (
        <text
          x={textX}
          y={y + h / 2 + 15}
          className={cn("text-[11px]", toneSub[tone])}
        >
          {subtitle}
        </text>
      ) : null}
      {badge ? (
        <>
          <rect
            x={x + w - 46}
            y={y + 10}
            width={36}
            height={18}
            rx={4}
            className="fill-destructive/15 stroke-destructive/50"
            strokeWidth={1}
          />
          <text
            x={x + w - 28}
            y={y + 23}
            textAnchor="middle"
            className="fill-destructive text-[10px] font-bold"
          >
            {badge}
          </text>
        </>
      ) : null}
      {logo ? (
        <image
          href={
            logo === "model"
              ? modelMark
              : logo === "tool"
                ? toolMark
                : storageMark
          }
          x={x + w - 34}
          y={y - 15}
          width={30}
          height={30}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}
    </g>
  );
}

type LineTone = "neutral" | "danger" | "safe";

const lineStroke: Record<LineTone, string> = {
  neutral: "stroke-muted-foreground/70",
  danger: "stroke-destructive",
  safe: "stroke-success",
};

const dotFill: Record<LineTone, string> = {
  neutral: "fill-primary",
  danger: "fill-destructive",
  safe: "fill-success",
};

const markerFor: Record<LineTone, string> = {
  neutral: "url(#ah-neutral)",
  danger: "url(#ah-danger)",
  safe: "url(#ah-safe)",
};

interface LineProps {
  id?: string;
  d: string;
  tone: LineTone;
  flow?: boolean;
  slow?: boolean;
  dot?: boolean;
  dotDur?: number;
  noMarker?: boolean;
}

function Line({
  id,
  d,
  tone,
  flow,
  slow,
  dot,
  dotDur = 2.2,
  noMarker,
}: LineProps) {
  return (
    <>
      <path
        id={id}
        d={d}
        className={cn(
          "fill-none",
          lineStroke[tone],
          flow && "arch-flow-line",
          slow && "arch-flow-line--slow",
        )}
        strokeWidth={2}
        strokeLinecap="round"
        markerEnd={noMarker ? undefined : markerFor[tone]}
      />
      {dot && id ? (
        <circle r={3.4} className={cn("arch-flow-dot", dotFill[tone])}>
          <animateMotion
            dur={`${dotDur}s`}
            repeatCount="indefinite"
            rotate="auto"
          >
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      ) : null}
    </>
  );
}

function FlowLabel({
  x,
  y,
  tone = "neutral",
  children,
}: {
  x: number;
  y: number;
  tone?: LineTone;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className={cn(
        "text-[12px] font-semibold",
        tone === "danger"
          ? "fill-destructive"
          : tone === "safe"
            ? "fill-success"
            : "fill-muted-foreground",
      )}
    >
      {children}
    </text>
  );
}

function Boundary({
  x,
  y,
  w,
  h,
  label,
  tone,
  icons,
  logo,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tone: "neutral" | "isolated";
  icons?: boolean;
  logo?: "postgres";
}) {
  const iconSize = 26;
  const iconGap = 8;
  const iconsRight = x + w - 14;
  const iconTop = y - iconSize / 2;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={18}
        className={cn(
          "fill-transparent",
          tone === "isolated"
            ? "stroke-primary/55"
            : "stroke-muted-foreground/50",
        )}
        strokeWidth={1.5}
        strokeDasharray="2 6"
      />
      <text
        x={x + 16}
        y={y - 9}
        className={cn(
          "text-[11.5px] font-semibold uppercase tracking-[0.1em]",
          tone === "isolated" ? "fill-primary" : "fill-muted-foreground",
        )}
      >
        {label}
      </text>
      {icons ? (
        <>
          <image
            href={managedIdentityMark}
            x={iconsRight - iconSize}
            y={iconTop}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
          />
          <image
            href={aiAgentsMark}
            x={iconsRight - iconSize * 2 - iconGap}
            y={iconTop}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
          />
        </>
      ) : null}
      {logo === "postgres" ? (
        <image
          href={postgresMark}
          x={iconsRight - iconSize}
          y={iconTop}
          width={iconSize}
          height={iconSize}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}
    </g>
  );
}

function Markers() {
  return (
    <defs>
      <marker
        id="ah-neutral"
        markerWidth={9}
        markerHeight={9}
        refX={6}
        refY={4}
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M1,1 L7,4 L1,7 Z" className="fill-muted-foreground/80" />
      </marker>
      <marker
        id="ah-danger"
        markerWidth={9}
        markerHeight={9}
        refX={6}
        refY={4}
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M1,1 L7,4 L1,7 Z" className="fill-destructive" />
      </marker>
      <marker
        id="ah-safe"
        markerWidth={9}
        markerHeight={9}
        refX={6}
        refY={4}
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M1,1 L7,4 L1,7 Z" className="fill-success" />
      </marker>
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* Vulnerable variant                                                  */
/* ------------------------------------------------------------------ */

function VulnerableDiagram() {
  return (
    <svg
      viewBox="0 0 800 452"
      className="h-auto w-full max-h-[47vh]"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Vulnerable architecture: generated code runs inside the agent container, reaches raw PII tables, and writes the chart image to blob storage."
    >
      <Markers />

      <Boundary
        x={16}
        y={58}
        w={476}
        h={302}
        label="Hosted agent container"
        tone="neutral"
        icons
      />

      {/* inbound prompt */}
      <Line d="M0,112 L44,112" tone="danger" />
      <text
        x={2}
        y={101}
        className="fill-destructive text-[11px] font-semibold"
      >
        prompt
      </text>

      <Node
        x={44}
        y={84}
        w={208}
        h={58}
        tone="neutral"
        icon="bot"
        title="Model"
        subtitle="GPT-4o-mini"
        tooltip="Agent brain"
        logo="model"
      />
      <Node
        x={44}
        y={172}
        w={222}
        h={58}
        tone="neutral"
        icon="database"
        title="get_market_data"
        subtitle="sanitized only"
        tooltip="Data retrieval"
        logo="tool"
      />
      <Node
        x={44}
        y={264}
        w={222}
        h={58}
        tone="danger"
        icon="code"
        title="execute_code"
        subtitle="runs in-container"
        tooltip="Visualization"
        logo="tool"
      />

      <Boundary
        x={548}
        y={100}
        w={248}
        h={248}
        label="PostgreSQL database"
        tone="neutral"
        logo="postgres"
      />
      <Node
        x={566}
        y={108}
        w={218}
        h={76}
        tone="safe"
        icon="shield"
        title="Sanitized"
        subtitle="vw_sales_by_region"
      />
      <Node
        x={566}
        y={250}
        w={218}
        h={88}
        tone="danger"
        icon="database"
        title="Raw tables"
        subtitle="customers · salaries · SSNs"
        badge="PII"
      />

      {/* legit path — two-way: query out, sanitized data back */}
      <Line
        id="vuln-query"
        d="M266,196 C400,176 500,150 566,138"
        tone="neutral"
        flow
        slow
        dot
        dotDur={3.0}
      />
      <FlowLabel x={420} y={150}>
        query →
      </FlowLabel>
      <Line
        id="vuln-clean"
        d="M566,156 C500,168 400,192 268,208"
        tone="neutral"
        flow
        slow
        dot
        dotDur={3.4}
      />
      <FlowLabel x={420} y={206}>
        ← sanitized rows
      </FlowLabel>

      {/* attack out */}
      <Line
        id="vuln-attack"
        d="M266,288 C420,284 500,284 566,286"
        tone="danger"
        flow
        dot
        dotDur={1.9}
      />
      <FlowLabel x={416} y={274} tone="danger">
        raw query →
      </FlowLabel>

      {/* PII back */}
      <Line
        id="vuln-pii"
        d="M566,314 C500,320 420,320 268,314"
        tone="danger"
        flow
        dot
        dotDur={2.1}
      />
      <FlowLabel x={416} y={336} tone="danger">
        ← PII rows
      </FlowLabel>

      {/* artifact channel: generated code writes the chart image to blob
          storage (one-way). In the vulnerable build the PNG carries the PII. */}
      <Node
        x={285}
        y={398}
        w={252}
        h={46}
        tone="danger"
        icon="image"
        title="Blob storage"
        subtitle="chart.png → SAS URL"
        logo="storage"
      />
      <Line
        id="vuln-write"
        d="M155,322 C155,378 215,421 285,421"
        tone="danger"
        flow
        dot
        dotDur={2.3}
      />
      <FlowLabel x={206} y={372} tone="danger">
        PII baked into pixels →
      </FlowLabel>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Secure variant                                                      */
/* ------------------------------------------------------------------ */

function SecureDiagram() {
  return (
    <svg
      viewBox="0 0 800 452"
      className="h-auto w-full max-h-[47vh]"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Secure architecture: generated code runs in an isolated sandbox with no path to raw PII tables, writing only a sanitized chart image to blob storage."
    >
      <Markers />

      <Boundary
        x={16}
        y={58}
        w={330}
        h={320}
        label="Hosted agent container"
        tone="neutral"
        icons
      />
      <Boundary
        x={30}
        y={298}
        w={302}
        h={72}
        label="Isolated sandbox · Dynamic ACA"
        tone="isolated"
      />

      {/* inbound prompt */}
      <Line d="M0,112 L44,112" tone="danger" />
      <text
        x={2}
        y={101}
        className="fill-destructive text-[11px] font-semibold"
      >
        prompt
      </text>

      <Node
        x={44}
        y={84}
        w={208}
        h={58}
        tone="neutral"
        icon="bot"
        title="Model"
        subtitle="GPT-4o-mini"
        tooltip="Agent brain"
        logo="model"
      />
      <Node
        x={44}
        y={176}
        w={222}
        h={58}
        tone="neutral"
        icon="database"
        title="get_market_data"
        subtitle="sanitized only"
        tooltip="Data retrieval"
        logo="tool"
      />
      <Node
        x={44}
        y={304}
        w={222}
        h={56}
        tone="isolated"
        icon="code"
        title="Code Interpreter"
        subtitle="Foundry · isolated"
        tooltip="Visualization"
        logo="tool"
      />

      <Boundary
        x={548}
        y={100}
        w={248}
        h={248}
        label="PostgreSQL database"
        tone="neutral"
        logo="postgres"
      />
      <Node
        x={566}
        y={108}
        w={218}
        h={76}
        tone="safe"
        icon="shield"
        title="Sanitized"
        subtitle="vw_sales_by_region"
      />
      <Node
        x={566}
        y={250}
        w={218}
        h={88}
        tone="neutral"
        icon="lock"
        title="Raw tables"
        subtitle="unreachable"
      />

      {/* legit path — two-way: query out, sanitized data back */}
      <Line
        id="sec-query"
        d="M266,200 C400,178 500,148 566,134"
        tone="neutral"
        flow
        slow
        dot
        dotDur={3.0}
      />
      <FlowLabel x={420} y={148}>
        query →
      </FlowLabel>
      <Line
        id="sec-clean"
        d="M566,152 C500,164 400,190 268,210"
        tone="neutral"
        flow
        slow
        dot
        dotDur={3.4}
      />
      <FlowLabel x={420} y={208}>
        ← sanitized rows
      </FlowLabel>

      {/* blocked path to raw tables — the hero of the secure design.
          The attempt flows toward the barrier and is stopped at the cross. */}
      <Line
        id="sec-blocked"
        d="M266,330 L364,326"
        tone="danger"
        flow
        dot
        dotDur={1.6}
        noMarker
      />
      <path
        d="M392,320 C480,302 500,300 566,298"
        className="fill-none stroke-muted-foreground/40"
        strokeWidth={2}
        strokeDasharray="3 6"
      />
      {/* barrier + cross */}
      <line
        x1={374}
        y1={304}
        x2={374}
        y2={348}
        className="stroke-destructive"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <g className="stroke-destructive" strokeWidth={3} strokeLinecap="round">
        <line x1={367} y1={318} x2={381} y2={336} />
        <line x1={381} y1={318} x2={367} y2={336} />
      </g>
      <FlowLabel x={476} y={300} tone="danger">
        no inherited identity
      </FlowLabel>

      {/* artifact channel: the sandbox still writes a chart image to blob
          storage (one-way), but it carries only sanitized data. */}
      <Node
        x={285}
        y={398}
        w={252}
        h={46}
        tone="safe"
        icon="image"
        title="Blob storage"
        subtitle="chart.png → SAS URL"
        logo="storage"
      />
      <Line
        id="sec-write"
        d="M155,360 C155,388 215,421 285,421"
        tone="safe"
        flow
        dot
        dotDur={2.3}
      />
      <FlowLabel x={210} y={400} tone="safe">
        sanitized chart →
      </FlowLabel>
    </svg>
  );
}

export function ArchitectureFlow({ variant }: { variant: Variant }) {
  return variant === "vulnerable" ? <VulnerableDiagram /> : <SecureDiagram />;
}
