"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ChoiceCard, Notice, Segmented } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/client/api";
import { useHydrated } from "@/lib/client/use-hydrated";
import type { ProfileInput } from "@/lib/domain/schemas";
import { ALLERGENS, ALLERGEN_LABELS } from "@/lib/food-data/types";
import { ACTIVITY_LEVELS, LIMITS, suggestActivityLevel, type ActivityLevel } from "@/lib/nutrition/energy";
import { cmToFeetInches, feetInchesToCm, kgToLb, lbToKg } from "@/lib/nutrition/units";
import type { TargetPreview } from "@/lib/services/targets";
import type { Profile } from "@/lib/repos/profiles";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const num = (min: number, max: number, msg: string) =>
  z.number({ message: msg }).refine((v) => Number.isFinite(v) && v >= min && v <= max, msg);
const optNum = z
  .number()
  .optional()
  .or(z.nan().transform(() => undefined));

const FormSchema = z
  .object({
    units: z.enum(["metric", "imperial"]),
    displayName: z.string().max(80).optional(),
    ageYears: num(LIMITS.ageMin, LIMITS.ageMax, `Enter an age between ${LIMITS.ageMin} and ${LIMITS.ageMax}.`).refine(
      Number.isInteger,
      "Use whole years.",
    ),
    sexParameter: z.enum(["male", "female", "unspecified"], { message: "Choose an option." }),
    heightCm: optNum,
    heightFt: optNum,
    heightIn: optNum,
    weight: z.number({ message: "Enter your weight." }).positive("Enter your weight."),
    activityLevel: z.enum(["sedentary", "light", "moderate", "very", "extra"], { message: "Choose your activity level." }),
    steps: optNum,
    occupation: z.enum(["", "desk", "standing", "physical"]),
    workoutsPerWeek: optNum,
    workoutMinutes: optNum,
    goalType: z.enum(["lose", "maintain", "gain", "muscle"], { message: "Choose a goal." }),
    goalPace: z.enum(["gentle", "moderate", "faster"]),
    targetWeight: optNum,
    goalWeeks: optNum,
    clinicalFlags: z.array(z.string()),
    dietaryPattern: z.enum(["omnivore", "vegetarian", "vegan", "pescatarian"]),
    allergies: z.array(z.string()),
    dislikes: z.string().max(600),
    likes: z.string().max(600),
    mealFrequency: optNum,
    preferredProtein: optNum,
  })
  .superRefine((v, ctx) => {
    const cm = v.units === "metric" ? v.heightCm : v.heightFt !== undefined ? feetInchesToCm(v.heightFt, v.heightIn ?? 0) : undefined;
    if (cm === undefined || !(cm >= LIMITS.heightCmMin && cm <= LIMITS.heightCmMax)) {
      ctx.addIssue({
        code: "custom",
        path: [v.units === "metric" ? "heightCm" : "heightFt"],
        message: "Enter a height between 120 and 250 cm (3′11″–8′2″).",
      });
    }
    const kg = v.units === "metric" ? v.weight : lbToKg(v.weight);
    if (!(kg >= LIMITS.weightKgMin && kg <= LIMITS.weightKgMax))
      ctx.addIssue({ code: "custom", path: ["weight"], message: "Enter a weight between 30 and 350 kg (66–770 lb)." });
    if (v.targetWeight !== undefined) {
      const t = v.units === "metric" ? v.targetWeight : lbToKg(v.targetWeight);
      if (!(t >= LIMITS.weightKgMin && t <= LIMITS.weightKgMax))
        ctx.addIssue({ code: "custom", path: ["targetWeight"], message: "Enter a realistic target weight." });
    }
    if (v.steps !== undefined && !(v.steps >= 0 && v.steps <= 60000))
      ctx.addIssue({ code: "custom", path: ["steps"], message: "Steps must be 0–60,000." });
    if (v.workoutsPerWeek !== undefined && !(v.workoutsPerWeek >= 0 && v.workoutsPerWeek <= 21 && Number.isInteger(v.workoutsPerWeek)))
      ctx.addIssue({ code: "custom", path: ["workoutsPerWeek"], message: "0–21 sessions." });
    if (v.workoutMinutes !== undefined && !(v.workoutMinutes >= 5 && v.workoutMinutes <= 300))
      ctx.addIssue({ code: "custom", path: ["workoutMinutes"], message: "5–300 minutes." });
    if (v.mealFrequency !== undefined && !(v.mealFrequency >= 1 && v.mealFrequency <= 8 && Number.isInteger(v.mealFrequency)))
      ctx.addIssue({ code: "custom", path: ["mealFrequency"], message: "1–8 meals." });
    if (v.preferredProtein !== undefined && !(v.preferredProtein >= 0.8 && v.preferredProtein <= 2.4))
      ctx.addIssue({ code: "custom", path: ["preferredProtein"], message: "0.8–2.4 g per kg." });
  });

