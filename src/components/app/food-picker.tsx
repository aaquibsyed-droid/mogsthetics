"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Loader2, PencilLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice } from "@/components/ui/misc";
import { api, errorMessage, useApi } from "@/lib/client/api";
import type { FrequentFood } from "@/lib/repos/meals";
import type { MealItemInput } from "@/lib/domain/schemas";
import type { FoodRecord } from "@/lib/food-data/types";
import { emptyNutrients, scaleNutrients, validatePer100g, type NutrientValues } from "@/lib/nutrition/nutrients";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BarcodeScanner } from "./barcode-scanner";

export interface PickedFood {
  item: MealItemInput;
  /** Per-100 g values for instant client-side recalculation (server recomputes on save). */
  per100g: NutrientValues;
  record: FoodRecord | null;
}

type Scored = FoodRecord & { score: number };

function sourceLabel(f: FoodRecord): string {
  switch (f.ref.source) {
    case "usda_sr":
    case "usda_fdc":
      return "USDA";
    case "off":
      return "Label · OFF";
    case "user_food":
      return "Your food";
    default:
      return "Custom";
  }
}

export function FoodResultRow({ food, onSelect, selected }: { food: FoodRecord; onSelect: () => void; selected?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-tint" : "border-transparent hover:bg-surface-2",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{food.name}</span>
        <span className="block truncate text-xs text-ink-faint">
          {food.brand ? `${food.brand} · ` : ""}
          {food.state ? `${food.state} · ` : ""}
          {fmtNum(food.per100g.caloriesKcal)} kcal / 100 g
        </span>
      </span>
      <Badge tone={food.ref.source === "user_food" ? "accent" : "outline"}>{sourceLabel(food)}</Badge>
    </button>
  );
}

