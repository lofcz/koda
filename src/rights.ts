import type { Layer, Matrix } from './model';
import { resolveTextStyle, textContent } from './textModel';
import type { TextRun, TextStyle } from './textModel';

/**
 * Per-layer editing rights. Every right defaults to `true`; a host or template
 * author denies an operation by setting it to `false`.
 *
 * Gesture rights need a selection: when `select` is denied (or the layer is
 * `locked`), every right from `move` to `pathPoints` is denied as well.
 * `textNewlines` additionally needs `editText`.
 */
export const LAYER_RIGHTS = [
  /** Pick the layer on the canvas, in the layer list or with Select all. */
  'select',
  /** Translate: drag, arrow-key nudge, align and distribute. */
  'move',
  /** Scale: corner handles, width/height fields, line endpoints, text box handles. */
  'resize',
  /** Rotate: rotation handle, Alt+arrow keys, rotation field, line endpoints. */
  'rotate',
  /** Mirror horizontally or vertically. */
  'flip',
  /** Remove with Delete/Backspace or the delete buttons. */
  'delete',
  /** Copy with Ctrl+D or the duplicate buttons. */
  'duplicate',
  /** Change the layer's own stacking position. */
  'reorder',
  /** Colors, fill, stroke, opacity, feather, line ends, redaction mode and all text formatting. */
  'style',
  /** Change text content. */
  'editText',
  /** Insert new line breaks into text. */
  'textNewlines',
  /** Change a text box's layout mode or box size. */
  'textLayout',
  /** Edit, insert and remove path nodes, and open/close the path. */
  'pathPoints',
  /** Eraser strokes above this layer remove its pixels. */
  'erase',
  /** Other layers snap to this layer while moving. */
  'snap',
  /** Toggle the layer's `locked` flag. */
  'lock',
  /** Toggle the layer's `hidden` flag. */
  'visibility',
] as const;
export type LayerRight = (typeof LAYER_RIGHTS)[number];
/** JSON-safe, partial rights stored on a layer. Omitted rights are allowed. */
export type LayerRights = { readonly [K in LayerRight]?: boolean };
/** Effective rights after defaults, `locked` and dependencies are applied. */
export type ResolvedLayerRights = { readonly [K in LayerRight]: boolean };
export type LayerKind = Layer['kind'];
/** Editor-wide defaults: `all` applies first, then the layer kind, then the layer's own rights. */
export type LayerRightsDefaults = {
  readonly [K in LayerKind | 'all']?: LayerRights;
};
/** Resolves the effective rights of a layer; the editor builds one from its options. */
export type RightsResolver = (layer: Layer) => ResolvedLayerRights;

/** Rights that need the layer to be selectable. `locked` denies all of them. */
export const SELECTION_RIGHTS: readonly LayerRight[] = [
  'select',
  'move',
  'resize',
  'rotate',
  'flip',
  'delete',
  'duplicate',
  'reorder',
  'style',
  'editText',
  'textNewlines',
  'textLayout',
  'pathPoints',
];
const KINDS: readonly (LayerKind | 'all')[] = [
  'all',
  'path',
  'text',
  'image',
  'redaction',
  'rectangle',
  'ellipse',
  'triangle',
  'line',
  'arrow',
];
const ALL_ALLOWED = Object.fromEntries(
  LAYER_RIGHTS.map((right) => [right, true])
) as ResolvedLayerRights;

/** Validate persisted rights. Unknown keys are rejected so an older editor never drops a denial. */
export function parseLayerRights(input: unknown): LayerRights | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid layer rights');
  const result: Partial<Record<LayerRight, boolean>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(LAYER_RIGHTS as readonly string[]).includes(key))
      throw new Error('Invalid layer right');
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new Error('Invalid layer right');
    result[key as LayerRight] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function parseLayerRightsDefaults(
  input: unknown
): LayerRightsDefaults | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid layer rights defaults');
  const result: Partial<Record<LayerKind | 'all', LayerRights>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KINDS.includes(key as LayerKind))
      throw new Error('Invalid layer rights defaults');
    const rights = parseLayerRights(value);
    if (rights) result[key as LayerKind] = rights;
  }
  return result;
}

export function resolveLayerRights(
  layer: Pick<Layer, 'kind' | 'rights' | 'locked'>,
  defaults?: LayerRightsDefaults
): ResolvedLayerRights {
  if (!layer.rights && !layer.locked && !defaults) return ALL_ALLOWED;
  const result: Record<LayerRight, boolean> = {
    ...ALL_ALLOWED,
    ...defaults?.all,
    ...defaults?.[layer.kind],
    ...layer.rights,
  };
  if (layer.locked || !result.select)
    for (const right of SELECTION_RIGHTS) result[right] = false;
  if (!result.editText) result.textNewlines = false;
  return result;
}

