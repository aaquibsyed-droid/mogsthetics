"use client";

import { Skeleton } from "@/components/ui/misc";
import { useApi } from "@/lib/client/api";
import type { WeeklyInsights } from "@/lib/services/insights";

/** Gentle weekly check-in: consistency over perfection. */
export function InsightsCard() {
  const { data } = useApi<WeeklyInsights>("/api/insights");
  if (!data) return <Skeleton className="h-40" />;
  return (
    <section aria-label="Your week" className="card-soft rounded-[var(--radius)] border border-rule/70 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="label-head text-base">your week</h2>
        <div className="text-right">
          <p className="label-num text-3xl" data-testid="streak-days">
            {data.streakDays}
          </p>
          <p className="text-[11px] lowercase text-ink-faint">day{data.streakDays === 1 ? "" : "s"} in a row</p>
        </div>
      </div>
      <div className="mt-3 flex gap-1" aria-label={`${data.loggedDays} of ${data.windowDays} days logged`}>
        {data.week.map((d) => (
          <span
            key={d.date}
            aria-hidden
            title={d.date}
            className={d.logged ? "h-1.5 flex-1 rounded-full bg-primary/70" : "h-1.5 flex-1 rounded-full bg-surface-2"}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
        {data.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
