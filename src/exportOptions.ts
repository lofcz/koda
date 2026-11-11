import { dimensions, MAX_DIMENSION, type Rect } from './model';

export interface ImageExportOptions {
  /** Defaults to PNG, preserving transparency. JPEG defaults to a white background. */
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Lossy encoder quality from 0 to 1. Ignored by PNG. */
  quality?: number;
  /** Omitting either dimension preserves the document aspect ratio. */
  width?: number;
  height?: number;
  background?: string;
  /** Force preserves the original explicit width/height behavior. */
  fit?: 'contain' | 'cover' | 'force';
  /** Defaults to true. False limits resizing to the original pixel resolution. */
  upscale?: boolean;
  resampling?: 'high' | 'pixelated';
  /** JPEG EXIF is preserved by default, with orientation/dimensions corrected and embedded previews removed. */
  metadata?: 'preserve' | 'strip';
}

/** Validate output settings identically in the browser and on the server. */
export function parseExportOptions(input: unknown = {}): ImageExportOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid image export options');
  const v = input as Record<string, unknown>,
    result: ImageExportOptions = {};
  const type = v.type ?? 'image/png';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type as string))
    throw new Error('Unsupported image format');
  result.type = type as ImageExportOptions['type'];
  if (v.quality !== undefined) {
    if (
      typeof v.quality !== 'number' ||
      !Number.isFinite(v.quality) ||
      v.quality < 0 ||
      v.quality > 1
    )
      throw new Error('Invalid image quality');
    result.quality = v.quality;
  }
  for (const key of ['width', 'height'] as const) {
    if (v[key] === undefined) continue;
    if (
      typeof v[key] !== 'number' ||
      !Number.isFinite(v[key]) ||
      v[key] < 1 ||
      v[key] > MAX_DIMENSION
    )
      throw new Error('Invalid image dimensions');
    result[key] = Math.round(v[key]);
  }
  dimensions(result.width ?? 1, result.height ?? 1);
  if (v.background !== undefined) {
    if (typeof v.background !== 'string' || v.background.length > 256)
      throw new Error('Invalid export background');
    result.background = v.background;
  }
  if (v.fit !== undefined) {
    if (!['contain', 'cover', 'force'].includes(v.fit as string))
      throw new Error('Invalid export fit');
    result.fit = v.fit as ImageExportOptions['fit'];
  }
  if (v.upscale !== undefined) {
    if (typeof v.upscale !== 'boolean')
      throw new Error('Invalid export upscale setting');
    result.upscale = v.upscale;
  }
  if (v.resampling !== undefined) {
    if (!['high', 'pixelated'].includes(v.resampling as string))
      throw new Error('Invalid image resampling');
    result.resampling = v.resampling as ImageExportOptions['resampling'];
  }
  if (v.metadata !== undefined) {
    if (!['preserve', 'strip'].includes(v.metadata as string))
      throw new Error('Invalid image metadata setting');
    result.metadata = v.metadata as ImageExportOptions['metadata'];
  }
  return result;
}

export function resolveExportSize(
  source: { width: number; height: number },
  input: ImageExportOptions = {}
) {
  const options = parseExportOptions(input),
    fit = options.fit ?? 'force';
  let width =
      options.width ??
      (options.height === undefined
        ? source.width
        : (source.width * options.height) / source.height),
    height =
      options.height ??
      (options.width === undefined
        ? source.height
        : (source.height * options.width) / source.width);
  let sourceRect: Rect = { x: 0, y: 0, ...source };
  if (fit === 'contain') {
    const ratio = Math.min(
      width / source.width,
      height / source.height,
      options.upscale === false ? 1 : Infinity
    );
    width = source.width * ratio;
    height = source.height * ratio;
  } else {
    if (options.upscale === false) {
      const reduction = Math.max(
        1,
        width / source.width,
        height / source.height
      );
      width /= reduction;
      height /= reduction;
    }
    if (fit === 'cover') {
      const ratio = Math.max(width / source.width, height / source.height);
      sourceRect = {
        x: (source.width - width / ratio) / 2,
        y: (source.height - height / ratio) / 2,
        width: width / ratio,
        height: height / ratio,
      };
    }
  }
  return { ...dimensions(Math.max(1, width), Math.max(1, height)), sourceRect };
}
