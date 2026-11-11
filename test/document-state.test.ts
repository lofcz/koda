import {
  createDocument,
  DEFAULT_EFFECTS,
  duplicateLayer,
  flipLayer,
  layerCorners,
  parseDocument,
  pathLayer,
  reorderLayer,
  resizeDocument,
  straightenDocument,
  transform,
  translate,
} from '../src/model';

it('straightening preserves the center and applies the same transform to the photo and editable layers', () => {
  const layer = pathLayer([
      { x: 5, y: 8 },
      { x: 20, y: 30 },
    ]),
    doc = { ...createDocument(200, 100), layers: [layer] },
    next = straightenDocument(doc, 15);
  expect(transform(next.imageMatrix, { x: 100, y: 50 })).toEqual({
    x: 100,
    y: 50,
  });
  const expected = transform(next.imageMatrix, { x: 5, y: 8 });
  expect(transform(next.layers[0].matrix, { x: 0, y: 0 })).toEqual(expected);
  expect(straightenDocument(doc, 0)).toBe(doc);
  expect(straightenDocument(doc, 90, true)).toMatchObject({
    width: 100,
    height: 200,
  });
  expect(() => straightenDocument(doc, NaN)).toThrow();
});

it('flipping a layer preserves its center and reversing twice restores every corner', () => {
  const layer = pathLayer([
    { x: 5, y: 8 },
    { x: 20, y: 30 },
  ]);
  const flipped = flipLayer(layer, true);
  expect(layerCorners(flipped)[0]).toEqual(layerCorners(layer)[1]);
  expect(layerCorners(flipLayer(flipped, true))).toEqual(layerCorners(layer));
});

it('duplication keeps independent transforms and stacking changes preserve every layer', () => {
  const first = pathLayer([{ x: 0, y: 0 }]),
    second = pathLayer([{ x: 30, y: 40 }]),
    doc = { ...createDocument(100, 100), layers: [first, second] },
    duplicate = duplicateLayer(doc, first.id);
  expect(duplicate.layers).toHaveLength(3);
  expect(duplicate.layers[0]).toBe(first);
  expect(duplicate.layers[1].id).not.toBe(first.id);
  expect(duplicate.layers[1].matrix).toEqual(translate(20, 20));
  expect(duplicate.layers[2]).toBe(second);
  expect(reorderLayer(doc, first.id, 'front').layers).toEqual([second, first]);
  expect(reorderLayer(doc, first.id, 'back')).toBe(doc);
  expect(reorderLayer(doc, second.id, 'backward').layers).toEqual([
    second,
    first,
  ]);
  expect(duplicateLayer(doc, 'missing')).toBe(doc);
});

it('resizing scales frames and corners along with the pixel document', () => {
  const doc = {
    ...createDocument(200, 100),
    cornerRadius: 20,
    frame: { style: 'solid' as const, width: 10, color: '#fff' },
  };
  expect(resizeDocument(doc, 100, 50)).toMatchObject({
    cornerRadius: 10,
    frame: { width: 5 },
  });
});

it('persisted documents round trip independently with embedded stickers and richer layer styles', () => {
  const text = {
      ...pathLayer([]),
      kind: 'text' as const,
      text: 'A\nB',
      textAlign: 'center' as const,
      underline: true,
    },
    image = {
      ...pathLayer([]),
      kind: 'image' as const,
      imageSource: 'data:image/png;base64,AA==',
    },
    redaction = {
      ...pathLayer([]),
      kind: 'redaction' as const,
      redactionMode: 'blur' as const,
      redactionSize: 8,
    },
    doc = {
      ...createDocument(400, 250),
      layers: [text, image, redaction],
      background: '#fff',
      effects: { ...DEFAULT_EFFECTS, gamma: 10, preset: 'chrome' as const },
    };
  const parsed = parseDocument(JSON.stringify(doc));
  expect(parsed).toMatchObject(doc);
  parsed.effects.gamma = 30;
  expect(doc.effects.gamma).toBe(10);
  expect(parsed.layers[0].matrix).not.toBe(text.matrix);
  expect(parsed.layers[0]).toMatchObject({
    fontSize: 40,
    lineHeight: 1.2,
    textAlign: 'center',
  });
});

it('validates a complete restored state before admitting transforms, asset URLs or malformed layer IDs', () => {
  const doc = createDocument(100, 100),
    layer = pathLayer([]);
  for (const invalid of [
    { ...doc, imageMatrix: [0, 0, 0, 0, 0, 0] },
    { ...doc, effects: { ...DEFAULT_EFFECTS, gamma: NaN } },
    { ...doc, layers: [layer, layer] },
    { ...doc, layers: [{ ...layer, opacity: 2 }] },
    {
      ...doc,
      layers: [{ ...layer, kind: 'image', imageSource: 'javascript:alert(1)' }],
    },
    {
      ...doc,
      layers: [
        { ...layer, kind: 'image', imageSource: 'data:text/html;base64,AA==' },
      ],
    },
    { ...doc, frame: { style: 'other', width: 1, color: 'red' } },
  ])
    expect(() => parseDocument(invalid)).toThrow();
});

it('restores earlier documents with neutral defaults for newly introduced properties', () => {
  const doc = parseDocument({
    width: 30,
    height: 20,
    imageMatrix: [1, 0, 0, 1, 0, 0],
    layers: [],
    effects: { preset: 'none', brightness: 0, contrast: 0, saturation: 0 },
  });
  expect(doc).toEqual(createDocument(30, 20));
});
