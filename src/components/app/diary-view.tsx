"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey, useApi } from "@/lib/client/api";
import { toast } from "sonner";
import { addDays, formatLocalDate } from "@/lib/nutrition/dates";
import type { DaySummary } from "@/lib/services/summary";
import { fmtNum, MEAL_TYPE_LABEL } from "@/lib/format";
import { MealCard, mealTotals, type MealWithImage } from "./meal-card";
import { NutritionLabel } from "./nutrition-label";

const ORDER = ["breakfast", "lunch", "dinner", "snack", "custom"] as const;

export function DiaryView({ today }: { today: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const day = useApi<{ summary: DaySummary; meals: MealWithImage[] }>(`/api/summary/day?date=${date}`);
  const prev = useApi<{ meals: MealWithImage[] }>(`/api/summary/day?date=${addDays(date, -1)}`);
  const [repeating, setRepeating] = useState<string | null>(null);

  async function repeatYesterday(type: string) {
    const source = (prev.data?.meals ?? []).filter((m) => m.mealType === type);
    setRepeating(type);
    try {
      for (const m of source) {
        await api(`/api/meals/${m.id}/copy`, { body: { localDate: date, mealType: type, idempotencyKey: newIdempotencyKey() } });
      }
      toast.success(`Repeated yesterday's ${MEAL_TYPE_LABEL[type].toLowerCase()}`);
      await day.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRepeating(null);
    }
  }
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const go = (d: string) => router.push(`/diary?date=${d}`, { scroll: false });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="label-num text-[32px]">Food diary</h1>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            aria-label="Search all meals"
            placeholder="Search past meals"
            className="pl-9"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearching(e.target.value.trim().length > 1);
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
              onClick={() => {
                setQuery("");
                setSearching(false);
              }}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      {searching ? (
        <SearchResults query={query.trim()} today={today} />
      ) : (
        <>
          <nav aria-label="Choose day" className="flex items-center justify-between gap-2 rounded-full border border-rule bg-surface p-1">
            <Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
              <ChevronLeft />
            </Button>
            <label className="flex items-center gap-2 font-medium">
              <CalendarDays className="size-4 text-ink-faint" />
              <span>
                {date === today
                  ? "Today"
                  : date === addDays(today, -1)
                    ? "Yesterday"
                    : formatLocalDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </span>
              <input
                type="date"
                aria-label="Pick a date"
                className="w-8 opacity-0 sm:w-auto sm:opacity-100 sm:text-sm sm:font-normal sm:text-ink-soft"
                value={date}
                max={today}
                onChange={(e) => e.target.value && go(e.target.value)}
              />
            </label>
            <Button variant="ghost" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => go(addDays(date, 1))}>
              <ChevronRight />
            </Button>
          </nav>

          {day.error ? <Notice tone="danger">{day.error}</Notice> : null}
          {!day.data ? (
            <Skeleton className="h-96" />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div className="flex flex-col gap-4">
                {ORDER.map((type) => {
                  const meals = day.data!.meals.filter((m) => m.mealType === type);
                  if (type === "custom" && meals.length === 0) return null;
                  const kcal = meals.reduce((s, m) => s + mealTotals(m).kcal, 0);
                  return (
                    <section
                      key={type}
                      aria-label={MEAL_TYPE_LABEL[type]}
                      className="rounded-[var(--radius)] border border-rule bg-surface"
                    >
                      <div className="flex items-center justify-between px-4 pt-3">
                        <h2 className="label-head text-base">
                          {MEAL_TYPE_LABEL[type]}{" "}
                          <span className="ml-1 font-mono text-xs font-normal text-ink-faint">
                            {meals.length ? `${fmtNum(kcal)} kcal` : ""}
                          </span>
                        </h2>
                        <Link
                          href={`/diary/new?date=${date}&type=${type}`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                          aria-label={`Add to ${MEAL_TYPE_LABEL[type]}`}
                        >
                          <Plus /> Add
                        </Link>
                      </div>
                      <div className="px-2 pb-2">
                        {meals.length ? (
                          meals.map((m) => <MealCard key={m.id} meal={m} showType={type === "custom"} />)
                        ) : (prev.data?.meals ?? []).some((m) => m.mealType === type) ? (
                          <div className="flex items-center justify-between gap-2 px-2 py-2">
                            <p className="text-sm text-ink-faint">Nothing logged.</p>
                            <Button size="sm" variant="outline" disabled={repeating !== null} onClick={() => repeatYesterday(type)}>
                              {repeating === type ? <Loader2 className="animate-spin" /> : null} repeat yesterday&apos;s{" "}
                              {MEAL_TYPE_LABEL[type].toLowerCase()}
                            </Button>
                          </div>
                        ) : (
                          <p className="px-2 py-3 text-sm text-ink-faint">Nothing logged.</p>
                        )}
                      </div>
                    </section>
                  );
                })}
                {day.data.meals.length === 0 ? (
                  <EmptyState
                    title={date === today ? "Your day is a blank page" : "Nothing logged this day"}
                    action={
                      <Link href={`/diary/new?date=${date}`} className={buttonVariants({})}>
                        Log a meal
                      </Link>
                    }
                  >
                    You can log past days too — totals use the target that applied on that date.
                  </EmptyState>
                ) : null}
              </div>
              <div className="lg:sticky lg:top-6 lg:self-start">
                <NutritionLabel
                  heading={date === today ? "Today" : formatLocalDate(date, { month: "short", day: "numeric" })}
                  sub={`${day.data.summary.totals.mealCount} meals`}
                  values={day.data.summary.totals}
                  targets={day.data.summary.targets.trackingOnly ? null : day.data.summary.targets}
                  partial={day.data.summary.partial}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SearchResults({ query, today }: { query: string; today: string }) {
  const [meals, setMeals] = useState<MealWithImage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      try {
        const r = await api<{ meals: MealWithImage[]; nextCursor: string | null }>(
          `/api/meals?q=${encodeURIComponent(query)}&to=${today}&limit=20${after ? `&cursor=${after}` : ""}`,
        );
        setMeals((m) => (after ? [...m, ...r.meals] : r.meals));
        setCursor(r.nextCursor);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [query, today],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  return (
    <section aria-label="Search results" className="rounded-[var(--radius)] border border-rule bg-surface p-2">
      {meals.length === 0 && !loading ? <p className="px-2 py-6 text-center text-sm text-ink-soft">No meals match “{query}”.</p> : null}
      {meals.map((m) => (
        <div key={m.id}>
          <p className="px-2 pt-2 font-mono text-[11px] text-ink-faint">{formatLocalDate(m.localDate)}</p>
          <MealCard meal={m} />
        </div>
      ))}
      {loading ? <Loader2 className="mx-auto my-3 size-5 animate-spin text-ink-faint" /> : null}
      {cursor && !loading ? (
        <Button variant="ghost" className="w-full" onClick={() => load(cursor)}>
          Load more
        </Button>
      ) : null}
    </section>
  );
}
