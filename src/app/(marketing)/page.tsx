import Link from "next/link";
import { Camera, PencilLine, Scale, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { NutritionLabel } from "@/components/app/nutrition-label";
import { buttonVariants } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

const STEPS = [
  {
    icon: Camera,
    title: "Snap your meal",
    body: "Point, shoot, done. We spot every food on your plate — even the sneaky stuff like oil, butter and dressing.",
  },
  {
    icon: Scale,
    title: "Get real numbers",
    body: "Every food is matched to trusted nutrition data from millions of foods and brands — so your calories and macros are numbers you can rely on.",
  },
  {
    icon: PencilLine,
    title: "Tweak in a tap",
    body: "Bigger portion? Extra sauce? Adjust anything in seconds and watch your totals update instantly.",
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
            <p className="eyebrow">The smarter way to track what you eat</p>
            <h1 className="label-num mt-4 text-[44px] leading-[0.95] sm:text-[68px]">
              Snap it.
              <br />
              Track it. Transform.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              {BRAND.name} turns one photo into calories and macros in seconds — then builds a personal plan to get you to your goal, on your timeline.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ variant: "accent", size: "lg" })}>
                <Camera /> Start free
              </Link>
              <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
                I have an account
              </Link>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-faint">
              <ShieldCheck className="size-4" /> Private by default. Your photos are never shared.
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
              footnote="Chicken breast, white rice, broccoli and a drizzle of olive oil — logged from one photo."
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <h2 className="label-head text-2xl">everything you need. nothing you don&apos;t.</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "type it like you'd say it",
                "Type “2 eggs and toast with butter” and it's logged. No endless scrolling through lists.",
              ],
              ["no ads. ever.", "Barcode scanning, macros and your full history are included. No upsells on the basics."],
              [
                "data you can trust",
                "Search millions of foods and brands, backed by official nutrition data and real product labels.",
              ],
              [
                "a plan built around you",
                "Tell us your goal and your deadline. We'll build the plan, and adjust it as you progress. No guilt trips.",
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
          <h2 className="label-head text-2xl">Honest by design</h2>
          <ul className="mt-6 space-y-4 text-ink-soft">
            <li>
              <strong className="text-ink">Photos are smart, not magic.</strong> We show you our best estimate. If you know the exact amount, just type it in.
            </li>
            <li>
              <strong className="text-ink">Your plan learns from you.</strong> We start with proven science, then fine-tune your plan as you log — always with your OK.
            </li>
            <li>
              <strong className="text-ink">Safety comes first.</strong> If you&apos;re pregnant, under 18 or have a medical condition, we keep it to tracking and leave the targets to your doctor.
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
