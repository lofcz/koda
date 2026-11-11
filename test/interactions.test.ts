import { describe, expect, it } from 'vitest';
import {
  cropHandles,
  dragCrop,
  lineEndpoints,
  moveLineEndpoint,
  snapMove,
  alignLayers,
  distributeLayers,
  duplicateLayers,
  layerBounds,
  marqueeLayers,
  pathNodes,
  pathSegments,
  selectionBounds,
  selectionFrame,
  snapPathPoint,
  transformLayers,
  withPathPoints,
} from '../src/interactions';
import {
  createDocument,
  Layer,
  inverse,
  layerCorners,
  multiply,
  rotation,
  resizeLayer,
  scale,
  transform,
  translate,
} from '../src/model';

const layer = (id = 'a'): Layer => ({
  id,
  kind: 'rectangle',
  width: 100,
  height: 60,
  matrix: translate(40, 30),
  color: '#000',
  fill: '#fff',
  strokeWidth: 2,
  opacity: 1,
});

describe('multi-selection ownership and affine transforms', () => {
  const first: Layer = {
      ...layer('first'),
      matrix: [1.8, 0.7, -0.4, 0.6, 60, 70],
    },
    second: Layer = {
      ...layer('second'),
      matrix: [-0.7, 0.3, 0.8, 1.5, 350, 110],
    },
    locked = { ...layer('locked'), locked: true },
    hidden = { ...layer('hidden'), hidden: true },
    doc = {
      ...createDocument(600, 400),
      layers: [first, locked, second, hidden],
    },
    ids = [first.id, second.id];
  it('applies one global transform without losing existing nonuniform scale, reflection or shear', () => {
    const matrix = multiply(
        translate(25, -15),
        multiply(rotation(37), scale(1.7, 0.8))
      ),
      next = transformLayers(doc, [...ids, locked.id, hidden.id], matrix);
    for (const index of [0, 2]) {
      const expected = layerCorners(doc.layers[index]).map((point) =>
        transform(matrix, point)
      );
      layerCorners(next.layers[index]).forEach((point, i) => {
        expect(point.x).toBeCloseTo(expected[i].x);
        expect(point.y).toBeCloseTo(expected[i].y);
      });
    }
    expect(next.layers[1]).toBe(locked);
    expect(next.layers[3]).toBe(hidden);
    expect(doc.layers[0]).toBe(first);
    const restored = transformLayers(next, ids, inverse(matrix));
    restored.layers.forEach((item, index) =>
      item.matrix.forEach((value, i) =>
        expect(value).toBeCloseTo(doc.layers[index].matrix[i])
      )
    );
  });
  it('resizes around the opposite selection corner and preserves each local coordinate frame', () => {
    const frame = selectionFrame(doc, ids)!,
      anchor = layerCorners(frame)[0],
      resized = resizeLayer(frame, 2, {
        x: anchor.x + frame.width * 1.5,
        y: anchor.y + frame.height * 0.7,
      }),
      matrix = multiply(resized.matrix, inverse(frame.matrix)),
      next = transformLayers(doc, ids, matrix),
      bounds = selectionBounds(next, ids)!;
    expect(bounds.x).toBeCloseTo(anchor.x);
    expect(bounds.y).toBeCloseTo(anchor.y);
    expect(bounds.width).toBeCloseTo(frame.width * 1.5);
    expect(bounds.height).toBeCloseTo(frame.height * 0.7);
    expect(next.layers[0].width).toBe(first.width);
    expect(next.layers[2].height).toBe(second.height);
  });
  it('does not snap the selection back to its own members', () => {
    const simple = {
        ...createDocument(600, 400),
        layers: [
          { ...layer('a'), matrix: translate(20, 40) },
          { ...layer('b'), matrix: translate(170, 70) },
        ],
      },
      frame = selectionFrame(simple, ['a', 'b'])!;
    expect(
      snapMove(simple, frame, { x: 2, y: 2 }, 5, undefined, ['a', 'b'])
    ).toEqual({ delta: { x: 2, y: 2 }, guides: [] });
  });
  it('duplicates editable members in document order and leaves originals untouched', () => {
    const result = duplicateLayers(doc, [
      second.id,
      locked.id,
      first.id,
      hidden.id,
    ]);
    expect(result.ids).toHaveLength(2);
    expect(new Set(result.ids).size).toBe(2);
    expect(result.document.layers.slice(0, 4)).toEqual(doc.layers);
    for (const [index, original] of [first, second].entries()) {
      const copy = result.document.layers[4 + index];
      expect(copy.matrix.slice(0, 4)).toEqual(original.matrix.slice(0, 4));
      expect(copy.matrix[4]).toBe(original.matrix[4] + 12);
      expect(copy.matrix[5]).toBe(original.matrix[5] + 12);
    }
  });
  it('aligns transformed visible bounds; one object aligns to the document', () => {
    const aligned = alignLayers(doc, ids, 'left'),
      min = selectionBounds(doc, ids)!.x;
    expect(layerBounds(aligned.layers[0]).x).toBeCloseTo(min);
    expect(layerBounds(aligned.layers[2]).x).toBeCloseTo(min);
    const right = alignLayers(doc, [first.id], 'right'),
      bound = layerBounds(right.layers[0]);
    expect(bound.x + bound.width).toBeCloseTo(doc.width);
    expect(right.layers[0].matrix.slice(0, 4)).toEqual(
      first.matrix.slice(0, 4)
    );
  });
  it('distributes variable width objects with equal gaps while retaining both outer edges', () => {
    const boxes = [
        { ...layer('a'), width: 40, matrix: translate(20, 10) },
        { ...layer('b'), width: 70, matrix: translate(100, 10) },
        { ...layer('c'), width: 30, matrix: translate(350, 10) },
      ],
      source = {
        ...createDocument(600, 400),
        layers: [boxes[2], boxes[0], boxes[1]],
      },
      result = distributeLayers(
        source,
        boxes.map((item) => item.id),
        'horizontal'
      ),
      bounds = boxes.map((box) =>
        layerBounds(result.layers.find((item) => item.id === box.id)!)
      );
    expect(bounds[1].x - bounds[0].x - bounds[0].width).toBeCloseTo(
      bounds[2].x - bounds[1].x - bounds[1].width
    );
    expect(bounds[0].x).toBe(20);
    expect(bounds[2].x + bounds[2].width).toBe(380);
    expect(result.layers.map((item) => item.id)).toEqual(
      source.layers.map((item) => item.id)
    );
  });
  it('marquee selection excludes hidden, locked, erased and transparent layers', () => {
    const source = {
      ...doc,
      layers: [
        ...doc.layers,
        { ...layer('erased'), erase: true },
        { ...layer('transparent'), opacity: 0 },
      ],
    };
    expect(
      marqueeLayers(source, { x: -100, y: -100, width: 1000, height: 1000 })
    ).toEqual(ids);
  });
});

