"use client";

import { uid } from "@/lib/client/uid";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Info, Loader2, Plus, Replace, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Notice, Skeleton } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import type { DetectedFoodItem, NutritionCandidate } from "@/lib/ai/schemas";
import type { MealItemInput } from "@/lib/domain/schemas";
import { parseRef } from "@/lib/food-data/types";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import { emptyNutrients, type NutrientValues } from "@/lib/nutrition/nutrients";
import type { AnalysisView } from "@/lib/services/analysis";
import { fmtNum, guessMealType, MEAL_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FoodPickerDialog, type PickedFood } from "./food-picker";
import { GramStepper } from "./meal-composer";
import { NutritionLabel } from "./nutrition-label";

const STAGES: Array<{ id: string; label: string }> = [
  { id: "identifying", label: "Identifying foods" },
  { id: "estimating_portions", label: "Estimating portions" },
  { id: "matching_nutrition", label: "Matching nutrition data" },
  { id: "done", label: "Calculating" },
];

const BASIS_LABEL: Record<string, string> = {
  user_provided: "your weight",
  package_or_serving: "package / serving",
  reference_object: "reference object",
  container_dimensions: "plate size",
  visual_estimate: "visual estimate",
  fallback_assumption: "typical serving (assumed)",
};

interface ReviewItem {
  key: string;
  ref: string | null; // analysis item ref (null when user-added)
  parentRef: string | null;
  role: DetectedFoodItem["role"] | "user_added";
  displayName: string;
  weightGrams: number;
  counted: boolean;
  candidates: NutritionCandidate[];
  selectedFoodRef: string | null;
  custom: PickedFood | null;
  source: DetectedFoodItem | null;
  edited: boolean;
}

function fromDetected(d: DetectedFoodItem): ReviewItem {
  return {
    key: d.ref,
    ref: d.ref,
    parentRef: d.parentRef,
    role: d.role,
    displayName: d.displayName,
    weightGrams: d.weightGrams,
    counted: d.countsTowardTotal,
    candidates: d.candidates,
    selectedFoodRef: d.selectedFoodRef,
    custom: null,
    source: d,
    edited: false,
  };
}

function per100(i: ReviewItem): NutrientValues | null {
  if (i.custom) return i.custom.per100g;
  return i.candidates.find((c) => c.foodRef === i.selectedFoodRef)?.per100g ?? null;
}

function ConfidenceBadge({ level, label }: { level: "high" | "medium" | "low"; label: string }) {
  return (
    <Badge tone={level === "high" ? "good" : level === "medium" ? "neutral" : "warn"} title={`${label}: ${level}`}>
      {label} {level}
    </Badge>
  );
}

