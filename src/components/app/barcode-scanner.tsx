"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";

/** Camera barcode scanning (EAN/UPC) with a manual-entry fallback. */
export function BarcodeScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera isn't available here. Type the barcode instead.");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (result) => {
          if (result && !cancelled) {
            const text = result.getText();
            if (/^[0-9]{6,14}$/.test(text)) {
              cancelled = true;
              controls.stop();
              onDetected(text);
            }
          }
        });
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch {
        setError("Couldn't start the camera. Allow camera access or type the barcode instead.");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onDetected]);

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice tone="warn">{error}</Notice>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={video}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            aria-label="Camera preview for barcode scanning"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent shadow-[0_0_12px_var(--accent)]"
          />
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[0-9]{6,14}$/.test(manual.trim())) onDetected(manual.trim());
          else setError("Barcodes are 6–14 digits.");
        }}
      >
        <Field label="Or type the barcode" htmlFor="barcode" className="flex-1">
          <Input id="barcode" inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button type="submit">Look up</Button>
      </form>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Back
      </Button>
      <p className="text-xs text-ink-faint">
        Product data from Open Food Facts (ODbL) — contributor-entered label values; check them against your package.
      </p>
    </div>
  );
}
