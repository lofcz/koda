import {
  clamp,
  dimensions,
  inverse,
  MAX_DIMENSION,
  MAX_PIXELS,
  multiply,
  scale,
  transform,
  transformDocument,
  translate,
} from './model';
import type { ImageDocument, Matrix, Point, Rect } from './model';

export type CropSize = { width: number; height: number };
export type CropSource = CropSize & { matrix: Matrix };
export type CropPreset = {
  id: string;
  label: string;
  group?: string;
  aspectRatio?: number | null;
  /** Output size, applied with its matching aspect ratio when the crop is committed. */
  size?: CropSize;
  /** Viewport-only overlay to show while this preset is active; the host option applies when omitted. */
  overlay?: CropOverlay;
  /** Print guides to show while this preset is active; `null` hides host guides. */
  bleed?: CropBleed | null;
};
/** Viewport-only crop overlay. `circle` dims everything outside the ellipse inscribed in the crop. */
export type CropOverlay = 'none' | 'circle';
/**
 * Print guides drawn inside the crop, never exported. The crop is the full printed sheet:
 * `bleed` is the inset from the crop edge to the trim line, `safe` the further inset from the
 * trim line to the safe area. `px` values are output pixels; `fraction` values are fractions
 * of the shorter output side.
 */
export type CropBleed = {
  bleed?: number;
  safe?: number;
  unit?: 'px' | 'fraction';
};
export type ResolvedCropBleed = Required<CropBleed>;
export type CropGuides =
  | 'none'
  | 'thirds'
  | 'grid'
  | 'diagonals'
  | {
      /** Guide positions as fractions strictly between zero and one. */
      columns: readonly number[];
      rows: readonly number[];
    };
export type CropOptions = {
  interactionFocus?: 'image' | 'selection';
  allowOutsideImage?: boolean;
  /** Show the interactive source-boundary toggle. */
  enableLimitToggle?: boolean;
  /** A non-null host ratio is required and overrides user-selected presets. */
  aspectRatio?: number | null;
  minSize?: CropSize;
  maxSize?: CropSize;
  presets?: readonly CropPreset[];
  guides?: CropGuides;
  maskOpacity?: number;
  handleStyle?: 'circle' | 'hook' | 'invisible';
  showSize?: boolean;
  enableZoom?: boolean;
  enableRotation?: boolean;
  /** Positive and negative straightening limits in degrees. */
  rotationRange?: number;
  /** Viewport-only profile overlay; never part of exported pixels. */
  overlay?: CropOverlay;
  /** Viewport-only print bleed and safe-area guides; never part of exported pixels. */
  bleed?: CropBleed | null;
};
export type ResolvedCropOptions = Required<
  Omit<CropOptions, 'presets' | 'bleed'>
> &
  Pick<CropOptions, 'presets'> & { bleed: ResolvedCropBleed | null };
export type CropIntent = {
  aspectRatio?: number | null;
  axis?: 'width' | 'height';
  /** Fractional point within the proposed rectangle to keep fixed during resize. */
  anchor?: Point;
};
export class CropConstraintError extends Error {
  constructor(message = 'Crop constraints cannot be satisfied') {
    super(message);
    this.name = 'CropConstraintError';
  }
}
const numeric = (
  value: unknown,
  min: number,
  max: number,
  fallback?: number
): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new CropConstraintError('Invalid crop number');
  return value;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CropConstraintError('Invalid crop options');
  return value as Record<string, unknown>;
};
const choice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T
): T => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !choices.includes(value as T))
    throw new CropConstraintError('Invalid crop option');
  return value as T;
};
const flag = (value: unknown, fallback: boolean) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean')
    throw new CropConstraintError('Invalid crop flag');
  return value;
};
const ratio = (value: unknown): number | null =>
  value == null ? null : numeric(value, 1 / MAX_DIMENSION, MAX_DIMENSION);
const size = (value: unknown, fallback: CropSize): CropSize => {
  if (value === undefined) return { ...fallback };
  const input = object(value);
  return {
    width: numeric(input.width, 1, MAX_DIMENSION),
    height: numeric(input.height, 1, MAX_DIMENSION),
  };
};
const overlay = (value: unknown, fallback: CropOverlay) =>
  choice(value, ['none', 'circle'] as const, fallback);
