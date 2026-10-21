"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey, useApi } from "@/lib/client/api";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import { formatLocalDate } from "@/lib/nutrition/dates";
import { fmtNum, MEAL_TYPE_LABEL } from "@/lib/format";
import type { MealWithImage } from "./meal-card";
import { MealComposer, mealToComposerItems } from "./meal-composer";
import { NutritionLabel } from "./nutrition-label";

export function MealDetail({ mealId, today }: { mealId: string; today: string }) {
  const router = useRouter();
  const { data, error, reload, setData } = useApi<{ meal: MealWithImage }>(`/api/meals/${mealId}`);
  const [editing, setEditing] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyDate, setCopyDate] = useState(today);
  const [copyType, setCopyType] = useState("");

  if (error)
    return (
      <Notice tone="danger" title="Couldn't load this meal">
        {error}
      </Notice>
    );
  if (!data) return <Skeleton className="h-96" />;
  const meal = data.meal;
  const calc = computeMeal(meal.items.map((i) => ({ key: i.id, weightGrams: i.weightGrams, per100g: i.snapshot!.per100g })));
  const totals = {
    caloriesKcal: meal.items.reduce((s, i) => s + (i.snapshot?.caloriesKcal ?? 0), 0),
    proteinG: meal.items.reduce((s, i) => s + (i.snapshot?.proteinG ?? 0), 0),
    carbohydratesG: meal.items.reduce((s, i) => s + (i.snapshot?.carbohydratesG ?? 0), 0),
    totalFatG: meal.items.reduce((s, i) => s + (i.snapshot?.totalFatG ?? 0), 0),
    saturatedFatG: calc.totals.values.saturatedFatG,
    fiberG: calc.totals.values.fiberG,
    sugarsG: calc.totals.values.sugarsG,
    sodiumMg: calc.totals.values.sodiumMg,
  };

  async function del() {
    setBusy(true);
    try {
      await api(`/api/meals/${meal.id}`, { method: "DELETE" });
      toast.success("Meal deleted");
      router.push(`/diary?date=${meal.localDate}`);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const r = await api<{ meal: { id: string; localDate: string } }>(`/api/meals/${meal.id}/copy`, {
        body: { localDate: copyDate, mealType: copyType || undefined, idempotencyKey: newIdempotencyKey() },
      });
      toast.success(`Copied to ${formatLocalDate(r.meal.localDate)}`);
      router.push(`/diary?date=${r.meal.localDate}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="label-num text-[28px]">Edit meal</h1>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
        <MealComposer
          mode="edit"
          initialMeal={meal}
          initialItems={mealToComposerItems(meal)}
          defaultDate={meal.localDate}
          today={today}
          onSaved={(m) => {
            setData({ meal: { ...m, imageUrl: meal.imageUrl } });
            setEditing(false);
            void reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-4">
        <div>
          <p className="eyebrow">
            {meal.mealType === "custom" ? meal.customLabel : MEAL_TYPE_LABEL[meal.mealType]} · {formatLocalDate(meal.localDate)}
          </p>
          <h1 className="label-num mt-1 text-[30px]">{meal.title}</h1>
        </div>
        {meal.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private signed URL
          <img src={meal.imageUrl} alt={`Photo of ${meal.title}`} className="max-h-80 w-full rounded-[20px] object-cover" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilLine /> Edit
          </Button>
          <Button variant="outline" onClick={() => setCopyOpen(true)}>
            <Copy /> Duplicate
          </Button>
          <Button variant="ghost" className="text-danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
        <ul className="divide-y divide-rule rounded-[var(--radius)] border border-rule bg-surface">
          {meal.items.map((i) => {
            const md = i.snapshot?.sourceMetadata as
              { provider?: string; url?: string | null; dataType?: string; description?: string } | undefined;
            return (
              <li key={i.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {i.displayName} {i.isUserCorrected ? <Badge tone="outline">Edited</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {fmtNum(i.weightGrams)} g · P {fmtNum(i.snapshot?.proteinG, 1)} · C {fmtNum(i.snapshot?.carbohydratesG, 1)} · F{" "}
                      {fmtNum(i.snapshot?.totalFatG, 1)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {md?.provider ?? i.nutritionSource}
                      {md?.dataType === "label" ? " · label values" : md?.dataType === "user_estimate" ? " · your estimate" : ""}
                      {i.snapshot?.energySource === "derived_atwater" ? " · energy derived from macros (4/4/9)" : ""}
                      {md?.url ? (
                        <>
                          {" · "}
                          <a className="underline" href={md.url} target="_blank" rel="noreferrer">
                            source
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <p className="label-num text-xl">{fmtNum(i.snapshot?.caloriesKcal)}</p>
                </div>
              </li>
            );
          })}
        </ul>
        {meal.notes ? <p className="text-sm text-ink-soft">{meal.notes}</p> : null}
      </div>
      <div className="lg:sticky lg:top-6 lg:self-start">
        <NutritionLabel
          heading="This meal"
          sub={`${meal.items.length} items`}
          values={totals}
          partial={{
            fiber: calc.totals.missing.fiberG > 0,
            sugars: calc.totals.missing.sugarsG > 0,
            saturatedFat: calc.totals.missing.saturatedFatG > 0,
            sodium: calc.totals.missing.sodiumMg > 0,
          }}
        />
      </div>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent title="Duplicate meal" description="Adds a copy with the same foods and amounts.">
          <div className="flex flex-col gap-4">
            <Field label="Date" htmlFor="copy-date">
              <Input id="copy-date" type="date" value={copyDate} max={today} onChange={(e) => setCopyDate(e.target.value)} />
            </Field>
            <Field label="Meal" htmlFor="copy-type">
              <Select id="copy-type" value={copyType} onChange={(e) => setCopyType(e.target.value)}>
                <option value="">Same as original</option>
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={copy} disabled={busy || !copyDate}>
              {busy ? <Loader2 className="animate-spin" /> : <Copy />} Duplicate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent title="Delete this meal?" description="The meal, its items and its photo are permanently removed.">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={del} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete meal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
