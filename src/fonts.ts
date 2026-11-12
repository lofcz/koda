import type { ImageDocument } from './model';

/** One downloadable face of a catalog font. Several URLs form a CSS `src` fallback list. */
export interface ImageEditorFontFace {
  url: string | readonly string[];
  /** CSS weight descriptor, a number or a variable range such as `"100 900"`. */
  weight?: number | string;
  style?: 'normal' | 'italic';
  unicodeRange?: string;
}
/**
 * A font the text panel offers.
 * - `'system'` (default): installed or generic family, nothing to load.
 * - `'host'`: the host page declares it with `@font-face`; the editor waits for
 *   `document.fonts.load()` and treats a family with no matching face as failed.
 * - face list: the editor creates `FontFace` objects and loads them itself.
 */
export interface ImageEditorFont {
  id: string;
  label: string;
  /** CSS `font-family` stored on text layers, e.g. `'"Inter", sans-serif'`. Keep a generic fallback. */
  family: string;
  group?: string;
  /** Weights the font provides. Choosing the font snaps the current weight to the nearest one. */
  weights?: readonly number[];
  styles?: readonly ('normal' | 'italic')[];
  source?: 'system' | 'host' | readonly ImageEditorFontFace[];
}
export type FontStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';
export interface FontReadiness {
  /** Catalog ids whose faces are ready. */
  loaded: string[];
  /** Catalog ids that failed or did not finish before the timeout; they render with the CSS fallback. */
  failed: string[];
}

