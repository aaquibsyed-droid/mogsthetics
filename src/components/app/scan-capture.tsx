"use client";

import { uid } from "@/lib/client/uid";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, ImagePlus, Loader2, PencilLine, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { guessMealType, MEAL_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Session {
  idempotencyKey: string;
  available: boolean;
  isMock: boolean;
  maxImages: number;
  maxTotalBytes: number;
  quota: { limit: number; used: number; remaining: number };
}

interface Shot {
  id: string;
  blob: Blob;
  url: string;
  name: string;
}

const MAX_EDGE = 1600;

/** Downscales on-device before upload (faster, cheaper, keeps uploads under platform limits). EXIF is not carried over by canvas. */
/** Decodes with createImageBitmap, or an <img> element where that fails (older iOS Safari, some HEIC). */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
}

async function downscale(file: File): Promise<Blob> {
  try {
    const img = await decode(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    img.done();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file; // the server validates and rejects undecodable photos with a clear message
  }
}

const QUALITY_TEXT: Record<string, string> = {
  too_dark: "too dark",
  overexposed: "washed out",
  blurry: "blurry",
  low_contrast: "hard to make out",
  low_resolution: "low resolution",
};

export function ScanCapture() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [note, setNote] = useState("");
  const [refObject, setRefObject] = useState("none");
  const [known, setKnown] = useState<Array<{ name: string; grams: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<{ message: string; issues: string[]; canOverride: boolean } | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Session>("/api/analyses/session", { body: {} })
      .then(setSession)
      .catch((e) => setSessionError(errorMessage(e)));
  }, []);

  const shotsRef = useRef<Shot[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const max = session?.maxImages ?? 4;
      const list = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      if (!list.length) return toast.error("Choose a photo (JPEG, PNG or WebP).");
      const room = max - shots.length;
      if (room <= 0) return toast.error(`Up to ${max} photos per meal.`);
      const next: Shot[] = [];
      for (const f of list.slice(0, room)) {
        const blob = await downscale(f);
        next.push({ id: uid(), blob, url: URL.createObjectURL(blob), name: f.name });
      }
      setShots((s) => [...s, ...next]);
      if (list.length > room) toast.message(`Only ${max} photos per meal are used.`);
    },
    [session, shots.length],
  );

  async function analyze(override = false) {
    if (!session || !shots.length) return;
    const total = shots.reduce((s, x) => s + x.blob.size, 0);
    if (total > session.maxTotalBytes) return toast.error("Photos are too large together. Remove one and try again.");
    setBusy(true);
    setQuality(null);
    const form = new FormData();
    shots.forEach((s, i) => form.append("images", s.blob, `photo-${i + 1}.jpg`));
    form.append("idempotencyKey", session.idempotencyKey);
    form.append(
      "context",
      JSON.stringify({
        mealType,
        note: note.trim() || undefined,
        referenceObject: refObject,
        knownWeights: known
          .filter((k) => k.name.trim() && Number(k.grams) > 0)
          .map((k) => ({ name: k.name.trim(), grams: Number(k.grams) })),
        analyzeDespiteQuality: override,
      }),
    );
    // Never spin forever: give up on a stalled upload after 60 s.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await api<{ id: string }>("/api/analyses", { form, signal: ctrl.signal });
      router.push(`/scan/${res.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.error("The upload is taking too long. Check your connection and try again.");
        return;
      }
      if (e instanceof ApiError && e.code === "image_quality") {
        const d = e.details as { quality?: { issues?: string[] }; canOverride?: boolean } | undefined;
        setQuality({ message: e.message, issues: d?.quality?.issues ?? [], canOverride: !!d?.canOverride });
        return;
      }
      toast.error(errorMessage(e));
      if (e instanceof ApiError && (e.code === "ai_unavailable" || e.code === "quota_exceeded")) setSessionError(e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  const unavailable = sessionError || (session && (!session.available || session.quota.remaining <= 0));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-4">
        {session?.isMock ? (
          <Notice tone="warn" title="Development mock active">
            No AI provider is configured, so results are a fixed example meal — the photo is not examined. For free real analysis, run
            Ollama locally or add a free Gemini key (see docs/NEXT-STEPS.md).
          </Notice>
        ) : null}
        {unavailable ? (
          <Notice
            tone="warn"
            title="Photo analysis isn't available right now"
            action={
              <Link href="/diary/new" className={buttonVariants({ size: "sm", variant: "outline" })}>
                <PencilLine /> Log manually
              </Link>
            }
          >
            {sessionError ??
              (session && session.quota.remaining <= 0
                ? `You've used all ${session.quota.limit} photo scans for today. They refresh tomorrow — you can still log by typing.`
                : "Photo scanning is taking a quick break. You can log this meal by typing it instead.")}
          </Notice>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "relative flex min-h-72 flex-col items-center justify-center gap-4 overflow-hidden rounded-[20px] border-2 border-dashed p-6 text-center transition-colors",
            dragOver ? "border-primary bg-tint" : "border-rule bg-surface",
          )}
        >
          {shots.length === 0 ? (
            <>
              <div className="glaze grid size-16 place-items-center rounded-full">
                <Camera className="size-7" />
              </div>
              <div>
                <p className="label-head text-xl">Photograph your meal</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
                  Shoot from slightly above with the whole plate in frame. A fork or card next to the plate helps with size.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" variant="accent" size="lg" onClick={() => cameraInput.current?.click()}>
                  <Camera /> Take photo
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => galleryInput.current?.click()}>
                  <ImagePlus /> Upload
                </Button>
              </div>
              <p className="hidden text-xs text-ink-faint sm:block">or drop images here</p>
            </>
          ) : (
            <div className="grid w-full grid-cols-2 gap-3">
              {shots.map((s, i) => (
                <figure key={s.id} className="group relative overflow-hidden rounded-xl bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={s.url} alt={`Meal photo ${i + 1}`} className="aspect-square w-full object-cover" />
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      type="button"
                      aria-label={`Replace photo ${i + 1}`}
                      className="grid size-8 place-items-center rounded-full bg-black/60 text-white"
                      onClick={() => {
                        setShots((x) => x.filter((y) => y.id !== s.id));
                        cameraInput.current?.click();
                      }}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      className="grid size-8 place-items-center rounded-full bg-black/60 text-white"
                      onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </figure>
              ))}
              {shots.length < (session?.maxImages ?? 4) ? (
                <button
                  type="button"
                  onClick={() => galleryInput.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rule text-sm text-ink-soft hover:bg-surface-2"
                >
                  <Plus className="size-5" /> Add another angle
                </button>
              ) : null}
            </div>
          )}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Take a photo"
            onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ""))}
          />
          <input
            ref={galleryInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Upload meal photos"
            data-testid="photo-input"
            onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ""))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Meal" htmlFor="scan-meal">
          <Select id="scan-meal" value={mealType} onChange={(e) => setMealType(e.target.value)}>
            {Object.entries(MEAL_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {k === "snack" ? "Snack" : v}
              </option>
            ))}
          </Select>
        </Field>
        <details className="rounded-xl border border-rule bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Improve accuracy (optional)</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="What's in the photo for scale?" htmlFor="ref">
              <Select id="ref" value={refObject} onChange={(e) => setRefObject(e.target.value)}>
                <option value="none">Nothing in particular</option>
                <option value="standard_dinner_plate_27cm">A standard dinner plate (~27 cm)</option>
                <option value="fork">A fork</option>
                <option value="credit_card">A bank card</option>
                <option value="hand">My hand</option>
              </Select>
            </Field>
            <div>
              <p className="mb-1 text-sm font-medium">Known weights</p>
              <p className="mb-2 text-xs text-ink-faint">If you weighed something, add it — it overrides the visual estimate.</p>
              {known.map((k, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <Input
                    aria-label="Food"
                    placeholder="e.g. rice"
                    value={k.name}
                    onChange={(e) => setKnown((s) => s.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <Input
                    aria-label="Grams"
                    placeholder="g"
                    inputMode="decimal"
                    className="w-24"
                    value={k.grams}
                    onChange={(e) => setKnown((s) => s.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    onClick={() => setKnown((s) => s.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setKnown((s) => [...s, { name: "", grams: "" }])}>
                <Plus /> Add a weight
              </Button>
            </div>
            <Field label="Anything the photo can't show?" htmlFor="note" hint="e.g. “cooked in butter”, “no dressing”">
              <Textarea id="note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        </details>
        <Button size="lg" variant="accent" disabled={!shots.length || busy || !session || !!unavailable} onClick={() => analyze(false)}>
          {busy ? <Loader2 className="animate-spin" /> : <Camera />} Analyze {shots.length > 1 ? `${shots.length} photos` : "photo"}
        </Button>
        {session && session.available ? (
          <p className="text-center text-xs text-ink-faint">
            {session.quota.remaining} of {session.quota.limit} analyses left today. Photos are stored privately{" "}
            <Link href="/profile#privacy" className="underline">
              per your retention setting
            </Link>
            .
          </p>
        ) : null}
        <Link href="/diary/new" className={buttonVariants({ variant: "ghost" })}>
          <PencilLine /> Log without a photo
        </Link>
      </div>

      <Dialog open={!!quality} onOpenChange={(o) => !o && setQuality(null)}>
        <DialogContent
          title="Check this photo"
          description={quality?.issues.length ? `It looks ${quality.issues.map((i) => QUALITY_TEXT[i] ?? i).join(" and ")}.` : undefined}
        >
          <p className="text-sm text-ink-soft">{quality?.message}</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setQuality(null);
                setShots([]);
                cameraInput.current?.click();
              }}
            >
              <RotateCcw /> Retake
            </Button>
            {quality?.canOverride ? <Button onClick={() => analyze(true)}>Analyze anyway</Button> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
