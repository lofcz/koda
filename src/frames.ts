import { IMAGE_SOURCE } from './backgrounds';
import type { Frame, ImageDocument } from './model';

export type SliceInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type FrameRepeat = 'stretch' | 'repeat' | 'round';
/**
 * The pixels and 9-slice definition of an image frame, persisted in the
 * document so it restores without the host catalog. `source` is embedded
 * `data:image/...` pixels when chosen in the editor. `sourceWidth/Height`
 * record the pixel size the insets refer to, so insets validate without
 * decoding and still apply if a host URL later serves a resized file.
 */
export type FrameImage = {
  /** Host catalog id, if the frame came from one. Informational only. */
  id?: string;
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Corner sizes in source pixels. Corners never stretch; edges between them stretch or repeat. */
  slice: SliceInsets;
  repeat: FrameRepeat;
};
/** A host-supplied image frame offered in the frame panel. */
export interface ImageEditorFrame {
  id: string;
  label: string;
  url: string;
  /** Insets in source image pixels, or one number for all four sides. */
  slice: number | SliceInsets;
  repeat?: FrameRepeat;
  /** Initial thickness of the widest side in document pixels. Defaults to 4% of the shorter image side. */
  width?: number;
  group?: string;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
function insets(value: unknown, error: string): SliceInsets {
  const check = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 8192)
      throw new Error(error);
    return n;
  };
  if (typeof value === 'number') {
    const n = check(value);
    return { top: n, right: n, bottom: n, left: n };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(error);
  const v = value as Record<string, unknown>;
  return {
    top: check(v.top),
    right: check(v.right),
    bottom: check(v.bottom),
    left: check(v.left),
  };
}
/** Corners must leave a non-negative middle and at least one side must have pixels. */
export function validSlice(
  slice: SliceInsets,
  width: number,
  height: number
): boolean {
  return (
    SIDES.some((side) => slice[side] > 0) &&
    slice.left + slice.right <= width &&
    slice.top + slice.bottom <= height
  );
}
const repeatChoice = (value: unknown): FrameRepeat => {
  if (value === undefined) return 'stretch';
  if (value !== 'stretch' && value !== 'repeat' && value !== 'round')
    throw new Error('Invalid frame repeat mode');
  return value;
};

export function parseFrameImage(value: unknown): FrameImage {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid frame image');
  const v = value as Record<string, unknown>;
  if (
    typeof v.source !== 'string' ||
    v.source.length > 64 * 1024 * 1024 ||
    !IMAGE_SOURCE.test(v.source)
  )
    throw new Error('Invalid frame image source');
  const size = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 8192)
      throw new Error('Invalid frame image size');
    return n;
  };
  const sourceWidth = size(v.sourceWidth),
    sourceHeight = size(v.sourceHeight),
    slice = insets(v.slice, 'Invalid frame slice');
  if (!validSlice(slice, sourceWidth, sourceHeight))
    throw new Error('Invalid frame slice');
  const result: FrameImage = {
    source: v.source,
    sourceWidth,
    sourceHeight,
    slice,
    repeat: repeatChoice(v.repeat),
  };
  if (v.id !== undefined) {
    if (typeof v.id !== 'string' || v.id.length > 256)
      throw new Error('Invalid frame image id');
    result.id = v.id;
  }
  return result;
}

/** Validate a host frame catalog. Slice insets are checked against pixels once the image loads. */
export function parseFrameCatalog(value: unknown): ImageEditorFrame[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid frame catalog');
  const ids = new Set<string>();
  return value.map((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid frame definition');
    const v = input as Record<string, unknown>;
    const text = (item: unknown, name: string, max = 4096) => {
      if (typeof item !== 'string' || !item.trim() || item.length > max)
        throw new Error(`Invalid frame ${name}`);
      return item;
    };
    const id = text(v.id, 'id');
    if (ids.has(id)) throw new Error(`Duplicate frame id: ${id}`);
    ids.add(id);
    const frame: ImageEditorFrame = {
      id,
      label: text(v.label, 'label'),
      url: text(v.url, 'url', 64 * 1024 * 1024),
      slice: insets(v.slice, `Invalid frame slice: ${id}`),
      repeat: repeatChoice(v.repeat),
    };
    if (!SIDES.some((side) => (frame.slice as SliceInsets)[side] > 0))
      throw new Error(`Invalid frame slice: ${id}`);
    if (v.width !== undefined) {
      if (
        typeof v.width !== 'number' ||
        !Number.isFinite(v.width) ||
        v.width <= 0 ||
        v.width > 8192
      )
        throw new Error(`Invalid frame width: ${id}`);
      frame.width = v.width;
    }
    if (v.group !== undefined) frame.group = text(v.group, 'group');
    return frame;
  });
}

