"use client";

import Link from "next/link";
import { ArrowRight, Check, Dumbbell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage, useApi } from "@/lib/client/api";
import type { TrainingState } from "@/lib/services/training";
import { cn } from "@/lib/utils";
import { KIND_ICON } from "./training-view";

/** Home card: today's session from the saved plan, with one-tap completion. */
export function TodayWorkout() {
  const { data: s, setData } = useApi<TrainingState>("/api/training");
  const idx = s ? s.week.findIndex((w) => w.date === s.today) : -1;
  const day = s?.plan && idx >= 0 ? s.plan.days[idx] : null;
  const done = !!(s && idx >= 0 && s.week[idx].done);

  async function toggle() {
    if (!s || !day) return;
    try {
      setData(await api<TrainingState>("/api/training", { method: "PATCH", body: { date: s.today, focus: day.focus, done: !done } }));
      if (!done) toast.success("Workout done. Nice work!");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const Icon = done ? Check : day ? KIND_ICON[day.kind] : Dumbbell;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-rule bg-surface px-5 py-4">
      <Link href="/training" className="group flex min-w-0 flex-1 items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", done ? "bg-primary text-primary-ink" : "bg-tint text-primary")}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="label-head block">{day ? (day.kind === "rest" ? "Rest day" : "Today's workout") : "Your training plan"}</span>
          <span className="block truncate text-sm text-ink-soft">
            {day ? `${day.focus}${day.kind !== "rest" ? ` · ${Math.round(day.minutes)} min` : ""}` : "Workouts built on your goal"}
          </span>
        </span>
        {!day || day.kind === "rest" ? <ArrowRight className="ml-auto size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" /> : null}
      </Link>
      {day && day.kind !== "rest" && s?.synced ? (
        <Button size="sm" variant={done ? "subtle" : "accent"} onClick={toggle} aria-pressed={done}>
          <Check /> {done ? "Done" : "Mark done"}
        </Button>
      ) : null}
    </div>
  );
}
