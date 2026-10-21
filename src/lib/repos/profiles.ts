import { json, type Queryable } from "@/lib/db/types";
import type { ActivityLevel, ClinicalFlag, GoalType, Pace, SexParameter } from "@/lib/nutrition/energy";
import type { Allergen } from "@/lib/food-data/types";
import type { PreferencesPatch } from "@/lib/domain/schemas";

export interface Profile {
  userId: string;
  displayName: string | null;
  ageYears: number | null;
  ageRecordedOn: string | null;
  sexParameter: SexParameter | null;
  heightCm: number | null;
  preferredUnits: "metric" | "imperial";
  timezone: string;
  activityLevel: ActivityLevel | null;
  activityEvidence: Record<string, unknown>;
  goalType: GoalType | null;
  goalPace: Pace | null;
  targetWeightKg: number | null;
  dietaryPattern: "omnivore" | "vegetarian" | "vegan" | "pescatarian";
  allergies: Allergen[];
  dislikedFoods: string[];
  likedFoods: string[];
  mealFrequency: number | null;
  sleepHours: number | null;
  preferredProteinGPerKg: number | null;
  fatPercent: number | null;
  clinicalFlags: ClinicalFlag[];
  adaptiveEnabled: boolean;
  imageRetention: "delete_after_analysis" | "30_days" | "keep";
  notificationPrefs: { weeklySummary: boolean; logReminders: boolean };
  dailyCalorieGoal: number | null;
  proteinGoalG: number | null;
  carbohydrateGoalG: number | null;
  fatGoalG: number | null;
  fiberGoalG: number | null;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT = `
  select user_id as "userId", display_name as "displayName", age_years as "ageYears",
    age_recorded_on::text as "ageRecordedOn", sex_parameter as "sexParameter", height_cm as "heightCm",
    preferred_units as "preferredUnits", timezone, activity_level as "activityLevel",
    activity_evidence as "activityEvidence", goal_type as "goalType", goal_pace as "goalPace",
    target_weight_kg as "targetWeightKg", dietary_pattern as "dietaryPattern", allergies,
    disliked_foods as "dislikedFoods", liked_foods as "likedFoods", meal_frequency as "mealFrequency",
    sleep_hours as "sleepHours", preferred_protein_g_per_kg as "preferredProteinGPerKg",
    fat_percent as "fatPercent", clinical_flags as "clinicalFlags", adaptive_enabled as "adaptiveEnabled",
    image_retention as "imageRetention", notification_prefs as "notificationPrefs",
    daily_calorie_goal as "dailyCalorieGoal", protein_goal_g as "proteinGoalG",
    carbohydrate_goal_g as "carbohydrateGoalG", fat_goal_g as "fatGoalG", fiber_goal_g as "fiberGoalG",
    onboarding_completed_at as "onboardingCompletedAt", created_at as "createdAt", updated_at as "updatedAt"
  from public.profiles`;

export async function getProfile(q: Queryable, userId: string): Promise<Profile | null> {
  const rows = await q.query<Profile>(`${SELECT} where user_id = $1::uuid`, [userId]);
  return rows[0] ?? null;
}

export async function ensureProfile(q: Queryable, userId: string, timezone = "UTC"): Promise<void> {
  await q.query(`insert into public.profiles (user_id, timezone) values ($1::uuid, $2::text) on conflict (user_id) do nothing`, [
    userId,
    timezone,
  ]);
}

export interface ProfileWrite {
  displayName?: string | null;
  ageYears: number;
  ageRecordedOn: string;
  sexParameter: SexParameter;
  heightCm: number;
  preferredUnits: "metric" | "imperial";
  timezone: string;
  activityLevel: ActivityLevel;
  activityEvidence: Record<string, unknown>;
  goalType: GoalType;
  goalPace: Pace | null;
  targetWeightKg: number | null;
  dietaryPattern: string;
  allergies: string[];
  dislikedFoods: string[];
  likedFoods: string[];
  mealFrequency: number | null;
  sleepHours: number | null;
  preferredProteinGPerKg: number | null;
  fatPercent: number | null;
  clinicalFlags: string[];
  targets: {
    caloriesKcal: number | null;
    proteinG: number | null;
    carbohydratesG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  completeOnboarding: boolean;
}

export async function upsertProfile(q: Queryable, userId: string, p: ProfileWrite): Promise<void> {
  await q.query(
    `insert into public.profiles (
       user_id, display_name, age_years, age_recorded_on, sex_parameter, height_cm, preferred_units, timezone,
       activity_level, activity_evidence, goal_type, goal_pace, target_weight_kg, dietary_pattern, allergies,
       disliked_foods, liked_foods, meal_frequency, sleep_hours, preferred_protein_g_per_kg, fat_percent,
       clinical_flags, daily_calorie_goal, protein_goal_g, carbohydrate_goal_g, fat_goal_g, fiber_goal_g,
       onboarding_completed_at)
     values ($1::uuid, $2::text, $3::int, $4::date, $5::text, $6::double precision, $7::text, $8::text,
       $9::text, $10::text::jsonb, $11::text, $12::text, $13::double precision, $14::text,
       public.jsonb_to_text_array($15::text::jsonb), public.jsonb_to_text_array($16::text::jsonb),
       public.jsonb_to_text_array($17::text::jsonb), $18::int, $19::double precision, $20::double precision,
       $21::double precision, public.jsonb_to_text_array($22::text::jsonb), $23::int, $24::int, $25::int, $26::int,
       $27::int, case when $28::boolean then now() else null end)
     on conflict (user_id) do update set
       display_name = coalesce(excluded.display_name, profiles.display_name),
       age_years = excluded.age_years, age_recorded_on = excluded.age_recorded_on,
       sex_parameter = excluded.sex_parameter, height_cm = excluded.height_cm,
       preferred_units = excluded.preferred_units, timezone = excluded.timezone,
       activity_level = excluded.activity_level, activity_evidence = excluded.activity_evidence,
       goal_type = excluded.goal_type, goal_pace = excluded.goal_pace, target_weight_kg = excluded.target_weight_kg,
       dietary_pattern = excluded.dietary_pattern, allergies = excluded.allergies,
       disliked_foods = excluded.disliked_foods, liked_foods = excluded.liked_foods,
       meal_frequency = excluded.meal_frequency, sleep_hours = excluded.sleep_hours,
       preferred_protein_g_per_kg = excluded.preferred_protein_g_per_kg, fat_percent = excluded.fat_percent,
       clinical_flags = excluded.clinical_flags, daily_calorie_goal = excluded.daily_calorie_goal,
       protein_goal_g = excluded.protein_goal_g, carbohydrate_goal_g = excluded.carbohydrate_goal_g,
       fat_goal_g = excluded.fat_goal_g, fiber_goal_g = excluded.fiber_goal_g,
       onboarding_completed_at = coalesce(profiles.onboarding_completed_at, excluded.onboarding_completed_at)`,
    [
      userId,
      p.displayName ?? null,
      p.ageYears,
      p.ageRecordedOn,
      p.sexParameter,
      p.heightCm,
      p.preferredUnits,
      p.timezone,
      p.activityLevel,
      json(p.activityEvidence),
      p.goalType,
      p.goalPace,
      p.targetWeightKg,
      p.dietaryPattern,
      json(p.allergies),
      json(p.dislikedFoods),
      json(p.likedFoods),
      p.mealFrequency,
      p.sleepHours,
      p.preferredProteinGPerKg,
      p.fatPercent,
      json(p.clinicalFlags),
      p.targets.caloriesKcal,
      p.targets.proteinG,
      p.targets.carbohydratesG,
      p.targets.fatG,
      p.targets.fiberG,
      p.completeOnboarding,
    ],
  );
}

export async function updateCurrentTargets(
  q: Queryable,
  userId: string,
  t: { caloriesKcal: number | null; proteinG: number | null; carbohydratesG: number | null; fatG: number | null; fiberG: number | null },
): Promise<void> {
  await q.query(
    `update public.profiles set daily_calorie_goal = $2::int, protein_goal_g = $3::int, carbohydrate_goal_g = $4::int,
       fat_goal_g = $5::int, fiber_goal_g = $6::int where user_id = $1::uuid`,
    [userId, t.caloriesKcal, t.proteinG, t.carbohydratesG, t.fatG, t.fiberG],
  );
}

export async function patchPreferences(q: Queryable, userId: string, p: PreferencesPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [userId];
  const add = (col: string, value: unknown, cast: string) => {
    params.push(value);
    sets.push(`${col} = ${cast.replace("$", `$${params.length}`)}`);
  };
  if (p.displayName !== undefined) add("display_name", p.displayName, "$::text");
  if (p.preferredUnits) add("preferred_units", p.preferredUnits, "$::text");
  if (p.timezone) add("timezone", p.timezone, "$::text");
  if (p.dietaryPattern) add("dietary_pattern", p.dietaryPattern, "$::text");
  if (p.allergies) add("allergies", json(p.allergies), "public.jsonb_to_text_array($::text::jsonb)");
  if (p.dislikedFoods) add("disliked_foods", json(p.dislikedFoods), "public.jsonb_to_text_array($::text::jsonb)");
  if (p.likedFoods) add("liked_foods", json(p.likedFoods), "public.jsonb_to_text_array($::text::jsonb)");
  if (p.mealFrequency !== undefined) add("meal_frequency", p.mealFrequency, "$::int");
  if (p.adaptiveEnabled !== undefined) add("adaptive_enabled", p.adaptiveEnabled, "$::boolean");
  if (p.imageRetention) add("image_retention", p.imageRetention, "$::text");
  if (p.notificationPrefs) add("notification_prefs", json(p.notificationPrefs), "$::text::jsonb");
  if (!sets.length) return;
  await q.query(`update public.profiles set ${sets.join(", ")} where user_id = $1::uuid`, params);
}
