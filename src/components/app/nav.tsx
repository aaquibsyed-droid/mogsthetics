"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BedDouble, BookOpen, Camera, Dumbbell, Home, LineChart, MessageCircle, Salad, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

const ITEMS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/diary", label: "Diary", icon: BookOpen },
  { href: "/scan", label: "Scan meal", icon: Camera, primary: true },
  { href: "/training", label: "Training", icon: Dumbbell },
  { href: "/progress", label: "Progress", icon: LineChart },
] as const;

const SECONDARY = [
  { href: "/recovery", label: "Recovery", icon: BedDouble },
  { href: "/plan", label: "Meal ideas", icon: Salad },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/profile", label: "Profile", icon: UserRound },
] as const;

function active(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-rule/70 px-4 py-6 lg:flex">
      <Link href="/home" className="mb-8 px-2">
        <Logo />
      </Link>
      <Link
        href="/scan"
        className="glaze mb-6 flex items-center justify-center gap-2 rounded-full px-4 py-3 font-medium transition hover:brightness-[1.03]"
      >
        <Camera className="size-5" /> Scan a meal
      </Link>
      <ul className="flex flex-col gap-1">
        {[...ITEMS.filter((i) => !("primary" in i)), ...SECONDARY].map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={active(path, i.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-full px-4 py-2.5 text-[15px] transition-colors",
                active(path, i.href) ? "bg-surface-2 text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
            >
              <i.icon className="size-[18px]" /> {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 items-center rounded-[26px] border border-white/60 bg-surface/85 px-1.5 py-1.5 shadow-[var(--nav-shadow)] backdrop-blur-xl dark:border-white/10">
        {ITEMS.map((i) =>
          "primary" in i ? (
            <li key={i.href} className="flex justify-center">
              <Link
                href={i.href}
                aria-label={i.label}
                aria-current={active(path, i.href) ? "page" : undefined}
                className="glaze -my-4 grid size-[60px] place-items-center rounded-full ring-4 ring-paper transition active:scale-95"
              >
                <i.icon className="size-7" />
              </Link>
            </li>
          ) : (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active(path, i.href) ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-[20px] py-2 text-[11px] font-medium transition-colors active:scale-95",
                  active(path, i.href) ? "bg-tint text-primary" : "text-ink-faint",
                )}
              >
                <i.icon className="size-[22px]" />
                {i.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

/** Phone-only shortcut to Profile (the bottom bar holds the five main sections). */
export function ProfileButton() {
  const path = usePathname();
  if (active(path, "/profile")) return null;
  return (
    <Link
      href="/profile"
      aria-label="Profile and settings"
      className="absolute right-4 top-[max(env(safe-area-inset-top),20px)] z-30 grid size-10 place-items-center rounded-full border border-rule bg-surface/85 text-ink-soft shadow-sm backdrop-blur sm:right-6 lg:hidden"
    >
      <UserRound className="size-5" />
    </Link>
  );
}
