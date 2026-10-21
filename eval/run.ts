/**
 * Runs the food-photo pipeline over an evaluation manifest and records metrics.
 *
 *   npm run eval -- --manifest eval/datasets/my-weighed-meals.manifest.json
 *
 * Provider: ANTHROPIC_API_KEY set → Claude (AI_VISION_MODEL, default claude-opus-5-5);
 * otherwise the development mock (results are flagged and meaningless for accuracy).
 * Nutrition matching uses the bundled USDA reference foods, plus the USDA API
 * when USDA_FDC_API_KEY is set. Results are written to eval/results/.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { processMealImage } from "@/lib/analysis/image";
import { runAnalysisPipeline } from "@/lib/analysis/pipeline";
import { createMockProviders } from "@/lib/ai/mock";
import { ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import type { VisionProvider } from "@/lib/ai/provider";
import { REFERENCE_META, getReferenceFood, searchReferenceFoods } from "@/lib/food-data/reference";
import type { FoodService } from "@/lib/food-data/service";
import { createUsdaClient } from "@/lib/food-data/usda";
import { CALCULATION_VERSION } from "@/lib/nutrition/nutrients";
import { scoreCase, summarize, summarizeByStratum, type CaseOutcome } from "./metrics";
import { EvalManifestSchema } from "./schema";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const manifestPath = arg("manifest", "eval/datasets/smoke.manifest.json");
  const manifest = EvalManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const baseDir = path.dirname(manifestPath);

  let vision: VisionProvider;
  if (process.env.ANTHROPIC_API_KEY) {
    const { createAnthropicProviders } = await import("@/lib/ai/anthropic");
    vision = createAnthropicProviders({
      apiKey: process.env.ANTHROPIC_API_KEY,
      visionModel: process.env.AI_VISION_MODEL ?? "claude-opus-5-5",
      textModel: process.env.AI_COACH_MODEL ?? "claude-opus-5-5",
      timeoutMs: 180000,
    }).vision;
  } else {
    vision = createMockProviders().vision;
    console.warn("⚠  No ANTHROPIC_API_KEY: using the development MOCK. Metrics below say nothing about real accuracy.");
  }
  const usda = process.env.USDA_FDC_API_KEY ? createUsdaClient(process.env.USDA_FDC_API_KEY) : null;
  const foods: FoodService = {
    async search(_u, q) {
      const ref = searchReferenceFoods(q, 12).map(({ food, score }) => ({ ...food, score }));
      if (!usda) return { results: ref, warnings: [] };
      try {
        const ext = (await usda.search(q, 8)).map((r) => ({ ...r, score: 0.5 }));
        return { results: [...ref, ...ext], warnings: [] };
      } catch {
        return { results: ref, warnings: ["usda unavailable"] };
      }
    },
    async get(_u, ref) {
      return ref.source === "usda_sr" ? getReferenceFood(ref.id) : usda && ref.source === "usda_fdc" ? usda.get(ref.id) : null;
    },
    async lookupBarcode() {
      return { food: null, warnings: [] };
    },
  };

  const outcomes: CaseOutcome[] = [];
  for (const c of manifest.cases) {
    const started = Date.now();
    try {
      const images = [];
      for (const rel of c.images) {
        const processed = await processMealImage(await readFile(path.resolve(baseDir, rel)));
        images.push({ mediaType: "image/jpeg" as const, base64: processed.jpeg.toString("base64") });
      }
      const out = await runAnalysisPipeline({ vision, foods, userId: "eval" }, images, {
        note: c.context.note,
        referenceObject: c.context.referenceObject as never,
      });
      const cost = out.usages.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0);
      outcomes.push(scoreCase(c, out.result, { latencyMs: Date.now() - started, costUsd: cost }));
      process.stdout.write(".");
    } catch (err) {
      outcomes.push(
        scoreCase(c, null, { latencyMs: Date.now() - started, costUsd: 0, error: err instanceof Error ? err.message : String(err) }),
      );
      process.stdout.write("x");
    }
  }
  process.stdout.write("\n");

  const summary = summarize(outcomes);
  const record = {
    runAt: new Date().toISOString(),
    manifest: { path: manifestPath, name: manifest.name, version: manifest.version, harnessOnly: manifest.harnessOnly },
    system: {
      provider: vision.id,
      model: vision.model,
      isMock: vision.isMock,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      calculationVersion: CALCULATION_VERSION,
      referenceFoods: REFERENCE_META.generatedAt,
      usdaApi: !!usda,
    },
    summary,
    byStratum: summarizeByStratum(outcomes),
    cases: outcomes,
  };
  await mkdir("eval/results", { recursive: true });
  const file = `eval/results/${record.runAt.slice(0, 19).replaceAll(":", "")}_${manifest.name}_${vision.id}-${vision.model}${vision.isMock || manifest.harnessOnly ? ".local" : ""}.json`;
  await writeFile(file, JSON.stringify(record, null, 2));

  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  const num = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));
  console.table({
    "Identification precision": pct(summary.identification.precision),
    "Identification recall": pct(summary.identification.recall),
    "Identification F1": pct(summary.identification.f1),
    "Portion MAE (g)": num(summary.portion.maeGrams),
    "Calorie MAE (kcal)": num(summary.calories.mae),
    "Calorie median |%| error": pct(summary.calories.medianAbsPctError),
    "Protein / carb / fat MAE (g)": `${num(summary.protein.maeG)} / ${num(summary.carbohydrates.maeG)} / ${num(summary.fat.maeG)}`,
    "DB matching accuracy": `${pct(summary.databaseMatching.accuracy)} (n=${summary.databaseMatching.evaluated})`,
    "Range coverage": pct(summary.rangeCoverage),
    "Failed / abstained": `${summary.failed} / ${summary.abstained} of ${summary.cases}`,
    "Cost (USD)": summary.costUsd.toFixed(4),
  });
  console.log(`Results written to ${file}`);
  if (vision.isMock || manifest.harnessOnly)
    console.warn("These results are for harness validation only and must not be reported as accuracy.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