describe('editable path geometry', () => {
  const path: Layer = {
    ...layer('path'),
    kind: 'path',
    pathEditable: true,
    pathClosed: true,
    matrix: [-1.4, 0.4, 0.6, 2, 250, 60],
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 10 },
      { x: 50, y: 70 },
    ],
  };
  it('normalizes a dragged vertex without moving the untouched vertices under an affine transform', () => {
    const points = [{ x: -30, y: 40 }, ...path.points!.slice(1)],
      changed = withPathPoints(path, points),
      world = pathNodes(changed);
    points.forEach((point, i) => {
      const expected = transform(path.matrix, point);
      expect(world[i].x).toBeCloseTo(expected.x);
      expect(world[i].y).toBeCloseTo(expected.y);
    });
    expect(Math.min(...changed.points!.map((p) => p.x))).toBe(0);
    expect(Math.min(...changed.points!.map((p) => p.y))).toBe(0);
    expect(changed.matrix.slice(0, 4)).toEqual(path.matrix.slice(0, 4));
    expect(changed.pathClosed).toBe(true);
  });
  it('provides a closing-segment insertion handle and retains the polygon when inserting it', () => {
    const segments = pathSegments(path),
      closing = segments.at(-1)!;
    expect(segments).toHaveLength(3);
    expect(closing.index).toBe(3);
    const points = [...path.points!];
    points.splice(
      closing.index,
      0,
      transform(inverse(path.matrix), closing.point)
    );
    const next = withPathPoints(path, points);
    expect(pathNodes(next).at(-1)!.x).toBeCloseTo(closing.point.x);
    expect(pathNodes(next).at(-1)!.y).toBeCloseTo(closing.point.y);
    expect(next.points).toHaveLength(4);
    expect(pathSegments({ ...path, pathClosed: false })).toHaveLength(2);
  });
  it('snaps path angles in document space without changing segment length', () => {
    const anchor = { x: 80, y: 60 },
      point = { x: 170, y: 64 },
      next = snapPathPoint(anchor, point);
    expect(next.y).toBeCloseTo(anchor.y);
    expect(Math.hypot(next.x - anchor.x, next.y - anchor.y)).toBeCloseTo(
      Math.hypot(point.x - anchor.x, point.y - anchor.y)
    );
  });
});
describe('crop manipulation', () => {
  const rect = { x: 100, y: 80, width: 200, height: 120 },
    bounds = { width: 600, height: 400 };
  it('offers corners and edge midpoints', () => {
    expect(cropHandles(rect)).toHaveLength(8);
    expect(cropHandles(rect).find((p) => p.handle === 'e')?.point).toEqual({
      x: 300,
      y: 140,
    });
  });
  it('keeps an opposite edge fixed during free edge resize', () => {
    expect(
      dragCrop(rect, { x: 300, y: 140 }, { x: 360, y: 180 }, 'e', bounds)
    ).toEqual({ ...rect, width: 260 });
    expect(
      dragCrop(rect, { x: 100, y: 140 }, { x: 40, y: 120 }, 'w', bounds)
    ).toEqual({ ...rect, x: 40, width: 260 });
  });
  it('keeps the ratio exact when a corner hits the image edge', () => {
    const result = dragCrop(
      rect,
      { x: 300, y: 200 },
      { x: 800, y: 600 },
      'se',
      bounds,
      16 / 9
    );
    expect(result.width / result.height).toBeCloseTo(16 / 9);
    expect(result.x).toBe(rect.x);
    expect(result.y).toBe(rect.y);
    expect(result.x + result.width).toBeLessThanOrEqual(bounds.width);
    expect(result.y + result.height).toBeLessThanOrEqual(bounds.height);
  });
  it('expands perpendicular edges symmetrically for a constrained edge drag', () => {
    const result = dragCrop(
      rect,
      { x: 300, y: 140 },
      { x: 400, y: 140 },
      'e',
      bounds,
      2
    );
    expect(result).toEqual({ x: 100, y: 65, width: 300, height: 150 });
  });
  it('bounds all eight constrained handles without drifting the ratio', () => {
    for (const { handle, point } of cropHandles(rect)) {
      const result = dragCrop(
        rect,
        point,
        { x: point.x * 3 - 700, y: point.y * 3 - 400 },
        handle,
        bounds,
        4 / 3
      );
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.x + result.width).toBeLessThanOrEqual(bounds.width + 1e-8);
      expect(result.y + result.height).toBeLessThanOrEqual(
        bounds.height + 1e-8
      );
      expect(result.width / result.height).toBeCloseTo(4 / 3);
    }
  });
  it('allows backwards drawing and clamps movement without changing size', () => {
    expect(
      dragCrop(rect, { x: 450, y: 300 }, { x: 250, y: 100 }, 'new', bounds, 1)
    ).toEqual({ x: 250, y: 100, width: 200, height: 200 });
    expect(
      dragCrop(rect, { x: 150, y: 100 }, { x: 1000, y: -400 }, 'move', bounds)
    ).toEqual({ ...rect, x: 400, y: 0 });
  });
});

