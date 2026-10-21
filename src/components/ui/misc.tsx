import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "good" | "warn" | "danger" | "accent" | "outline" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-soft",
    good: "bg-tint text-primary",
    warn: "bg-warn-bg text-warn",
    danger: "bg-danger-bg text-danger",
    accent: "bg-accent text-accent-ink",
    outline: "border border-rule text-ink-soft",
  };
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-2", className)} {...props} />;
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "good";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const tones = {
    info: "border-rule bg-surface-2 text-ink",
    warn: "border-warn/30 bg-warn-bg text-ink",
    danger: "border-danger/30 bg-danger-bg text-ink",
    good: "border-primary/20 bg-tint text-ink",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? <div className={cn("text-ink-soft", title && "mt-0.5")}>{children}</div> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Meter({
  value,
  max,
  color,
  label,
  className,
}: {
  value: number;
  max: number | null;
  color: string;
  label: string;
  className?: string;
}) {
  const pct = max && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max !== null && value > max;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max ?? undefined}
      aria-valuenow={Math.round(value)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: over ? "var(--warn)" : color }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-rule px-6 py-10 text-center">
      {icon ? <div className="grid size-12 place-items-center rounded-full bg-tint text-primary">{icon}</div> : null}
      <div>
        <p className="label-head text-base">{title}</p>
        {children ? <div className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
  name: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn("inline-flex rounded-full border border-rule bg-surface p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Large tappable radio card used in onboarding/settings. */
export function ChoiceCard({
  checked,
  onSelect,
  title,
  description,
  role = "radio",
}: {
  checked: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  role?: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
        checked ? "border-primary bg-tint" : "border-rule bg-surface hover:bg-surface-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center border-2",
          role === "radio" ? "rounded-full" : "rounded",
          checked ? "border-primary bg-primary" : "border-ink-faint",
        )}
      >
        {checked ? <span className={cn("size-1.5 bg-primary-ink", role === "radio" ? "rounded-full" : "rounded-sm")} /> : null}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        {description ? <span className="mt-0.5 block text-sm text-ink-soft">{description}</span> : null}
      </span>
    </button>
  );
}
