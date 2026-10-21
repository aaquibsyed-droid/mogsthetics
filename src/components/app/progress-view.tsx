"use client";

import { useState } from "react";
import { WeeklyReport } from "./weekly-report";
import { Loader2, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Notice, Segmented, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { useHydrated } from "@/lib/client/use-hydrated";
import { addDays, formatLocalDate } from "@/lib/nutrition/dates";
import { lbToKg } from "@/lib/nutrition/units";
import type { AdaptiveSuggestionRow } from "@/lib/repos/misc";
import type { AdaptiveView, ProgressView as Progress } from "@/lib/services/progress";
import type { DaySummary } from "@/lib/services/summary";
import { fmtNum, fmtWeight, fmtWeightDelta, type Units } from "@/lib/format";
import { AdaptiveCard } from "./adaptive-card";
import { WeeklyCaloriesChart, WeightTrendChart } from "./charts";

export function ProgressView({ units, today }: { units: Units; today: string }) {
  const [range, setRange] = useState<"30" | "90" | "180" | "365">("90");
  const progress = useApi<Progress>(`/api/metrics?days=${range}`);
  const nutrition = useApi<{ days: DaySummary[] }>(`/api/summary/range?from=${addDays(today, -27)}&to=${today}`);
  const adaptive = useApi<AdaptiveView & { history: AdaptiveSuggestionRow[] }>(`/api/adaptive`);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(today);
  const [waist, setWaist] = useState("");
  const [saving, setSaving] = useState(false);
  const hydrated = useHydrated();
  const unit = units === "imperial" ? "lb" : "kg";

  async function logWeight(e: React.FormEvent) {
    e.preventDefault();
    const w = Number(weight);
    const wc = waist ? Number(waist) : null;
    if (!(w > 0) && !(wc && wc > 0)) return toast.error("Enter a weight or a waist measurement.");
    setSaving(true);
    try {
      await api("/api/metrics", {
        body: {
          localDate: date,
          weightKg: w > 0 ? Math.round((units === "imperial" ? lbToKg(w) : w) * 100) / 100 : null,
          waistCm: wc ? (units === "imperial" ? Math.round(wc * 2.54 * 10) / 10 : wc) : null,
        },
      });
      toast.success("Saved");
      setWeight("");
      setWaist("");
      await Promise.all([progress.reload(), adaptive.reload()]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/metrics/${id}`, { method: "DELETE" });
      await progress.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const p = progress.data;
  const days = nutrition.data?.days ?? [];
  const logged = days.filter((d) => d.totals.mealCount > 0);
  const avg = (f: (d: DaySummary) => number | null) => (logged.length ? logged.reduce((s, d) => s + (f(d) ?? 0), 0) / logged.length : null);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="label-num text-[32px]">Progress</h1>

      <WeeklyReport units={units} />

      {adaptive.data?.suggestion?.status === "pending" ? (
        <AdaptiveCard suggestion={adaptive.data.suggestion} onDecided={() => adaptive.reload()} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card id="weight">
          <CardHeader>
            <CardTitle>Weight</CardTitle>
            <Segmented
              name="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: "30", label: "1M" },
                { value: "90", label: "3M" },
                { value: "180", label: "6M" },
                { value: "365", label: "1Y" },
              ]}
            />
          </CardHeader>
          <CardContent>
            {!p ? (
              <Skeleton className="h-64" />
            ) : p.trend.points.length < 2 ? (
              <EmptyState icon={<Scale className="size-5" />} title="Add a couple of weigh-ins">
                Weigh yourself at a similar time of day, a few times a week. A single reading says little — the trend line is what matters.
              </EmptyState>
            ) : (
              <WeightTrendChart points={p.trend.points} units={units} targetKg={p.targetWeightKg} />
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Log a weigh-in</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={logWeight} className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Weight (${unit})`} htmlFor="w">
                    <Input id="w" type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
                  </Field>
                  <Field label="Date" htmlFor="wd">
                    <Input id="wd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>
                <Field label={`Waist (${units === "imperial" ? "in" : "cm"}, optional)`} htmlFor="waist">
                  <Input id="waist" type="number" inputMode="decimal" step="0.1" value={waist} onChange={(e) => setWaist(e.target.value)} />
                </Field>
                <Button type="submit" disabled={saving || !hydrated}>
                  {saving ? <Loader2 className="animate-spin" /> : null} Save weigh-in
                </Button>
              </form>
            </CardContent>
          </Card>

          {p ? (
            <Card>
              <CardHeader>
                <CardTitle>Trend</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="eyebrow">Current trend</dt>
                    <dd className="label-num mt-1 text-2xl" data-testid="trend-weight">
                      {fmtWeight(p.trend.latestTrendKg, units)}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Rate</dt>
                    <dd className="label-num mt-1 text-2xl">
                      {p.trend.ratePerWeekKg === null ? "—" : `${fmtWeightDelta(p.trend.ratePerWeekKg, units, 2)}/wk`}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">7 days</dt>
                    <dd className="font-mono">{fmtWeightDelta(p.trend.change7dKg, units)}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">30 days</dt>
                    <dd className="font-mono">{fmtWeightDelta(p.trend.change30dKg, units)}</dd>
                  </div>
                </dl>
                {p.trend.insufficientReason && !(p.targetWeightKg && p.projection.message === p.trend.insufficientReason) ? (
                  <p className="text-ink-soft">{p.trend.insufficientReason}</p>
                ) : null}
                {p.targetWeightKg ? (
                  <Notice
                    tone={p.projection.status === "projected" ? "good" : "info"}
                    title={
                      p.projection.weeksRange
                        ? `Roughly ${p.projection.weeksRange[0]}–${p.projection.weeksRange[1]} weeks to ${fmtWeight(p.targetWeightKg, units)}`
                        : `Target ${fmtWeight(p.targetWeightKg, units)}`
                    }
                  >
                    {p.projection.message}
                  </Notice>
                ) : null}
                <p className="text-xs text-ink-faint">
                  Daily readings move with water, salt and meal timing. The trend (an exponentially smoothed average) is what progress
                  estimates use. Ascend doesn&apos;t estimate body fat.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calories, last 4 weeks</CardTitle>
          </CardHeader>
          <CardContent>
            {!nutrition.data ? (
              <Skeleton className="h-44" />
            ) : logged.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-soft">Log meals to see intake trends.</p>
            ) : (
              <>
                <WeeklyCaloriesChart
                  days={days.map((d) => ({
                    date: d.date,
                    kcal: d.totals.caloriesKcal,
                    target: d.targets.caloriesKcal,
                    logged: d.totals.mealCount > 0,
                  }))}
                />
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="eyebrow">Avg kcal</dt>
                    <dd className="font-mono text-base">{fmtNum(avg((d) => d.totals.caloriesKcal))}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Avg protein</dt>
                    <dd className="font-mono text-base">{fmtNum(avg((d) => d.totals.proteinG))} g</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Days logged</dt>
                    <dd className="font-mono text-base">
                      {logged.length}/{days.length}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-ink-faint">Averages use logged days only.</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Adaptive target</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!adaptive.data ? (
              <Skeleton className="h-24" />
            ) : adaptive.data.trackingOnly ? (
              <p className="text-ink-soft">Not used while you&apos;re tracking without targets.</p>
            ) : adaptive.data.evaluation ? (
              <>
                <p className="font-medium">
                  {adaptive.data.evaluation.status === "on_track"
                    ? "Your target looks consistent with your data."
                    : adaptive.data.evaluation.status === "disabled"
                      ? "Adaptive suggestions are off."
                      : adaptive.data.evaluation.status === "cooldown"
                        ? "Recently reviewed."
                        : adaptive.data.evaluation.status === "suggest"
                          ? "A change is suggested above."
                          : "Collecting data."}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-ink-soft">
                  {adaptive.data.evaluation.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="text-xs text-ink-faint">
              Ascend compares your logged intake with your weight trend over 4 weeks and may suggest a small change (never more than
              150 kcal). Nothing changes unless you accept. Turn this off in Profile.
            </p>
            {adaptive.data?.history.filter((h) => h.status !== "pending").length ? (
              <details>
                <summary className="cursor-pointer font-medium">Past suggestions</summary>
                <ul className="mt-2 space-y-1 text-ink-soft">
                  {adaptive.data.history
                    .filter((h) => h.status !== "pending")
                    .map((h) => (
                      <li key={h.id}>
                        {formatLocalDate(h.createdOn)}: {fmtNum(h.previousTargetKcal)} → {fmtNum(h.suggestedTargetKcal)} kcal · {h.status}
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {p && p.metrics.length ? (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-rule text-sm" aria-label="Measurements">
              {[...p.metrics]
                .reverse()
                .slice(0, 30)
                .map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2">
                    <span className="text-ink-soft">{formatLocalDate(m.localDate)}</span>
                    <span className="flex items-center gap-4 font-mono">
                      {m.weightKg != null ? fmtWeight(m.weightKg, units) : ""}
                      {m.waistCm != null ? (
                        <span className="text-ink-faint">
                          waist {units === "imperial" ? `${fmtNum(m.waistCm / 2.54, 1)} in` : `${fmtNum(m.waistCm, 1)} cm`}
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete measurement from ${m.localDate}`}
                        onClick={() => remove(m.id)}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
