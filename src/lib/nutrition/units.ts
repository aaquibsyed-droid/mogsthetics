/** Unit conversions. Internal storage is always metric (kg, cm, g). */

export const LB_PER_KG = 2.2046226218;
export const CM_PER_INCH = 2.54;
export const G_PER_OZ = 28.349523125;

export type UnitSystem = "metric" | "imperial";

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 10) / 10;
  if (inches >= 12) {
    feet += 1;
    inches -= 12;
  }
  return { feet, inches };
}

export function ozToG(oz: number): number {
  return oz * G_PER_OZ;
}

export function gToOz(g: number): number {
  return g / G_PER_OZ;
}

export function formatWeight(kg: number, units: UnitSystem, decimals = 1): string {
  const f = 10 ** decimals;
  return units === "imperial" ? `${Math.round(kgToLb(kg) * f) / f} lb` : `${Math.round(kg * f) / f} kg`;
}

export function formatHeight(cm: number, units: UnitSystem): string {
  if (units === "imperial") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}′ ${Math.round(inches)}″`;
  }
  return `${Math.round(cm)} cm`;
}

export function formatMass(g: number, units: UnitSystem): string {
  if (units === "imperial") return `${Math.round(gToOz(g) * 10) / 10} oz`;
  return `${Math.round(g)} g`;
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Weight at a given BMI for a height. */
export function weightAtBmi(targetBmi: number, heightCm: number): number {
  const m = heightCm / 100;
  return targetBmi * m * m;
}
