import {
  applyCrop,
  constrainCropRect,
  constrainImageToCrop,
  cropOutputSize,
  CropConstraintError,
  parseCropOptions,
  sourceBounds,
  sourceContainsRect,
  transformImage,
} from '../src/crop';
import {
  createDocument,
  DocumentHistory,
  IDENTITY,
  inverse,
  MAX_PIXELS,
  multiply,
  parseDocument,
  pathLayer,
  rotation,
  transform,
  translate,
} from '../src/model';

const source = { width: 100, height: 80, matrix: IDENTITY };
const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index], 7)
  );

it('validates and clones crop permissions, bounded constraints, grouped presets and custom guides', () => {
  const input = {
    minSize: { width: 10.2, height: 20 },
    maxSize: { width: 200.9, height: 100 },
    presets: [
      {
        id: 'cover',
        label: 'Cover',
        group: 'Output',
        size: { width: 160, height: 90 },
      },
    ],
    guides: { columns: [0.75, 0.25, 0.25], rows: [0.5] },
    enableLimitToggle: true,
  };
  const result = parseCropOptions(input);
  expect(result).toMatchObject({
    interactionFocus: 'selection',
    allowOutsideImage: false,
    enableLimitToggle: true,
    minSize: { width: 11, height: 20 },
    maxSize: { width: 200, height: 100 },
    presets: [{ aspectRatio: 16 / 9 }],
    guides: { columns: [0.25, 0.75], rows: [0.5] },
  });
  result.presets![0].size!.width = 10;
  expect(input.presets[0].size.width).toBe(160);
  expect(
    parseCropOptions({
      guides: 'diagonals',
      handleStyle: 'hook',
      enableZoom: false,
      rotationRange: 90,
    })
  ).toMatchObject({
    guides: 'diagonals',
    handleStyle: 'hook',
    enableZoom: false,
    rotationRange: 90,
  });
});
it.each([
  null,
  [],
  { aspectRatio: 0 },
  { interactionFocus: 'photo' },
  { allowOutsideImage: 1 },
  { maskOpacity: 2 },
  { minSize: { width: 11, height: 1 }, maxSize: { width: 10, height: 100 } },
  {
    minSize: { width: 10.1, height: 1 },
    maxSize: { width: 10.9, height: 100 },
  },
  {
    aspectRatio: 2,
    minSize: { width: 80, height: 60 },
    maxSize: { width: 100, height: 90 },
  },
  { minSize: { width: 8192, height: 8192 } },
  { guides: { columns: [0], rows: [] } },
  {
    presets: [
      { id: 'one', label: 'One' },
      { id: 'one', label: 'Two' },
    ],
  },
  { presets: [{ id: 'one', label: '', aspectRatio: 1 }] },
  {
    presets: [
      {
        id: 'one',
        label: 'One',
        aspectRatio: 1,
        size: { width: 100, height: 50 },
      },
    ],
  },
])('rejects contradictory or invalid crop configuration %#', (input) => {
  expect(() => parseCropOptions(input)).toThrow();
});

it('constrains free dimensions independently instead of violating minimum sizes with uniform shrink', () => {
  const result = constrainCropRect(
    { x: -40, y: -50, width: 200, height: 200 },
    { ...source, width: 200, height: 100 },
    { minSize: { width: 150, height: 50 } }
  );
  expect(result).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  expect(() =>
    constrainCropRect({ x: 0, y: 0, width: 100, height: 80 }, source, {
      minSize: { width: 90, height: 90 },
    })
  ).toThrow(CropConstraintError);
  expect(
    constrainCropRect({ x: -20, y: -30, width: 200, height: 100 }, source, {
      allowOutsideImage: true,
    })
  ).toEqual({ x: -20, y: -30, width: 200, height: 100 });
});

