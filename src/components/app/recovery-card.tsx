"use client";

import Link from "next/link";
import { ArrowRight, BedDouble } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { fmtHm } from "@/lib/health/recovery";
import type { HealthOverview } from "@/lib/services/health";
import { ZONE_COLOR } from "./recovery-view";

/** Home: today's recovery, sleep and strain at a glance. */
export function RecoveryCard() {
  const { data: d } = useApi<HealthOverview>("/api/recovery");
  if (!d?.synced) return null;
  const r = d.todayRecovery;
  const today = d.days.find((x) => x.date === d.today);
  return (
    <Link href="/recovery" className="group flex items-center gap-4 rounded-[var(--radius)] border border-rule bg-surface px-5 py-4 hover:bg-surface-2">
      <span
        className="grid size-14 shrink-0 place-items-center rounded-full border-[5px] text-sm font-semibold"
        style={{ borderColor: r.zone ? ZONE_COLOR[r.zone] : "var(--color-rule)" }}
      >
        {r.score != null ? `${r.score}%` : <BedDouble className="size-5 text-ink-faint" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="label-head block">{r.score != null ? "Recovery" : "Track your recovery"}</span>
        <span className="block text-sm text-ink-soft">
          {r.score != null
            ? `Sleep ${today?.sleepMinutes != null ? fmtHm(today.sleepMinutes) : "–"} · Strain ${d.todayStrain ?? "–"}`
            : "Log sleep or connect Apple Health, WHOOP or Oura"}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
