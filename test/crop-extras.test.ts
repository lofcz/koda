import {
  applyCrop,
  centerCropOnSource,
  cropBleedInsets,
  CropConstraintError,
  parseCropBleed,
  parseCropOptions,
  sourceContainsRect,
  straightenAngle,
  transformImage,
} from '../src/crop';
import { formatAngle, parseAngle } from '../src/CropStraighten';
import {
  createDocument,
  flipDocument,
  IDENTITY,
  multiply,
  rotateDocument,
  rotation,
  scale,
  translate,
} from '../src/model';
import type { Matrix } from '../src/model';
import { translator } from '../src/locale';

const about = (matrix: Matrix, x: number, y: number): Matrix =>
  multiply(translate(x, y), multiply(matrix, translate(-x, -y)));

it('resolves profile and print overlays with host defaults and preset overrides', () => {
  expect(parseCropOptions({})).toMatchObject({ overlay: 'none', bleed: null });
  expect(
    parseCropOptions({
      overlay: 'circle',
      bleed: { bleed: 36, safe: 24 },
      presets: [
        {
          id: 'profile',
          label: 'Profile',
          aspectRatio: 1,
          overlay: 'circle',
        },
        {
          id: 'print',
          label: 'Postcard',
          size: { width: 1800, height: 1200 },
          bleed: { bleed: 0.02, safe: 0.03, unit: 'fraction' },
        },
        { id: 'plain', label: 'Plain', bleed: null },
      ],
    })
  ).toMatchObject({
    overlay: 'circle',
    bleed: { bleed: 36, safe: 24, unit: 'px' },
    presets: [
      { id: 'profile', overlay: 'circle' },
      { id: 'print', bleed: { bleed: 0.02, safe: 0.03, unit: 'fraction' } },
      { id: 'plain', bleed: null },
    ],
  });
  expect(parseCropBleed(undefined)).toBeNull();
  expect(parseCropBleed({ safe: 10 })).toEqual({
    bleed: 0,
    safe: 10,
    unit: 'px',
  });
  // Presets without overlay settings leave the keys absent so the host option applies.
  expect(
    parseCropOptions({ presets: [{ id: 'a', label: 'A' }] }).presets![0]
  ).not.toHaveProperty('overlay');
});

it.each([
  { overlay: 'square' },
  { overlay: true },
  { bleed: 3 },
  { bleed: { bleed: -1 } },
  { bleed: { safe: Number.NaN } },
  { bleed: { bleed: 1, unit: 'mm' } },
  { bleed: { bleed: 0.3, safe: 0.2, unit: 'fraction' } },
  { bleed: { bleed: 5000 } },
  { presets: [{ id: 'a', label: 'A', overlay: 'oval' }] },
  { presets: [{ id: 'a', label: 'A', bleed: { bleed: -2 } }] },
])('rejects invalid overlay configuration %#', (input) => {
  expect(() => parseCropOptions(input)).toThrow(CropConstraintError);
});

it('measures print insets in output pixels or fractions of the shorter side', () => {
  // A crop shown at half the output resolution maps output pixels to half crop units.
  expect(
    cropBleedInsets(
      { width: 900, height: 600 },
      { width: 1800, height: 1200 },
      { bleed: 36, safe: 24, unit: 'px' }
    )
  ).toEqual({ bleed: { x: 18, y: 18 }, safe: { x: 30, y: 30 } });
  const fraction = cropBleedInsets(
    { width: 400, height: 200 },
    { width: 400, height: 200 },
    { bleed: 0.05, safe: 0.1, unit: 'fraction' }
  );
  for (const [point, expected] of [
    [fraction.bleed, 10],
    [fraction.safe, 30],
  ] as const) {
    expect(point.x).toBeCloseTo(expected, 9);
    expect(point.y).toBeCloseTo(expected, 9);
  }
  // Oversized pixel insets stop at the crop center instead of inverting.
  expect(
    cropBleedInsets(
      { width: 100, height: 40 },
      { width: 100, height: 40 },
      { bleed: 30, safe: 0, unit: 'px' }
    ).bleed
  ).toEqual({ x: 30, y: 20 });
});

