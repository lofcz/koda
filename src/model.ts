/** The editable document uses image pixels, never CSS pixels or canvas DPR. */
export type Point = { x: number; y: number };
export type Matrix = readonly [number, number, number, number, number, number];
export type Rect = Point & { width: number; height: number };
export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow';
export type LineEnd = 'none' | 'arrow' | 'circle' | 'square';
export type Layer = {
  id: string;
  kind: 'path' | 'text' | 'image' | 'redaction' | ShapeKind;
  matrix: Matrix;
  width: number;
  height: number;
  color: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  points?: readonly Point[];
  erase?: boolean;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  arrowStart?: LineEnd;
  arrowEnd?: LineEnd;
  imageSource?: string;
  redactionMode?: 'pixelate' | 'blur' | 'solid';
  redactionSize?: number;
  /** Locked layers render normally, but cannot be selected or edited by gestures. */
  locked?: boolean;
  hidden?: boolean;
};
export type Effects = {
  preset:
    | 'none'
    | 'grayscale'
    | 'sepia'
    | 'invert'
    | 'vintage'
    | 'warm'
    | 'cool'
    | 'noir'
    | 'fade'
    | 'chrome'
    | 'pastel'
    | 'stark'
    | 'wash'
    | 'sepiaBlues'
    | 'sepiaColor'
    | 'sepiaRust';
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  gamma: number;
  temperature: number;
  clarity: number;
  vignette: number;
};
export type Frame = {
  style:
    | 'none'
    | 'solid'
    | 'inset'
    | 'double'
    | 'mat'
    | 'polaroid'
    | 'bevel'
    | 'hooks'
    | 'cross'
    | 'edge';
  color: string;
  /** Width in document pixels, drawn inside the image. */
  width: number;
};
export type ImageDocument = {
  width: number;
  height: number;
  imageMatrix: Matrix;
  layers: readonly Layer[];
  effects: Effects;
  background: string;
  frame: Frame;
  cornerRadius: number;
};
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const DEFAULT_EFFECTS: Effects = {
  preset: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  gamma: 0,
  temperature: 0,
  clarity: 0,
  vignette: 0,
};
export const DEFAULT_FRAME: Frame = {
  style: 'none',
  color: '#ffffff',
  width: 16,
};
export const MAX_DIMENSION = 8192;
export const MAX_PIXELS = 32 * 1024 * 1024;
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export function dimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  )
    throw new Error('Invalid image dimensions');
  const size = { width: Math.round(width), height: Math.round(height) };
  if (size.width * size.height > MAX_PIXELS)
    throw new Error('Invalid image dimensions');
  return size;
}
export function createDocument(width: number, height: number): ImageDocument {
  return {
    ...dimensions(width, height),
    imageMatrix: IDENTITY,
    layers: [],
    effects: DEFAULT_EFFECTS,
    background: 'transparent',
    frame: DEFAULT_FRAME,
    cornerRadius: 0,
  };
}
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transform(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-10) throw new Error('Singular transform');
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];
export function rotation(angle: number): Matrix {
  const a = (angle * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
}
export function transformDocument(
  doc: ImageDocument,
  matrix: Matrix,
  width = doc.width,
  height = doc.height
): ImageDocument {
  return {
    ...doc,
    ...dimensions(width, height),
    imageMatrix: multiply(matrix, doc.imageMatrix),
    layers: doc.layers.map((layer) => ({
      ...layer,
      matrix: multiply(matrix, layer.matrix),
    })),
  };
}
export function resizeDocument(
  doc: ImageDocument,
  width: number,
  height: number
): ImageDocument {
  const size = dimensions(width, height);
  if (size.width === doc.width && size.height === doc.height) return doc;
  const resized = transformDocument(
    doc,
    scale(size.width / doc.width, size.height / doc.height),
    size.width,
    size.height
  );
  const factor = Math.min(size.width / doc.width, size.height / doc.height);
  return {
    ...resized,
    frame: { ...doc.frame, width: doc.frame.width * factor },
    cornerRadius: doc.cornerRadius * factor,
  };
}
export function cropDocument(doc: ImageDocument, rect: Rect): ImageDocument {
  const x = clamp(Math.round(rect.x), 0, doc.width - 1),
    y = clamp(Math.round(rect.y), 0, doc.height - 1);
  const width = clamp(Math.round(rect.width), 1, doc.width - x),
    height = clamp(Math.round(rect.height), 1, doc.height - y);
  if (x === 0 && y === 0 && width === doc.width && height === doc.height)
    return doc;
  return transformDocument(doc, translate(-x, -y), width, height);
}
export function rotateDocument(
  doc: ImageDocument,
  clockwise: boolean
): ImageDocument {
  return transformDocument(
    doc,
    clockwise ? [0, 1, -1, 0, doc.height, 0] : [0, -1, 1, 0, 0, doc.width],
    doc.height,
    doc.width
  );
}
export function flipDocument(
  doc: ImageDocument,
  horizontal: boolean
): ImageDocument {
  return transformDocument(
    doc,
    horizontal ? [-1, 0, 0, 1, doc.width, 0] : [1, 0, 0, -1, 0, doc.height]
  );
}
/** Rotate the entire editable composition around its center, retaining every layer. */
export function straightenDocument(
  doc: ImageDocument,
  angle: number,
  expand = false
): ImageDocument {
  if (!Number.isFinite(angle)) throw new Error('Invalid rotation');
  if (angle % 360 === 0) return doc;
  const rotated = rotation(angle);
  const width = expand
      ? Math.ceil(
          Math.abs(rotated[0]) * doc.width +
            Math.abs(rotated[2]) * doc.height -
            1e-9
        )
      : doc.width,
    height = expand
      ? Math.ceil(
          Math.abs(rotated[1]) * doc.width +
            Math.abs(rotated[3]) * doc.height -
            1e-9
        )
      : doc.height;
  return transformDocument(
    doc,
    multiply(
      translate(width / 2, height / 2),
      multiply(rotated, translate(-doc.width / 2, -doc.height / 2))
    ),
    width,
    height
  );
}
export function updateLayer(
  doc: ImageDocument,
  id: string,
  patch: Partial<Layer>
): ImageDocument {
  if (!doc.layers.some((layer) => layer.id === id)) return doc;
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.id === id ? { ...layer, ...patch } : layer
    ),
  };
}
export function layerCorners(layer: Layer): Point[] {
  return [
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
    { x: layer.width, y: layer.height },
    { x: 0, y: layer.height },
  ].map((p) => transform(layer.matrix, p));
}
export function rotateLayer(layer: Layer, angle: number): Layer {
  const c = transform(layer.matrix, {
    x: layer.width / 2,
    y: layer.height / 2,
  });
  return {
    ...layer,
    matrix: multiply(
      multiply(
        multiply(translate(c.x, c.y), rotation(angle)),
        translate(-c.x, -c.y)
      ),
      layer.matrix
    ),
  };
}
export function flipLayer(layer: Layer, horizontal: boolean): Layer {
  return {
    ...layer,
    matrix: multiply(
      layer.matrix,
      horizontal
        ? [-1, 0, 0, 1, layer.width, 0]
        : [1, 0, 0, -1, 0, layer.height]
    ),
  };
}
export function duplicateLayer(doc: ImageDocument, id: string): ImageDocument {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return doc;
  const layer = doc.layers[index];
  const copy = {
    ...layer,
    id: crypto.randomUUID(),
    locked: false,
    matrix: multiply(translate(20, 20), layer.matrix),
  };
  return {
    ...doc,
    layers: [
      ...doc.layers.slice(0, index + 1),
      copy,
      ...doc.layers.slice(index + 1),
    ],
  };
}
export function reorderLayer(
  doc: ImageDocument,
  id: string,
  direction: 'front' | 'back' | 'forward' | 'backward'
): ImageDocument {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return doc;
  const target =
    direction === 'front'
      ? doc.layers.length - 1
      : direction === 'back'
        ? 0
        : clamp(
            index + (direction === 'forward' ? 1 : -1),
            0,
            doc.layers.length - 1
          );
  if (index === target) return doc;
  const layers = [...doc.layers];
  layers.splice(target, 0, ...layers.splice(index, 1));
  return { ...doc, layers };
}
/** Corner resize is anchored at the opposite corner, including rotated/sheared layers. */
export function resizeLayer(
  layer: Layer,
  corner: number,
  point: Point,
  lockAspect = false
): Layer {
  const local = transform(inverse(layer.matrix), point);
  const opposite = [
    { x: layer.width, y: layer.height },
    { x: 0, y: layer.height },
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
  ][corner];
  const original = [
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
    { x: layer.width, y: layer.height },
    { x: 0, y: layer.height },
  ][corner];
  let sx = Math.max(
    0.01 / Math.max(0.000001, Math.hypot(layer.matrix[0], layer.matrix[1])),
    (local.x - opposite.x) / (original.x - opposite.x)
  );
  let sy = Math.max(
    0.01 / Math.max(0.000001, Math.hypot(layer.matrix[2], layer.matrix[3])),
    (local.y - opposite.y) / (original.y - opposite.y)
  );
  if (lockAspect) sx = sy = Math.max(sx, sy);
  const delta = multiply(
    multiply(translate(opposite.x, opposite.y), scale(sx, sy)),
    translate(-opposite.x, -opposite.y)
  );
  return { ...layer, matrix: multiply(layer.matrix, delta) };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy;
  const t = d ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / d, 0, 1) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Accurate path/ellipse/line hit testing; transparent areas do not steal clicks. */