/** Validate print guides; `undefined` and `null` both mean no guides. */
export function parseCropBleed(value: unknown): ResolvedCropBleed | null {
  if (value == null) return null;
  const input = object(value),
    unit = choice(input.unit, ['px', 'fraction'] as const, 'px'),
    limit = unit === 'px' ? MAX_DIMENSION / 2 : 0.5,
    bleed = numeric(input.bleed, 0, limit, 0),
    safe = numeric(input.safe, 0, limit, 0);
  if (unit === 'fraction' && bleed + safe >= 0.5)
    throw new CropConstraintError('Invalid crop bleed');
  return { bleed, safe, unit };
}
const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512)
    throw new CropConstraintError('Invalid crop preset label');
  return value;
};

/** Validate public configuration without changing the current document or crop draft. */
export function parseCropOptions(value: unknown = {}): ResolvedCropOptions {
  const input = object(value),
    minSize = size(input.minSize, { width: 1, height: 1 }),
    maxSize = size(input.maxSize, {
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
    }),
    aspectRatio = ratio(input.aspectRatio);
  minSize.width = Math.ceil(minSize.width);
  minSize.height = Math.ceil(minSize.height);
  maxSize.width = Math.floor(maxSize.width);
  maxSize.height = Math.floor(maxSize.height);
  if (
    minSize.width > maxSize.width ||
    minSize.height > maxSize.height ||
    minSize.width * minSize.height > MAX_PIXELS
  )
    throw new CropConstraintError();
  if (
    aspectRatio &&
    Math.max(minSize.height, minSize.width / aspectRatio) >
      Math.min(
        maxSize.height,
        maxSize.width / aspectRatio,
        Math.sqrt(MAX_PIXELS / aspectRatio)
      )
  )
    throw new CropConstraintError();
  let guides: CropGuides = 'thirds';
  if (input.guides !== undefined) {
    if (typeof input.guides === 'string')
      guides = choice(
        input.guides,
        ['none', 'thirds', 'grid', 'diagonals'] as const,
        'thirds'
      );
    else {
      const settings = object(input.guides);
      const stops = (value: unknown) => {
        if (!Array.isArray(value) || value.length > 32)
          throw new CropConstraintError('Invalid crop guides');
        return [
          ...new Set(
            value.map((n) => numeric(n, Number.EPSILON, 1 - Number.EPSILON))
          ),
        ].sort((a, b) => a - b);
      };
      guides = { columns: stops(settings.columns), rows: stops(settings.rows) };
    }
  }
  let presets: CropPreset[] | undefined;
  if (input.presets !== undefined) {
    if (!Array.isArray(input.presets) || input.presets.length > 200)
      throw new CropConstraintError('Invalid crop presets');
    const ids = new Set<string>();
    presets = input.presets.map((raw) => {
      const preset = object(raw),
        id = label(preset.id);
      if (ids.has(id)) throw new CropConstraintError('Duplicate crop preset');
      ids.add(id);
      const result: CropPreset = { id, label: label(preset.label) };
      if (preset.group !== undefined) result.group = label(preset.group);
      if (preset.size !== undefined) {
        result.size = dimensions(
          size(preset.size, minSize).width,
          size(preset.size, minSize).height
        );
        result.aspectRatio = result.size.width / result.size.height;
        if (
          preset.aspectRatio != null &&
          Math.abs(ratio(preset.aspectRatio)! - result.aspectRatio) > 1e-9
        )
          throw new CropConstraintError('Crop preset size and ratio disagree');
      } else result.aspectRatio = ratio(preset.aspectRatio);
      if (preset.overlay !== undefined)
        result.overlay = overlay(preset.overlay, 'none');
      if (preset.bleed !== undefined)
        result.bleed = parseCropBleed(preset.bleed);
      return result;
    });
  }
  return {
    interactionFocus: choice(
      input.interactionFocus,
      ['image', 'selection'],
      'selection'
    ),
    allowOutsideImage: flag(input.allowOutsideImage, false),
    enableLimitToggle: flag(input.enableLimitToggle, false),
    aspectRatio,
    minSize,
    maxSize,
    presets,
    guides,
    maskOpacity: numeric(input.maskOpacity, 0, 1, 0.75),
    handleStyle: choice(
      input.handleStyle,
      ['circle', 'hook', 'invisible'],
      'circle'
    ),
    showSize: flag(input.showSize, true),
    enableZoom: flag(input.enableZoom, true),
    enableRotation: flag(input.enableRotation, true),
    rotationRange: numeric(input.rotationRange, 0, 180, 45),
    overlay: overlay(input.overlay, 'none'),
    bleed: parseCropBleed(input.bleed),
  };
}