export function AnalysisReview({ analysisId, timeZone }: { analysisId: string; timeZone: string }) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [title, setTitle] = useState("");
  const [picker, setPicker] = useState<{ open: boolean; replaceKey?: string; query?: string }>({ open: false });
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [idemKey] = useState(newIdempotencyKey);
  const initialized = useRef(false);

  // Poll until the background analysis completes or fails.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { analysis: a } = await api<{ analysis: AnalysisView }>(`/api/analyses/${analysisId}`);
        if (stop) return;
        setAnalysis(a);
        if (a.status === "queued" || a.status === "processing") timer = setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setError(errorMessage(e));
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [analysisId]);

  useEffect(() => {
    if (initialized.current || !analysis?.result) return;
    initialized.current = true;
    // Initialise editable state once; later polls never overwrite user edits.
    setItems(analysis.result.items.map(fromDetected));
    setTitle(analysis.result.mealTitle);
  }, [analysis]);

  const calc = useMemo(
    () =>
      computeMeal(
        items
          .filter((i) => per100(i))
          .map((i) => ({
            key: i.key,
            weightGrams: i.weightGrams || 0,
            per100g: per100(i)!,
            countsTowardTotal: i.counted,
            weightRangeGrams: i.source && !i.edited ? ([i.source.portion.lowGrams, i.source.portion.highGrams] as [number, number]) : null,
          })),
      ),
    [items],
  );
  const nutrientsFor = (key: string) => calc.items.find((x) => x.key === key)?.nutrients ?? emptyNutrients();

  const update = (key: string, patch: Partial<ReviewItem>) =>
    setItems((s) => s.map((i) => (i.key === key ? { ...i, ...patch, edited: true } : i)));

  function setStrategy(parentRef: string, wholeDish: boolean) {
    setItems((s) =>
      s.map((i) =>
        i.ref === parentRef
          ? { ...i, counted: wholeDish, edited: true }
          : i.parentRef === parentRef && i.role === "component"
            ? { ...i, counted: !wholeDish, edited: true }
            : i,
      ),
    );
  }

  function onPick(p: PickedFood) {
    if (picker.replaceKey) {
      setItems((s) =>
        s.map((i) => {
          if (i.key !== picker.replaceKey) return i;
          if (p.record) {
            const ref = `${p.record.ref.source}:${p.record.ref.id}`;
            const cand: NutritionCandidate = {
              foodRef: ref,
              name: p.record.name,
              description: p.record.description ?? null,
              provider: p.record.provenance.provider,
              dataType: p.record.dataType,
              state: p.record.state,
              kind: p.record.kind,
              score: 1,
              stateAgreement: "unknown",
              per100g: p.record.per100g,
              portions: p.record.portions,
              license: p.record.provenance.license,
              url: p.record.provenance.url,
            };
            return {
              ...i,
              candidates: [cand, ...i.candidates.filter((c) => c.foodRef !== ref)],
              selectedFoodRef: ref,
              custom: null,
              counted: i.role === "component" ? i.counted : true,
              edited: true,
            };
          }
          return { ...i, custom: p, selectedFoodRef: null, displayName: p.item.displayName, edited: true, counted: true };
        }),
      );
    } else {
      setItems((s) => [
        ...s,
        {
          key: uid(),
          ref: null,
          parentRef: null,
          role: "user_added",
          displayName: p.item.displayName,
          weightGrams: p.item.weightGrams,
          counted: true,
          candidates: [],
          selectedFoodRef: null,
          custom: p,
          source: null,
          edited: true,
        },
      ]);
    }
  }

  function answer(qId: string, optionIndex: number) {
    const q = analysis?.result?.questions.find((x) => x.id === qId);
    if (!q) return;
    const opt = q.options[optionIndex];
    setAnswered((s) => ({ ...s, [qId]: opt.label }));
    if (opt.action.type === "add_item") {
      const item = fromDetected(opt.action.item);
      setItems((s) => (s.some((i) => i.key === item.key) ? s : [...s, { ...item, counted: true }]));
    }
  }

  async function save() {
    const counted = items.filter((i) => i.counted && (i.custom || i.selectedFoodRef));
    if (!counted.length) return toast.error("Nothing to save — match at least one food.");
    const unmatched = items.filter((i) => i.counted && !i.custom && !i.selectedFoodRef);
    if (unmatched.length) return toast.error(`Match or remove: ${unmatched.map((u) => u.displayName).join(", ")}`);
    setSaving(true);
    const payload: MealItemInput[] = counted.map((i) => {
      if (i.custom) return { ...i.custom.item, displayName: i.displayName, weightGrams: i.weightGrams, analysisItemRef: i.ref };
      const ref = parseRef(i.selectedFoodRef!)!;
      return {
        displayName: i.displayName,
        canonicalName: i.source?.canonicalName ?? i.displayName,
        weightGrams: i.weightGrams,
        preparationMethod: i.source?.preparationMethod ?? null,
        food: { ref },
        analysisItemRef: i.ref,
        confidence: i.source?.portion.confidence ?? null,
        matchMethod: i.edited ? "user_selected" : (i.source?.matchMethod ?? null),
      };
    });
    try {
      await api("/api/meals", {
        body: {
          mealType,
          title: title.trim() || "Meal",
          sourceType: "photo",
          analysisId,
          items: payload,
          idempotencyKey: idemKey,
          localDate: new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()),
        },
      });
      toast.success("Meal saved to your diary");
      router.push(`/home`);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  }

  async function retry() {
    try {
      await api(`/api/analyses/${analysisId}/retry`, { body: {} });
      location.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (error)
    return (
      <Notice tone="danger" title="Couldn't load this analysis">
        {error}
      </Notice>
    );
  if (!analysis) return <Skeleton className="h-96" />;

  if (analysis.mealId) {
    return (
      <Notice
        tone="good"
        title="Already saved"
        action={
          <Link className={buttonVariants({ size: "sm" })} href={`/meals/${analysis.mealId}`}>
            Open meal
          </Link>
        }
      >
        This analysis is already in your diary.
      </Notice>
    );
  }

  if (analysis.status === "queued" || analysis.status === "processing") {
    const idx = Math.max(
      0,
      STAGES.findIndex((s) => s.id === analysis.stage),
    );
    return (
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        {analysis.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed private URL
          <img src={analysis.imageUrl} alt="Your meal" className="aspect-square w-full rounded-[20px] object-cover" />
        ) : (
          <Skeleton className="aspect-square" />
        )}
        <div className="flex flex-col justify-center gap-4" role="status" aria-live="polite">
          <p className="label-num text-3xl">Reading your plate…</p>
          <ol className="flex flex-col gap-3">
            {STAGES.map((s, i) => (
              <li key={s.id} className={cn("flex items-center gap-3 text-[15px]", i <= idx ? "text-ink" : "text-ink-faint")}>
                {i < idx ? (
                  <Check className="size-4 text-primary" />
                ) : i === idx ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <span className="size-4 rounded-full border border-rule" />
                )}
                {s.label}
              </li>
            ))}
          </ol>
          <p className="text-sm text-ink-soft">
            This usually takes 10–40 seconds. You can leave this page — the result will be in your diary flow when you come back.
          </p>
        </div>
      </div>
    );
  }

  if (analysis.status === "failed" || !analysis.result) {
    return (
      <Notice
        tone="danger"
        title="The analysis didn't complete"
        action={
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={retry}>
              <RotateCcw /> Retry
            </Button>
            <Link href="/diary/new" className={buttonVariants({ size: "sm" })}>
              Log manually
            </Link>
          </div>
        }
      >
        {analysis.error?.message ?? "Unknown error."}
      </Notice>
    );
  }

  const r = analysis.result;
  const parents = items.filter((i) => !i.parentRef || !items.some((p) => p.ref === i.parentRef));
  const childrenOf = (ref: string | null) => items.filter((i) => ref && i.parentRef === ref);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-4">
        {r.isMock ? (
          <Notice tone="warn" title="Development mock — not a real analysis">
            The photo was not examined. These items are a fixed example used to test the app. Configure an AI provider for real results.
          </Notice>
        ) : null}
        {r.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        {r.items.length === 0 ? (
          <Notice
            tone="info"
            title="No food found"
            action={
              <Link href="/scan" className={buttonVariants({ size: "sm" })}>
                Try another photo
              </Link>
            }
          >
            {r.imageAssessment.notes || "We couldn't find food in this photo."}
          </Notice>
        ) : null}

        <div className="flex gap-4">
          {analysis.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed private URL
            <img src={analysis.imageUrl} alt="Your meal" className="size-24 shrink-0 rounded-xl object-cover sm:size-32" />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Field label="Title" htmlFor="meal-title">
              <Input id="meal-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Meal" htmlFor="meal-type">
              <Select id="meal-type" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k === "snack" ? "Snack" : v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {r.questions.length ? (
          <section aria-label="Quick questions" className="flex flex-col gap-2">
            {r.questions.map((q) => (
              <div key={q.id} className="rounded-xl border border-primary/25 bg-tint px-4 py-3">
                <p className="text-sm font-medium">{q.question}</p>
                <p className="text-xs text-ink-soft">Could change the total by about {q.impactKcal} kcal.</p>
                {answered[q.id] ? (
                  <p className="mt-2 flex items-center gap-1 text-sm text-primary">
                    <Check className="size-4" /> {answered[q.id]}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.options.map((o, i) => (
                      <Button key={o.label} size="sm" variant={i === 0 ? "primary" : "outline"} onClick={() => answer(q.id, i)}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        ) : null}

        <section aria-label="Detected foods" className="flex flex-col gap-3">
          {parents.map((p) => {
            const kids = childrenOf(p.ref).filter((k) => k.role === "component");
            const hidden = childrenOf(p.ref).filter((k) => k.role === "hidden_ingredient");
            return (
              <div key={p.key} className="rounded-[var(--radius)] border border-rule bg-surface">
                <ItemRow
                  item={p}
                  nutrients={nutrientsFor(p.key)}
                  share={calc.items.find((x) => x.key === p.key)?.calorieShare ?? null}
                  onChange={(patch) => update(p.key, patch)}
                  onReplace={() => setPicker({ open: true, replaceKey: p.key, query: p.source?.canonicalName ?? p.displayName })}
                  onRemove={() => setItems((s) => s.filter((i) => i.key !== p.key && i.parentRef !== p.ref))}
                />
                {kids.length ? (
                  <div className="border-t border-rule px-4 py-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-ink-soft">Components</p>
                      <div role="radiogroup" aria-label="How to count this dish" className="flex gap-1 text-xs">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={p.counted}
                          className={cn("rounded-full px-2 py-1", p.counted ? "bg-primary text-primary-ink" : "bg-surface-2")}
                          onClick={() => setStrategy(p.ref!, true)}
                          disabled={!p.selectedFoodRef && !p.custom}
                        >
                          Count whole dish
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={!p.counted}
                          className={cn("rounded-full px-2 py-1", !p.counted ? "bg-primary text-primary-ink" : "bg-surface-2")}
                          onClick={() => setStrategy(p.ref!, false)}
                        >
                          Count components
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col divide-y divide-rule rounded-xl border border-rule">
                      {kids.map((k) => (
                        <ItemRow
                          key={k.key}
                          compact
                          item={k}
                          nutrients={nutrientsFor(k.key)}
                          share={calc.items.find((x) => x.key === k.key)?.calorieShare ?? null}
                          onChange={(patch) => update(k.key, patch)}
                          onReplace={() => setPicker({ open: true, replaceKey: k.key, query: k.displayName })}
                          onRemove={() => setItems((s) => s.filter((i) => i.key !== k.key))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {hidden.map((h) => (
                  <div key={h.key} className="border-t border-rule">
                    <ItemRow
                      compact
                      item={h}
                      nutrients={nutrientsFor(h.key)}
                      share={calc.items.find((x) => x.key === h.key)?.calorieShare ?? null}
                      onChange={(patch) => update(h.key, patch)}
                      onReplace={() => setPicker({ open: true, replaceKey: h.key, query: h.displayName })}
                      onRemove={() => setItems((s) => s.filter((i) => i.key !== h.key))}
                    />
                  </div>
                ))}
              </div>
            );
          })}
          <Button variant="outline" onClick={() => setPicker({ open: true })}>
            <Plus /> Add a missing food
          </Button>
        </section>

        <details className="rounded-xl border border-rule bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">About this estimate</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              Overall confidence: <strong className="text-ink">{r.uncertainty.overall}</strong>.
            </li>
            {r.uncertainty.drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
            <li>{r.uncertainty.rangeNote}</li>
            <li>{r.segmentation.note}</li>
            <li>
              Identification and portions by {r.isMock ? "a development mock" : r.model}; nutrition values from the databases listed on each
              item, calculated by Mogsthetics.
            </li>
          </ul>
        </details>
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <NutritionLabel
          heading="Estimate"
          sub={`${items.filter((i) => i.counted).length} counted`}
          values={calc.totals.values}
          caloriesRange={calc.caloriesRange}
          partial={{
            fiber: calc.totals.missing.fiberG > 0,
            sugars: calc.totals.missing.sugarsG > 0,
            saturatedFat: calc.totals.missing.saturatedFatG > 0,
            sodium: calc.totals.missing.sodiumMg > 0,
          }}
          footnote="AI-identified foods, estimated portions and database nutrition values. Check items marked “review”."
        />
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />} Save to diary
        </Button>
        <Button variant="ghost" onClick={() => setDiscardOpen(true)}>
          Discard
        </Button>
      </div>

      <FoodPickerDialog
        open={picker.open}
        onOpenChange={(o) => setPicker((s) => ({ ...s, open: o }))}
        onPick={(p) => onPick(p)}
        initialQuery={picker.query}
        title={picker.replaceKey ? "Choose a different match" : "Add a missing food"}
        confirmLabel={picker.replaceKey ? "Use" : "Add"}
      />
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent
          title="Discard this analysis?"
          description="Nothing will be added to your diary. The photo is deleted automatically within a day."
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => router.push("/home")}>
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemRow({
  item,
  nutrients,
  share,
  onChange,
  onReplace,
  onRemove,
  compact = false,
}: {
  item: ReviewItem;
  nutrients: NutrientValues;
  share: number | null;
  onChange: (patch: Partial<ReviewItem>) => void;
  onReplace: () => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const s = item.source;
  const matched = !!(item.custom || item.selectedFoodRef);
  const selected = item.candidates.find((c) => c.foodRef === item.selectedFoodRef);
  const review = s?.needsReview && !item.edited;
  return (
    <div className={cn("px-4 py-3", !item.counted && "opacity-60")} data-testid="analysis-item">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Food name"
              className="h-8 w-auto min-w-0 flex-1 border-transparent bg-transparent px-0 font-medium focus-visible:border-rule focus-visible:px-2"
              value={item.displayName}
              maxLength={200}
              onChange={(e) => onChange({ displayName: e.target.value })}
            />
            {item.role === "hidden_ingredient" ? <Badge tone="accent">added</Badge> : null}
            {review ? (
              <Badge tone="warn">
                <AlertTriangle className="size-3" /> review
              </Badge>
            ) : null}
            {!item.counted ? <Badge tone="outline">not counted</Badge> : null}
          </div>
          <p className="text-xs text-ink-faint">
            {matched ? (
              <>
                {fmtNum(nutrients.caloriesKcal)} kcal{share !== null && item.counted ? ` · ${Math.round(share * 100)}% of meal` : ""} · P{" "}
                {fmtNum(nutrients.proteinG, 1)} · C {fmtNum(nutrients.carbohydratesG, 1)} · F {fmtNum(nutrients.totalFatG, 1)}
              </>
            ) : (
              <span className="text-warn">No nutrition match yet</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <GramStepper label={item.displayName} value={item.weightGrams} onChange={(g) => onChange({ weightGrams: g })} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Details for ${item.displayName}`}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${item.displayName}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {s && !compact ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ConfidenceBadge level={s.identificationConfidence} label="ID" />
          <ConfidenceBadge level={s.portion.confidence} label="portion" />
          {matched ? <ConfidenceBadge level={item.edited ? "high" : s.matchConfidence} label="match" /> : null}
          <Badge tone="outline">
            {BASIS_LABEL[s.portion.basis]} · {s.portion.lowGrams}–{s.portion.highGrams} g
          </Badge>
        </div>
      ) : null}
      {!matched ? (
        <Button size="sm" className="mt-2" onClick={onReplace}>
          <Search /> Find a match
        </Button>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          {item.candidates.length > 1 && !item.custom ? (
            <Field label="Nutrition match" htmlFor={`cand-${item.key}`}>
              <Select
                id={`cand-${item.key}`}
                value={item.selectedFoodRef ?? ""}
                onChange={(e) => onChange({ selectedFoodRef: e.target.value })}
              >
                {item.candidates.map((c) => (
                  <option key={c.foodRef} value={c.foodRef}>
                    {c.name} — {fmtNum(c.per100g.caloriesKcal)} kcal/100 g{c.stateAgreement === "mismatch" ? " (state differs)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Button size="sm" variant="outline" onClick={onReplace} className="self-start">
            <Replace /> Search for another food
          </Button>
          {selected ? (
            <p className="text-xs text-ink-soft">
              <Info className="mr-1 inline size-3.5" />
              {selected.provider}
              {selected.description && selected.description !== selected.name ? ` — “${selected.description}”` : ""} ·{" "}
              {selected.dataType === "label" ? "label values" : "measured/calculated values"}
              {selected.url ? (
                <>
                  {" · "}
                  <a href={selected.url} target="_blank" rel="noreferrer" className="underline">
                    source
                  </a>
                </>
              ) : null}
            </p>
          ) : item.custom ? (
            <p className="text-xs text-ink-soft">Values you entered from a label.</p>
          ) : null}
          {selected?.portions.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.portions.map((p) => (
                <Button key={p.label} size="sm" variant="outline" onClick={() => onChange({ weightGrams: p.grams })}>
                  {p.label} · {fmtNum(p.grams)} g
                </Button>
              ))}
            </div>
          ) : null}
          {s ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-soft">
              {s.portion.reasoning ? <li>Portion: {s.portion.reasoning}</li> : null}
              {s.portion.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
              {s.ingredients.length ? <li>Seen: {s.ingredients.join(", ")}</li> : null}
              {s.alternatives.length ? <li>Could also be: {s.alternatives.join(", ")}</li> : null}
              {s.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
