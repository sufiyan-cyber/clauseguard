"use client";

import type { RiskLevel } from "@/lib/types";
import { IconAlertTriangle, IconCheck, IconPause, IconX } from "@/components/icons";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-edge bg-surface/90 ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  className = "",
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "success";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  ariaLabel?: string;
}) {
  const styles = {
    primary:
      "bg-brand text-brand-ink font-bold hover:bg-brand-strong active:scale-[0.98]",
    ghost:
      "border border-edge-strong/50 text-ink-dim hover:border-edge-strong hover:bg-raised hover:text-ink",
    danger:
      "border border-risk-high/40 text-risk-high hover:bg-risk-high/10",
    success:
      "bg-brand text-brand-ink font-bold hover:bg-brand-strong active:scale-[0.98]",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

const RISK_STYLES: Record<string, string> = {
  high: "bg-risk-high/10 text-risk-high border-risk-high/35",
  medium: "bg-risk-medium/10 text-risk-medium border-risk-medium/35",
  low: "bg-risk-low/10 text-risk-low border-risk-low/35",
};

const RISK_GLYPH: Record<string, React.ReactNode> = {
  high: <IconAlertTriangle size={11} />,
  medium: <IconAlertTriangle size={11} />,
  low: <IconCheck size={11} />,
};

export function RiskBadge({ level, score }: { level: RiskLevel | null; score?: number | null }) {
  if (!level) {
    return (
      <span className="rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-ink-faint">
        unscored
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide tabular-nums ${RISK_STYLES[level]}`}
    >
      {RISK_GLYPH[level]}
      {level}
      {typeof score === "number" ? ` · ${score}` : ""}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "pass" | "fail" | "warn";
  title?: string;
}) {
  const styles = {
    neutral: "border-edge text-ink-dim",
    brand: "border-brand/35 bg-brand/10 text-brand-strong",
    pass: "border-risk-low/35 bg-risk-low/10 text-risk-low",
    fail: "border-risk-high/35 bg-risk-high/10 text-risk-high",
    warn: "border-risk-medium/35 bg-risk-medium/10 text-risk-medium",
  }[tone];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${styles}`}
    >
      {tone === "pass" && <IconCheck size={10} />}
      {tone === "fail" && <IconX size={10} />}
      {tone === "warn" && <IconAlertTriangle size={10} />}
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-dim" role="status">
      <span className="size-3.5 animate-spin rounded-full border-2 border-edge border-t-brand" />
      {label}
    </span>
  );
}

/** Loading placeholder rows (skeleton — no layout shift when data lands). */
export function SkeletonRows({ rows = 3, height = 72 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton w-full" style={{ height }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-edge py-14 text-center">
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink-dim">{title}</p>
      {hint && <p className="mt-1.5 max-w-md px-4 text-xs leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`mx-auto my-8 w-full ${wide ? "max-w-3xl" : "max-w-xl"} animate-rise rounded-2xl border border-edge-strong/40 bg-surface shadow-2xl shadow-black/50`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-edge px-5 py-4">
          <div>
            <h3 className="font-serif text-[17px] font-semibold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="grid size-9 place-items-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string; pulse?: boolean; gate?: boolean }> = {
    uploaded: { label: "Uploaded", tone: "border-edge text-ink-dim" },
    queued: { label: "Queued", tone: "border-edge text-ink-dim", pulse: true },
    parsing: { label: "Parsing", tone: "border-brand/40 text-brand-strong", pulse: true },
    classifying: { label: "Classifying", tone: "border-brand/40 text-brand-strong", pulse: true },
    indexing: { label: "Indexing", tone: "border-brand/40 text-brand-strong", pulse: true },
    analyzing_risk: {
      label: "Analyzing risk",
      tone: "border-brand/40 text-brand-strong",
      pulse: true,
    },
    awaiting_risk_review: {
      label: "Awaiting risk review",
      tone: "border-risk-medium/50 text-risk-medium",
      gate: true,
    },
    generating_redlines: {
      label: "Drafting redlines",
      tone: "border-brand/40 text-brand-strong",
      pulse: true,
    },
    awaiting_final_approval: {
      label: "Awaiting final approval",
      tone: "border-risk-medium/50 text-risk-medium",
      gate: true,
    },
    compiling_report: {
      label: "Compiling report",
      tone: "border-brand/40 text-brand-strong",
      pulse: true,
    },
    completed: { label: "Completed", tone: "border-risk-low/50 text-risk-low" },
    failed: { label: "Failed", tone: "border-risk-high/50 text-risk-high" },
  };
  const s = map[status] ?? { label: status, tone: "border-edge text-ink-dim" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${s.tone} ${s.pulse ? "animate-pulse-soft" : ""}`}
    >
      {s.gate && <IconPause size={10} />}
      {status === "completed" && <IconCheck size={10} />}
      {status === "failed" && <IconX size={10} />}
      {s.label}
    </span>
  );
}
