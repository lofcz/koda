import {
  clamp,
  ImageDocument,
  Layer,
  layerCorners,
  Matrix,
  multiply,
  Point,
  Rect,
  rotation,
  scale,
  transform,
  translate,
} from './model';

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CropMode = CropHandle | 'move' | 'new';
export type SnapGuide = { axis: 'x' | 'y'; value: number };
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function cropHandles(
  rect: Rect
): { handle: CropHandle; point: Point }[] {
  const { x, y, width: w, height: h } = rect;
  return [
    { handle: 'nw', point: { x, y } },
    { handle: 'ne', point: { x: x + w, y } },
    { handle: 'se', point: { x: x + w, y: y + h } },
    { handle: 'sw', point: { x, y: y + h } },
    { handle: 'n', point: { x: x + w / 2, y } },
    { handle: 'e', point: { x: x + w, y: y + h / 2 } },
    { handle: 's', point: { x: x + w / 2, y: y + h } },
    { handle: 'w', point: { x, y: y + h / 2 } },
  ];
}

/** Keeps the opposite crop edge fixed and the requested ratio exact at image bounds. */
export function dragCrop(
  rect: Rect,
  start: Point,
  point: Point,
  mode: CropMode,
  bounds: { width: number; height: number },
  ratio: number | null = null
): Rect {
  if (mode === 'move')
    return {
      ...rect,
      x: clamp(rect.x + point.x - start.x, 0, bounds.width - rect.width),
      y: clamp(rect.y + point.y - start.y, 0, bounds.height - rect.height),
    };
  const p = {
    x: clamp(point.x, 0, bounds.width),
    y: clamp(point.y, 0, bounds.height),
  };
  const fresh = mode === 'new';
  const horizontal = fresh || mode.includes('e') || mode.includes('w');
  const vertical = fresh || mode.includes('n') || mode.includes('s');
  const anchor = fresh
    ? {
        x: clamp(start.x, 0, bounds.width),
        y: clamp(start.y, 0, bounds.height),
      }
    : {
        x: mode.includes('w')
          ? rect.x + rect.width
          : mode.includes('e')
            ? rect.x
            : rect.x + rect.width / 2,
        y: mode.includes('n')
          ? rect.y + rect.height
          : mode.includes('s')
            ? rect.y
            : rect.y + rect.height / 2,
      };
  // Existing handles do not flip through the opposite edge. A fresh crop follows the drag.
  const sx = fresh ? (p.x < anchor.x ? -1 : 1) : mode.includes('w') ? -1 : 1;
  const sy = fresh ? (p.y < anchor.y ? -1 : 1) : mode.includes('n') ? -1 : 1;
  let width = horizontal ? Math.max(1, (p.x - anchor.x) * sx) : rect.width;
  let height = vertical ? Math.max(1, (p.y - anchor.y) * sy) : rect.height;
  const limitX = horizontal
    ? sx < 0
      ? anchor.x
      : bounds.width - anchor.x
    : 2 * Math.min(anchor.x, bounds.width - anchor.x);
  const limitY = vertical
    ? sy < 0
      ? anchor.y
      : bounds.height - anchor.y
    : 2 * Math.min(anchor.y, bounds.height - anchor.y);
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    if (!horizontal) width = height * ratio;
    else if (!vertical) height = width / ratio;
    else if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
    const fit = Math.min(1, limitX / width, limitY / height);
    width *= fit;
    height *= fit;
  } else {
    width = Math.min(width, limitX);
    height = Math.min(height, limitY);
  }
  // At an image boundary a newly drawn zero-size region is inset by one pixel.
  if (width < 1 || height < 1) return rect;
  return {
    x: horizontal ? anchor.x - (sx < 0 ? width : 0) : anchor.x - width / 2,
    y: vertical ? anchor.y - (sy < 0 ? height : 0) : anchor.y - height / 2,
    width,
    height,
  };
}