/**
 * Straightening angle of an affine source in degrees: the tilt of its x axis with quarter turns
 * removed. Flips need no special case because a reflection keeps the axis line. Among the
 * equivalent angles within `range`, the one closest to `hint` wins, so a host range above 45°
 * keeps showing the angle the user chose.
 */
export function straightenAngle(matrix: Matrix, range = 45, hint = 0): number {
  validSource({ width: 1, height: 1, matrix });
  const tilt = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI,
    nearest = tilt - 90 * Math.round((tilt - hint) / 90),
    candidates = [nearest - 90, nearest, nearest + 90].filter(
      (angle) => Math.abs(angle) <= range + 1e-6
    );
  const angle = candidates.length
    ? candidates.reduce((best, angle) =>
        Math.abs(angle - hint) < Math.abs(best - hint) ? angle : best
      )
    : tilt - 90 * Math.round(tilt / 90);
  const rounded = Math.round(angle * 1e6) / 1e6;
  return Math.abs(rounded) > range ? Math.sign(rounded) * range : rounded || 0;
}

/** Bleed and safe-area insets in crop units, one per axis, clamped inside the crop. */
export function cropBleedInsets(
  crop: CropSize,
  output: CropSize,
  bleed: ResolvedCropBleed
): { bleed: Point; safe: Point } {
  const shorter = Math.min(output.width, output.height),
    toCrop = (value: number): Point => {
      const px = bleed.unit === 'fraction' ? value * shorter : value;
      return {
        x: Math.min(crop.width / 2, (px * crop.width) / output.width),
        y: Math.min(crop.height / 2, (px * crop.height) / output.height),
      };
    };
  return { bleed: toCrop(bleed.bleed), safe: toCrop(bleed.bleed + bleed.safe) };
}

/** Move a crop so its center matches the transformed source center, keeping its size when possible. */
export function centerCropOnSource(
  rect: Rect,
  source: CropSource,
  settings: CropOptions = {},
  intent: CropIntent = {}
): Rect {
  validRect(rect);
  validSource(source);
  const center = transform(source.matrix, {
    x: source.width / 2,
    y: source.height / 2,
  });
  return constrainCropRect(
    {
      ...rect,
      x: center.x - rect.width / 2,
      y: center.y - rect.height / 2,
    },
    source,
    settings,
    { aspectRatio: intent.aspectRatio }
  );
}

function validSource(source: CropSource) {
  numeric(source.width, Number.EPSILON, 1e7);
  numeric(source.height, Number.EPSILON, 1e7);
  if (
    !Array.isArray(source.matrix) ||
    source.matrix.length !== 6 ||
    source.matrix.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e8)
  )
    throw new CropConstraintError('Invalid crop source transform');
  try {
    return inverse(source.matrix);
  } catch {
    throw new CropConstraintError('Invalid crop source transform');
  }
}
function validRect(rect: Rect) {
  numeric(rect.x, -1e8, 1e8);
  numeric(rect.y, -1e8, 1e8);
  numeric(rect.width, Number.EPSILON, 1e8);
  numeric(rect.height, Number.EPSILON, 1e8);
}
const corners = (rect: Rect): Point[] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
];
function bounds(points: readonly Point[]): Rect {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function sourceBounds(source: CropSource): Rect {
  validSource(source);
  return bounds(
    corners({ x: 0, y: 0, ...source }).map((point) =>
      transform(source.matrix, point)
    )
  );
}
export function sourceContainsRect(
  source: CropSource,
  crop: Rect,
  tolerance = 1e-7
): boolean {
  const inverted = validSource(source);
  validRect(crop);
  return corners(crop).every((point) => {
    const local = transform(inverted, point);
    return (
      local.x >= -tolerance &&
      local.y >= -tolerance &&
      local.x <= source.width + tolerance &&
      local.y <= source.height + tolerance
    );
  });
}

/** Minimum uniform zoom and source-axis translation that make the affine source cover the crop. */
export function constrainImageToCrop(
  matrix: Matrix,
  sourceSize: CropSize,
  crop: Rect,
  allowOutside = false
): Matrix {
  let inverted = validSource({ ...sourceSize, matrix });
  validRect(crop);
  if (allowOutside) return matrix;
  let local = bounds(corners(crop).map((point) => transform(inverted, point)));
  const factor = Math.max(
    1,
    local.width / sourceSize.width,
    local.height / sourceSize.height
  );
  let result = matrix;
  if (factor > 1 + 1e-12) {
    const center = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
    result = multiply(
      multiply(
        translate(center.x, center.y),
        multiply(scale(factor), translate(-center.x, -center.y))
      ),
      result
    );
    inverted = inverse(result);
    local = bounds(corners(crop).map((point) => transform(inverted, point)));
  }
  const x = clamp(0, local.x + local.width - sourceSize.width, local.x),
    y = clamp(0, local.y + local.height - sourceSize.height, local.y);
  return Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9
    ? result
    : multiply(result, translate(x, y));
}

/** Move image pixels and their annotations together under a fixed crop viewport. */
export function transformImage(
  doc: ImageDocument,
  matrix: Matrix
): ImageDocument {
  validSource({ width: 1, height: 1, matrix });
  if (matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index]))
    return doc;
  return {
    ...doc,
    imageMatrix: multiply(matrix, doc.imageMatrix),
    layers: doc.layers.map((layer) => ({
      ...layer,
      matrix: multiply(matrix, layer.matrix),
    })),
  };
}