export function hitLayer(layer: Layer, point: Point, tolerance = 4): boolean {
  if (layer.hidden || layer.locked || layer.opacity <= 0) return false;
  if (
    Math.abs(
      layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]
    ) < 1e-10
  )
    return false;
  const p = transform(inverse(layer.matrix), point);
  // The smallest singular value keeps a usable target after nonuniform scaling.
  const [a, b, c, d] = layer.matrix,
    trace = a * a + b * b + c * c + d * d,
    determinant = a * d - b * c,
    minScale = Math.sqrt(
      Math.max(
        0,
        (trace -
          Math.sqrt(
            Math.max(0, trace * trace - 4 * determinant * determinant)
          )) /
          2
      )
    );
  const localTolerance = tolerance / Math.max(0.01, minScale);
  const stroke = layer.strokeWidth / 2 + localTolerance;
  if (layer.kind === 'path') {
    const points = layer.points ?? [];
    return points.some(
      (q, i) => segmentDistance(p, points[Math.max(0, i - 1)], q) <= stroke
    );
  }
  if (layer.kind === 'line' || layer.kind === 'arrow')
    return (
      segmentDistance(p, { x: 0, y: 0 }, { x: layer.width, y: layer.height }) <=
      stroke
    );
  if (layer.kind === 'ellipse') {
    const distance = Math.hypot(
      (p.x - layer.width / 2) / (layer.width / 2),
      (p.y - layer.height / 2) / (layer.height / 2)
    );
    const edge = stroke / Math.min(layer.width / 2, layer.height / 2);
    return layer.fill === 'transparent'
      ? Math.abs(distance - 1) <= edge
      : distance <= 1 + edge;
  }
  if (
    p.x < -stroke ||
    p.y < -stroke ||
    p.x > layer.width + stroke ||
    p.y > layer.height + stroke
  )
    return false;
  if (layer.kind === 'rectangle' && layer.fill === 'transparent')
    return (
      p.x <= stroke ||
      p.y <= stroke ||
      p.x >= layer.width - stroke ||
      p.y >= layer.height - stroke
    );
  if (layer.kind === 'triangle') {
    const a = { x: layer.width / 2, y: 0 },
      b = { x: layer.width, y: layer.height },
      c = { x: 0, y: layer.height };
    if (layer.fill === 'transparent')
      return (
        Math.min(
          segmentDistance(p, a, b),
          segmentDistance(p, b, c),
          segmentDistance(p, c, a)
        ) <= stroke
      );
    return (
      p.y >= 0 &&
      p.y <= layer.height &&
      Math.abs(p.x - layer.width / 2) <=
        (p.y * layer.width) / (2 * layer.height) + stroke
    );
  }
  return true;
}
export function hitDocument(
  doc: ImageDocument,
  p: Point,
  tolerance = 4
): Layer | undefined {
  return [...doc.layers]
    .reverse()
    .find((layer) => hitLayer(layer, p, tolerance));
}
export function pathLayer(
  points: readonly Point[],
  style: Partial<Layer> = {}
): Layer {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!points.length) {
    minX = minY = maxX = maxY = 0;
  }
  return {
    id: crypto.randomUUID(),
    kind: 'path',
    matrix: translate(minX, minY),
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    color: '#e5484d',
    fill: 'transparent',
    strokeWidth: 8,
    opacity: 1,
    ...style,
    points: points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
  };
}

