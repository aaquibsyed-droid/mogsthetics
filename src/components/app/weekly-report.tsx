"use client";

import { BedDouble, Dumbbell, Flame, Scale, Share2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useApi } from "@/lib/client/api";
import { fmtNum, fmtWeightDelta, type Units } from "@/lib/format";
import { fmtHm } from "@/lib/health/recovery";
import { formatLocalDate } from "@/lib/nutrition/dates";
import type { WeeklyReport as Report } from "@/lib/services/briefing";

/** Last 7 days across food, training, sleep and weight, with a one-tap share. */
export function WeeklyReport({ units }: { units: Units }) {
  const { data: r } = useApi<Report>("/api/report");
  if (!r) return <Skeleton className="h-56" />;
  const tiles = [
    { icon: UtensilsCrossed, label: "Days logged", value: `${r.daysLogged}/7`, sub: r.avgCaloriesKcal ? `avg ${fmtNum(r.avgCaloriesKcal)} kcal` : "" },
    { icon: Dumbbell, label: "Workouts", value: r.workoutsPlanned ? `${r.workoutsDone}/${r.workoutsPlanned}` : `${r.workoutsDone}`, sub: r.workoutsPlanned ? "planned this week" : "no plan yet" },
    { icon: BedDouble, label: "Avg sleep", value: r.avgSleepMinutes != null ? fmtHm(r.avgSleepMinutes) : "–", sub: r.avgRecovery != null ? `${r.avgRecovery}% recovery` : "" },
    { icon: Scale, label: "Weight trend", value: r.weightChangeKg != null ? fmtWeightDelta(r.weightChangeKg, units) : "–", sub: "this week" },
  ];

  async function share() {
    const text = [
      `My week on Ascend (${formatLocalDate(r!.from, { month: "short", day: "numeric" })}–${formatLocalDate(r!.to, { month: "short", day: "numeric" })})`,
      ...tiles.filter((t) => t.value !== "–").map((t) => `• ${t.label}: ${t.value}${t.sub ? ` (${t.sub})` : ""}`),
      r!.streak ? `🔥 ${r!.streak}-day logging streak` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard.");
      }
    } catch {
      // Share sheet dismissed.
    }
  }

  return (
    <Card id="weekly-report" className="scroll-mt-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>This week</CardTitle>
        <Button size="sm" variant="outline" onClick={share}>
          <Share2 /> Share
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl bg-surface-2 p-3">
              <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                <t.icon className="size-3.5 text-primary" /> {t.label}
              </p>
              <p className="label-num mt-1 text-xl">{t.value}</p>
              {t.sub ? <p className="text-[11px] text-ink-faint">{t.sub}</p> : null}
            </div>
          ))}
        </div>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {r.streak ? (
            <li className="flex items-center gap-2 font-medium">
              <Flame className="size-4 text-primary" /> {r.streak}-day logging streak
            </li>
          ) : null}
          {r.highlights.map((h, i) => (
            <li key={i} className="text-ink-soft">
              ✓ {h}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