type Limit = { a: number; b: number; c: number };
function clipPolygon(points: Point[], { a, b, c }: Limit): Point[] {
  const output: Point[] = [];
  for (let index = 0; index < points.length; index++) {
    const from = points[index],
      to = points[(index + 1) % points.length];
    const first = a * from.x + b * from.y - c,
      second = a * to.x + b * to.y - c;
    if (first <= 1e-9) output.push(from);
    if (first <= 1e-9 !== second <= 1e-9) {
      const t = first / (first - second);
      output.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }
  return output;
}
function nearestSize(
  point: Point,
  options: ResolvedCropOptions,
  limits: Limit[]
): CropSize {
  const { minSize: min, maxSize: max } = options;
  let polygon = corners({
    x: min.width,
    y: min.height,
    width: max.width - min.width,
    height: max.height - min.height,
  });
  for (const limit of limits) polygon = clipPolygon(polygon, limit);
  if (!polygon.length) throw new CropConstraintError();
  const inside =
    point.x >= min.width &&
    point.x <= max.width &&
    point.y >= min.height &&
    point.y <= max.height &&
    limits.every(({ a, b, c }) => a * point.x + b * point.y <= c + 1e-9);
  let closest = inside ? point : polygon[0],
    distance = inside ? 0 : Infinity;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index],
      end = polygon[(index + 1) % polygon.length],
      dx = end.x - start.x,
      dy = end.y - start.y;
    const t =
      dx || dy
        ? clamp(
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              (dx * dx + dy * dy),
            0,
            1
          )
        : 0;
    const candidate = { x: start.x + t * dx, y: start.y + t * dy },
      nextDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (nextDistance < distance) {
      closest = candidate;
      distance = nextDistance;
    }
  }
  let width = closest.x,
    height = closest.y;
  if (width * height > MAX_PIXELS) {
    const factor = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.max(min.width, width * factor);
    height = Math.max(min.height, height * factor);
    if (width * height > MAX_PIXELS) {
      if (width === min.width) height = MAX_PIXELS / width;
      else width = MAX_PIXELS / height;
    }
  }
  return { width, height };
}