describe('annotation precision', () => {
  it('snaps document centers within tolerance and leaves further movement free', () => {
    const item = layer(),
      doc = { ...createDocument(600, 400), layers: [item] };
    expect(snapMove(doc, item, { x: 208, y: 138 }, 5)).toEqual({
      delta: { x: 210, y: 140 },
      guides: [
        { axis: 'x', value: 300 },
        { axis: 'y', value: 200 },
      ],
    });
    expect(snapMove(doc, item, { x: 200, y: 130 }, 5).delta).toEqual({
      x: 200,
      y: 130,
    });
  });
  it('ignores hidden peers and respects a constrained movement axis', () => {
    const item = layer(),
      peer = { ...layer('b'), hidden: true, matrix: translate(200, 100) },
      doc = { ...createDocument(600, 400), layers: [item, peer] };
    expect(snapMove(doc, item, { x: 108, y: 68 }, 5).guides).toEqual([]);
    expect(snapMove(doc, item, { x: 208, y: 138 }, 5, 'x').delta).toEqual({
      x: 210,
      y: 138,
    });
  });
  it('moves either rotated line endpoint while anchoring the other', () => {
    const item: Layer = {
      ...layer(),
      kind: 'arrow',
      matrix: multiply(translate(120, 90), rotation(37)),
    };
    const before = lineEndpoints(item),
      target = { x: 350, y: 180 };
    for (const endpoint of [0, 1]) {
      const changed = moveLineEndpoint(item, endpoint, target),
        after = lineEndpoints(changed);
      expect(after[endpoint].x).toBeCloseTo(target.x);
      expect(after[endpoint].y).toBeCloseTo(target.y);
      expect(after[1 - endpoint].x).toBeCloseTo(before[1 - endpoint].x);
      expect(after[1 - endpoint].y).toBeCloseTo(before[1 - endpoint].y);
      expect(changed.strokeWidth).toBe(item.strokeWidth);
      expect(
        changed.strokeWidth * Math.hypot(changed.matrix[0], changed.matrix[1])
      ).toBeCloseTo(item.strokeWidth);
    }
  });
  it('snaps endpoint angle without moving its anchor', () => {
    const item: Layer = { ...layer(), kind: 'line' };
    const changed = moveLineEndpoint(item, 1, { x: 240, y: 32 }, true),
      [start, end] = lineEndpoints(changed);
    expect(start).toEqual({ x: 40, y: 30 });
    expect(end.y).toBeCloseTo(30);
  });
});
