"use client";

import { uid } from "@/lib/client/uid";
import { useMemo, useState } from "react";
import { Loader2, Replace, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Badge, Notice } from "@/components/ui/misc";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client/api";
import type { FoodRecord } from "@/lib/food-data/types";
import { scaleNutrients } from "@/lib/nutrition/nutrients";
import type { QuickLogItem } from "@/lib/quicklog/resolve";
import { fmtNum, guessMealType, MEAL_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FoodPickerDialog } from "./food-picker";
import { GramStepper } from "./meal-composer";

interface Row {
  key: string;
  raw: string;
  food: FoodRecord | null;
  alternatives: FoodRecord[];
  grams: number;
  note: string;
  confidence: "high" | "medium" | "low";
}

const EXAMPLES = [
  "2 boiled eggs, 1 slice whole wheat toast with butter",
  "200g greek yogurt, blueberries, 1 tbsp honey",
  "chicken breast 150g, 1 cup rice, broccoli",
];

/** Type what you ate in plain words → matched foods with grams → one tap to log. No AI needed. */
export function QuickLog({ today, onLogged, compact = false }: { today: string; onLogged?: () => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [picker, setPicker] = useState<{ open: boolean; key?: string; query?: string }>({ open: false });

  const totals = useMemo(() => {
    const ready = (rows ?? []).filter((r) => r.food && r.grams > 0);
    return ready.reduce((s, r) => s + (scaleNutrients(r.food!.per100g, r.grams).caloriesKcal ?? 0), 0);
  }, [rows]);

  async function parse() {
    if (!text.trim()) return;
    setBusy("parse");
    try {
      const r = await api<{ items: QuickLogItem[]; warnings: string[] }>("/api/quick-log", { body: { text } });
      setRows(
        r.items.map((i) => ({
          key: uid(),
          raw: i.raw,
          food: i.food,
          alternatives: i.alternatives,
          grams: i.grams,
          note: i.note,
          confidence: i.confidence,
        })),
      );
      setWarnings(r.warnings);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const ready = (rows ?? []).filter((r) => r.food && r.grams > 0);
    if (!ready.length) return toast.error("Match at least one food first.");
    setBusy("save");
    try {
      await api("/api/meals", {
        body: {
          mealType,
          localDate: today,
          title: ready
            .map((r) => r.food!.name.split(",")[0])
            .slice(0, 3)
            .join(", ")
            .slice(0, 120),
          sourceType: "quick_add",
          idempotencyKey: newIdempotencyKey(),
          items: ready.map((r) => ({
            displayName: r.food!.name,
            weightGrams: r.grams,
            food: { ref: r.food!.ref },
            matchMethod: "quick_log",
          })),
        },
      });
      toast.success(`Logged ${ready.length} food${ready.length === 1 ? "" : "s"} · ${fmtNum(totals)} kcal`);
      setRows(null);
      setText("");
      onLogged?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const update = (key: string, patch: Partial<Row>) => setRows((s) => (s ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <section aria-label="Type what you ate" className="card-soft rounded-[var(--radius)] border border-rule/70 bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="label-head flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-ink-faint" /> type what you ate
        </h2>
        {!compact ? <span className="text-[11px] text-ink-faint">no AI needed · matched to USDA data</span> : null}
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void parse();
        }}
      >
        <label htmlFor="quick-log-text" className="sr-only">
          What did you eat?
        </label>
        <Textarea
          id="quick-log-text"
          rows={compact ? 1 : 2}
          maxLength={1000}
          placeholder={`e.g. ${EXAMPLES[0]}`}
          className="min-h-11 resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void parse();
            }
          }}
        />
        <Button type="submit" disabled={!text.trim() || busy !== null} className="sm:mb-0.5">
          {busy === "parse" ? <Loader2 className="animate-spin" /> : null} read it
        </Button>
      </form>
      {!rows && !compact ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.slice(1).map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-soft hover:bg-tint"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {rows ? (
        <div className="mt-4 flex flex-col gap-3">
          {warnings.length ? <p className="text-xs text-ink-faint">{warnings[0]}</p> : null}
          <ul className="divide-y divide-rule rounded-2xl border border-rule/70" aria-label="Matched foods">
            {rows.map((r) => {
              const kcal = r.food ? scaleNutrients(r.food.per100g, r.grams).caloriesKcal : null;
              return (
                <li
                  key={r.key}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="quick-log-row"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-ink-faint">“{r.raw}”</p>
                    {r.food ? (
                      r.alternatives.length ? (
                        <Select
                          aria-label={`Food for ${r.raw}`}
                          className="mt-0.5 h-9 border-transparent bg-transparent px-0 pr-7 font-medium"
                          value={`${r.food.ref.source}:${r.food.ref.id}`}
                          onChange={(e) => {
                            const all = [r.food!, ...r.alternatives];
                            const next = all.find((f) => `${f.ref.source}:${f.ref.id}` === e.target.value);
                            if (next)
                              update(r.key, { food: next, alternatives: all.filter((f) => f !== next), note: "", confidence: "medium" });
                          }}
                        >
                          {[r.food, ...r.alternatives].map((f) => (
                            <option key={`${f.ref.source}:${f.ref.id}`} value={`${f.ref.source}:${f.ref.id}`}>
                              {f.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <p className="mt-0.5 font-medium">{r.food.name}</p>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() => setPicker({ open: true, key: r.key, query: r.raw })}
                      >
                        choose a food
                      </Button>
                    )}
                    {r.note ? <p className={cn("text-[11px]", r.confidence === "low" ? "text-warn" : "text-ink-faint")}>{r.note}</p> : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {r.food ? (
                      <>
                        <GramStepper
                          label={r.raw}
                          value={r.grams}
                          onChange={(g) => update(r.key, { grams: g, note: "", confidence: "high" })}
                        />
                        <span className="w-16 text-right font-mono text-sm">{fmtNum(kcal)}</span>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Search a different food for ${r.raw}`}
                      onClick={() => setPicker({ open: true, key: r.key, query: r.food?.name ?? r.raw })}
                    >
                      <Replace />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${r.raw}`}
                      onClick={() => setRows((s) => (s ?? []).filter((x) => x.key !== r.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.some((r) => r.confidence === "low" && r.food) ? (
            <Notice tone="warn">Amounts marked in amber are assumptions — adjust the grams if you know them.</Notice>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="quick-log-meal" className="text-sm text-ink-soft">
                add to
              </label>
              <Select id="quick-log-meal" className="h-9 w-auto" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {(k === "snack" ? "snack" : v).toLowerCase()}
                  </option>
                ))}
              </Select>
              <Badge tone="outline">{fmtNum(totals)} kcal</Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRows(null)}>
                clear
              </Button>
              <Button onClick={save} disabled={busy !== null || !rows.some((r) => r.food && r.grams > 0)}>
                {busy === "save" ? <Loader2 className="animate-spin" /> : null} log {rows.filter((r) => r.food).length} food
                {rows.filter((r) => r.food).length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <FoodPickerDialog
        open={picker.open}
        onOpenChange={(o) => setPicker((s) => ({ ...s, open: o }))}
        initialQuery={picker.query}
        title="Choose a food"
        confirmLabel="Use"
        onPick={(p) => {
          if (!picker.key) return;
          if (!p.record) {
            toast.message("Label entries can be logged from “Log manually”.");
            return;
          }
          update(picker.key, { food: p.record, grams: p.item.weightGrams, note: "", confidence: "high" });
        }}
      />
    </section>
  );
}