/** One constraint path for pointer gestures, number fields and the final commit. */
export function constrainCropRect(
  rect: Rect,
  source: CropSource,
  settings: CropOptions = {},
  intent: CropIntent = {}
): Rect {
  validRect(rect);
  const inverted = validSource(source),
    options = parseCropOptions(settings),
    aspect = options.aspectRatio ?? ratio(intent.aspectRatio);
  const fraction = intent.anchor;
  if (fraction) {
    numeric(fraction.x, 0, 1);
    numeric(fraction.y, 0, 1);
  }
  const anchor = fraction && {
    x: rect.x + rect.width * fraction.x,
    y: rect.y + rect.height * fraction.y,
  };
  const limits: Limit[] = [];
  if (!options.allowOutsideImage) {
    if (anchor && fraction) {
      const local = transform(inverted, anchor);
      if (
        local.x < -1e-7 ||
        local.x > source.width + 1e-7 ||
        local.y < -1e-7 ||
        local.y > source.height + 1e-7
      )
        throw new CropConstraintError();
      for (const point of [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]) {
        const dx = point.x - fraction.x,
          dy = point.y - fraction.y;
        limits.push(
          {
            a: inverted[0] * dx,
            b: inverted[2] * dy,
            c: source.width - local.x,
          },
          { a: -inverted[0] * dx, b: -inverted[2] * dy, c: local.x },
          {
            a: inverted[1] * dx,
            b: inverted[3] * dy,
            c: source.height - local.y,
          },
          { a: -inverted[1] * dx, b: -inverted[3] * dy, c: local.y }
        );
      }
    } else
      limits.push(
        { a: Math.abs(inverted[0]), b: Math.abs(inverted[2]), c: source.width },
        { a: Math.abs(inverted[1]), b: Math.abs(inverted[3]), c: source.height }
      );
  }
  let width: number, height: number;
  if (aspect) {
    let min = Math.max(options.minSize.height, options.minSize.width / aspect),
      max = Math.min(
        options.maxSize.height,
        options.maxSize.width / aspect,
        Math.sqrt(MAX_PIXELS / aspect)
      );
    for (const { a, b, c } of limits) {
      const coefficient = a * aspect + b;
      if (coefficient > 1e-14) max = Math.min(max, c / coefficient);
      else if (coefficient < -1e-14) min = Math.max(min, c / coefficient);
      else if (c < -1e-9) throw new CropConstraintError();
    }
    if (max < min - 1e-7) throw new CropConstraintError();
    height = clamp(
      intent.axis === 'height'
        ? rect.height
        : intent.axis === 'width'
          ? rect.width / aspect
          : Math.min(rect.height, rect.width / aspect),
      min,
      Math.max(min, max)
    );
    width = height * aspect;
  } else
    ({ width, height } = nearestSize(
      { x: rect.width, y: rect.height },
      options,
      limits
    ));
  let result = {
    x:
      anchor && fraction
        ? anchor.x - width * fraction.x
        : rect.x + (rect.width - width) / 2,
    y:
      anchor && fraction
        ? anchor.y - height * fraction.y
        : rect.y + (rect.height - height) / 2,
    width,
    height,
  };
  if (!options.allowOutsideImage && !anchor) {
    const local = bounds(
      corners(result).map((point) => transform(inverted, point))
    );
    const x = clamp(0, -local.x, source.width - local.x - local.width),
      y = clamp(0, -local.y, source.height - local.y - local.height);
    result = {
      ...result,
      x: result.x + source.matrix[0] * x + source.matrix[2] * y,
      y: result.y + source.matrix[1] * x + source.matrix[3] * y,
    };
  }
  return result;
}

/** Preserve fractional crop geometry; only the final output dimensions are quantized to pixels. */
export function cropOutputSize(
  crop: CropSize,
  settings: CropOptions = {}
): CropSize {
  const options = parseCropOptions(settings),
    min = options.minSize,
    max = options.maxSize;
  let width = clamp(
      Math.round(numeric(crop.width, 1, MAX_DIMENSION)),
      min.width,
      max.width
    ),
    height = clamp(
      Math.round(numeric(crop.height, 1, MAX_DIMENSION)),
      min.height,
      max.height
    );
  if (width * height > MAX_PIXELS) {
    const candidates = [
      { width: Math.floor(MAX_PIXELS / height), height },
      { width, height: Math.floor(MAX_PIXELS / width) },
    ].filter((item) => item.width >= min.width && item.height >= min.height);
    if (!candidates.length) throw new CropConstraintError();
    candidates.sort(
      (a, b) =>
        Math.hypot(
          (a.width - crop.width) / crop.width,
          (a.height - crop.height) / crop.height
        ) -
        Math.hypot(
          (b.width - crop.width) / crop.width,
          (b.height - crop.height) / crop.height
        )
    );
    ({ width, height } = candidates[0]);
  }
  return dimensions(width, height);
}

export function applyCrop(
  doc: ImageDocument,
  rect: Rect,
  sourceSize: CropSize,
  settings: CropOptions = {},
  intent: CropIntent = {}
): ImageDocument {
  const crop = constrainCropRect(
      rect,
      { ...sourceSize, matrix: doc.imageMatrix },
      settings,
      intent
    ),
    output = cropOutputSize(crop, settings);
  if (
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === doc.width &&
    crop.height === doc.height
  )
    return doc;
  return transformDocument(
    doc,
    multiply(
      scale(output.width / crop.width, output.height / crop.height),
      translate(-crop.x, -crop.y)
    ),
    output.width,
    output.height
  );
}
