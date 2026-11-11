/** The editable document uses image pixels, never CSS pixels or canvas DPR. */
export type Point = { x: number; y: number };
export type Matrix = readonly [number, number, number, number, number, number];
export type Rect = Point & { width: number; height: number };
export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow';
export type Layer = {
  id: string;
  kind: 'path' | 'text' | ShapeKind;
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
};
export type Effects = {
  preset: 'none' | 'grayscale' | 'sepia' | 'invert' | 'vintage';
  brightness: number;
  contrast: number;
  saturation: number;
};
export type ImageDocument = {
  width: number;
  height: number;
  imageMatrix: Matrix;
  layers: readonly Layer[];
  effects: Effects;
};
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const DEFAULT_EFFECTS: Effects = {
  preset: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
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
  return { width: Math.round(width), height: Math.round(height) };
}
export function createDocument(width: number, height: number): ImageDocument {
  return {
    ...dimensions(width, height),
    imageMatrix: IDENTITY,
    layers: [],
    effects: DEFAULT_EFFECTS,
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
  return transformDocument(
    doc,
    scale(size.width / doc.width, size.height / doc.height),
    size.width,
    size.height
  );
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
  if (
    Math.abs(
      layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]
    ) < 1e-10
  )
    return false;
  const p = transform(inverse(layer.matrix), point);
  const localTolerance =
    tolerance / Math.max(0.01, Math.hypot(layer.matrix[0], layer.matrix[1]));
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
    if (before === next || JSON.stringify(before) === JSON.stringify(next)) {
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
