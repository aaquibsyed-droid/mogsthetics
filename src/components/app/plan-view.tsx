"use client";

import { uid } from "@/lib/client/uid";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Clock, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, newIdempotencyKey, useApi } from "@/lib/client/api";
import type { MealSuggestion } from "@/lib/ai/schemas";
import { ALLERGEN_LABELS, parseRef, type Allergen } from "@/lib/food-data/types";
import type { RecipeRow } from "@/lib/repos/misc";
import { fmtNum, guessMealType } from "@/lib/format";

interface SuggestResponse {
  suggestions: MealSuggestion[];
  remaining: { caloriesKcal: number | null; proteinG: number | null };
  notes: string[];
  aiUsed: boolean;
  aiStatus: string;
}

export function PlanView({ today }: { today: string }) {
  const router = useRouter();
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [ingredients, setIngredients] = useState("");
  const [prep, setPrep] = useState("");
  const [budget, setBudget] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [request, setRequest] = useState<Record<string, unknown>>(() => ({
    localDate: today,
    mealType,
    availableIngredients: [],
    maxPrepMinutes: null,
    budget: null,
    useAi: true,
  }));
  const [result, setResult] = useState<{ key: string; data?: SuggestResponse; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const recipes = useApi<{ recipes: RecipeRow[] }>("/api/recipes");
  const requestKey = JSON.stringify(request);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? (result.error ?? null) : null;

  useEffect(() => {
    let cancelled = false;
    const { nonce: _nonce, ...body } = request; // nonce only forces a refetch
    void _nonce;
    api<SuggestResponse>("/api/suggestions", { body })
      .then((d) => !cancelled && setResult({ key: requestKey, data: d }))
      .catch((e) => !cancelled && setResult((r) => ({ key: requestKey, data: r?.data, error: errorMessage(e) })));
    return () => {
      cancelled = true;
    };
  }, [request, requestKey]);

  const load = useCallback(() => {
    setRequest({
      localDate: today,
      mealType,
      availableIngredients: ingredients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
      maxPrepMinutes: prep ? Number(prep) : null,
      budget: budget || null,
      useAi,
      nonce: uid(),
    });
  }, [today, mealType, ingredients, prep, budget, useAi]);

  async function addToDiary(s: MealSuggestion) {
    setBusy(`add-${s.id}`);
    try {
      await api("/api/meals", {
        body: {
          mealType: s.mealType,
          localDate: today,
          title: s.name,
          sourceType: "suggestion",
          idempotencyKey: newIdempotencyKey(),
          items: s.ingredients.map((i) => ({
            displayName: i.name,
            weightGrams: i.grams,
            food: i.per100g ? { custom: { name: i.name, per100g: i.per100g, dataType: "user_estimate" } } : { ref: parseRef(i.foodRef)! },
          })),
        },
      });
      toast.success(`${s.name} added to today`);
      router.push("/home");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveRecipe(s: MealSuggestion) {
    setBusy(`save-${s.id}`);
    try {
      await api("/api/recipes", {
        body: {
          name: s.name,
          servings: 1,
          instructions: s.instructions,
          origin: "suggestion",
          ingredients: s.ingredients.map((i) => ({ foodRef: i.foodRef, displayName: i.name, grams: i.grams, ...(i.per100g ? { per100g: i.per100g } : {}) })),
        },
      });
      toast.success("Saved to your recipes");
      await recipes.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="label-num text-[32px]">Meal ideas</h1>
        <p className="mt-1 text-ink-soft">
          {data?.remaining.caloriesKcal != null
            ? `About ${fmtNum(Math.max(0, data.remaining.caloriesKcal))} kcal and ${fmtNum(Math.max(0, data.remaining.proteinG ?? 0))} g protein left today.`
            : "Ideas that respect your preferences and allergies."}
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
          <Field label="Meal" htmlFor="pm">
            <Select id="pm" value={mealType} onChange={(e) => setMealType(e.target.value)}>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </Select>
          </Field>
          <Field label="I have (optional)" htmlFor="pi">
            <Input id="pi" placeholder="e.g. eggs, spinach" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          </Field>
          <Field label="Max prep" htmlFor="pp">
            <Select id="pp" value={prep} onChange={(e) => setPrep(e.target.value)}>
              <option value="">Any</option>
              <option value="10">10 min</option>
              <option value="20">20 min</option>
              <option value="30">30 min</option>
            </Select>
          </Field>
          <Field label="Budget" htmlFor="pb">
            <Select id="pb" value={budget} onChange={(e) => setBudget(e.target.value)}>
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
            </Select>
          </Field>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Show ideas
          </Button>
          {data && ["anthropic", "ollama", "gemini"].includes(data.aiStatus) ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-5">
              <Switch checked={useAi} onCheckedChange={setUseAi} aria-label="Include AI ideas" />
              <Sparkles className="size-4 text-primary" /> AI chef ideas, personalised to your goals and what&apos;s left today
            </label>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {data?.notes.map((n) => (
        <Notice key={n} tone="info">
          {n}
        </Notice>
      ))}

      {!data && loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : data && data.suggestions.length === 0 ? (
        <EmptyState title="No ideas match right now">Try removing the prep-time limit or the ingredient list.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data?.suggestions.map((s) => (
            <article key={s.id} className="flex flex-col rounded-[var(--radius)] border border-rule bg-surface" aria-label={s.name}>
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline" className="capitalize">
                      {s.mealType}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-ink-faint">
                      <Clock className="size-3" /> {s.prepMinutes} min
                    </span>
                    {s.source === "ai" ? (
                      <Badge tone="accent">
                        <Sparkles className="size-3" /> AI idea
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="label-head mt-2 text-lg">{s.name}</h2>
                </div>
                <div className="text-right">
                  <p className="label-num text-3xl">{fmtNum(s.nutrients.caloriesKcal)}</p>
                  <p className="text-[11px] text-ink-faint">kcal</p>
                </div>
              </div>
              <div className="rule-mid mx-5 mt-3" />
              <dl className="mx-5 grid grid-cols-4 gap-2 py-2 text-center text-xs">
                {[
                  ["Protein", s.nutrients.proteinG],
                  ["Carbs", s.nutrients.carbohydratesG],
                  ["Fat", s.nutrients.totalFatG],
                  ["Fiber", s.nutrients.fiberG],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <dt className="text-ink-faint">{l}</dt>
                    <dd className="font-mono text-sm font-medium">{fmtNum(v as number | null)} g</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-1 flex-col gap-3 px-5 pb-5 text-sm">
                <ul className="space-y-0.5">
                  {s.ingredients.map((i) => (
                    <li key={i.foodRef} className="flex justify-between gap-2">
                      <span>{i.name}</span>
                      <span className="font-mono text-ink-soft">{fmtNum(i.grams)} g</span>
                    </li>
                  ))}
                </ul>
                <details>
                  <summary className="cursor-pointer font-medium">Method & swaps</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
                    {s.instructions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ol>
                  {s.substitutions.length ? <p className="mt-2 text-ink-soft">Swaps: {s.substitutions.join(" ")}</p> : null}
                </details>
                <p className="text-xs text-ink-faint">
                  Contains:{" "}
                  {s.allergens.length ? s.allergens.map((a) => ALLERGEN_LABELS[a as Allergen]).join(", ") : "none of the tracked allergens"}
                  . {s.nutritionNote}
                </p>
                {s.fitNotes.map((n) => (
                  <p key={n} className="text-xs text-ink-soft">
                    {n}
                  </p>
                ))}
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => addToDiary(s)} disabled={!!busy}>
                    {busy === `add-${s.id}` ? <Loader2 className="animate-spin" /> : <Plus />} Add to today
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => saveRecipe(s)} disabled={!!busy}>
                    <BookmarkPlus /> Save recipe
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Saved recipes</CardTitle>
        </CardHeader>
        <CardContent>
          {!recipes.data ? (
            <Skeleton className="h-16" />
          ) : recipes.data.recipes.length === 0 ? (
            <p className="text-sm text-ink-soft">Recipes you save from ideas appear here.</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {recipes.data.recipes.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{r.name}</span>{" "}
                    <span className="text-ink-faint">· {r.ingredients.length} ingredients</span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await api("/api/meals", {
                            body: {
                              mealType: guessMealType(),
                              localDate: today,
                              title: r.name,
                              sourceType: "suggestion",
                              idempotencyKey: newIdempotencyKey(),
                              items: r.ingredients.map((i) => ({
                                displayName: i.displayName,
                                weightGrams: i.grams,
                                food: { ref: { source: i.nutritionSource, id: i.nutritionSourceId } },
                              })),
                            },
                          });
                          toast.success(`${r.name} added to today`);
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      <Plus /> Log
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${r.name}`}
                      onClick={async () => {
                        try {
                          await api(`/api/recipes/${r.id}`, { method: "DELETE" });
                          await recipes.reload();
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