type Size = { width: number; height: number };
export type SlicePiece = {
  source: { x: number; y: number; width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
};
/**
 * Scale applied to every slice so the widest side is `width` document pixels.
 * The same factor is used along both axes, so corners keep their aspect and
 * stay the same size on any canvas unless the canvas is too small for them.
 */
export function sliceScale(
  image: Pick<FrameImage, 'slice'>,
  width: number,
  area: Size
) {
  const { slice } = image,
    widest = Math.max(slice.top, slice.right, slice.bottom, slice.left);
  if (widest <= 0 || width <= 0) return 0;
  const scale = width / widest,
    horizontal = (slice.left + slice.right) * scale,
    vertical = (slice.top + slice.bottom) * scale;
  // Like CSS border-image, shrink uniformly when opposite borders would overlap.
  return (
    scale *
    Math.min(
      1,
      horizontal > 0 ? area.width / horizontal : 1,
      vertical > 0 ? area.height / vertical : 1
    )
  );
}
/** Border thickness per side in document pixels. */
export function frameImageInsets(
  image: Pick<FrameImage, 'slice'>,
  width: number,
  area: Size = { width: Infinity, height: Infinity }
): SliceInsets {
  const scale = sliceScale(image, width, area);
  return {
    top: image.slice.top * scale,
    right: image.slice.right * scale,
    bottom: image.slice.bottom * scale,
    left: image.slice.left * scale,
  };
}
function edgeTiles(
  start: number,
  length: number,
  tile: number,
  mode: FrameRepeat
): { offset: number; size: number }[] {
  if (length <= 0 || tile <= 0) return [];
  if (mode === 'stretch') return [{ offset: start, size: length }];
  if (mode === 'round') {
    const count = Math.max(1, Math.round(length / tile)),
      size = length / count;
    return Array.from({ length: count }, (_, i) => ({
      offset: start + i * size,
      size,
    }));
  }
  // CSS `repeat`: whole tiles centered on the edge, clipped at both ends.
  const count = Math.ceil(length / tile / 2) * 2 + 1,
    first = start + (length - count * tile) / 2;
  return Array.from({ length: count }, (_, i) => ({
    offset: first + i * tile,
    size: tile,
  })).filter(
    (item) =>
      item.offset + item.size > start + 1e-9 &&
      item.offset < start + length - 1e-9
  );
}
/** Eight pieces of a 9-slice frame drawn inward from the canvas edge. The center stays empty. */
export function nineSlice(
  image: Pick<FrameImage, 'slice' | 'repeat' | 'sourceWidth' | 'sourceHeight'>,
  natural: Size,
  width: number,
  area: Size
): (SlicePiece & { clip?: SlicePiece['target'] })[] {
  // Insets refer to sourceWidth/Height; follow a resized file proportionally.
  const kx = natural.width / image.sourceWidth,
    ky = natural.height / image.sourceHeight;
  const s = {
      top: image.slice.top * ky,
      right: image.slice.right * kx,
      bottom: image.slice.bottom * ky,
      left: image.slice.left * kx,
    },
    d = frameImageInsets(image, width, area);
  const middle = {
      x: s.left,
      y: s.top,
      width: natural.width - s.left - s.right,
      height: natural.height - s.top - s.bottom,
    },
    inner = {
      x: d.left,
      y: d.top,
      width: area.width - d.left - d.right,
      height: area.height - d.top - d.bottom,
    };
  const pieces: (SlicePiece & { clip?: SlicePiece['target'] })[] = [];
  const add = (
    source: SlicePiece['source'],
    target: SlicePiece['target'],
    clip?: SlicePiece['target']
  ) => {
    if (
      source.width > 0 &&
      source.height > 0 &&
      target.width > 0 &&
      target.height > 0
    )
      pieces.push(clip ? { source, target, clip } : { source, target });
  };
  // Corners.
  add(
    { x: 0, y: 0, width: s.left, height: s.top },
    { x: 0, y: 0, width: d.left, height: d.top }
  );
  add(
    { x: natural.width - s.right, y: 0, width: s.right, height: s.top },
    { x: area.width - d.right, y: 0, width: d.right, height: d.top }
  );
  add(
    {
      x: natural.width - s.right,
      y: natural.height - s.bottom,
      width: s.right,
      height: s.bottom,
    },
    {
      x: area.width - d.right,
      y: area.height - d.bottom,
      width: d.right,
      height: d.bottom,
    }
  );
  add(
    { x: 0, y: natural.height - s.bottom, width: s.left, height: s.bottom },
    { x: 0, y: area.height - d.bottom, width: d.left, height: d.bottom }
  );
  // Horizontal edges: tile length follows the edge's scaled source width.
  for (const [sy, sh, ty, th] of [
    [0, s.top, 0, d.top],
    [natural.height - s.bottom, s.bottom, area.height - d.bottom, d.bottom],
  ] as const) {
    const clip = { x: inner.x, y: ty, width: inner.width, height: th };
    const tile = sh > 0 ? (middle.width * th) / sh : 0;
    for (const item of edgeTiles(inner.x, inner.width, tile, image.repeat))
      add(
        { x: middle.x, y: sy, width: middle.width, height: sh },
        { x: item.offset, y: ty, width: item.size, height: th },
        image.repeat === 'repeat' ? clip : undefined
      );
  }
  for (const [sx, sw, tx, tw] of [
    [0, s.left, 0, d.left],
    [natural.width - s.right, s.right, area.width - d.right, d.right],
  ] as const) {
    const clip = { x: tx, y: inner.y, width: tw, height: inner.height };
    const tile = sw > 0 ? (middle.height * tw) / sw : 0;
    for (const item of edgeTiles(inner.y, inner.height, tile, image.repeat))
      add(
        { x: sx, y: middle.y, width: sw, height: middle.height },
        { x: tx, y: item.offset, width: tw, height: item.size },
        image.repeat === 'repeat' ? clip : undefined
      );
  }
  return pieces;
}
const slices = new WeakMap<object, Map<string, CanvasImageSource>>();
/**
 * Each slice is copied to its own canvas once, so smoothing samples clamp at
 * the slice edge instead of bleeding neighboring slices into corners and edges.
 */
function isolatedSlice(
  image: CanvasImageSource,
  rect: SlicePiece['source']
): CanvasImageSource {
  if (typeof document === 'undefined') return image;
  const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
  let cache = slices.get(image as object);
  if (!cache) slices.set(image as object, (cache = new Map()));
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  canvas
    .getContext('2d')
    ?.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  cache.set(key, canvas);
  return canvas;
}
export function paintImageFrame(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  image: CanvasImageSource | undefined,
  natural: Size | undefined,
  area: Size
) {
  if (!frame.image || !image || !natural || frame.width <= 0) return;
  for (const piece of nineSlice(frame.image, natural, frame.width, area)) {
    if (piece.clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(piece.clip.x, piece.clip.y, piece.clip.width, piece.clip.height);
      ctx.clip();
    }
    ctx.drawImage(
      isolatedSlice(image, piece.source),
      piece.target.x,
      piece.target.y,
      piece.target.width,
      piece.target.height
    );
    if (piece.clip) ctx.restore();
  }
}

/** Canvas added on each side when a frame sits outside the photo. */
export function frameMargins(frame: Frame): SliceInsets {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (
    frame.placement !== 'outside' ||
    frame.style === 'none' ||
    frame.width <= 0
  )
    return none;
  if (frame.style === 'image')
    return frame.image ? frameImageInsets(frame.image, frame.width) : none;
  const w = frame.width;
  return {
    top: w,
    right: w,
    bottom: frame.style === 'polaroid' ? w * 3 : w,
    left: w,
  };
}
/**
 * Replace a document's frame. An outside frame grows the canvas by its margins
 * so it never covers the photo; replacing or removing it shrinks the canvas by
 * the previous margins first, so repeated edits do not accumulate.
 */
export function setFrame(
  doc: ImageDocument,
  frame: Frame,
  transform: (
    doc: ImageDocument,
    dx: number,
    dy: number,
    width: number,
    height: number
  ) => ImageDocument
): ImageDocument {
  const before = frameMargins(doc.frame),
    after = frameMargins(frame);
  let next = doc;
  const round = (n: number) => Math.round(n);
  if (before.top || before.right || before.bottom || before.left)
    next = transform(
      next,
      -round(before.left),
      -round(before.top),
      Math.max(1, next.width - round(before.left) - round(before.right)),
      Math.max(1, next.height - round(before.top) - round(before.bottom))
    );
  if (after.top || after.right || after.bottom || after.left)
    next = transform(
      next,
      round(after.left),
      round(after.top),
      next.width + round(after.left) + round(after.right),
      next.height + round(after.top) + round(after.bottom)
    );
  return { ...next, frame };
}
