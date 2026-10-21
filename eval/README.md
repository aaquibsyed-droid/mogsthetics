# Evaluation framework

Measures the food-photo pipeline end to end on **your own labelled data**. No accuracy figures are claimed anywhere in this
project; the only bundled dataset (`datasets/smoke.manifest.json`) is a harness smoke test whose "truth" is the mock's
output — its numbers mean nothing about real accuracy.

## Building a dataset (legally usable)

- **Weighed meals you photograph yourself** (best): weigh each component on a kitchen scale before plating, photograph, and
  record grams + the matching database record (e.g. `usda_sr:168878`). Totals = Σ grams × per-100 g values.
- **Packaged foods**: photograph with the label; truth from the label × amount eaten.
- **Licensed datasets**: e.g. Nutrition5k (Google Research, CC BY 4.0 — attribute it) provides overhead images of weighed
  dishes with per-ingredient masses and nutrition. Record the licence in each case.

Cover strata deliberately: cuisines, lighting (good/dim/harsh), angles (overhead/angled/side), food types (single item,
plated mixed, composite dish, packaged, beverage), hidden fats, occlusion, raw vs cooked.

Manifest format: `eval/schema.ts` (`EvalManifestSchema`). Image paths are relative to the manifest file.

## Running

```bash
ANTHROPIC_API_KEY=... AI_VISION_MODEL=claude-opus-5-5 npm run eval -- --manifest eval/datasets/weighed-v1.manifest.json
USDA_FDC_API_KEY=...   # optional: broader matching
```

Output: a console summary plus `eval/results/<timestamp>_<dataset>_<provider>-<model>.json` containing the model, prompt
version, calculation version, reference-data version, per-case outcomes and per-stratum summaries. Commit result files for
real datasets to keep a history; mock/harness runs are written as `*.local.json` (git-ignored).

## Metrics

| Metric                         | Definition                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Identification P / R / F1      | Items aligned greedily by name similarity ≥ 0.5 (same matcher as the app)      |
| Portion MAE / median abs % err | On aligned items, grams                                                        |
| Calorie MAE / median abs % err | Meal totals vs truth                                                           |
| Protein / carb / fat MAE       | Meal totals, grams                                                             |
| DB matching accuracy           | Aligned items whose selected record equals the labelled `foodRef`              |
| Range coverage                 | Share of cases whose true kcal lies in the reported range (coverage, not a CI) |
| Error by confidence            | Median abs % calorie error per reported overall confidence (calibration check) |
| Failure / abstention rates     | Pipeline errors vs "no food found"                                             |
| Latency, cost                  | From recorded provider usage                                                   |

## Using results

Compare models/prompts on the same manifest before changing defaults. Inspect worst cases for: mixed dishes, hidden oils
and sauces, occlusion, regional foods, cooked-vs-raw mismatches, ambiguous portions. User corrections are also stored in
`analysis_feedback` (renamed / reweighed / rematched / added / removed) — aggregate them to find systematic bias, but treat
them as feedback, not ground truth.
