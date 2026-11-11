import { describe, expect, it } from 'vitest';
import {
  cropHandles,
  dragCrop,
  lineEndpoints,
  moveLineEndpoint,
  snapMove,
} from '../src/interactions';
import {
  createDocument,
  Layer,
  multiply,
  rotation,
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