it('uses required host ratios for both number-field axes and preserves resize anchors', () => {
  const rect = { x: 10, y: 10, width: 80, height: 20 };
  expect(
    constrainCropRect(
      rect,
      source,
      { aspectRatio: 2 },
      { aspectRatio: 1, axis: 'width', anchor: { x: 0, y: 0 } }
    )
  ).toEqual({ x: 10, y: 10, width: 80, height: 40 });
  expect(
    constrainCropRect(
      rect,
      source,
      { aspectRatio: 2 },
      { axis: 'height', anchor: { x: 1, y: 1 } }
    )
  ).toEqual({ x: 50, y: 10, width: 40, height: 20 });
  const constrained = constrainCropRect(
    { x: 30, y: 20, width: 200, height: 200 },
    source,
    {},
    { anchor: { x: 0, y: 0 } }
  );
  expect(constrained).toEqual({ x: 30, y: 20, width: 70, height: 60 });
  expect(() =>
    constrainCropRect(
      { x: -1, y: 0, width: 50, height: 50 },
      source,
      {},
      { anchor: { x: 0, y: 0 } }
    )
  ).toThrow(CropConstraintError);
});

it('solves source containment analytically for rotation, reflection, shear and nonuniform scale', () => {
  for (let index = 0; index < 40; index++) {
    const matrix = multiply(
        translate(25 - index, 30 + index),
        multiply(rotation(index * 11), [
          index % 2 ? -1.7 : 1.1,
          0.2,
          0.45,
          0.8,
          0,
          0,
        ])
      ),
      current = { ...source, matrix },
      center = transform(matrix, { x: 50, y: 40 }),
      proposal = {
        x: center.x - 100,
        y: center.y - 80,
        width: 200,
        height: 160,
      };
    const free = constrainCropRect(proposal, current),
      ratio = constrainCropRect(proposal, current, { aspectRatio: 16 / 9 });
    expect(sourceContainsRect(current, free)).toBe(true);
    expect(sourceContainsRect(current, ratio)).toBe(true);
    expect(ratio.width / ratio.height).toBeCloseTo(16 / 9);
    const anchored = constrainCropRect(
      proposal,
      current,
      {},
      { anchor: { x: 0.5, y: 0.5 } }
    );
    expect(anchored.x + anchored.width / 2).toBeCloseTo(center.x, 8);
    expect(anchored.y + anchored.height / 2).toBeCloseTo(center.y, 8);
    expect(sourceContainsRect(current, anchored)).toBe(true);
    const again = constrainCropRect(ratio, current, { aspectRatio: 16 / 9 });
    close(
      [again.x, again.y, again.width, again.height],
      [ratio.x, ratio.y, ratio.width, ratio.height]
    );
  }
});

it('zooms only as needed and translates the image beneath a stationary crop without accumulating drift', () => {
  const crop = { x: 0, y: 0, width: 100, height: 80 };
  expect(constrainImageToCrop(IDENTITY, source, crop)).toBe(IDENTITY);
  expect(constrainImageToCrop(translate(20, -10), source, crop)).toEqual(
    IDENTITY
  );
  for (const angle of [1, 15, 45, 75, 90, 135, 180, 270]) {
    const candidate = multiply(
      translate(50, 40),
      multiply(rotation(angle), translate(-50, -40))
    );
    const result = constrainImageToCrop(candidate, source, crop);
    expect(sourceContainsRect({ ...source, matrix: result }, crop)).toBe(true);
    const determinant = result[0] * result[3] - result[1] * result[2];
    const radians = (angle * Math.PI) / 180;
    const expected = Math.max(
      1,
      (Math.abs(Math.cos(radians)) * 100 + Math.abs(Math.sin(radians)) * 80) /
        100,
      (Math.abs(Math.sin(radians)) * 100 + Math.abs(Math.cos(radians)) * 80) /
        80
    );
    expect(Math.sqrt(determinant)).toBeCloseTo(expected, 8);
    let repeated = result;
    for (let i = 0; i < 100; i++)
      repeated = constrainImageToCrop(repeated, source, crop);
    close(repeated, result);
    expect(constrainImageToCrop(candidate, source, crop, true)).toBe(candidate);
  }
  expect(() =>
    constrainImageToCrop([0, 0, 0, 0, 0, 0], source, crop, true)
  ).toThrow(CropConstraintError);
  expect(() =>
    constrainImageToCrop([Infinity, 0, 0, 1, 0, 0], source, crop)
  ).toThrow(CropConstraintError);
});

