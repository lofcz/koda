import {
  createDocument,
  cropDocument,
  dimensions,
  DocumentHistory,
  flipDocument,
  hitDocument,
  hitLayer,
  ImageDocument,
  inverse,
  layerCorners,
  Layer,
  multiply,
  pathLayer,
  resizeDocument,
  resizeLayer,
  rotateDocument,
  rotateLayer,
  rotation,
  scale,
  transform,
  translate,
  updateLayer,
} from '../src/model';

const box = (): Layer => ({
  id: 'box',
  kind: 'rectangle',
  width: 40,
  height: 30,
  matrix: translate(25, 15),
  color: '#000000',
  fill: '#ff0000',
  strokeWidth: 2,
  opacity: 1,
});
const document = (): ImageDocument => ({
  ...createDocument(200, 120),
  layers: [box()],
});

describe('pixel-space document geometry', () => {
  it('rejects invalid or unallocatable sizes rather than silently resampling exports', () => {
    for (const [w, h] of [
      [0, 10],
      [10, -1],
      [NaN, 100],
      [Infinity, 10],
      [8193, 10],
      [8192, 8192],
    ])
      expect(() => dimensions(w, h)).toThrow();
    expect(dimensions(200.3, 100.7)).toEqual({ width: 200, height: 101 });
  });
  it('crop retains editable layers and translates image/layers by the same amount', () => {
    const before = document(),
      after = cropDocument(before, { x: 20, y: 10, width: 100, height: 80 });
    expect(after.width).toBe(100);
    expect(after.height).toBe(80);
    expect(transform(after.imageMatrix, { x: 20, y: 10 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(transform(after.layers[0].matrix, { x: 0, y: 0 })).toEqual({
      x: 5,
      y: 5,
    });
    expect(before.layers[0].matrix).toEqual(translate(25, 15));
    expect(cropDocument(before, { x: 0, y: 0, width: 200, height: 120 })).toBe(
      before
    );
  });
  it('clamps crops to the original canvas and preserves positive output dimensions', () => {
    expect(
      cropDocument(createDocument(20, 10), {
        x: -20,
        y: 9,
        width: 99,
        height: 99,
      })
    ).toMatchObject({ width: 20, height: 1 });
  });
  it('resize scales all affine transforms, including rotated objects, without flattening', () => {
    const layer = rotateLayer(box(), 35),
      before = { ...createDocument(200, 120), layers: [layer] },
      after = resizeDocument(before, 400, 60);
    const corners = layerCorners(layer),
      next = layerCorners(after.layers[0]);
    next.forEach((p, i) => {
      expect(p.x).toBeCloseTo(corners[i].x * 2);
      expect(p.y).toBeCloseTo(corners[i].y * 0.5);
    });
    expect(after.layers[0].kind).toBe('rectangle');
    expect(resizeDocument(before, 200, 120)).toBe(before);
  });
  it('four quarter turns and two flips restore the original document exactly', () => {
    let doc = document();
    for (let i = 0; i < 4; i++) doc = rotateDocument(doc, true);
    // JSON document equality treats IEEE-754 -0 and 0 as the same coordinate.
    for (const restored of [
      doc,
      rotateDocument(rotateDocument(document(), true), false),
      flipDocument(flipDocument(document(), true), true),
      flipDocument(flipDocument(document(), false), false),
    ])
      expect(JSON.stringify(restored)).toBe(JSON.stringify(document()));
  });
  it('inverts affine transforms after translation, rotation and nonuniform scaling', () => {
    for (const angle of [-170, -45, 0, 45, 170]) {
      const m = multiply(
          translate(100, -20),
          multiply(rotation(angle), scale(2, 0.3))
        ),
        p = { x: 31, y: 17 };
      const result = transform(inverse(m), transform(m, p));
      expect(result.x).toBeCloseTo(p.x);
      expect(result.y).toBeCloseTo(p.y);
    }
    expect(() => inverse([0, 0, 0, 0, 0, 0])).toThrow();
  });
  it('corner resizing keeps the opposite corner fixed after rotation', () => {
    const layer = rotateLayer(box(), 45),
      corners = layerCorners(layer),
      target = { x: corners[2].x + 20, y: corners[2].y + 30 };
    const after = resizeLayer(layer, 2, target);
    expect(layerCorners(after)[0].x).toBeCloseTo(corners[0].x);
    expect(layerCorners(after)[0].y).toBeCloseTo(corners[0].y);
    expect(layerCorners(after)[2].x).toBeCloseTo(target.x);
    expect(layerCorners(after)[2].y).toBeCloseTo(target.y);
  });
  it('repeated shrinking never produces an unusable near-singular selection', () => {
    let layer = box();
    for (let i = 0; i < 1000; i++)
      layer = resizeLayer(layer, 2, transform(layer.matrix, { x: 0, y: 0 }));
    expect(
      Math.abs(
        layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]
      )
    ).toBeGreaterThanOrEqual(0.0000999);
    expect(() => hitLayer(layer, { x: 25, y: 15 })).not.toThrow();
    const locked = resizeLayer(box(), 2, { x: 105, y: 75 }, true);
    expect(locked.matrix[0]).toBe(locked.matrix[3]);
  });
  it('rotation preserves the selected layer center', () => {
    const layer = box(),
      after = rotateLayer(layer, 90);
    expect(transform(after.matrix, { x: 20, y: 15 })).toEqual(
      transform(layer.matrix, { x: 20, y: 15 })
    );
  });
  it('long freehand paths are bounded iteratively and retain their geometry', () => {
    const points = Array.from({ length: 250000 }, (_, i) => ({
        x: i * 0.1,
        y: (i % 100) - 50,
      })),
      layer = pathLayer(points);
    expect(layer.width).toBeCloseTo(24999.9);
    expect(layer.height).toBe(99);
    expect(layer.points).toHaveLength(250000);
    expect(pathLayer([])).toMatchObject({ width: 1, height: 1, points: [] });
  });
});

describe('selection follows rendered geometry', () => {
  it('selects topmost painted objects and ignores empty outlines', () => {
    const bottom = box(),
      top = { ...box(), id: 'top', fill: 'transparent' };
    expect(
      hitDocument(
        { ...createDocument(200, 120), layers: [bottom, top] },
        { x: 45, y: 30 }
      )?.id
    ).toBe('box');
    expect(
      hitDocument(
        { ...createDocument(200, 120), layers: [bottom, top] },
        { x: 25, y: 15 }
      )?.id
    ).toBe('top');
    expect(hitLayer(top, { x: 0, y: 0 })).toBe(false);
  });
  it('tests ellipse, line, triangle, text and freehand shapes in local coordinates', () => {
    const layer = box();
    expect(hitLayer({ ...layer, kind: 'ellipse' }, { x: 45, y: 30 })).toBe(
      true
    );
    expect(
      hitLayer(
        { ...layer, kind: 'ellipse', fill: 'transparent' },
        { x: 45, y: 30 }
      )
    ).toBe(false);
    expect(hitLayer({ ...layer, kind: 'line' }, { x: 45, y: 30 })).toBe(true);
    expect(hitLayer({ ...layer, kind: 'arrow' }, { x: 27, y: 40 })).toBe(false);
    expect(hitLayer({ ...layer, kind: 'triangle' }, { x: 45, y: 30 })).toBe(
      true
    );
    expect(
      hitLayer(
        { ...layer, kind: 'triangle', fill: 'transparent' },
        { x: 45, y: 30 },
        0
      )
    ).toBe(false);
    expect(hitLayer({ ...layer, kind: 'text' }, { x: 45, y: 30 })).toBe(true);
    expect(
      hitLayer(
        pathLayer([
          { x: 1, y: 1 },
          { x: 20, y: 20 },
        ]),
        { x: 10, y: 10 }
      )
    ).toBe(true);
    expect(
      hitLayer({ ...layer, matrix: [0, 0, 0, 0, 0, 0] }, { x: 0, y: 0 })
    ).toBe(false);
  });
  it('editing an absent selection is a no-op', () => {
    const doc = document();
    expect(updateLayer(doc, 'missing', { color: 'red' })).toBe(doc);
  });
});

describe('document history', () => {
  it('groups hundreds of pointer previews into one reversible gesture', () => {
    const original = document(),
      history = new DocumentHistory(original);
    history.begin();
    for (let i = 1; i <= 300; i++)
      history.preview(
        updateLayer(original, 'box', { matrix: translate(i, 15) })
      );
    expect(history.past).toHaveLength(0);
    history.commit();
    expect(history.past).toHaveLength(1);
    expect(history.changed).toBe(true);
    const moved = history.current;
    history.undo();
    expect(history.current).toBe(original);
    expect(history.changed).toBe(false);
    history.redo();
    expect(history.current).toBe(moved);
  });
  it('cancel and no-op gestures do not change history or dirty state', () => {
    const doc = document(),
      history = new DocumentHistory(doc);
    history.begin();
    history.preview(resizeDocument(doc, 100, 60));
    history.cancel();
    expect(history.current).toBe(doc);
    expect(history.inTransaction).toBe(false);
    expect(history.past).toHaveLength(0);
    history.begin();
    history.preview({ ...doc });
    expect(history.commit()).toBe(false);
    expect(history.changed).toBe(false);
    history.undo();
    history.redo();
    expect(history.current).toBe(doc);
  });
  it('new edits after undo clear redo, while bounded history retains recent states', () => {
    const history = new DocumentHistory(document(), 2);
    history.commit(resizeDocument(history.current, 100, 60));
    history.commit(resizeDocument(history.current, 50, 30));
    history.commit(resizeDocument(history.current, 40, 20));
    expect(history.past).toHaveLength(2);
    history.undo();
    expect(history.future).toHaveLength(1);
    history.commit(
      cropDocument(history.current, { x: 1, y: 1, width: 20, height: 10 })
    );
    expect(history.future).toHaveLength(0);
  });
});
