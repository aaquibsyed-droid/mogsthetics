import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Mark: a single glazed pearl. Wordmark: lowercase, quiet. */
export function Logo({ className, withWord = true }: { className?: string; withWord?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="glaze inline-block size-6 rounded-full" />
      {withWord ? (
        <span className="text-[17px] font-medium lowercase leading-none tracking-[-0.03em] text-ink">{BRAND.shortName}</span>
      ) : null}
    </span>
  );
}