it('keeps source annotations attached while crop-bound frames and the viewport remain fixed', () => {
  const layer = pathLayer([
      { x: 10, y: 15 },
      { x: 20, y: 30 },
    ]),
    original = {
      ...createDocument(100, 80),
      layers: [layer],
      frame: { style: 'solid' as const, width: 4, color: '#fff' },
      background: '#f00',
      cornerRadius: 5,
    },
    delta = multiply(translate(12, 8), rotation(23)),
    moved = transformImage(original, delta);
  expect([
    moved.width,
    moved.height,
    moved.frame,
    moved.background,
    moved.cornerRadius,
  ]).toEqual([100, 80, original.frame, '#f00', 5]);
  close(
    multiply(inverse(moved.imageMatrix), moved.layers[0].matrix),
    layer.matrix
  );
  expect(transformImage(original, IDENTITY)).toBe(original);
  const history = new DocumentHistory(original);
  history.begin();
  history.preview(moved);
  history.commit(
    applyCrop(moved, { x: 15, y: 15, width: 40, height: 30 }, source)
  );
  expect(history.past).toHaveLength(1);
  const saved = parseDocument(JSON.stringify(history.current));
  close(
    multiply(inverse(saved.imageMatrix), saved.layers[0].matrix),
    layer.matrix
  );
  history.undo();
  expect(history.current).toBe(original);
  history.redo();
  expect(history.current.width).toBe(40);
});

it('recovers previously cropped pixels through negative origins and validates outside-image extension', () => {
  const original = createDocument(100, 80),
    first = applyCrop(
      original,
      { x: 20, y: 15, width: 40, height: 30 },
      source
    );
  expect(sourceBounds({ ...source, matrix: first.imageMatrix })).toEqual({
    x: -20,
    y: -15,
    width: 100,
    height: 80,
  });
  const recovered = applyCrop(
    first,
    { x: -20, y: -15, width: 100, height: 80 },
    source
  );
  expect(recovered).toEqual(original);
  const extended = applyCrop(
    first,
    { x: -30, y: -20, width: 120, height: 100 },
    source,
    { allowOutsideImage: true }
  );
  expect(extended).toMatchObject({
    width: 120,
    height: 100,
    imageMatrix: [1, 0, 0, 1, 10, 5],
  });
});

it('quantizes valid fractional crops without exceeding pixel caps or configured dimensions', () => {
  const edge = Math.sqrt(MAX_PIXELS),
    candidate = { x: 0, y: 0, width: edge, height: edge };
  const output = cropOutputSize(candidate);
  expect(output.width * output.height).toBeLessThanOrEqual(MAX_PIXELS);
  expect(Math.abs(output.width - edge)).toBeLessThan(1);
  expect(Math.abs(output.height - edge)).toBeLessThan(1);
  const original = createDocument(8192, 4096),
    crop = constrainCropRect(
      candidate,
      { width: 8192, height: 8192, matrix: IDENTITY },
      { aspectRatio: 1 }
    );
  expect(
    applyCrop(original, crop, { width: 8192, height: 8192 }, { aspectRatio: 1 })
  ).toMatchObject(output);
  const settings = {
    aspectRatio: 16 / 9,
    minSize: { width: 99.2, height: 55.2 },
    maxSize: { width: 100.8, height: 57.8 },
  };
  const exact = constrainCropRect(
    { x: 0, y: 0, width: 100, height: 57 },
    { ...source, width: 200, height: 200 },
    settings
  );
  expect(exact.width / exact.height).toBeCloseTo(16 / 9);
  expect(cropOutputSize(exact, settings)).toEqual({ width: 100, height: 56 });
  expect(
    applyCrop(
      createDocument(200, 200),
      exact,
      { width: 200, height: 200 },
      settings
    )
  ).toMatchObject({ width: 100, height: 56 });
});
