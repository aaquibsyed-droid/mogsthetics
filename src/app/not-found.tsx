import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="label-num text-6xl">404</p>
      <p className="text-ink-soft">That page doesn&apos;t exist.</p>
      <Link href="/home" className={buttonVariants({})}>
        Go home
      </Link>
    </div>
  );
}