export function layerBounds(layer: Layer): Rect {
  const points = layerCorners(layer),
    xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Snap visible bounds to document/peer centers and edges in document pixels. */
export function snapMove(
  doc: ImageDocument,
  layer: Layer,
  delta: Point,
  threshold: number,
  axis?: 'x' | 'y',
  excludedIds: readonly string[] = [layer.id]
): { delta: Point; guides: SnapGuide[] } {
  const bounds = layerBounds(layer);
  const peers = doc.layers.filter(
    (p) => !excludedIds.includes(p.id) && !p.hidden && !p.erase && p.opacity > 0
  );
  const targets = {
    x: [doc.width / 2, 0, doc.width],
    y: [doc.height / 2, 0, doc.height],
  };
  for (const peer of peers) {
    const b = layerBounds(peer);
    targets.x.push(b.x + b.width / 2, b.x, b.x + b.width);
    targets.y.push(b.y + b.height / 2, b.y, b.y + b.height);
  }
  const result = { delta: { ...delta }, guides: [] as SnapGuide[] };
  for (const coordinate of ['x', 'y'] as const) {
    if (axis && axis !== coordinate) continue;
    const extent = coordinate === 'x' ? bounds.width : bounds.height,
      origin = bounds[coordinate] + delta[coordinate],
      values = [origin + extent / 2, origin, origin + extent];
    let best = threshold + Number.EPSILON,
      target: number | undefined,
      correction = 0;
    for (const candidate of targets[coordinate]) {
      for (const value of values) {
        const difference = candidate - value;
        if (Math.abs(difference) < best) {
          best = Math.abs(difference);
          correction = difference;
          target = candidate;
        }
      }
    }
    if (target !== undefined) {
      result.delta[coordinate] += correction;
      result.guides.push({ axis: coordinate, value: target });
    }
  }
  return result;
}

export function lineEndpoints(layer: Layer): [Point, Point] {
  return [
    transform(layer.matrix, { x: 0, y: 0 }),
    transform(layer.matrix, { x: layer.width, y: layer.height }),
  ];
}

/** A similarity transform preserves the opposite endpoint, including rotated/flipped arrows. */
export function moveLineEndpoint(
  layer: Layer,
  endpoint: number,
  point: Point,
  snap = false
): Layer {
  const ends = lineEndpoints(layer),
    anchor = ends[1 - endpoint],
    original = ends[endpoint];
  const before = Math.atan2(original.y - anchor.y, original.x - anchor.x);
  let after = Math.atan2(point.y - anchor.y, point.x - anchor.x);
  if (snap) after = Math.round(after / (Math.PI / 12)) * (Math.PI / 12);
  const factor =
    Math.max(1, distance(anchor, point)) /
    Math.max(0.001, distance(anchor, original));
  const delta = multiply(
    multiply(
      multiply(
        translate(anchor.x, anchor.y),
        rotation(((after - before) * 180) / Math.PI)
      ),
      scale(factor)
    ),
    translate(-anchor.x, -anchor.y)
  );
  const matrix = multiply(delta, layer.matrix),
    width = Math.max(0.001, layer.width * factor),
    height = Math.max(0.001, layer.height * factor);
  // Put length into geometry so dragging an endpoint preserves the visible stroke
  // and its editable value, without tiny transforms or huge compensating strokes.
  return {
    ...layer,
    width,
    height,
    matrix: [
      (matrix[0] * layer.width) / width,
      (matrix[1] * layer.width) / width,
      (matrix[2] * layer.height) / height,
      (matrix[3] * layer.height) / height,
      matrix[4],
      matrix[5],
    ],
  };
}

export function resizeCursor(corners: Point[], corner: number): string {
  const c = midpoint(corners[0], corners[2]),
    p = corners[corner];
  const index =
    ((Math.round(Math.atan2(p.y - c.y, p.x - c.x) / (Math.PI / 4)) % 4) + 4) %
    4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index];
}

export function selectedLayers(
  doc: ImageDocument,
  ids: readonly string[]
): Layer[] {
  const selected = new Set(ids);
  return doc.layers.filter(
    (layer) => selected.has(layer.id) && !layer.hidden && !layer.locked
  );
}

export function selectionBounds(
  doc: ImageDocument,
  ids: readonly string[]
): Rect | null {
  const layers = selectedLayers(doc, ids);
  if (!layers.length) return null;
  const bounds = layers.map(layerBounds),
    x = Math.min(...bounds.map((r) => r.x)),
    y = Math.min(...bounds.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(0.001, Math.max(...bounds.map((r) => r.x + r.width)) - x),
    height: Math.max(0.001, Math.max(...bounds.map((r) => r.y + r.height)) - y),
  };
}

/** A temporary coordinate frame for a selection; never stored in the document. */
export function selectionFrame(
  doc: ImageDocument,
  ids: readonly string[]
): Layer | null {
  const bounds = selectionBounds(doc, ids);
  return bounds
    ? {
        id: '__selection__',
        kind: 'rectangle',
        matrix: translate(bounds.x, bounds.y),
        width: bounds.width,
        height: bounds.height,
        color: 'transparent',
        fill: 'transparent',
        strokeWidth: 0,
        opacity: 1,
      }
    : null;
}

/** Premultiplication applies the same document-space gesture to every existing affine frame. */
export function transformLayers(
  doc: ImageDocument,
  ids: readonly string[],
  matrix: Matrix
): ImageDocument {
  const selected = new Set(selectedLayers(doc, ids).map((layer) => layer.id));
  if (!selected.size) return doc;
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      selected.has(layer.id)
        ? { ...layer, matrix: multiply(matrix, layer.matrix) }
        : layer
    ),
  };
}