type FormValues = z.input<typeof FormSchema>;

const STEPS: Array<{ id: string; title: string; why: string; fields: FieldPath<FormValues>[]; optional?: boolean }> = [
  {
    id: "basics",
    title: "About you",
    why: "A few quick basics so we can build a plan that's actually yours. Takes under a minute.",
    fields: ["ageYears", "sexParameter", "heightCm", "heightFt", "heightIn", "weight"],
  },
  {
    id: "activity",
    title: "Your activity",
    why: "How much you move changes how much you can eat. Be honest — your plan gets smarter as you log.",
    fields: ["activityLevel", "steps", "workoutsPerWeek", "workoutMinutes"],
  },
  {
    id: "goal",
    title: "Your goal",
    why: "Tell us where you want to be and when. We'll map out how to get there.",
    fields: ["goalType", "goalPace", "targetWeight", "goalWeeks"],
  },
  {
    id: "health",
    title: "Anything we should know?",
    why: "Optional. This helps us keep your plan safe and right for you.",
    fields: ["clinicalFlags"],
    optional: true,
  },
  {
    id: "food",
    title: "Food preferences",
    why: "So your meal ideas are things you'll actually want to eat. We never suggest your allergens.",
    fields: ["dietaryPattern", "allergies", "dislikes", "likes", "mealFrequency", "preferredProtein"],
    optional: true,
  },
  { id: "review", title: "Your plan is ready", why: "Here's your personalised plan. Nothing is saved until you confirm.", fields: [] },
];

const HEALTH_FLAGS: Array<{ value: string; title: string; description: string }> = [
  { value: "pregnant", title: "I'm pregnant", description: "We'll skip calorie targets — your doctor or midwife knows best." },
  { value: "breastfeeding", title: "I'm breastfeeding", description: "We'll skip calorie targets and keep it to simple tracking." },
  { value: "eating_disorder_history", title: "History of disordered eating", description: "We'll hide calorie targets. Just log, no numbers." },
  {
    value: "prefers_no_targets",
    title: "I'd prefer not to see calorie targets",
    description: "Log meals without targets or remaining counts.",
  },
  { value: "kidney_disease", title: "Kidney disease", description: "We'll keep protein moderate. Check with your care team." },
  {
    value: "diabetes_medication",
    title: "I take medication for diabetes",
    description: "Targets are general — review them with your clinician.",
  },
  {
    value: "other_medical",
    title: "Another condition affecting nutrition",
    description: "Targets are general — review them with your clinician.",
  },
];

function profileDefaults(p: Profile | null, weightKg: number | null): FormValues {
  const units = p?.preferredUnits ?? "metric";
  const ft = p?.heightCm ? cmToFeetInches(p.heightCm) : null;
  const ev = (p?.activityEvidence ?? {}) as {
    averageDailySteps?: number;
    occupationActivity?: string;
    workoutsPerWeek?: number;
    workoutMinutes?: number;
  };
  const toUnits = (kg: number | null | undefined) =>
    kg == null ? undefined : Math.round((units === "imperial" ? kgToLb(kg) : kg) * 10) / 10;
  return {
    units,
    displayName: p?.displayName ?? "",
    ageYears: p?.ageYears ?? (undefined as unknown as number),
    sexParameter: p?.sexParameter ?? (undefined as unknown as "male"),
    heightCm: p?.heightCm ? Math.round(p.heightCm) : undefined,
    heightFt: ft?.feet,
    heightIn: ft ? Math.round(ft.inches) : undefined,
    weight: toUnits(weightKg) ?? (undefined as unknown as number),
    activityLevel: p?.activityLevel ?? (undefined as unknown as ActivityLevel),
    steps: ev.averageDailySteps,
    occupation: (ev.occupationActivity as FormValues["occupation"]) ?? "",
    workoutsPerWeek: ev.workoutsPerWeek,
    workoutMinutes: ev.workoutMinutes,
    goalType: p?.goalType ?? (undefined as unknown as "lose"),
    goalPace: p?.goalPace ?? "moderate",
    targetWeight: toUnits(p?.targetWeightKg),
    goalWeeks: p?.goalWeeks ?? undefined,
    clinicalFlags: p?.clinicalFlags ?? [],
    dietaryPattern: p?.dietaryPattern ?? "omnivore",
    allergies: p?.allergies ?? [],
    dislikes: (p?.dislikedFoods ?? []).join(", "),
    likes: (p?.likedFoods ?? []).join(", "),
    mealFrequency: p?.mealFrequency ?? undefined,
    preferredProtein: p?.preferredProteinGPerKg ?? undefined,
  };
}