/** Matches the font list the editor shipped before catalogs were configurable. */
export const DEFAULT_FONTS: readonly ImageEditorFont[] = [
  { id: 'sans-serif', label: 'Sans serif', family: 'sans-serif' },
  { id: 'serif', label: 'Serif', family: 'serif' },
  { id: 'monospace', label: 'Monospace', family: 'monospace' },
  { id: 'arial', label: 'Arial', family: 'Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia, serif' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana, sans-serif' },
  {
    id: 'trebuchet',
    label: 'Trebuchet MS',
    family: '"Trebuchet MS", sans-serif',
  },
];
export const DEFAULT_FONT_LOAD_TIMEOUT = 5000;

const unsafeCss = /[<>;{}\\]|url\s*\(|expression\s*\(/i;
/** Validate a host catalog. Configuration mistakes throw instead of silently dropping fonts. */
export function parseFontCatalog(value: unknown): ImageEditorFont[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Invalid font catalog');
  const ids = new Set<string>();
  return value.map((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid font definition');
    const v = input as Record<string, unknown>;
    const text = (item: unknown, name: string, max = 512) => {
      if (typeof item !== 'string' || !item.trim() || item.length > max)
        throw new Error(`Invalid font ${name}`);
      return item;
    };
    const id = text(v.id, 'id', 256);
    if (ids.has(id)) throw new Error(`Duplicate font id: ${id}`);
    ids.add(id);
    const family = text(v.family, 'family');
    if (unsafeCss.test(family) || !primaryFamily(family))
      throw new Error(`Invalid font family: ${id}`);
    const font: ImageEditorFont = { id, label: text(v.label, 'label'), family };
    if (v.group !== undefined) font.group = text(v.group, 'group');
    if (v.weights !== undefined) {
      if (!Array.isArray(v.weights) || !v.weights.length)
        throw new Error(`Invalid font weights: ${id}`);
      font.weights = v.weights.map((weight: unknown) => {
        if (
          typeof weight !== 'number' ||
          !Number.isFinite(weight) ||
          weight < 1 ||
          weight > 1000
        )
          throw new Error(`Invalid font weight: ${id}`);
        return weight;
      });
    }
    if (v.styles !== undefined) {
      if (
        !Array.isArray(v.styles) ||
        !v.styles.length ||
        v.styles.some((style) => style !== 'normal' && style !== 'italic')
      )
        throw new Error(`Invalid font styles: ${id}`);
      font.styles = [...(v.styles as ('normal' | 'italic')[])];
    }
    if (v.source === 'system' || v.source === 'host') font.source = v.source;
    else if (v.source !== undefined) {
      if (!Array.isArray(v.source) || !v.source.length || v.source.length > 64)
        throw new Error(`Invalid font source: ${id}`);
      font.source = v.source.map((face: unknown) => {
        if (!face || typeof face !== 'object' || Array.isArray(face))
          throw new Error(`Invalid font face: ${id}`);
        const f = face as Record<string, unknown>;
        const urls = Array.isArray(f.url) ? f.url : [f.url];
        if (!urls.length) throw new Error(`Invalid font face URL: ${id}`);
        const result: ImageEditorFontFace = {
          url: urls.map((url) => text(url, 'face URL', 64 * 1024 * 1024)),
        };
        if (f.weight !== undefined) {
          if (
            (typeof f.weight !== 'number' || !Number.isFinite(f.weight)) &&
            (typeof f.weight !== 'string' || !/^\d+( \d+)?$/.test(f.weight))
          )
            throw new Error(`Invalid font face weight: ${id}`);
          result.weight = f.weight;
        }
        if (f.style !== undefined) {
          if (f.style !== 'normal' && f.style !== 'italic')
            throw new Error(`Invalid font face style: ${id}`);
          result.style = f.style;
        }
        if (f.unicodeRange !== undefined)
          result.unicodeRange = text(f.unicodeRange, 'unicode range');
        return result;
      });
    }
    return font;
  });
}

/** The first family of a CSS stack, unquoted; the name `FontFace` objects register. */
export function primaryFamily(family: string): string {
  const match = family.trim().match(/^(?:"([^"]*)"|'([^']*)'|([^,]*))/);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}
const familyKey = (family: string) => primaryFamily(family).toLowerCase();

/** Every family a document's text uses, including per-run overrides. */
export function documentFamilies(doc: ImageDocument): string[] {
  const families = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.kind !== 'text') continue;
    families.add(layer.fontFamily ?? 'sans-serif');
    for (const run of layer.textRuns ?? [])
      if (run.style?.fontFamily) families.add(run.style.fontFamily);
  }
  return [...families];
}
/** Catalog entries a document references. Families missing from the catalog are kept but never loaded. */
export function catalogFonts(
  families: readonly string[],
  catalog: readonly ImageEditorFont[]
): ImageEditorFont[] {
  const keys = new Set(families.map(familyKey));
  return catalog.filter((font) => keys.has(familyKey(font.family)));
}
export function layerUsesFamily(
  layer: ImageDocument['layers'][number],
  key: string
) {
  return (
    familyKey(layer.fontFamily ?? 'sans-serif') === key ||
    !!layer.textRuns?.some(
      (run) => run.style?.fontFamily && familyKey(run.style.fontFamily) === key
    )
  );
}
export const fontFamilyKey = familyKey;

const cssUrl = (url: string) =>
  `url("${url.replace(/[\\"\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
const sourceKey = (font: ImageEditorFont) =>
  `${familyKey(font.family)}\u0000${JSON.stringify(font.source ?? 'system')}`;

type Entry = {
  status: FontStatus;
  promise?: Promise<FontStatus>;
};
/**
 * Document-wide `FontFace` registry. Faces are shared across editor instances
 * because `document.fonts` is global; listeners hear the primary family key.
 */
class FontRegistry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<(family: string) => void>();
  version = 0;
  status(font: ImageEditorFont): FontStatus {
    if (!font.source || font.source === 'system') return 'loaded';
    return this.entries.get(sourceKey(font))?.status ?? 'unloaded';
  }
  subscribe = (listener: (family: string) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = () => this.version;
  private notify(font: ImageEditorFont) {
    this.version++;
    const key = familyKey(font.family);
    this.listeners.forEach((listener) => listener(key));
  }
  /** Idempotent; resolves with the final status and never rejects. */
  load(font: ImageEditorFont): Promise<FontStatus> {
    if (!font.source || font.source === 'system')
      return Promise.resolve('loaded');
    const key = sourceKey(font),
      existing = this.entries.get(key);
    if (existing?.promise) return existing.promise;
    const entry: Entry = { status: 'loading' };
    this.entries.set(key, entry);
    entry.promise = this.loadFaces(font).then((status) => {
      entry.status = status;
      this.notify(font);
      return status;
    });
    this.notify(font);
    return entry.promise;
  }
  private async loadFaces(font: ImageEditorFont): Promise<FontStatus> {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return 'failed';
    const family = primaryFamily(font.family);
    try {
      if (font.source === 'host') {
        const weights = font.weights ?? [400],
          styles = font.styles ?? ['normal'];
        const results = await Promise.all(
          weights.flatMap((weight) =>
            styles.map((style) =>
              fonts.load(`${style} ${weight} 16px ${font.family}`)
            )
          )
        );
        return results.every(
          (faces) =>
            faces.length && faces.every((face) => face.status === 'loaded')
        )
          ? 'loaded'
          : 'failed';
      }
      const faces = (font.source as readonly ImageEditorFontFace[]).map(
        (face) => {
          const created = new FontFace(
            family,
            (typeof face.url === 'string' ? [face.url] : face.url)
              .map(cssUrl)
              .join(', '),
            {
              weight:
                face.weight === undefined ? undefined : String(face.weight),
              style: face.style,
              unicodeRange: face.unicodeRange,
              display: 'swap',
            }
          );
          fonts.add(created);
          return created;
        }
      );
      await Promise.all(faces.map((face) => face.load()));
      return 'loaded';
    } catch {
      return 'failed';
    }
  }
}
export const fontRegistry = new FontRegistry();

/** Load fonts with a deadline. Unfinished fonts count as failed; drawing then uses the CSS fallback. */
export async function waitForFonts(
  fonts: readonly ImageEditorFont[],
  timeout: number
): Promise<FontReadiness> {
  const result: FontReadiness = { loaded: [], failed: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, timeout));
  });
  try {
    const statuses = await Promise.all(
      fonts.map((font) =>
        Promise.race([fontRegistry.load(font), deadline]).then((status) =>
          status === 'timeout' ? fontRegistry.status(font) : status
        )
      )
    );
    fonts.forEach((font, index) =>
      (statuses[index] === 'loaded' ? result.loaded : result.failed).push(
        font.id
      )
    );
  } finally {
    clearTimeout(timer);
  }
  return result;
}

/** Nearest weight a font provides, preferring the heavier one on ties. */
export function nearestWeight(font: ImageEditorFont, weight: number) {
  if (!font.weights?.length) return weight;
  return font.weights.reduce((best, item) =>
    Math.abs(item - weight) < Math.abs(best - weight) ||
    (Math.abs(item - weight) === Math.abs(best - weight) && item > best)
      ? item
      : best
  );
}
