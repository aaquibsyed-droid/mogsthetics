import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Mark: a single glazed pearl, with the wordmark. */
export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="glaze inline-block size-6 rounded-full" />
      {withWord ? (
        <span className="text-[17px] font-display font-semibold leading-none tracking-[0.02em] uppercase text-ink">{BRAND.name}</span>
      ) : null}
    </span>
  );
}