/** A stable resolver for one defaults object, so render caches can key on it. */
export function rightsResolver(defaults?: LayerRightsDefaults): RightsResolver {
  return (layer) => resolveLayerRights(layer, defaults);
}
export const defaultRights: RightsResolver = rightsResolver();

/** Rights that matter for a layer kind; used to list what a host restricted. */
export function applicableRights(layer: Layer): LayerRight[] {
  return LAYER_RIGHTS.filter((right) => {
    if (right === 'editText' || right === 'textNewlines')
      return layer.kind === 'text';
    if (right === 'textLayout') return layer.kind === 'text';
    if (right === 'pathPoints')
      return layer.kind === 'path' && !!layer.pathEditable;
    return true;
  });
}

/** Denied rights a user can notice, in display order. Locking is reported separately. */
export function deniedRights(
  layer: Layer,
  resolve: RightsResolver = defaultRights
): LayerRight[] {
  if (layer.locked) return [];
  const rights = resolve(layer);
  if (!rights.select) return ['select'];
  return applicableRights(layer).filter(
    (right) => !rights[right] && right !== 'snap'
  );
}

/** Line endpoints change both length and angle. */
export function canDragEndpoint(rights: ResolvedLayerRights) {
  return rights.resize && rights.rotate;
}
/** Text handles change the layout box, so both resizing and box changes must be allowed. */
export function canResizeBox(layer: Layer, rights: ResolvedLayerRights) {
  return layer.kind === 'text'
    ? rights.resize && rights.textLayout
    : rights.resize;
}

/**
 * Multi-selection rules:
 * - Translation (drag, nudge, align, distribute) excludes members that cannot move;
 *   they stay put and remain snap targets. A drag that starts on a member that
 *   cannot move only selects.
 * - Group resize and rotate reposition every member, so their handles appear only
 *   when every member allows the transform and moving.
 * - Duplicate, delete and style changes apply to the members that allow them.
 */
export function movableIds(
  layers: readonly Layer[],
  resolve: RightsResolver
): string[] {
  return layers.filter((layer) => resolve(layer).move).map((l) => l.id);
}
export function groupTransformRights(
  layers: readonly Layer[],
  resolve: RightsResolver
) {
  const all = (test: (layer: Layer, rights: ResolvedLayerRights) => boolean) =>
    layers.length > 0 && layers.every((layer) => test(layer, resolve(layer)));
  return {
    resize: all((layer, r) => r.move && canResizeBox(layer, r)),
    rotate: all((_, r) => r.move && r.rotate),
    endpoint: all((_, r) => r.move && canDragEndpoint(r)),
  };
}

/** Which transform handles a selection shows: a single layer, or a group frame with its members. */
export function handleRights(
  layer: Layer,
  members: readonly Layer[] | null,
  resolve: RightsResolver
) {
  if (members && members.length > 1)
    return { ...groupTransformRights(members, resolve), endpoint: false };
  const rights = resolve(layer);
  return {
    resize: canResizeBox(layer, rights),
    rotate: rights.rotate,
    endpoint: canDragEndpoint(rights),
  };
}

const STYLE_KEYS: readonly (keyof Layer)[] = [
  'color',
  'fill',
  'strokeWidth',
  'opacity',
  'strokeDash',
  'strokeCap',
  'strokeJoin',
  'cornerRadius',
  'feather',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'letterSpacing',
  'bold',
  'italic',
  'underline',
  'strike',
  'textBackground',
  'textAlign',
  'lineHeight',
  'textOutline',
  'textShadow',
  'arrowStart',
  'arrowEnd',
  'redactionMode',
  'redactionSize',
];

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a).filter(
      (key) => (a as Record<string, unknown>)[key] !== undefined
    ),
    right = Object.keys(b).filter(
      (key) => (b as Record<string, unknown>)[key] !== undefined
    );
  return (
    left.length === right.length &&
    left.every((key) =>
      same(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    )
  );
}

