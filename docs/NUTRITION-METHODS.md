# Nutrition & calculation methods

All calculations are deterministic TypeScript in `src/lib/nutrition/*` with tests in `tests/unit/*`. No LLM performs
authoritative arithmetic. Version tags (`energy-engine@…`, `macro-rules@…`, `nutrition-engine@…`, `adaptive@…`) are stored
with goals and snapshots.

## Energy (`energy.ts`)

- **BMR — Mifflin–St Jeor (1990)**: male `10·kg + 6.25·cm − 5·age + 5`; female `… − 161`.
  - _Sex parameter not specified_: both variants are computed; the midpoint is used and the 166 kcal range (±83) is shown as
    added uncertainty. No value is silently substituted.
  - Limitations shown to users: validated mostly in healthy adults; ~70–80 % of people within ±10 % of measured RMR; less
    accurate above BMI 40 and over 80 years.
- **TDEE** = BMR × one activity factor (1.2 / 1.375 / 1.55 / 1.725 / 1.9). Steps, occupation and workouts only _suggest_
  which factor fits (`suggestActivityLevel`); they are never added on top (no double counting).
- **Targets**
  - Lose: pace = 0.25 / 0.5 / 0.75 % body weight per week; deficit = rate × 7,700 kcal/kg ÷ 7. Capped at 25 % of TDEE.
    "Faster" only at BMI ≥ 25. No weight-loss target below BMI 18.5. Floor: 1,200 (female) / 1,500 (male) / 1,350
    (unspecified) kcal, never above TDEE. Every adjustment is explained, never silent.
  - Maintain: TDEE.
  - Gain: +0.1 / 0.25 / 0.5 kg/week surplus, capped at 20 % of TDEE. Muscle goal: max moderate pace, with the explicit note
    that training + protein, not calories alone, drive muscle gain.
  - Targets are rounded to 10 kcal.
- **Tracking-only pathway** (no calorie numbers at all): under 18, pregnancy, breastfeeding, history of disordered eating,
  or the user's own choice. Users can still log meals and see what they ate.
- Input validation: age 13–110 (whole years), height 120–250 cm, weight 30–350 kg; known enums only.

## Macros (`macros.ts`)

- Protein g/kg: lose 1.6, maintain 1.2, gain 1.4, muscle 1.8 (user-adjustable 0.8–2.4). Reference weight = weight at BMI 25
  when BMI > 30. Kidney disease flagged → default 0.8 g/kg with a "confirm with your care team" note.
- Fat 30 % of energy (20–40 %); carbohydrate = remainder; trimmed toward the fat floor if carbs fall under 130 g.
- Fiber 14 g/1,000 kcal; saturated fat < 10 % energy; added sugars < 10 % energy; sodium < 2,300 mg.
- Consistency: protein·4 + carbs·4 + fat·9 reproduces the calorie target within ±2 kcal (carbs absorb rounding). Manual
  edits must be within 5 % and above the safety floor.

## Nutrient arithmetic (`nutrients.ts`, `meal-calc.ts`)

- `amount = per-100 g value × edible grams ÷ 100`.
- Unknown values stay `null`; totals report how many components lacked a value (UI shows "≥").
- Energy: source-reported kcal preferred. If absent but protein, carbs and fat are present, Atwater 4/4/9 is used and the
  snapshot is marked `energy_source = derived_atwater`. Open Food Facts kJ-only labels convert at 4.184 kJ/kcal.
- Composite dishes: either one whole-dish record **or** its components count — never both (`decideComposite`).
- Raw vs cooked: matching penalises state mismatches (−0.35) and rewards agreement (+0.15); typical yield factors are
  documented for user-entered raw weights.
- Every saved item stores an **immutable nutrition snapshot** (values, per-100 g basis, source, licence, retrieval time,
  calculation version). Edits retire the old snapshot and add a new one.

## Weight trend (`weight-trend.ts`)

- Daily means → time-aware EWMA (α = 0.1/day, `1 − 0.9^Δdays` for gaps).
- Rate: least-squares slope of the trend over 28 days; requires ≥ 4 weigh-ins over ≥ 14 days.
- Projection: remaining ÷ (rate ± 1.5·SE). Described as a heuristic plausibility band, **not** a confidence interval. Not
  shown when moving away from the target, too variable, or data are insufficient. Never a promised date.

## Adaptive targets (`adaptive.ts`)

Observed expenditure ≈ mean intake on plausibly complete days − trend slope × 7,700. Requires ≥ 14 complete days, ≥ 6
weigh-ins spanning ≥ 14 days (≥ 21 days before suggesting a decrease); shrinks 50 % toward the prior estimate; ignores
< 100 kcal differences; caps changes at 150 kcal; respects the floor; at most every 14 days; user accepts / rejects /
postpones; history stored with previous target, new target, reasons and data window. Can be disabled.

## Food photo pipeline (`src/lib/analysis/*`)

A ingestion (validate, EXIF-orient, strip metadata, ≤ 1568 px, blur/brightness heuristics) → B identification (vision model,
structured output) → C segmentation (**not implemented**: the model returns rough boxes, labelled as such) → D portion
estimation (edible grams, low/high range, evidence basis per the documented hierarchy) → E matching (bundled USDA SR Legacy,
your foods, USDA API) → F deterministic calculation. Hidden fats/sauces with ≥ 40 kcal impact become one-tap questions.
Portion ranges produce a calorie range labelled "not a statistical confidence interval".
