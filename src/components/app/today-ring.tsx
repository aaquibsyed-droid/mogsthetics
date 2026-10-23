import type { NutrientValues } from "@/lib/nutrition/nutrients";
import { fmtNum } from "@/lib/format";
import type { LabelTargets } from "./nutrition-label";

/** Hero summary for today: a calorie ring plus macro bars, sized for one glance on a phone. */
export function TodayRing({
  values,
  targets,
  mealCount,
  bonus,
}: {
  values: NutrientValues;
  targets: LabelTargets;
  mealCount: number;
  /** Extra food earned by today's activity (adaptive target). */
  bonus?: { kcal: number; proteinG: number; reason: string | null };
}) {
  const eaten = values.caloriesKcal ?? 0;
  const extra = targets.caloriesKcal ? (bonus?.kcal ?? 0) : 0;
  const goal = (targets.caloriesKcal ?? 0) + extra;
  const left = goal - eaten;
  const pct = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const r = 70;
  const c = 2 * Math.PI * r;
  const macros = [
    { label: "Protein", value: values.proteinG ?? 0, target: targets.proteinG != null ? targets.proteinG + (bonus?.proteinG ?? 0) : null, color: "#9fb4ff" },
    { label: "Carbs", value: values.carbohydratesG ?? 0, target: targets.carbohydratesG, color: "#ffd36e" },
    { label: "Fat", value: values.totalFatG ?? 0, target: targets.fatG, color: "#ff8fb4" },
  ];
  return (
    <section aria-label="Today's calories" className="hero-card relative overflow-hidden rounded-[28px] p-5 text-white sm:p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow !text-white/75">Today</p>
        <p className="text-xs font-medium text-white/75">
          {mealCount} meal{mealCount === 1 ? "" : "s"} logged
        </p>
      </div>
      <div className="mt-2 flex items-center gap-5">
        <div className="relative size-[168px] shrink-0">
          <svg viewBox="0 0 168 168" className="size-full -rotate-90" aria-hidden>
            <circle cx="84" cy="84" r={r} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="14" />
            <circle
              cx="84"
              cy="84"
              r={r}
              fill="none"
              stroke="url(#ring)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - pct)}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
            <defs>
              <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#c8ff3d" />
                <stop offset="100%" stopColor="#6dffc8" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-content-center text-center">
            <span className="label-num text-[32px] !text-white" data-testid="kcal-left">
              {fmtNum(Math.abs(left))}
            </span>
            <span className="mt-1 text-xs font-medium text-white/80">{left >= 0 ? "kcal left" : "kcal over"}</span>
          </div>
        </div>
        <dl className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <dt className="text-xs text-white/70">Eaten</dt>
            <dd className="label-num text-2xl !text-white">{fmtNum(eaten)}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/70">Goal</dt>
            <dd className="label-num text-2xl !text-white">{fmtNum(goal)}</dd>
            {extra ? (
              <dd className="mt-0.5 text-[11px] font-medium text-white/80" title={bonus?.reason ?? undefined}>
                incl. +{fmtNum(extra)} {bonus?.reason ?? "activity"}
              </dd>
            ) : null}
          </div>
        </dl>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {macros.map((m) => {
          const p = m.target ? Math.min(m.value / m.target, 1) : 0;
          return (
            <div key={m.label} className="rounded-2xl bg-white/12 p-3 backdrop-blur-sm">
              <p className="text-[11px] font-medium text-white/75">{m.label}</p>
              <p className="mt-0.5 text-sm font-semibold">
                {fmtNum(m.value)}
                <span className="font-normal text-white/70">/{m.target ? fmtNum(m.target) : "–"}g</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${p * 100}%`, background: m.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