/** Classify an affine change of one layer. Translation that follows a linear change belongs to it. */
export function matrixRights(before: Matrix, after: Matrix): LayerRight[] {
  const epsilon = 1e-9,
    linear = [0, 1, 2, 3].some((i) => Math.abs(before[i] - after[i]) > epsilon);
  if (!linear)
    return Math.abs(before[4] - after[4]) > epsilon ||
      Math.abs(before[5] - after[5]) > epsilon
      ? ['move']
      : [];
  const det = (m: Matrix) => m[0] * m[3] - m[1] * m[2];
  if (Math.sign(det(before)) !== Math.sign(det(after))) return ['flip'];
  const result: LayerRight[] = [],
    angle = (m: Matrix) => Math.atan2(m[1], m[0]),
    turn = Math.abs(
      ((angle(after) - angle(before) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    );
  if (turn > 1e-6) result.push('rotate');
  // Rotation preserves column lengths and the area; anything else scales or shears.
  const lengths = (m: Matrix) => [
    Math.hypot(m[0], m[1]),
    Math.hypot(m[2], m[3]),
  ];
  const [ax, ay] = lengths(before),
    [bx, by] = lengths(after);
  if (
    Math.abs(ax - bx) > 1e-6 * Math.max(1, ax) ||
    Math.abs(ay - by) > 1e-6 * Math.max(1, ay) ||
    Math.abs(Math.abs(det(before)) - Math.abs(det(after))) >
      1e-6 * Math.max(1, Math.abs(det(before)))
  )
    result.push('resize');
  return result;
}

/** Rights a property patch needs. Unchanged values need nothing. */
export function patchRights(
  layer: Layer,
  patch: Partial<Layer>
): Set<LayerRight> {
  const needed = new Set<LayerRight>();
  for (const key of Object.keys(patch) as (keyof Layer)[]) {
    if (key === 'id' || key === 'kind' || same(patch[key], layer[key]))
      continue;
    if (key === 'matrix')
      matrixRights(layer.matrix, patch.matrix!).forEach((right) =>
        needed.add(right)
      );
    else if (key === 'width' || key === 'height') {
      needed.add('resize');
      if (layer.kind === 'text') needed.add('textLayout');
    } else if (key === 'textLayout') needed.add('textLayout');
    else if (key === 'text' || key === 'textRuns') {
      const before = textContent(layer),
        after = textContent({ ...layer, ...patch });
      if (before !== after) needed.add('editText');
      if (count(after, '\n') > count(before, '\n')) needed.add('textNewlines');
      if (patch.textRuns && !runStylesKnown(layer, patch.textRuns))
        needed.add('style');
    } else if (key === 'points' || key === 'pathClosed')
      needed.add('pathPoints');
    else if (key === 'locked') needed.add('lock');
    else if (key === 'hidden') needed.add('visibility');
    else if (key === 'rights' || key === 'pathEditable' || key === 'erase')
      // Authoring properties belong to the host, never to an editing control.
      needed.add('select').add('lock').add('style').add('pathPoints');
    else if (STYLE_KEYS.includes(key)) needed.add('style');
    else if (key === 'imageSource') needed.add('style');
  }
  return needed;
}

export function allowsPatch(
  layer: Layer,
  patch: Partial<Layer>,
  rights: ResolvedLayerRights
): boolean {
  for (const right of patchRights(layer, patch))
    if (!rights[right]) return false;
  return true;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;
/** Pure CSS-ish canonical form, so a browser echo such as rgb(…) of #hex is not a style change. */
function canonicalColor(value: string) {
  const color = value.trim().toLowerCase(),
    hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(color);
  let channels: number[] | null = null;
  if (hex) {
    const digits =
      hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    channels = (digits.match(/../g) ?? []).map((pair) => parseInt(pair, 16));
    if (channels.length === 4) channels[3] = channels[3] / 255;
  } else {
    const rgb = /^rgba?\(([^)]*)\)$/.exec(color);
    if (rgb)
      channels = rgb[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map((part, index) =>
          part.endsWith('%')
            ? (parseFloat(part) / 100) * (index < 3 ? 255 : 1)
            : parseFloat(part)
        );
  }
  if (!channels || channels.some((n) => !Number.isFinite(n))) return color;
  const alpha = channels[3] ?? 1;
  return alpha >= 1
    ? `rgb(${channels.slice(0, 3).map(Math.round).join(',')})`
    : alpha <= 0
      ? 'transparent'
      : `rgba(${channels.slice(0, 3).map(Math.round).join(',')},${Math.round(alpha * 1000) / 1000})`;
}
const canonicalFont = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .join(',')
    .toLowerCase();
function styleKey(layer: Layer, style: TextStyle | undefined) {
  const resolved = resolveTextStyle(layer, style);
  return JSON.stringify([
    resolved.fontSize,
    canonicalFont(resolved.fontFamily),
    resolved.fontWeight,
    resolved.italic,
    resolved.underline,
    resolved.strike,
    canonicalColor(resolved.color),
    canonicalColor(resolved.background),
    resolved.letterSpacing,
  ]);
}
/** Typing inherits neighboring marks; only a combination of marks the text did not have is a style change. */
function runStylesKnown(layer: Layer, after: readonly TextRun[]) {
  const known = new Set([styleKey(layer, undefined)]);
  for (const run of layer.textRuns ?? []) known.add(styleKey(layer, run.style));
  return after.every(
    (run) => !run.text || known.has(styleKey(layer, run.style))
  );
}

/**
 * The single text-edit gate for the canvas editor, the panel field and host renderers.
 * Returns false when the edit needs a denied right.
 */
export function allowsTextEdit(
  layer: Layer,
  value: { text: string; runs?: readonly TextRun[] },
  rights: ResolvedLayerRights
): boolean {
  return allowsPatch(
    layer,
    { text: value.text, ...(value.runs ? { textRuns: value.runs } : {}) },
    rights
  );
}