/** Parse persisted state into an independent, validated document before replacing a draft. */
export function parseDocument(input: unknown): ImageDocument {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('Invalid editor document');
    return v as Record<string, unknown>;
  };
  const number = (
    v: unknown,
    min: number,
    max: number,
    fallback?: number
  ): number => {
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      throw new Error('Invalid document number');
    return v;
  };
  const string = (v: unknown, fallback = '', max = 1000000): string => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || v.length > max)
      throw new Error('Invalid document string');
    return v;
  };
  const choice = <const T extends string>(
    v: unknown,
    options: readonly T[],
    fallback: T
  ): T => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !options.includes(v as T))
      throw new Error('Invalid document option');
    return v as T;
  };
  const matrix = (v: unknown): Matrix => {
    if (!Array.isArray(v) || v.length !== 6)
      throw new Error('Invalid document transform');
    const m = v.map((n) => number(n, -1e8, 1e8)) as unknown as Matrix;
    inverse(m);
    return m;
  };
  const doc = object(value);
  const result = createDocument(
    number(doc.width, 1, MAX_DIMENSION),
    number(doc.height, 1, MAX_DIMENSION)
  );
  result.imageMatrix = matrix(doc.imageMatrix);
  result.background = string(doc.background, 'transparent', 256);
  result.cornerRadius = number(doc.cornerRadius, 0, MAX_DIMENSION, 0);
  const effect = doc.effects === undefined ? {} : object(doc.effects);
  result.effects = {
    ...DEFAULT_EFFECTS,
    preset: choice(
      effect.preset,
      [
        'none',
        'grayscale',
        'sepia',
        'invert',
        'vintage',
        'warm',
        'cool',
        'noir',
        'fade',
        'chrome',
        'pastel',
        'stark',
        'wash',
        'sepiaBlues',
        'sepiaColor',
        'sepiaRust',
      ],
      'none'
    ),
  };
  for (const key of [
    'brightness',
    'contrast',
    'saturation',
    'exposure',
    'gamma',
    'temperature',
    'clarity',
    'vignette',
  ] as const)
    result.effects[key] = number(effect[key], -100, 100, 0);
  const frame = doc.frame === undefined ? {} : object(doc.frame);
  result.frame = {
    style: choice(
      frame.style,
      [
        'none',
        'solid',
        'inset',
        'double',
        'mat',
        'polaroid',
        'bevel',
        'hooks',
        'cross',
        'edge',
      ],
      'none'
    ),
    color: string(frame.color, DEFAULT_FRAME.color, 256),
    width: number(frame.width, 0, MAX_DIMENSION, DEFAULT_FRAME.width),
  };
  if (!Array.isArray(doc.layers) || doc.layers.length > 10000)
    throw new Error('Invalid document layers');
  const ids = new Set<string>();
  let pointCount = 0;
  result.layers = doc.layers.map((input) => {
    const v = object(input),
      id = string(v.id, '', 256);
    if (!id || ids.has(id)) throw new Error('Invalid layer identifier');
    ids.add(id);
    const layer: Layer = {
      id,
      kind: choice(
        v.kind,
        [
          'path',
          'text',
          'image',
          'redaction',
          'rectangle',
          'ellipse',
          'triangle',
          'line',
          'arrow',
        ],
        'rectangle'
      ),
      matrix: matrix(v.matrix),
      width: number(v.width, 0.001, 1e7),
      height: number(v.height, 0.001, 1e7),
      color: string(v.color, '#000000', 256),
      fill: string(v.fill, 'transparent', 256),
      strokeWidth: number(v.strokeWidth, 0, MAX_DIMENSION, 0),
      opacity: number(v.opacity, 0, 1, 1),
    };
    for (const key of [
      'erase',
      'bold',
      'italic',
      'underline',
      'locked',
      'hidden',
    ] as const) {
      if (v[key] !== undefined) {
        if (typeof v[key] !== 'boolean') throw new Error('Invalid layer flag');
        layer[key] = v[key];
      }
    }
    if (v.points !== undefined) {
      if (!Array.isArray(v.points) || (pointCount += v.points.length) > 1000000)
        throw new Error('Invalid layer points');
      layer.points = v.points.map((input) => {
        const p = object(input);
        return { x: number(p.x, -1e7, 1e7), y: number(p.y, -1e7, 1e7) };
      });
    }
    if (layer.kind === 'text') {
      layer.text = string(v.text);
      layer.fontFamily = string(v.fontFamily, 'sans-serif', 512);
      layer.fontSize = number(v.fontSize, 1, MAX_DIMENSION, 40);
      layer.lineHeight = number(v.lineHeight, 0.5, 5, 1.2);
      layer.textAlign = choice(
        v.textAlign,
        ['left', 'center', 'right'],
        'left'
      );
    }
    if (layer.kind === 'line' || layer.kind === 'arrow') {
      layer.arrowStart = choice(
        v.arrowStart,
        ['none', 'arrow', 'circle', 'square'],
        'none'
      );
      layer.arrowEnd = choice(
        v.arrowEnd,
        ['none', 'arrow', 'circle', 'square'],
        layer.kind === 'arrow' ? 'arrow' : 'none'
      );
    }
    if (layer.kind === 'image') {
      const source = string(v.imageSource, '', 64 * 1024 * 1024);
      if (
        !/^(data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,|https?:\/\/|blob:)/i.test(
          source
        )
      )
        throw new Error('Invalid image layer source');
      layer.imageSource = source;
    }
    if (layer.kind === 'redaction') {
      layer.redactionMode = choice(
        v.redactionMode,
        ['pixelate', 'blur', 'solid'],
        'pixelate'
      );
      layer.redactionSize = number(v.redactionSize, 1, 512, 16);
    }
    return layer;
  });
  return result;
}

function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  if (left.length !== right.length) return false;
  return left.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      equalValue(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
  );
}

/** One pointer gesture is one history entry, regardless of pointer sample count. */
export class DocumentHistory {
  past: ImageDocument[] = [];
  future: ImageDocument[] = [];
  private transaction: ImageDocument | null = null;
  readonly baseline: ImageDocument;
  constructor(
    public current: ImageDocument,
    private limit = 100
  ) {
    this.baseline = current;
  }
  get changed() {
    return this.current !== this.baseline;
  }
  get inTransaction() {
    return this.transaction !== null;
  }
  begin() {
    if (!this.transaction) this.transaction = this.current;
  }
  preview(next: ImageDocument) {
    this.current = next;
  }
  commit(next = this.current) {
    const before = this.transaction ?? this.current;
    this.transaction = null;
    if (equalValue(before, next)) {
      this.current = before;
      return false;
    }
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return true;
  }
  cancel() {
    if (this.transaction) this.current = this.transaction;
    this.transaction = null;
  }
  undo() {
    this.cancel();
    const before = this.past.pop();
    if (before) {
      this.future.push(this.current);
      this.current = before;
    }
  }
  redo() {
    this.cancel();
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
  }
}