export function duplicateLayers(
  doc: ImageDocument,
  ids: readonly string[]
): { document: ImageDocument; ids: string[] } {
  const copies = selectedLayers(doc, ids).map((layer) => ({
    ...layer,
    id: crypto.randomUUID(),
    matrix: multiply(translate(12, 12), layer.matrix),
  }));
  return {
    document: copies.length
      ? { ...doc, layers: [...doc.layers, ...copies] }
      : doc,
    ids: copies.map((layer) => layer.id),
  };
}

export type Alignment =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export function alignLayers(
  doc: ImageDocument,
  ids: readonly string[],
  alignment: Alignment
): ImageDocument {
  const layers = selectedLayers(doc, ids),
    bounds =
      layers.length > 1
        ? selectionBounds(doc, ids)
        : { x: 0, y: 0, width: doc.width, height: doc.height };
  if (!bounds || !layers.length) return doc;
  const horizontal = ['left', 'center', 'right'].includes(alignment),
    axis = horizontal ? 'x' : 'y',
    size = horizontal ? 'width' : 'height',
    fraction = ['center', 'middle'].includes(alignment)
      ? 0.5
      : ['right', 'bottom'].includes(alignment)
        ? 1
        : 0;
  const selected = new Set(layers.map((layer) => layer.id));
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (!selected.has(layer.id)) return layer;
      const box = layerBounds(layer),
        delta =
          bounds[axis] +
          bounds[size] * fraction -
          box[axis] -
          box[size] * fraction;
      return {
        ...layer,
        matrix: multiply(
          translate(horizontal ? delta : 0, horizontal ? 0 : delta),
          layer.matrix
        ),
      };
    }),
  };
}

export function distributeLayers(
  doc: ImageDocument,
  ids: readonly string[],
  direction: 'horizontal' | 'vertical'
): ImageDocument {
  const axis = direction === 'horizontal' ? 'x' : 'y',
    size = direction === 'horizontal' ? 'width' : 'height',
    layers = selectedLayers(doc, ids)
      .map((layer) => ({ layer, bounds: layerBounds(layer) }))
      .sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  if (layers.length < 3) return doc;
  const first = layers[0].bounds,
    last = layers[layers.length - 1].bounds,
    gap =
      (last[axis] +
        last[size] -
        first[axis] -
        layers.reduce((sum, item) => sum + item.bounds[size], 0)) /
      (layers.length - 1),
    positions = new Map<string, number>();
  let cursor = first[axis];
  for (const item of layers) {
    positions.set(item.layer.id, cursor - item.bounds[axis]);
    cursor += item.bounds[size] + gap;
  }
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      const delta = positions.get(layer.id);
      return delta === undefined
        ? layer
        : {
            ...layer,
            matrix: multiply(
              translate(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0),
              layer.matrix
            ),
          };
    }),
  };
}

export function marqueeLayers(doc: ImageDocument, rect: Rect): string[] {
  return doc.layers
    .filter((layer) => {
      if (layer.hidden || layer.locked || layer.erase || layer.opacity <= 0)
        return false;
      const bounds = layerBounds(layer);
      return (
        bounds.x <= rect.x + rect.width &&
        bounds.x + bounds.width >= rect.x &&
        bounds.y <= rect.y + rect.height &&
        bounds.y + bounds.height >= rect.y
      );
    })
    .map((layer) => layer.id);
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Normalize path bounds while retaining every point's document position under shear/flip. */
export function withPathPoints(layer: Layer, points: readonly Point[]): Layer {
  if (!points.length) return layer;
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y)),
    width = Math.max(0.001, Math.max(...points.map((p) => p.x)) - x),
    height = Math.max(0.001, Math.max(...points.map((p) => p.y)) - y);
  return {
    ...layer,
    width,
    height,
    matrix: multiply(layer.matrix, translate(x, y)),
    points: points.map((p) => ({ x: p.x - x, y: p.y - y })),
  };
}

export function snapPathPoint(anchor: Point, point: Point): Point {
  const length = distance(anchor, point),
    angle =
      (Math.round(
        Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 4)
      ) *
        Math.PI) /
      4;
  return {
    x: anchor.x + Math.cos(angle) * length,
    y: anchor.y + Math.sin(angle) * length,
  };
}

export function pathNodes(layer: Layer): Point[] {
  return (layer.points ?? []).map((point) => transform(layer.matrix, point));
}

export function pathSegments(layer: Layer): { index: number; point: Point }[] {
  const points = pathNodes(layer),
    count = layer.pathClosed ? points.length : points.length - 1;
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    index: index + 1,
    point: midpoint(points[index], points[(index + 1) % points.length]),
  }));
}
