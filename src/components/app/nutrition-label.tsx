import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";

/**
 * The Ascend signature: a Nutrition-Facts-style panel. Heavy rules, expanded
 * black numerals, hairline rows. Values are always labelled as estimates.
 */
export interface LabelValues {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  totalFatG: number | null;
  saturatedFatG?: number | null;
  fiberG?: number | null;
  sugarsG?: number | null;
  sodiumMg?: number | null;
}

export interface LabelTargets {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  fatG: number | null;
  fiberG?: number | null;
  saturatedFatMaxG?: number | null;
  sodiumMaxMg?: number | null;
}

function Bar({ value, target, color, minimum }: { value: number; target: number | null; color: string; minimum?: boolean }) {
  if (!target) return null;
  const pct = Math.min(100, (value / target) * 100);
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: !minimum && value > target * 1.05 ? "var(--warn)" : color }}
      />
    </div>
  );
}

function MacroRow({
  name,
  value,
  unit,
  target,
  color,
  partial,
  limit,
  minimum,
}: {
  name: string;
  value: number | null | undefined;
  unit: string;
  target?: number | null;
  color?: string;
  partial?: boolean;
  limit?: boolean;
  /** Targets that are minimums (protein, fiber): going over is not flagged. */
  minimum?: boolean;
}) {
  const v = value ?? null;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-[15px] text-ink">
          {color ? <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} /> : null}
          {name}
        </span>
        <span className="flex items-baseline gap-1.5 font-mono text-[13px]">
          <span className="text-[15px] text-ink">
            {partial && v !== null ? "≥ " : ""}
            {v === null ? "—" : fmtNum(v, unit === "mg" ? 0 : v < 10 ? 1 : 0)}
            {unit}
          </span>
          {target ? (
            <span className="text-ink-faint">
              {limit ? "limit" : "of"} {fmtNum(target)}
              {unit}
            </span>
          ) : null}
        </span>
      </div>
      {color && v !== null ? <Bar value={v} target={target ?? null} color={color} minimum={minimum} /> : null}
    </div>
  );
}

export function NutritionLabel({
  heading,
  sub,
  values,
  targets,
  partial,
  caloriesRange,
  footnote,
  compact = false,
  className,
}: {
  heading: string;
  sub?: React.ReactNode;
  values: LabelValues;
  targets?: LabelTargets | null;
  partial?: { calories?: boolean; fiber?: boolean; sugars?: boolean; saturatedFat?: boolean; sodium?: boolean };
  caloriesRange?: [number, number] | null;
  footnote?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const kcal = values.caloriesKcal;
  const target = targets?.caloriesKcal ?? null;
  const remaining = target !== null && kcal !== null ? target - kcal : null;
  return (
    <section
      aria-label={`${heading} nutrition`}
      className={cn("card-soft rounded-[24px] border border-rule/70 bg-surface px-5 pb-4 pt-5 text-ink sm:px-6", className)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label-head text-[20px] leading-none sm:text-[22px]">{heading}</h2>
        {sub ? <span className="eyebrow">{sub}</span> : null}
      </div>
      <div className="rule-heavy mt-3" />
      <div className="flex items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-[13px] text-ink-soft">calories</p>
          <p className="label-num mt-1 text-[56px] sm:text-[72px]" data-testid="label-calories">
            {partial?.calories && kcal !== null ? <span className="text-[0.5em] align-top">≥</span> : null}
            {kcal === null ? "—" : fmtNum(Math.round(kcal))}
          </p>
          {caloriesRange ? (
            <p className="mt-1 font-mono text-[11px] text-ink-faint">
              likely {fmtNum(caloriesRange[0])}–{fmtNum(caloriesRange[1])} kcal
            </p>
          ) : null}
        </div>
        {target !== null ? (
          <div className="pb-1 text-right">
            <p className="label-num text-[30px] sm:text-[36px]" data-testid="label-remaining">
              {remaining === null ? "—" : fmtNum(Math.abs(Math.round(remaining)))}
            </p>
            <p className="text-[12px] text-ink-soft">{remaining !== null && remaining < 0 ? "over estimate" : "remaining"}</p>
            <p className="font-mono text-[11px] text-ink-faint">target {fmtNum(target)}</p>
          </div>
        ) : null}
      </div>
      {target !== null && kcal !== null ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="meter"
          aria-label="Calories eaten vs target"
          aria-valuenow={Math.round(kcal)}
          aria-valuemin={0}
          aria-valuemax={target}
        >
          <div
            className="glaze h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, (kcal / target) * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="rule-hair mt-4" />
      <div className="divide-y divide-rule">
        <MacroRow name="Protein" value={values.proteinG} unit="g" target={targets?.proteinG} color="var(--protein)" minimum />
        <MacroRow name="Carbohydrates" value={values.carbohydratesG} unit="g" target={targets?.carbohydratesG} color="var(--carbs)" />
        <MacroRow name="Fat" value={values.totalFatG} unit="g" target={targets?.fatG} color="var(--fat)" />
        {!compact ? (
          <>
            <MacroRow
              name="Fiber"
              value={values.fiberG}
              unit="g"
              target={targets?.fiberG}
              color="var(--fiber)"
              partial={partial?.fiber}
              minimum
            />
            <div className="grid grid-cols-3 gap-3 py-2 text-[12px]">
              <SmallStat
                label="Sat. fat"
                value={values.saturatedFatG}
                unit="g"
                partial={partial?.saturatedFat}
                limit={targets?.saturatedFatMaxG}
              />
              <SmallStat label="Sugars" value={values.sugarsG} unit="g" partial={partial?.sugars} />
              <SmallStat label="Sodium" value={values.sodiumMg} unit="mg" partial={partial?.sodium} limit={targets?.sodiumMaxMg} />
            </div>
          </>
        ) : null}
      </div>
      <div className="rule-hair" />
      <p className="pt-2 text-[11px] leading-snug text-ink-faint">
        {footnote ?? "Estimates from food database values and logged portions. “≥” means some items have no value for that nutrient."}
      </p>
    </section>
  );
}

function SmallStat({
  label,
  value,
  unit,
  partial,
  limit,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  partial?: boolean;
  limit?: number | null;
}) {
  return (
    <div>
      <p className="text-ink-faint">{label}</p>
      <p className="font-mono text-[13px]">
        {partial && value != null ? "≥ " : ""}
        {value == null ? "—" : fmtNum(value, unit === "mg" ? 0 : 1)}
        {unit}
        {limit ? <span className="text-ink-faint"> / {fmtNum(limit)}</span> : null}
      </p>
    </div>
  );
}