/** Amount selector: grams or a listed serving size × count. */
export function AmountPicker({ food, grams, onGrams }: { food: FoodRecord; grams: number; onGrams: (g: number) => void }) {
  const [mode, setMode] = useState<string>("g");
  const [count, setCount] = useState(1);
  const portion = food.portions.find((p) => p.label === mode);
  return (
    <div className="grid grid-cols-[1fr_1.4fr] gap-3">
      <Field label={portion ? "Servings" : "Grams"} htmlFor="amount">
        <Input
          id="amount"
          type="number"
          inputMode="decimal"
          step={portion ? "0.25" : "1"}
          min={0}
          value={portion ? count : Math.round(grams)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v < 0) return;
            if (portion) {
              setCount(v);
              onGrams(Math.round(v * portion.grams * 10) / 10);
            } else onGrams(v);
          }}
        />
      </Field>
      <Field label="Unit" htmlFor="unit">
        <Select
          id="unit"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            const p = food.portions.find((x) => x.label === e.target.value);
            if (p) {
              setCount(1);
              onGrams(p.grams);
            }
          }}
        >
          <option value="g">grams</option>
          {food.portions.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} ({fmtNum(p.grams)} g)
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function NutrientPreview({ values, className }: { values: NutrientValues; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-4 gap-2 rounded-xl bg-surface-2 px-3 py-2 text-center", className)}>
      {[
        ["kcal", values.caloriesKcal, 0],
        ["protein", values.proteinG, 1],
        ["carbs", values.carbohydratesG, 1],
        ["fat", values.totalFatG, 1],
      ].map(([l, v, d]) => (
        <div key={l as string}>
          <dd className="font-mono text-[15px] font-medium">{fmtNum(v as number | null, d as number)}</dd>
          <dt className="text-[11px] text-ink-faint">{l}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Manual nutrition-label entry (per serving or per 100 g). */
export function LabelEntry({
  initialName = "",
  onDone,
  onCancel,
}: {
  initialName?: string;
  onDone: (p: PickedFood, saveForLater: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [basis, setBasis] = useState<"serving" | "100g">("serving");
  const [serving, setServing] = useState(30);
  const [eaten, setEaten] = useState(30);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const fields: Array<[keyof NutrientValues, string, string]> = [
    ["caloriesKcal", "Calories", "kcal"],
    ["proteinG", "Protein", "g"],
    ["carbohydratesG", "Carbohydrate", "g"],
    ["totalFatG", "Fat", "g"],
    ["saturatedFatG", "Saturated fat", "g"],
    ["fiberG", "Fiber", "g"],
    ["sugarsG", "Total sugars", "g"],
    ["sodiumMg", "Sodium", "mg"],
  ];
  function submit() {
    const per = emptyNutrients();
    const factor = basis === "serving" ? 100 / serving : 1;
    for (const [k] of fields) {
      const raw = vals[k];
      per[k] = raw === undefined || raw.trim() === "" ? null : Number(raw) * factor;
    }
    const errs = [];
    if (!name.trim()) errs.push("Enter a name.");
    if (basis === "serving" && !(serving > 0)) errs.push("Serving size must be more than 0 g.");
    if (!(eaten > 0)) errs.push("Amount eaten must be more than 0 g.");
    if (fields.some(([k]) => vals[k] && !Number.isFinite(Number(vals[k])))) errs.push("Use numbers only.");
    if (per.caloriesKcal === null && per.proteinG === null) errs.push("Enter at least calories or protein.");
    errs.push(...validatePer100g(per));
    setErrors(errs);
    if (errs.length) return;
    onDone(
      {
        per100g: per,
        record: null,
        item: {
          displayName: name.trim(),
          weightGrams: eaten,
          food: { custom: { name: name.trim(), per100g: per, dataType: "label" } },
          matchMethod: "label_input",
        },
      },
      save,
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {errors.length ? <Notice tone="danger">{errors.join(" ")}</Notice> : null}
      <Field label="Food name" htmlFor="lbl-name">
        <Input id="lbl-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Values are per" htmlFor="lbl-basis">
          <Select id="lbl-basis" value={basis} onChange={(e) => setBasis(e.target.value as "serving" | "100g")}>
            <option value="serving">serving</option>
            <option value="100g">100 g</option>
          </Select>
        </Field>
        {basis === "serving" ? (
          <Field label="Serving size (g)" htmlFor="lbl-serving">
            <Input
              id="lbl-serving"
              type="number"
              inputMode="decimal"
              value={serving}
              onChange={(e) => setServing(Number(e.target.value))}
            />
          </Field>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, label, unit]) => (
          <Field key={k} label={`${label} (${unit})`} htmlFor={`lbl-${k}`}>
            <Input
              id={`lbl-${k}`}
              type="number"
              inputMode="decimal"
              placeholder="unknown"
              value={vals[k] ?? ""}
              onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        Leave a field blank if the label doesn&apos;t list it — it&apos;ll be treated as unknown, not zero.
      </p>
      <Field label="Amount you ate (g)" htmlFor="lbl-eaten">
        <Input id="lbl-eaten" type="number" inputMode="decimal" value={eaten} onChange={(e) => setEaten(Number(e.target.value))} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-4 accent-[var(--primary)]" /> Save
        to &ldquo;Your foods&rdquo; for next time
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Back
        </Button>
        <Button type="button" onClick={submit}>
          Add food
        </Button>
      </div>
    </div>
  );
}

/**
 * Dialog to find a food (bundled USDA, your foods, USDA API), scan a barcode,
 * or enter a label — then choose an amount.
 */
export function FoodPickerDialog({
  open,
  onOpenChange,
  onPick,
  title = "Add food",
  initialQuery = "",
  confirmLabel = "Add",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (p: PickedFood, opts: { saveCustom: boolean }) => void;
  title?: string;
  initialQuery?: string;
  confirmLabel?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Scored[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FoodRecord | null>(null);
  const [grams, setGrams] = useState(100);
  const [view, setView] = useState<"search" | "label" | "barcode">("search");
  const [error, setError] = useState<string | null>(null);
  const recents = useApi<{ foods: FrequentFood[] }>(open ? "/api/foods/frequent" : null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when reopened
    setQuery(initialQuery);
    setSelected(null);
    setView("search");
    setError(null);
  }, [open, initialQuery]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results for short queries
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      try {
        const r = await api<{ results: Scored[]; warnings: string[] }>(`/api/foods/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        setResults(r.results);
        setWarnings(r.warnings);
        setError(null);
      } catch (e) {
        if (!(e instanceof DOMException)) setError(errorMessage(e));
      } finally {
        if (abort.current === ctrl) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const preview = useMemo(() => (selected ? scaleNutrients(selected.per100g, grams || 0) : null), [selected, grams]);

  function choose(food: FoodRecord, grams?: number) {
    setSelected(food);
    setGrams(grams ?? food.portions[0]?.grams ?? 100);
  }

  async function chooseRecent(f: FrequentFood) {
    setLoading(true);
    try {
      const r = await api<{ food: FoodRecord }>(
        `/api/foods/detail?ref=${encodeURIComponent(`${f.nutritionSource}:${f.nutritionSourceId}`)}`,
      );
      choose(r.food, f.typicalWeightGrams);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function onBarcode(code: string) {
    setView("search");
    setLoading(true);
    try {
      const r = await api<{ food: FoodRecord | null; warnings: string[] }>(`/api/foods/barcode/${code}`);
      if (r.food) choose(r.food);
      else setError(r.warnings[0] ?? `No product found for barcode ${code}. You can enter the label instead.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} side="bottom" description="Search foods, scan a barcode, or enter a nutrition label.">
        {view === "label" ? (
          <LabelEntry
            initialName={query}
            onCancel={() => setView("search")}
            onDone={(p, save) => {
              onPick(p, { saveCustom: save });
              onOpenChange(false);
            }}
          />
        ) : view === "barcode" ? (
          <BarcodeScanner onDetected={onBarcode} onCancel={() => setView("search")} />
        ) : selected ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="label-head text-lg">{selected.name}</p>
              <p className="text-xs text-ink-faint">
                {selected.provenance.provider}
                {selected.ref.source !== "user_food" ? ` · ID ${selected.provenance.externalId}` : ""}
                {selected.dataType === "label" ? " · label values" : ""}
              </p>
            </div>
            <AmountPicker food={selected} grams={grams} onGrams={setGrams} />
            {preview ? <NutrientPreview values={preview} /> : null}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" type="button" onClick={() => setSelected(null)}>
                Back to results
              </Button>
              <Button
                type="button"
                disabled={!(grams > 0)}
                onClick={() => {
                  onPick(
                    {
                      per100g: selected.per100g,
                      record: selected,
                      item: {
                        displayName: selected.name,
                        canonicalName: selected.name,
                        weightGrams: grams,
                        food: { ref: selected.ref },
                        matchMethod: "user_selected",
                      },
                    },
                    { saveCustom: false },
                  );
                  onOpenChange(false);
                }}
              >
                {confirmLabel} {fmtNum(grams)} g
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                autoFocus
                aria-label="Search foods"
                placeholder="Search foods, e.g. “greek yogurt”"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {loading ? <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-faint" /> : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setView("barcode")}>
                <Barcode /> Scan barcode
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setView("label")}>
                <PencilLine /> Enter label
              </Button>
            </div>
            {error ? <Notice tone="warn">{error}</Notice> : null}
            {warnings.length ? <p className="text-xs text-ink-faint">{warnings[0]}</p> : null}
            {query.trim().length < 2 && recents.data?.foods.length ? (
              <div>
                <p className="eyebrow mb-1 px-1">your usual foods</p>
                <div className="flex flex-col gap-1" role="list" aria-label="Recent foods">
                  {recents.data.foods.slice(0, 8).map((f) => (
                    <div role="listitem" key={`${f.nutritionSource}:${f.nutritionSourceId}`}>
                      <button
                        type="button"
                        onClick={() => chooseRecent(f)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"
                      >
                        <span className="truncate">{f.displayName}</span>
                        <span className="shrink-0 font-mono text-xs text-ink-faint">
                          {fmtNum(f.typicalWeightGrams)} g · {f.timesLogged}×
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex max-h-[45dvh] flex-col gap-1 overflow-y-auto" role="list" aria-label="Search results">
              {results.map((r) => (
                <div role="listitem" key={`${r.ref.source}:${r.ref.id}`}>
                  <FoodResultRow food={r} onSelect={() => choose(r)} />
                </div>
              ))}
              {query.trim().length >= 2 && !loading && results.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-ink-soft">
                  No matches. Try a simpler name, or{" "}
                  <button type="button" className="font-medium text-primary underline" onClick={() => setView("label")}>
                    enter the label
                  </button>
                  .
                </p>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
