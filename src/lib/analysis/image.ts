import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { AppError } from "@/lib/errors";

/**
 * Stage A — image ingestion.
 * - Validates real image content (decoded by libvips, not trusted from the
 *   file extension or Content-Type).
 * - Applies EXIF orientation, then strips all metadata (including GPS).
 * - Resizes to ≤ 1568 px on the long edge (enough detail for vision models,
 *   smaller uploads and storage).
 * - Computes simple quality signals: mean brightness and Laplacian variance
 *   (a standard sharpness heuristic). These are heuristics, so they produce
 *   warnings the user can override — only near-blank images are blocked.
 */
export const IMAGE_LIMITS = {
  maxBytes: 12 * 1024 * 1024,
  minShortSide: 200,
  maxInputPixels: 50_000_000,
  outputLongEdge: 1568,
  maxImagesPerMeal: 4,
  /** Total multipart upload size (serverless platforms cap request bodies ~4.5 MB; the client downsizes photos first). */
  maxUploadBytes: 4 * 1024 * 1024,
} as const;

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "heif", "gif", "tiff"]);

export interface ImageQuality {
  brightness: number;
  sharpness: number;
  contrast: number;
  issues: Array<"too_dark" | "overexposed" | "blurry" | "low_contrast" | "low_resolution">;
  blocking: boolean;
  advice: string[];
}

export interface ProcessedImage {
  jpeg: Buffer;
  width: number;
  height: number;
  sha256: string;
  quality: ImageQuality;
}

export const QUALITY_THRESHOLDS = {
  darkMean: 45,
  blockingDarkMean: 12,
  brightMean: 240,
  blurryLaplacianVariance: 30,
  lowContrastStdev: 18,
  blockingContrastStdev: 4,
} as const;

export async function assessQuality(img: Buffer): Promise<ImageQuality> {
  const grey = sharp(img).greyscale().resize(512, 512, { fit: "inside" });
  const stats = await grey.clone().stats();
  const brightness = stats.channels[0].mean;
  const contrast = stats.channels[0].stdev;
  const { data } = await grey
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] - 128;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / data.length;
  const sharpness = sumSq / data.length - mean * mean;

  const issues: ImageQuality["issues"] = [];
  const advice: string[] = [];
  if (brightness < QUALITY_THRESHOLDS.darkMean) {
    issues.push("too_dark");
    advice.push("The photo looks dark. Try more light or turn off night mode.");
  }
  if (brightness > QUALITY_THRESHOLDS.brightMean) {
    issues.push("overexposed");
    advice.push("The photo looks washed out. Avoid direct glare on the plate.");
  }
  if (sharpness < QUALITY_THRESHOLDS.blurryLaplacianVariance) {
    issues.push("blurry");
    advice.push("The photo may be blurry. Hold steady and tap to focus on the food.");
  }
  if (contrast < QUALITY_THRESHOLDS.lowContrastStdev) {
    issues.push("low_contrast");
    advice.push("It's hard to make out details. Make sure the food fills most of the frame.");
  }
  const blocking = brightness < QUALITY_THRESHOLDS.blockingDarkMean || contrast < QUALITY_THRESHOLDS.blockingContrastStdev;
  return { brightness: Math.round(brightness), sharpness: Math.round(sharpness), contrast: Math.round(contrast), issues, blocking, advice };
}

export async function processMealImage(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength > IMAGE_LIMITS.maxBytes) throw new AppError("payload_too_large", "Images must be 12 MB or smaller.");
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: IMAGE_LIMITS.maxInputPixels }).metadata();
  } catch {
    throw new AppError("unsupported_media_type", "That file isn't an image we can read. Use a JPEG, PNG or WebP photo.");
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new AppError("unsupported_media_type", "Unsupported image format. Use a JPEG, PNG or WebP photo.");
  }
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (Math.min(w, h) < IMAGE_LIMITS.minShortSide) {
    throw new AppError(
      "image_quality",
      `The image is too small (${w}×${h}). Use a photo at least ${IMAGE_LIMITS.minShortSide}px on its shortest side.`,
    );
  }

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels: IMAGE_LIMITS.maxInputPixels, animated: false })
      .rotate() // apply EXIF orientation
      .resize(IMAGE_LIMITS.outputLongEdge, IMAGE_LIMITS.outputLongEdge, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true }) // metadata is dropped unless withMetadata() is called
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError("unsupported_media_type", "We couldn't process that image. Try exporting it as JPEG.");
  }
  const quality = await assessQuality(out.data);
  return {
    jpeg: out.data,
    width: out.info.width,
    height: out.info.height,
    sha256: createHash("sha256").update(out.data).digest("hex"),
    quality,
  };
}