function toInput(v: FormValues): ProfileInput {
  const kg = (x: number) => Math.round((v.units === "imperial" ? lbToKg(x) : x) * 100) / 100;
  const heightCm = v.units === "metric" ? v.heightCm! : Math.round(feetInchesToCm(v.heightFt!, v.heightIn ?? 0) * 10) / 10;
  const list = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 30);
  return {
    displayName: v.displayName?.trim() || null,
    ageYears: v.ageYears,
    sexParameter: v.sexParameter,
    heightCm,
    weightKg: kg(v.weight),
    preferredUnits: v.units,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    activityLevel: v.activityLevel,
    activityEvidence: {
      averageDailySteps: v.steps ?? null,
      occupationActivity: v.occupation || null,
      workoutsPerWeek: v.workoutsPerWeek ?? null,
      workoutMinutes: v.workoutMinutes ?? null,
    },
    goalType: v.goalType,
    goalPace: v.goalType === "maintain" ? null : v.goalPace,
    targetWeightKg: v.targetWeight !== undefined ? kg(v.targetWeight) : null,
    goalWeeks: v.goalType !== "maintain" && v.targetWeight !== undefined && v.goalWeeks ? Math.round(v.goalWeeks) : null,
    dietaryPattern: v.dietaryPattern,
    allergies: v.allergies as ProfileInput["allergies"],
    dislikedFoods: list(v.dislikes),
    likedFoods: list(v.likes),
    mealFrequency: v.mealFrequency ?? null,
    preferredProteinGPerKg: v.preferredProtein ?? null,
    clinicalFlags: v.clinicalFlags as ProfileInput["clinicalFlags"],
  };
}

