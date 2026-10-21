"use client";

import { YourDay } from "./your-day";
import type { Briefing } from "@/lib/services/briefing";
import { TodayRing } from "./today-ring";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck, Camera, MessageCircle, PencilLine, Plus, Salad, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey, useApi } from "@/lib/client/api";
import type { FrequentFood } from "@/lib/repos/meals";
import type { DaySummary } from "@/lib/services/summary";
import type { ProgressView, AdaptiveView } from "@/lib/services/progress";
import type { AdaptiveSuggestionRow } from "@/lib/repos/misc";
import { fmtNum, fmtWeight, fmtWeightDelta, guessMealType, type Units } from "@/lib/format";
import { addDays, formatLocalDate } from "@/lib/nutrition/dates";
import { WeeklyCaloriesChart, WeightTrendChart } from "./charts";
import { MealCard, type MealWithImage } from "./meal-card";
import { NutritionLabel } from "./nutrition-label";
import { AdaptiveCard } from "./adaptive-card";
import { InsightsCard } from "./insights-card";
import { QuickLog } from "./quick-log";
import { WaterCard } from "./water-card";

export function HomeDashboard({ name, units, today }: { name: string | null; units: Units; today: string }) {
  const router = useRouter();
  const day = useApi<{ summary: DaySummary; meals: MealWithImage[]; today: string }>(`/api/summary/day?date=${today}`);
  const week = useApi<{ days: DaySummary[] }>(`/api/summary/range?from=${addDays(today, -6)}&to=${today}`);
  const weight = useApi<ProgressView>(`/api/metrics?days=60`);
  const frequent = useApi<{ foods: FrequentFood[] }>(`/api/foods/frequent`);
  const adaptive = useApi<AdaptiveView & { history: AdaptiveSuggestionRow[] }>(`/api/adaptive`);
  const [hourAtLoad] = useState(() => new Date().getHours());
  const briefing = useApi<Briefing>(`/api/briefing?hour=${hourAtLoad}`);
  const [adding, setAdding] = useState<string | null>(null);

  const s = day.data?.summary;
  const meals = day.data?.meals ?? [];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  async function quickAdd(f: FrequentFood) {
    const key = `${f.nutritionSource}:${f.nutritionSourceId}`;
    setAdding(key);
    try {
      await api("/api/meals", {
        body: {
          mealType: guessMealType(),
          localDate: today,
          title: f.displayName.slice(0, 120),
          sourceType: "quick_add",
          idempotencyKey: newIdempotencyKey(),
          items: [
            {
              displayName: f.displayName,
              weightGrams: f.typicalWeightGrams,
              food: { ref: { source: f.nutritionSource, id: f.nutritionSourceId } },
            },
          ],
        },
      });
      toast.success(`Added ${f.displayName} (${fmtNum(f.typicalWeightGrams)} g)`);
      await Promise.all([day.reload(), week.reload()]);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{formatLocalDate(today, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="label-num mt-1 text-[26px] sm:text-[36px]">
            {greeting}
            {name ? `, ${name}` : ""}.
          </h1>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link href="/diary/new" className={buttonVariants({ variant: "outline" })}>
            <PencilLine /> Log manually
          </Link>
          <Link href="/scan" className={buttonVariants({ variant: "accent" })}>
            <Camera /> Scan meal
          </Link>
        </div>
      </header>

      {s && !s.targets.trackingOnly ? <TodayRing values={s.totals} targets={s.targets} mealCount={s.totals.mealCount} bonus={briefing.data?.bonus} /> : null}

      {briefing.data ? <YourDay b={briefing.data} onChange={briefing.setData} /> : <Skeleton className="h-72" />}

      {adaptive.data?.suggestion?.status === "pending" ? (
        <AdaptiveCard
          suggestion={adaptive.data.suggestion}
          onDecided={() => {
            adaptive.reload();
            day.reload();
          }}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-4">
          {day.error ? <Notice tone="danger">{day.error}</Notice> : null}
          {!s ? (
            <Skeleton className="h-[420px]" />
          ) : s.targets.trackingOnly ? (
            <>
              <NutritionLabel heading="Today" sub={`${s.totals.mealCount} meals`} values={s.totals} partial={s.partial} />
              <p className="text-xs text-ink-faint">You&apos;re tracking without calorie targets.</p>
            </>
          ) : (
            <details className="group rounded-[var(--radius)]">
              <summary className="card-soft flex cursor-pointer list-none items-center justify-between rounded-[var(--radius)] border border-rule/70 bg-surface px-5 py-4 font-medium">
                Full nutrition breakdown
                <span className="text-ink-faint transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <NutritionLabel
                className="mt-3"
                heading="Today"
                sub={`${s.totals.mealCount} meal${s.totals.mealCount === 1 ? "" : "s"}`}
                values={s.totals}
                targets={s.targets}
                partial={s.partial}
              />
            </details>
          )}
          <Link
            href="/scan"
            className="card-soft flex items-center justify-between gap-3 rounded-[var(--radius)] border border-rule/70 bg-surface px-5 py-4 sm:hidden"
          >
            <span>
              <span className="label-head block text-lg">Scan your next meal</span>
              <span className="text-sm opacity-80">Photo → estimate → correct → save</span>
            </span>
            <span className="glaze grid size-12 place-items-center rounded-full">
              <Camera className="size-6" />
            </span>
          </Link>
        </div>

        <div className="flex flex-col gap-4">
          <QuickLog
            today={today}
            onLogged={() => {
              void day.reload();
              void week.reload();
              void frequent.reload();
            }}
          />
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s meals</CardTitle>
              <Link
                href={`/diary?date=${today}`}
                className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink"
              >
                Diary
              </Link>
            </CardHeader>
            <CardContent className="px-3">
              {day.loading && !day.data ? (
                <Skeleton className="h-32" />
              ) : meals.length === 0 ? (
                <EmptyState
                  icon={<Camera className="size-5" />}
                  title="Nothing logged yet today"
                  action={
                    <div className="flex gap-2">
                      <Link href="/scan" className={buttonVariants({ variant: "accent", size: "sm" })}>
                        Scan a meal
                      </Link>
                      <Link href="/diary/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        Add manually
                      </Link>
                    </div>
                  }
                >
                  Photograph your plate or search a food — totals update as you go.
                </EmptyState>
              ) : (
                <div className="flex flex-col">
                  {meals.map((m) => (
                    <MealCard key={m.id} meal={m} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {frequent.data?.foods.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Quick add</CardTitle>
                <span className="text-xs text-ink-faint">Your usual amounts</span>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {frequent.data.foods.slice(0, 8).map((f) => {
                  const key = `${f.nutritionSource}:${f.nutritionSourceId}`;
                  return (
                    <Button key={key} size="sm" variant="outline" disabled={adding === key} onClick={() => quickAdd(f)}>
                      <Plus /> {f.displayName.length > 26 ? `${f.displayName.slice(0, 24)}…` : f.displayName} ·{" "}
                      {fmtNum(f.typicalWeightGrams)} g
                    </Button>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <InsightsCard />
        <WaterCard today={today} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Last 7 days</CardTitle>
            <Link href="/progress" className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink">
              Trends
            </Link>
          </CardHeader>
          <CardContent>
            {week.data ? (
              week.data.days.some((d) => d.totals.mealCount > 0) ? (
                <WeeklyCaloriesChart
                  days={week.data.days.map((d) => ({
                    date: d.date,
                    kcal: d.totals.caloriesKcal,
                    target: d.targets.caloriesKcal,
                    logged: d.totals.mealCount > 0,
                  }))}
                />
              ) : (
                <p className="py-10 text-center text-sm text-ink-soft">Your weekly calories appear here once you log meals.</p>
              )
            ) : (
              <Skeleton className="h-44" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Weight trend</CardTitle>
            <Link
              href="/progress#weight"
              className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Log weight
            </Link>
          </CardHeader>
          <CardContent>
            {!weight.data ? (
              <Skeleton className="h-44" />
            ) : weight.data.trend.points.length < 2 ? (
              <EmptyState
                icon={<Scale className="size-5" />}
                title="Not enough weigh-ins yet"
                action={
                  <Link href="/progress#weight" className={buttonVariants({ size: "sm", variant: "outline" })}>
                    Add a weigh-in
                  </Link>
                }
              >
                Weigh in a few times a week — Ascend smooths daily swings into a trend.
              </EmptyState>
            ) : (
              <>
                <div className="mb-2 flex items-baseline gap-3">
                  <span className="label-num text-2xl">{fmtWeight(weight.data.trend.latestTrendKg, units)}</span>
                  <span className="text-sm text-ink-soft">trend · {fmtWeightDelta(weight.data.trend.change7dKg, units)} this week</span>
                </div>
                <WeightTrendChart points={weight.data.trend.points} units={units} targetKg={weight.data.targetWeightKg} height={150} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/plan"
          className="group flex items-center justify-between rounded-[var(--radius)] border border-rule bg-surface px-5 py-4 hover:bg-surface-2"
        >
          <span className="flex items-center gap-3">
            <Salad className="size-5 text-primary" />
            <span>
              <span className="label-head block">Meal ideas for what&apos;s left</span>
              <span className="text-sm text-ink-soft">
                {s?.remaining.caloriesKcal != null
                  ? `~${fmtNum(Math.max(0, s.remaining.caloriesKcal))} kcal remaining`
                  : "Based on your preferences"}
              </span>
            </span>
          </span>
          <ArrowRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/progress#weekly-report"
          className="group flex items-center justify-between rounded-[var(--radius)] border border-rule bg-surface px-5 py-4 hover:bg-surface-2"
        >
          <span className="flex items-center gap-3">
            <CalendarCheck className="size-5 text-primary" />
            <span>
              <span className="label-head block">Your weekly report</span>
              <span className="text-sm text-ink-soft">Food, training, sleep and weight</span>
            </span>
          </span>
          <ArrowRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/coach"
          className="group flex items-center justify-between rounded-[var(--radius)] border border-rule bg-surface px-5 py-4 hover:bg-surface-2"
        >
          <span className="flex items-center gap-3">
            <MessageCircle className="size-5 text-primary" />
            <span>
              <span className="label-head block">Ask the coach</span>
              <span className="text-sm text-ink-soft">Answers grounded in your logs</span>
            </span>
          </span>
          <ArrowRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
