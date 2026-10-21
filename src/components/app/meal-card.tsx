import Link from "next/link";
import { Camera, PencilLine, ScanBarcode } from "lucide-react";
import type { MealView } from "@/lib/repos/meals";
import { fmtNum, MEAL_TYPE_LABEL } from "@/lib/format";

export type MealWithImage = MealView & { imageUrl: string | null };

export function mealTotals(m: MealView) {
  const sum = (k: "caloriesKcal" | "proteinG" | "carbohydratesG" | "totalFatG") => m.items.reduce((s, i) => s + (i.snapshot?.[k] ?? 0), 0);
  return { kcal: sum("caloriesKcal"), p: sum("proteinG"), c: sum("carbohydratesG"), f: sum("totalFatG") };
}

export function MealCard({ meal, showType = true }: { meal: MealWithImage; showType?: boolean }) {
  const t = mealTotals(meal);
  const Icon = meal.sourceType === "photo" ? Camera : meal.sourceType === "barcode" ? ScanBarcode : PencilLine;
  return (
    <Link
      href={`/meals/${meal.id}`}
      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
      data-testid="meal-card"
    >
      {meal.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL
        <img src={meal.imageUrl} alt="" className="size-14 shrink-0 rounded-lg object-cover" loading="lazy" />
      ) : (
        <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-tint text-primary">
          <Icon className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        {showType ? (
          <span className="eyebrow">{meal.mealType === "custom" ? meal.customLabel : MEAL_TYPE_LABEL[meal.mealType]}</span>
        ) : null}
        <span className="block truncate font-medium">{meal.title}</span>
        <span className="block truncate text-xs text-ink-faint">
          P {fmtNum(t.p)} · C {fmtNum(t.c)} · F {fmtNum(t.f)} · {meal.items.length} item{meal.items.length === 1 ? "" : "s"}
        </span>
      </span>
      <span className="text-right">
        <span className="label-num block text-xl">{fmtNum(t.kcal)}</span>
        <span className="text-[10px] text-ink-faint">kcal</span>
      </span>
    </Link>
  );
}
