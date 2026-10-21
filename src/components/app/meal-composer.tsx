"use client";

import { uid } from "@/lib/client/uid";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Replace, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import type { MealItemInput } from "@/lib/domain/schemas";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import type { NutrientValues } from "@/lib/nutrition/nutrients";
import type { MealView } from "@/lib/repos/meals";
import { MEAL_TYPE_LABEL, fmtNum, guessMealType } from "@/lib/format";
import { FoodPickerDialog, type PickedFood } from "./food-picker";
import { NutritionLabel } from "./nutrition-label";

export interface ComposerItem {
  key: string;
  item: MealItemInput;
  per100g: NutrientValues;
}

export function mealToComposerItems(meal: MealView): ComposerItem[] {
  return meal.items.map((i) => ({
    key: i.id,
    per100g: i.snapshot?.per100g ?? ({} as NutrientValues),
    item: {
      id: i.id,
      displayName: i.displayName,
      canonicalName: i.canonicalName,
      weightGrams: i.weightGrams,
      quantity: i.quantity,
      quantityUnit: i.quantityUnit,
      preparationMethod: i.preparationMethod,
      food:
        i.nutritionSource === "user_entered"
          ? {
              custom: {
                name: String(i.snapshot?.sourceMetadata?.name ?? i.displayName),
                per100g: i.snapshot!.per100g,
                dataType: i.snapshot?.sourceMetadata?.dataType === "label" ? "label" : "user_estimate",
              },
            }
          : { ref: { source: i.nutritionSource, id: i.nutritionSourceId } },
    },
  }));
}

export function GramStepper({ value, onChange, label }: { value: number; onChange: (g: number) => void; label: string }) {
  const step = value >= 200 ? 25 : value >= 50 ? 10 : 5;
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(1, Math.round(value - step)))}
      >
        <Minus />
      </Button>
      <label className="sr-only" htmlFor={`g-${label}`}>
        {label} grams
      </label>
      <Input
        id={`g-${label}`}
        type="number"
        inputMode="decimal"
        min={1}
        max={5000}
        className="h-8 w-20 px-2 text-center font-mono text-sm"
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : ""}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(5000, Math.max(0, v)));
        }}
      />
      <span className="text-xs text-ink-faint">g</span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(5000, Math.round(value + step)))}
      >
        <Plus />
      </Button>
    </div>
  );
}