export function ProfileWizard({
  initial,
  initialWeightKg,
  mode,
}: {
  initial: Profile | null;
  initialWeightKg: number | null;
  mode: "onboarding" | "edit";
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hydrated = useHydrated();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: profileDefaults(initial, initialWeightKg),
    mode: "onTouched",
  });
  const { register, setValue, formState, trigger, getValues } = form;
  const v = useWatch({ control: form.control }) as FormValues;
  const e = formState.errors;
  const current = STEPS[step];

  const suggestion = useMemo(
    () =>
      suggestActivityLevel({
        averageDailySteps: Number.isFinite(v.steps) ? v.steps : null,
        occupationActivity: v.occupation || null,
        workoutsPerWeek: Number.isFinite(v.workoutsPerWeek) ? v.workoutsPerWeek : null,
        workoutMinutes: Number.isFinite(v.workoutMinutes) ? v.workoutMinutes : null,
      }),
    [v.steps, v.occupation, v.workoutsPerWeek, v.workoutMinutes],
  );

  useEffect(() => {
    if (current.id !== "review") return;
    let cancelled = false;
    api<TargetPreview>("/api/targets/preview", { body: toInput(getValues()) })
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setPreviewError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [current.id, getValues]);

  async function next() {
    const ok = await trigger(current.fields);
    if (!ok) return;
    if (STEPS[step + 1]?.id === "review") {
      setPreview(null);
      setPreviewError(null);
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function apply() {
    setSaving(true);
    try {
      await api("/api/profile", { method: "PUT", body: toInput(getValues()) });
      toast.success(mode === "onboarding" ? "Targets saved. Let's log your first meal." : "Profile updated. New targets apply from today.");
      router.push(mode === "onboarding" ? "/home" : "/profile");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  }

  const toggleIn = (field: "clinicalFlags" | "allergies", value: string) => {
    const cur = getValues(field);
    setValue(field, cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value], { shouldDirty: true });
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <ol className="mb-6 flex gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-surface-2")}
            aria-current={i === step ? "step" : undefined}
          >
            <span className="sr-only">
              Step {i + 1} of {STEPS.length}: {s.title}
            </span>
          </li>
        ))}
      </ol>
      <p className="eyebrow">
        Step {step + 1} of {STEPS.length}
        {current.optional ? " · optional" : ""}
      </p>
      <h1 className="label-num mt-2 text-[34px]">{current.title}</h1>
      <p className="mt-2 flex gap-2 text-sm text-ink-soft">
        <Info className="mt-0.5 size-4 shrink-0" /> {current.why}
      </p>

      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (current.id === "review") void apply();
          else void next();
        }}
        noValidate
      >
        {current.id === "basics" && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Units</span>
              <Segmented
                name="Units"
                value={v.units}
                onChange={(u) => setValue("units", u)}
                options={[
                  { value: "metric", label: "kg · cm" },
                  { value: "imperial", label: "lb · ft" },
                ]}
              />
            </div>
            <Field label="Name (optional)" htmlFor="displayName">
              <Input id="displayName" autoComplete="given-name" {...register("displayName")} />
            </Field>
            <Field label="Age" htmlFor="ageYears" error={e.ageYears?.message} hint="Whole years. We store your age, not your birth date.">
              <Input
                id="ageYears"
                inputMode="numeric"
                type="number"
                {...register("ageYears", { valueAsNumber: true })}
                aria-invalid={!!e.ageYears}
              />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Sex</legend>
              <p className="-mt-1 mb-1 text-xs text-ink-faint">
                Men and women burn energy a little differently, so this makes your numbers more accurate.
              </p>
              <ChoiceCard
                checked={v.sexParameter === "female"}
                onSelect={() => setValue("sexParameter", "female", { shouldValidate: true })}
                title="Female"
              />
              <ChoiceCard
                checked={v.sexParameter === "male"}
                onSelect={() => setValue("sexParameter", "male", { shouldValidate: true })}
                title="Male"
              />
              <ChoiceCard
                checked={v.sexParameter === "unspecified"}
                onSelect={() => setValue("sexParameter", "unspecified", { shouldValidate: true })}
                title="Prefer not to say"
                description="No problem — your numbers will just be a little less precise."
              />
              {e.sexParameter ? <p className="text-xs text-danger">{e.sexParameter.message}</p> : null}
            </fieldset>
            {v.units === "metric" ? (
              <Field label="Height (cm)" htmlFor="heightCm" error={e.heightCm?.message}>
                <Input
                  id="heightCm"
                  type="number"
                  inputMode="decimal"
                  {...register("heightCm", { valueAsNumber: true })}
                  aria-invalid={!!e.heightCm}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Height (ft)" htmlFor="heightFt" error={e.heightFt?.message}>
                  <Input
                    id="heightFt"
                    type="number"
                    inputMode="numeric"
                    {...register("heightFt", { valueAsNumber: true })}
                    aria-invalid={!!e.heightFt}
                  />
                </Field>
                <Field label="(in)" htmlFor="heightIn">
                  <Input id="heightIn" type="number" inputMode="numeric" {...register("heightIn", { valueAsNumber: true })} />
                </Field>
              </div>
            )}
            <Field label={`Current weight (${v.units === "metric" ? "kg" : "lb"})`} htmlFor="weight" error={e.weight?.message}>
              <Input
                id="weight"
                type="number"
                inputMode="decimal"
                step="0.1"
                {...register("weight", { valueAsNumber: true })}
                aria-invalid={!!e.weight}
              />
            </Field>
          </>
        )}

        {current.id === "activity" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Activity level</legend>
              {(Object.keys(ACTIVITY_LEVELS) as ActivityLevel[]).map((k) => (
                <ChoiceCard
                  key={k}
                  checked={v.activityLevel === k}
                  onSelect={() => setValue("activityLevel", k, { shouldValidate: true })}
                  title={
                    <span className="flex items-center gap-2">
                      {ACTIVITY_LEVELS[k].label}{" "}
                      <span className="font-mono text-xs font-normal text-ink-faint">×{ACTIVITY_LEVELS[k].multiplier}</span>
                      {suggestion?.level === k ? (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium lowercase text-accent-ink">
                          suggested
                        </span>
                      ) : null}
                    </span>
                  }
                  description={ACTIVITY_LEVELS[k].description}
                />
              ))}
              {e.activityLevel ? <p className="text-xs text-danger">{e.activityLevel.message}</p> : null}
            </fieldset>
            <details className="rounded-xl border border-rule bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">Not sure? Add details for a suggestion</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Average daily steps" htmlFor="steps" error={e.steps?.message}>
                  <Input id="steps" type="number" inputMode="numeric" {...register("steps", { valueAsNumber: true })} />
                </Field>
                <Field label="Work activity" htmlFor="occupation">
                  <Select id="occupation" {...register("occupation")}>
                    <option value="">Not specified</option>
                    <option value="desk">Mostly sitting</option>
                    <option value="standing">On my feet</option>
                    <option value="physical">Physical work</option>
                  </Select>
                </Field>
                <Field label="Workouts per week" htmlFor="workoutsPerWeek" error={e.workoutsPerWeek?.message}>
                  <Input id="workoutsPerWeek" type="number" inputMode="numeric" {...register("workoutsPerWeek", { valueAsNumber: true })} />
                </Field>
                <Field label="Minutes per workout" htmlFor="workoutMinutes" error={e.workoutMinutes?.message}>
                  <Input id="workoutMinutes" type="number" inputMode="numeric" {...register("workoutMinutes", { valueAsNumber: true })} />
                </Field>
              </div>
              {suggestion ? (
                <p className="mt-3 text-sm text-ink-soft">
                  Based on {suggestion.rationale.join(", ")}:{" "}
                  <strong className="text-ink">{ACTIVITY_LEVELS[suggestion.level].label}</strong>.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline"
                    onClick={() => setValue("activityLevel", suggestion.level, { shouldValidate: true })}
                  >
                    Use this
                  </button>
                </p>
              ) : null}
            </details>
          </>
        )}

        {current.id === "goal" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Goal</legend>
              <ChoiceCard
                checked={v.goalType === "lose"}
                onSelect={() => setValue("goalType", "lose", { shouldValidate: true })}
                title="Lose weight"
                description="Lose fat steadily without feeling starved."
              />
              <ChoiceCard
                checked={v.goalType === "maintain"}
                onSelect={() => setValue("goalType", "maintain", { shouldValidate: true })}
                title="Maintain weight"
                description="Stay where you are and feel your best."
              />
              <ChoiceCard
                checked={v.goalType === "gain"}
                onSelect={() => setValue("goalType", "gain", { shouldValidate: true })}
                title="Gain weight"
                description="Put on healthy weight, steadily."
              />
              <ChoiceCard
                checked={v.goalType === "muscle"}
                onSelect={() => setValue("goalType", "muscle", { shouldValidate: true })}
                title="Build muscle"
                description="Fuel lean muscle with more protein. Pair it with lifting."
              />
              {e.goalType ? <p className="text-xs text-danger">{e.goalType.message}</p> : null}
            </fieldset>
            {v.goalType && v.goalType !== "maintain" ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Pace</span>
                <Segmented
                  name="Pace"
                  value={v.goalPace}
                  onChange={(p) => setValue("goalPace", p)}
                  options={[
                    { value: "gentle", label: "Gentle" },
                    { value: "moderate", label: "Moderate" },
                    { value: "faster", label: "Faster" },
                  ]}
                />
                <p className="text-xs text-ink-faint">
                  {v.goalType === "lose"
                    ? "Gentle ≈ 0.25%, moderate ≈ 0.5%, faster ≈ 0.75% of body weight per week. Faster is only offered at higher BMIs and is capped for safety."
                    : "Gentle ≈ 0.1 kg, moderate ≈ 0.25 kg, faster ≈ 0.5 kg per week. Muscle-gain goals use at most the moderate pace."}
                </p>
              </div>
            ) : null}
            <Field
              label={`Target weight (${v.units === "metric" ? "kg" : "lb"}, optional)`}
              htmlFor="targetWeight"
              error={e.targetWeight?.message}
              hint="Add a target and a timeline to get a custom week-by-week plan."
            >
              <Input
                id="targetWeight"
                type="number"
                inputMode="decimal"
                step="0.1"
                {...register("targetWeight", { valueAsNumber: true })}
              />
            </Field>
            {v.goalType !== "maintain" && v.targetWeight !== undefined && !Number.isNaN(v.targetWeight) ? (
              <Field
                label="How many weeks do you want to reach it in?"
                htmlFor="goalWeeks"
                error={e.goalWeeks?.message}
                hint="We'll set your daily calories to hit it. If it's too fast to be healthy, we'll show you a realistic date instead."
              >
                <Input
                  id="goalWeeks"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={260}
                  step="1"
                  placeholder="e.g. 12"
                  {...register("goalWeeks", { valueAsNumber: true })}
                />
              </Field>
            ) : null}
          </>
        )}

        {current.id === "health" && (
          <div className="flex flex-col gap-2">
            {HEALTH_FLAGS.map((f) => (
              <ChoiceCard
                key={f.value}
                role="checkbox"
                checked={v.clinicalFlags.includes(f.value)}
                onSelect={() => toggleIn("clinicalFlags", f.value)}
                title={f.title}
                description={f.description}
              />
            ))}
            <p className="mt-2 text-xs text-ink-faint">
              Mogsthetics is not a medical service. Under 18? Targets aren&apos;t set automatically — logging still works.
            </p>
          </div>
        )}

        {current.id === "food" && (
          <>
            <Field label="Eating pattern" htmlFor="dietaryPattern">
              <Select id="dietaryPattern" {...register("dietaryPattern")}>
                <option value="omnivore">No restrictions</option>
                <option value="vegetarian">Vegetarian</option>
                <option value="pescatarian">Pescatarian</option>
                <option value="vegan">Vegan</option>
              </Select>
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Allergies & intolerances</legend>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => {
                  const on = v.allergies.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleIn("allergies", a)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm",
                        on ? "border-primary bg-primary text-primary-ink" : "border-rule bg-surface",
                      )}
                    >
                      {on ? <Check className="mr-1 inline size-3.5" /> : null}
                      {ALLERGEN_LABELS[a]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field label="Foods you avoid or dislike" htmlFor="dislikes" hint="Comma-separated, e.g. olives, mushrooms">
              <Input id="dislikes" {...register("dislikes")} />
            </Field>
            <Field label="Foods you enjoy" htmlFor="likes" hint="Comma-separated">
              <Input id="likes" {...register("likes")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Meals per day" htmlFor="mealFrequency" error={e.mealFrequency?.message}>
                <Input id="mealFrequency" type="number" inputMode="numeric" {...register("mealFrequency", { valueAsNumber: true })} />
              </Field>
              <Field
                label="Protein (g/kg, optional)"
                htmlFor="preferredProtein"
                error={e.preferredProtein?.message}
                hint="Leave blank for the default."
              >
                <Input
                  id="preferredProtein"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  {...register("preferredProtein", { valueAsNumber: true })}
                />
              </Field>
            </div>
          </>
        )}

        {current.id === "review" && <Review preview={preview} error={previewError} units={v.units} />}

        <div className="mt-2 flex items-center justify-between gap-3">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft /> Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {current.optional ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (STEPS[step + 1]?.id === "review") {
                    setPreview(null);
                    setPreviewError(null);
                  }
                  setStep((s) => s + 1);
                }}
              >
                Skip
              </Button>
            ) : null}
            {current.id === "review" ? (
              <Button type="submit" size="lg" disabled={!preview || saving || !hydrated}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />} {mode === "onboarding" ? "Save and start" : "Apply from today"}
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={!hydrated}>
                Continue <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-rule pt-2">
      <p className="eyebrow">{label}</p>
      <p className="label-num mt-1 text-[28px]">{value}</p>
      {note ? <p className="text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}

function Review({ preview, error, units }: { preview: TargetPreview | null; error: string | null; units: "metric" | "imperial" }) {
  if (error)
    return (
      <Notice tone="danger" title="We couldn't build your plan">
        {error}
      </Notice>
    );
  if (!preview) {
    return (
      <div className="flex items-center gap-2 text-ink-soft">
        <Loader2 className="size-4 animate-spin" /> Building your plan…
      </div>
    );
  }
  const { plan, macros } = preview;
  if (plan.status === "tracking_only") {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="info" title="Tracking, without the numbers">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {plan.trackingOnlyReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Notice>
        <p className="text-sm text-ink-soft">
          You can still photograph and log meals, see nutrient totals, and track weight if you choose.
        </p>
      </div>
    );
  }
  const rate = plan.plannedRateKgPerWeek;
  const goalLabel = { lose: "Lose weight", maintain: "Maintain", gain: "Gain weight", muscle: "Build muscle" }[plan.goal];
  return (
    <div className="flex flex-col gap-5">
      {plan.adjustments.map((a) => (
        <Notice key={a} tone="warn">
          {a}
        </Notice>
      ))}
      {plan.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Calories at rest"
          value={`${fmtNum(plan.bmrKcal)}`}
          note={plan.bmrRange ? `range ${fmtNum(plan.bmrRange[0])}–${fmtNum(plan.bmrRange[1])} kcal` : "what your body burns doing nothing"}
        />
        <Stat label="Calories you burn" value={`${fmtNum(plan.tdeeKcal)}`} note="per day, including activity" />
        <Stat
          label="Goal"
          value={goalLabel}
          note={
            rate
              ? `~${fmtNum(units === "imperial" ? kgToLb(rate) : rate, 2)} ${units === "imperial" ? "lb" : "kg"}/week planned`
              : undefined
          }
        />
        <Stat
          label={
            plan.dailyAdjustmentKcal && plan.dailyAdjustmentKcal < 0
              ? "Eating below burn"
              : plan.dailyAdjustmentKcal
                ? "Eating above burn"
                : "Adjustment"
          }
          value={`${fmtNum(Math.abs(plan.dailyAdjustmentKcal ?? 0))}`}
          note="kcal per day"
        />
      </div>
      {plan.timeline ? <TimelinePlan timeline={plan.timeline} units={units} /> : null}
      <div className="border-2 border-ink bg-surface p-4">
        <p className="text-[13px] font-medium">Your daily calories</p>
        <p className="label-num text-[56px]" data-testid="preview-target">
          {fmtNum(plan.targetKcal)}
        </p>
        <div className="rule-mid mt-2" />
        {macros ? (
          <dl className="mt-1 grid grid-cols-4 gap-2 pt-2 text-center">
            {[
              ["Protein", macros.proteinG, "var(--protein)"],
              ["Carbs", macros.carbohydratesG, "var(--carbs)"],
              ["Fat", macros.fatG, "var(--fat)"],
              ["Fiber", macros.fiberG, "var(--fiber)"],
            ].map(([l, g, c]) => (
              <div key={l as string}>
                <dt className="text-xs font-medium text-ink-soft">
                  <span className="mr-1 inline-block size-2" style={{ background: c as string }} />
                  {l}
                </dt>
                <dd className="label-num mt-1 text-2xl">{g as number}g</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {macros?.notes.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {macros.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <details className="rounded-xl border border-rule bg-surface px-4 py-3 text-sm" open>
        <summary className="cursor-pointer font-medium">How this was calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="mt-3 font-medium">Limitations</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
          {plan.limitations.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function TimelinePlan({ timeline: t, units }: { timeline: NonNullable<TargetPreview["plan"]["timeline"]>; units: "metric" | "imperial" }) {
  const w = (kg: number) => `${fmtNum(units === "imperial" ? kgToLb(kg) : kg, 1)} ${units === "imperial" ? "lb" : "kg"}`;
  const [now] = useState(() => Date.now());
  const finish = t.plannedWeeks ? new Date(now + t.plannedWeeks * 7 * 86400000) : null;
  return (
    <div className="border-2 border-ink bg-surface p-4" data-testid="timeline-plan">
      <p className="text-[13px] font-medium">Your {t.plannedWeeks ?? t.requestedWeeks}-week plan</p>
      <p className="mt-1 text-sm text-ink-soft">
        {w(t.startWeightKg)} → {w(t.targetWeightKg)}
        {finish ? ` · on track for ${finish.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
        {t.slowedForSafety && t.plannedWeeks ? ` (you asked for ${t.requestedWeeks} weeks)` : ""}
      </p>
      {t.milestones.length ? (
        <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {t.milestones.map((m) => (
            <li key={m.week} className="flex justify-between border-b border-line py-1">
              <span className="text-ink-soft">Wk {m.week}</span>
              <span className="label-num">{w(m.weightKg)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
