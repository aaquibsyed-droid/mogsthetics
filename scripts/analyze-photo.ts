/**
 * Runs one or more photos of a single meal through the full analysis pipeline
 * from the terminal (real Claude when ANTHROPIC_API_KEY is set, otherwise the
 * labelled mock). Nothing is saved.
 *
 *   npm run analyze -- path/to/meal.jpg [another-angle.jpg] [--note "cooked in butter"]
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import { processMealImage } from "@/lib/analysis/image";
import { runAnalysisPipeline } from "@/lib/analysis/pipeline";
import { createMockProviders } from "@/lib/ai/mock";
import type { VisionProvider } from "@/lib/ai/provider";
import { getReferenceFood, searchReferenceFoods } from "@/lib/food-data/reference";
import type { FoodService } from "@/lib/food-data/service";
import { createUsdaClient } from "@/lib/food-data/usda";

async function main() {
  const args = process.argv.slice(2);
  const noteIdx = args.indexOf("--note");
  const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined;
  const files = args.filter((a, i) => !a.startsWith("--") && !(noteIdx >= 0 && i === noteIdx + 1));
  if (!files.length) throw new Error('Usage: npm run analyze -- path/to/meal.jpg [--note "..."]');

  const { getAiProviders } = await import("@/lib/ai");
  const ai = await getAiProviders();
  const vision: VisionProvider = ai.vision ?? createMockProviders().vision;
  if (vision.isMock) console.warn("⚠  No AI provider configured — using the development MOCK (the photo is not examined).\n");
  const usda = process.env.USDA_FDC_API_KEY ? createUsdaClient(process.env.USDA_FDC_API_KEY) : null;
  const foods: FoodService = {
    async search(_u, q) {
      const ref = searchReferenceFoods(q, 12).map(({ food, score }) => ({ ...food, score }));
      if (!usda) return { results: ref, warnings: [] };
      const ext = await usda.search(q, 8).catch(() => []);
      return { results: [...ref, ...ext.map((r) => ({ ...r, score: 0.5 }))], warnings: [] };
    },
    async get(_u, ref) {
      return ref.source === "usda_sr" ? getReferenceFood(ref.id) : null;
    },
    async lookupBarcode() {
      return { food: null, warnings: [] };
    },
  };

  const images = [];
  for (const f of files) {
    const p = await processMealImage(await readFile(f));
    if (p.quality.issues.length) console.warn(`Photo quality (${f}): ${p.quality.advice.join(" ")}`);
    images.push({ mediaType: "image/jpeg" as const, base64: p.jpeg.toString("base64") });
  }
  const started = Date.now();
  const { result, usages } = await runAnalysisPipeline({ vision, foods, userId: "cli" }, images, { note });
  const n = (x: number | null | undefined, d = 0) => (x == null ? "—" : x.toFixed(d));

  console.log(`\n${result.mealTitle}  (${result.isMock ? "MOCK" : result.model}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const i of result.items) {
    const c = i.candidates.find((x) => x.foodRef === i.selectedFoodRef);
    const kcal = c?.per100g.caloriesKcal != null ? (c.per100g.caloriesKcal * i.weightGrams) / 100 : null;
    const indent = i.parentRef ? "    " : "  ";
    console.log(
      `${indent}${i.countsTowardTotal ? "•" : "◦"} ${i.displayName.padEnd(28)} ${String(i.weightGrams).padStart(4)} g (${i.portion.lowGrams}–${i.portion.highGrams}, ${i.portion.basis})  ${n(kcal).padStart(4)} kcal  → ${c?.name ?? "NO MATCH"}  [id ${i.identificationConfidence}, match ${i.matchConfidence}]`,
    );
  }
  for (const q of result.questions) console.log(`  ? ${q.question} (±${q.impactKcal} kcal)`);
  console.log(
    `\n  Total ${n(result.totals.caloriesKcal)} kcal · P ${n(result.totals.proteinG, 1)} · C ${n(result.totals.carbohydratesG, 1)} · F ${n(result.totals.totalFatG, 1)}`,
  );
  if (result.uncertainty.caloriesRange)
    console.log(
      `  Likely range ${result.uncertainty.caloriesRange[0]}–${result.uncertainty.caloriesRange[1]} kcal (portion-based, not a statistical interval)`,
    );
  for (const w of result.warnings) console.log(`  ! ${w}`);
  const cost = usages.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0);
  console.log(
    `  Tokens in/out: ${usages.reduce((s, u) => s + (u.inputTokens ?? 0), 0)}/${usages.reduce((s, u) => s + (u.outputTokens ?? 0), 0)} · est. cost $${cost.toFixed(4)}\n`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
