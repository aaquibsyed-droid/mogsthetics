import Link from "next/link";
import { Camera, PencilLine, Scale, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { NutritionLabel } from "@/components/app/nutrition-label";
import { buttonVariants } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

const STEPS = [
  {
    icon: Camera,
    title: "Photograph the plate",
    body: "The vision model lists each food, whether it looks cooked or raw, and what might be hidden — oil, butter, dressing.",
  },
  {
    icon: Scale,
    title: "Weigh it against real data",
    body: "Each item is matched to USDA FoodData Central or a product label. Calories and macros are calculated in code from grams, not guessed by AI.",
  },
  {
    icon: PencilLine,
    title: "Correct anything in seconds",
    body: "Swap a match, type the grams, add the oil. Totals update instantly, and your edits are never overwritten.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
          <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
            Create account
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div>
            <p className="eyebrow">Photo-based calorie & macro estimates</p>
            <h1 className="label-num mt-4 text-[44px] leading-[0.95] sm:text-[68px]">
              Read your plate
              <br />
              like a label.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              {BRAND.name} turns a meal photo into an itemised nutrition estimate you can check and correct — then tracks it against targets
              calculated for you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ variant: "accent", size: "lg" })}>
                <Camera /> Start with your next meal
              </Link>
              <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
                I have an account
              </Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-faint">
              <ShieldCheck className="size-4" /> Your photos stay private. Estimates are shown as estimates.
            </p>
          </div>
          <div className="relative">
            <span className="absolute -top-3 left-5 z-10 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] lowercase tracking-wider text-accent-ink">
              example
            </span>
            <NutritionLabel
              heading="Lunch"
              sub="4 items"
              values={{
                caloriesKcal: 567,
                proteinG: 50.4,
                carbohydratesG: 57.2,
                totalFatG: 13.9,
                fiberG: 3.7,
                saturatedFatG: 2.7,
                sugarsG: 1.3,
                sodiumMg: 143,
              }}
              caloriesRange={[420, 779]}
              footnote="Example: 140 g roasted chicken breast, 180 g cooked white rice, 90 g broccoli and ~8 g olive oil, computed from USDA SR Legacy values."
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <h2 className="label-head text-2xl">calmer than a calorie spreadsheet</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "type it like you'd say it",
                "“2 eggs, toast with butter” becomes a logged meal — matched to USDA data, with the grams shown.",
              ],
              ["no ads, no paywalled basics", "Barcode scanning, macros by meal and data export are part of the app, not an upsell."],
              [
                "verified numbers only",
                "Nutrition comes from USDA FoodData Central and product labels, never crowd-sourced guesses or AI arithmetic.",
              ],
              [
                "kind by design",
                "No red numbers or guilt trips — going over shows in calm tones, and targets only change slowly, when you agree.",
              ],
            ].map(([t, b]) => (
              <div key={t} className="card-soft rounded-[var(--radius)] border border-rule/70 bg-surface p-5">
                <p className="label-head text-base">{t}</p>
                <p className="mt-2 text-sm text-ink-soft">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-rule bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.title}>
                <div className="grid size-10 place-items-center rounded-full bg-tint text-primary">
                  <s.icon className="size-5" />
                </div>
                <h2 className="label-head mt-4 text-lg">{s.title}</h2>
                <p className="mt-2 text-ink-soft">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="label-head text-2xl">What Mogsthetics won&apos;t pretend</h2>
          <ul className="mt-6 space-y-4 text-ink-soft">
            <li>
              <strong className="text-ink">A photo can&apos;t weigh food.</strong> Portions come with a likely range and the evidence used.
              If you know the grams, type them.
            </li>
            <li>
              <strong className="text-ink">Targets are estimates.</strong> Your calorie target starts from the Mifflin–St Jeor equation and
              only changes when your own logged data supports it — and only if you accept.
            </li>
            <li>
              <strong className="text-ink">It isn&apos;t medical care.</strong> For pregnancy, people under 18, or medical conditions,
              Mogsthetics tracks without prescribing targets.
            </li>
          </ul>
        </section>
      </main>
      <footer className="border-t border-rule px-5 py-8 text-center text-xs text-ink-faint">
        Nutrition data: USDA FoodData Central (public domain) · Open Food Facts (ODbL). {BRAND.name} provides general information, not
        medical advice.
      </footer>
    </div>
  );
}
