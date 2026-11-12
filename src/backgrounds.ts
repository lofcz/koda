/**
 * Image backgrounds are painted below the photo, after the solid background
 * color, over the whole document canvas. They show through transparent photo
 * pixels and outside-image crop margins. Pure geometry; no DOM at module load.
 */
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'repeat';
export type BackgroundImage = {
  /** Embedded `data:image/...` pixels (editor default) or a host URL. */
  source: string;
  fit: BackgroundFit;
  /** Anchor in 0..1 like CSS percentages: 0 = left/top, 0.5 = center. */
  position: { x: number; y: number };
  /** Repeat only: tile size is the image's natural size times this, in document pixels. */
  scale: number;
  opacity: number;
};
export const DEFAULT_BACKGROUND_IMAGE: Omit<BackgroundImage, 'source'> = {
  fit: 'cover',
  position: { x: 0.5, y: 0.5 },
  scale: 1,
  opacity: 1,
};
export const IMAGE_SOURCE =
  /^(data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,|https?:\/\/|blob:)/i;

type Size = { width: number; height: number };
export type BackgroundPlacement =
  | { mode: 'single'; x: number; y: number; width: number; height: number }
  | { mode: 'tile'; x: number; y: number; width: number; height: number };

/** Where the image lands on a `area`-sized canvas. Tile `x`/`y` is the origin of one tile in (-size, 0]. */
export function backgroundPlacement(
  background: Pick<BackgroundImage, 'fit' | 'position' | 'scale'>,
  image: Size,
  area: Size
): BackgroundPlacement {
  if (background.fit === 'stretch')
    return { mode: 'single', x: 0, y: 0, ...area };
  if (background.fit === 'repeat') {
    const width = image.width * background.scale,
      height = image.height * background.scale;
    const wrap = (offset: number, size: number) => {
      const value = offset % size;
      return value > 0 ? value - size : value;
    };
    return {
      mode: 'tile',
      x: wrap((area.width - width) * background.position.x, width),
      y: wrap((area.height - height) * background.position.y, height),
      width,
      height,
    };
  }
  const factor = (background.fit === 'cover' ? Math.max : Math.min)(
      area.width / image.width,
      area.height / image.height
    ),
    width = image.width * factor,
    height = image.height * factor;
  return {
    mode: 'single',
    x: (area.width - width) * background.position.x,
    y: (area.height - height) * background.position.y,
    width,
    height,
  };
}

export function parseBackgroundImage(value: unknown): BackgroundImage {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid background image');
  const v = value as Record<string, unknown>;
  const number = (n: unknown, min: number, max: number, fallback: number) => {
    if (n === undefined) return fallback;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error('Invalid background image number');
    return n;
  };
  if (
    typeof v.source !== 'string' ||
    v.source.length > 64 * 1024 * 1024 ||
    !IMAGE_SOURCE.test(v.source)
  )
    throw new Error('Invalid background image source');
  const fit = v.fit ?? DEFAULT_BACKGROUND_IMAGE.fit;
  if (
    typeof fit !== 'string' ||
    !['cover', 'contain', 'stretch', 'repeat'].includes(fit)
  )
    throw new Error('Invalid background image fit');
  const position =
    v.position === undefined
      ? DEFAULT_BACKGROUND_IMAGE.position
      : v.position && typeof v.position === 'object'
        ? (v.position as Record<string, unknown>)
        : null;
  if (!position) throw new Error('Invalid background image position');
  return {
    source: v.source,
    fit: fit as BackgroundFit,
    position: {
      x: number(position.x, 0, 1, 0.5),
      y: number(position.y, 0, 1, 0.5),
    },
    // A 0.01 lower bound keeps tile counts bounded on the largest canvases.
    scale: number(v.scale, 0.01, 100, 1),
    opacity: number(v.opacity, 0, 1, 1),
  };
}

/** Paint into the current transform's 0..width × 0..height document space. */
export function paintBackgroundImage(
  ctx: CanvasRenderingContext2D,
  background: BackgroundImage,
  image: CanvasImageSource | undefined,
  natural: Size | undefined,
  area: Size
) {
  if (!image || !natural || background.opacity <= 0) return;
  const placement = backgroundPlacement(background, natural, area);
  ctx.save();
  ctx.globalAlpha *= background.opacity;
  if (placement.mode === 'single')
    ctx.drawImage(
      image,
      placement.x,
      placement.y,
      placement.width,
      placement.height
    );
  else {
    const pattern = ctx.createPattern(image, 'repeat');
    if (pattern) {
      pattern.setTransform(
        new DOMMatrix([
          placement.width / natural.width,
          0,
          0,
          placement.height / natural.height,
          placement.x,
          placement.y,
        ])
      );
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, area.width, area.height);
    }
  }
  ctx.restore();
}

/** A host-supplied background offered in the background panel. */
export interface ImageEditorBackground {
  id: string;
  label: string;
  url: string;
  fit?: BackgroundFit;
  /** Repeat tile scale; see {@link BackgroundImage.scale}. */
  scale?: number;
  group?: string;
}
export function parseBackgroundCatalog(
  value: unknown
): ImageEditorBackground[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid background catalog');
  const ids = new Set<string>();
  return value.map((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid background definition');
    const v = input as Record<string, unknown>;
    const text = (item: unknown, name: string, max = 4096) => {
      if (typeof item !== 'string' || !item.trim() || item.length > max)
        throw new Error(`Invalid background ${name}`);
      return item;
    };
    const id = text(v.id, 'id');
    if (ids.has(id)) throw new Error(`Duplicate background id: ${id}`);
    ids.add(id);
    const result: ImageEditorBackground = {
      id,
      label: text(v.label, 'label'),
      url: text(v.url, 'url', 64 * 1024 * 1024),
    };
    if (v.fit !== undefined) {
      if (
        typeof v.fit !== 'string' ||
        !['cover', 'contain', 'stretch', 'repeat'].includes(v.fit)
      )
        throw new Error(`Invalid background fit: ${id}`);
      result.fit = v.fit as BackgroundFit;
    }
    if (v.scale !== undefined) {
      if (
        typeof v.scale !== 'number' ||
        !Number.isFinite(v.scale) ||
        v.scale < 0.01 ||
        v.scale > 100
      )
        throw new Error(`Invalid background scale: ${id}`);
      result.scale = v.scale;
    }
    if (v.group !== undefined) result.group = text(v.group, 'group');
    return result;
  });
}