it('derives the straighten angle from the image matrix through quarter turns, flips and crops', () => {
  expect(straightenAngle(IDENTITY)).toBe(0);
  expect(straightenAngle(rotation(-3.5))).toBeCloseTo(-3.5, 9);
  expect(straightenAngle(rotation(12))).toBeCloseTo(12, 9);
  // A quarter turn on top of a tilt keeps the tilt.
  expect(straightenAngle(multiply(rotation(90), rotation(-7)))).toBeCloseTo(
    -7,
    9
  );
  expect(straightenAngle(multiply(rotation(180), rotation(5)))).toBeCloseTo(
    5,
    9
  );
  // Mirroring a tilted image mirrors its visible tilt.
  expect(straightenAngle(multiply(scale(-1, 1), rotation(8)))).toBeCloseTo(
    -8,
    9
  );
  expect(straightenAngle(multiply(scale(1, -1), rotation(8)))).toBeCloseTo(
    -8,
    9
  );
  // A tilt applied after a flip reads back unchanged.
  expect(straightenAngle(multiply(rotation(8), scale(-1, 1)))).toBeCloseTo(
    8,
    9
  );
  // Document quarter turns and flips used by the selection-mode controls.
  let doc = transformImage(
    createDocument(600, 400),
    about(rotation(6), 300, 200)
  );
  doc = rotateDocument(doc, true);
  expect(straightenAngle(doc.imageMatrix)).toBeCloseTo(6, 9);
  doc = flipDocument(doc, true);
  expect(straightenAngle(doc.imageMatrix)).toBeCloseTo(-6, 9);
  // Committing a crop with uniform output scale keeps the angle.
  const cropped = applyCrop(
    doc,
    { x: 120, y: 120, width: 200, height: 150 },
    { width: 600, height: 400 },
    { allowOutsideImage: true }
  );
  expect(straightenAngle(cropped.imageMatrix)).toBeCloseTo(-6, 6);
});

it('keeps angles above 45° when the host range allows them', () => {
  const tilted = rotation(60);
  expect(straightenAngle(tilted)).toBeCloseTo(-30, 9);
  expect(straightenAngle(tilted, 90, 55)).toBeCloseTo(60, 9);
  expect(straightenAngle(tilted, 90, -20)).toBeCloseTo(-30, 9);
  // Equivalent angles outside a narrow range fall back to the nearest quarter turn.
  expect(straightenAngle(rotation(40), 10)).toBe(10);
  expect(Object.is(straightenAngle(rotation(-1e-9)), -0)).toBe(false);
  expect(() => straightenAngle([0, 0, 0, 0, 0, 0])).toThrow(
    CropConstraintError
  );
});

it('centers the crop on the transformed source without resizing it', () => {
  const source = { width: 600, height: 400, matrix: translate(-300, 0) };
  expect(
    centerCropOnSource({ x: 0, y: 0, width: 300, height: 400 }, source)
  ).toEqual({ x: -150, y: 0, width: 300, height: 400 });
  const tilted = {
    width: 600,
    height: 400,
    matrix: about(rotation(10), 300, 200),
  };
  const rect = { x: 20, y: 30, width: 200, height: 120 },
    centered = centerCropOnSource(rect, tilted);
  expect(centered.width).toBeCloseTo(200, 9);
  expect(centered.height).toBeCloseTo(120, 9);
  expect(centered.x + centered.width / 2).toBeCloseTo(300, 9);
  expect(centered.y + centered.height / 2).toBeCloseTo(200, 9);
  expect(sourceContainsRect(tilted, centered)).toBe(true);
  // An oversized crop shrinks only as far as the source requires.
  const shrunk = centerCropOnSource(
    { x: 0, y: 0, width: 600, height: 400 },
    tilted,
    { aspectRatio: 1.5 }
  );
  expect(shrunk.width / shrunk.height).toBeCloseTo(1.5, 9);
  expect(sourceContainsRect(tilted, shrunk, 1e-6)).toBe(true);
});

it('formats and parses typed angles in every locale', () => {
  expect(formatAngle(-3.5, 'en')).toBe('−3.5');
  expect(formatAngle(-3.5, 'cs')).toBe('−3,5');
  expect(formatAngle(2.004, 'pl')).toBe('2');
  expect(formatAngle(-0.001, 'en')).toBe('0');
  expect(formatAngle(1.25, 'not a locale!')).toBe('1.25');
  for (const [text, value] of [
    ['-3.5', -3.5],
    ['−3,5', -3.5],
    ['–12°', -12],
    [' 7 ° ', 7],
    ['+.5', 0.5],
  ] as const)
    expect(parseAngle(text)).toBe(value);
  for (const text of ['', '-', 'abc', '1e3', '3..5', '--2'])
    expect(parseAngle(text)).toBeNull();
  for (const locale of ['en', 'cs', 'sk', 'pl']) {
    const t = translator({ locale });
    for (const key of [
      'crop.straighten_angle',
      'crop.straighten_reset',
      'crop.center_image_hint',
      'crop.center_selection_hint',
      'crop.overlay_circle',
      'crop.overlay_circle_hint',
      'crop.bleed_hint',
      'crop.safe_hint',
    ])
      expect(t(key)).not.toBe(key);
  }
});