export function MealComposer({
  mode,
  initialItems = [],
  initialMeal,
  defaultDate,
  today,
  defaultMealType,
  sourceType = "manual",
  onSaved,
}: {
  mode: "create" | "edit";
  initialItems?: ComposerItem[];
  initialMeal?: Pick<MealView, "id" | "title" | "mealType" | "localDate" | "notes" | "customLabel">;
  defaultDate: string;
  today?: string;
  defaultMealType?: string;
  sourceType?: "manual" | "barcode" | "suggestion" | "quick_add";
  onSaved?: (meal: MealView) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ComposerItem[]>(initialItems);
  const [mealType, setMealType] = useState(initialMeal?.mealType ?? defaultMealType ?? guessMealType());
  const [customLabel, setCustomLabel] = useState(initialMeal?.customLabel ?? "");
  const [date, setDate] = useState(initialMeal?.localDate ?? defaultDate);
  const [title, setTitle] = useState(initialMeal?.title ?? "");
  const [notes, setNotes] = useState(initialMeal?.notes ?? "");
  const [picker, setPicker] = useState<{ open: boolean; replaceKey?: string; query?: string }>({ open: false });
  const [saveCustom, setSaveCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idemKey] = useState(newIdempotencyKey);

  const calc = useMemo(
    () => computeMeal(items.map((i) => ({ key: i.key, weightGrams: i.item.weightGrams || 0, per100g: i.per100g }))),
    [items],
  );

  function onPick(p: PickedFood, opts: { saveCustom: boolean }) {
    if (opts.saveCustom) setSaveCustom(true);
    if (picker.replaceKey) {
      setItems((s) =>
        s.map((i) => (i.key === picker.replaceKey ? { key: i.key, per100g: p.per100g, item: { ...p.item, id: i.item.id } } : i)),
      );
    } else {
      setItems((s) => [...s, { key: uid(), per100g: p.per100g, item: p.item }]);
    }
  }

  async function save() {
    if (!items.length) return toast.error("Add at least one food.");
    if (items.some((i) => !(i.item.weightGrams > 0))) return toast.error("Every item needs an amount above 0 g.");
    setSaving(true);
    const autoTitle =
      title.trim() ||
      items
        .map((i) => i.item.displayName)
        .slice(0, 3)
        .join(", ")
        .slice(0, 120);
    try {
      const body = {
        mealType,
        customLabel: mealType === "custom" ? customLabel || "Other" : null,
        localDate: date,
        title: autoTitle,
        notes: notes.trim() || null,
        items: items.map((i) => i.item),
      };
      const res =
        mode === "create"
          ? await api<{ meal: MealView }>("/api/meals", {
              body: { ...body, sourceType, idempotencyKey: idemKey, saveCustomFoods: saveCustom },
            })
          : await api<{ meal: MealView }>(`/api/meals/${initialMeal!.id}`, { method: "PATCH", body });
      toast.success(mode === "create" ? "Meal saved" : "Meal updated");
      if (onSaved) onSaved(res.meal);
      else {
        router.push(`/diary?date=${res.meal.localDate}`);
        router.refresh();
      }
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Meal" htmlFor="mealType">
            <Select id="mealType" value={mealType} onChange={(e) => setMealType(e.target.value as typeof mealType)}>
              {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {k === "snack" ? "Snack" : v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="date">
            <Input id="date" type="date" value={date} max={today ?? defaultDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {mealType === "custom" ? (
          <Field label="Category name" htmlFor="customLabel">
            <Input
              id="customLabel"
              maxLength={40}
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="e.g. Pre-workout"
            />
          </Field>
        ) : null}
        <Field label="Title (optional)" htmlFor="title">
          <Input
            id="title"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Named from its foods if left blank"
          />
        </Field>

        <section aria-label="Foods">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="label-head text-base">Foods</h2>
            <Button type="button" variant="subtle" size="sm" onClick={() => setPicker({ open: true })}>
              <Plus /> Add food
            </Button>
          </div>
          {items.length === 0 ? (
            <EmptyState title="No foods yet" action={<Button onClick={() => setPicker({ open: true })}>Search foods</Button>}>
              Search the USDA database, scan a barcode, or type in a nutrition label.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-rule rounded-[var(--radius)] border border-rule bg-surface">
              {items.map((i, idx) => {
                const n = calc.items[idx]?.nutrients;
                return (
                  <li key={i.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Input
                        aria-label="Food name"
                        className="h-8 border-transparent bg-transparent px-0 font-medium focus-visible:border-rule focus-visible:px-2"
                        value={i.item.displayName}
                        maxLength={200}
                        onChange={(e) =>
                          setItems((s) => s.map((x) => (x.key === i.key ? { ...x, item: { ...x.item, displayName: e.target.value } } : x)))
                        }
                      />
                      <p className="text-xs text-ink-faint">
                        {fmtNum(n?.caloriesKcal)} kcal · P {fmtNum(n?.proteinG, 1)} · C {fmtNum(n?.carbohydratesG, 1)} · F{" "}
                        {fmtNum(n?.totalFatG, 1)}
                        {"custom" in i.item.food ? " · label values" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <GramStepper
                        label={i.item.displayName}
                        value={i.item.weightGrams}
                        onChange={(g) =>
                          setItems((s) => s.map((x) => (x.key === i.key ? { ...x, item: { ...x.item, weightGrams: g } } : x)))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Replace ${i.item.displayName}`}
                        onClick={() => setPicker({ open: true, replaceKey: i.key, query: i.item.displayName })}
                      >
                        <Replace />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${i.item.displayName}`}
                        onClick={() => setItems((s) => s.filter((x) => x.key !== i.key))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Field label="Notes (optional)" htmlFor="notes">
          <Textarea id="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <NutritionLabel
          heading="This meal"
          sub={`${items.length} item${items.length === 1 ? "" : "s"}`}
          values={calc.totals.values}
          partial={{
            fiber: calc.totals.missing.fiberG > 0,
            sugars: calc.totals.missing.sugarsG > 0,
            saturatedFat: calc.totals.missing.saturatedFatG > 0,
            sodium: calc.totals.missing.sodiumMg > 0,
          }}
        />
        <Button size="lg" onClick={save} disabled={saving || items.length === 0}>
          {saving ? <Loader2 className="animate-spin" /> : null} {mode === "create" ? "Save meal" : "Save changes"}
        </Button>
      </div>
      <FoodPickerDialog
        open={picker.open}
        onOpenChange={(o) => setPicker((s) => ({ ...s, open: o }))}
        onPick={onPick}
        initialQuery={picker.query}
        title={picker.replaceKey ? "Replace food" : "Add food"}
        confirmLabel={picker.replaceKey ? "Use" : "Add"}
      />
    </div>
  );
}
