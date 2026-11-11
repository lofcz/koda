import { blurPixels, filterPixels, fitView, zoomAt } from '../src/render';
import { createDocument, DEFAULT_EFFECTS } from '../src/model';

it('effects preserve alpha and leave an unfiltered image unchanged', () => {
  const bytes = new Uint8ClampedArray([
      255, 30, 10, 0, 0, 100, 200, 128, 90, 90, 90, 255,
    ]),
    original = bytes.slice();
  filterPixels(bytes, DEFAULT_EFFECTS);
  expect(bytes).toEqual(original);
  for (const preset of ['grayscale', 'sepia', 'invert', 'vintage'] as const) {
    const pixels = original.slice();
    filterPixels(pixels, {
      ...DEFAULT_EFFECTS,
      preset,
      contrast: 20,
      brightness: 10,
      saturation: -30,
    });
    expect([pixels[3], pixels[7], pixels[11]]).toEqual([0, 128, 255]);
  }
});
it('grayscale channels match and inversion uses the original RGB channels', () => {
  const gray = new Uint8ClampedArray([220, 90, 20, 170]);
  filterPixels(gray, { ...DEFAULT_EFFECTS, preset: 'grayscale' });
  expect(gray[0]).toBe(gray[1]);
  expect(gray[1]).toBe(gray[2]);
  const inverted = new Uint8ClampedArray([20, 70, 200, 30]);
  filterPixels(inverted, { ...DEFAULT_EFFECTS, preset: 'invert' });
  expect(inverted).toEqual(new Uint8ClampedArray([235, 185, 55, 30]));
});
it('fit uses image dimensions and zoom leaves the anchored image pixel fixed', () => {
  const view = fitView(createDocument(400, 200), 500, 300);
  expect(view).toEqual({ zoom: 1.17, x: 16, y: 33 });
  const anchor = { x: 250, y: 150 },
    next = zoomAt(view, view.zoom * 2, anchor);
  expect((anchor.x - next.x) / next.zoom).toBeCloseTo(
    (anchor.x - view.x) / view.zoom
  );
  expect((anchor.y - next.y) / next.zoom).toBeCloseTo(
    (anchor.y - view.y) / view.zoom
  );
  expect(zoomAt(view, 1000, anchor).zoom).toBe(32);
  expect(zoomAt(view, 0, anchor).zoom).toBe(0.01);
});

it('all adjustment controls preserve alpha, and exposure and gamma have neutral zero values', () => {
  const original = new Uint8ClampedArray([
    50, 80, 100, 77, 200, 100, 40, 0, 90, 90, 90, 255, 40, 70, 100, 128,
  ]);
  for (const key of [
    'exposure',
    'gamma',
    'temperature',
    'clarity',
    'vignette',
  ] as const) {
    const pixels = original.slice();
    filterPixels(pixels, { ...DEFAULT_EFFECTS, [key]: 50 }, 2, 2);
    expect(pixels.filter((_, i) => i % 4 === 3)).toEqual(
      original.filter((_, i) => i % 4 === 3)
    );
    expect(pixels).not.toEqual(original);
  }
  const exposed = new Uint8ClampedArray([20, 40, 80, 255]);
  filterPixels(exposed, { ...DEFAULT_EFFECTS, exposure: 50 });
  expect(exposed).toEqual(new Uint8ClampedArray([40, 80, 160, 255]));
});

it('vignette is strongest at the corners and clarity softens or sharpens local detail', () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4).fill(160);
  filterPixels(pixels, { ...DEFAULT_EFFECTS, vignette: 100 }, 5, 5);
  expect(pixels[0]).toBeLessThan(pixels[(2 * 5 + 2) * 4]);
  expect(pixels[(2 * 5 + 2) * 4]).toBe(160);
  const light = new Uint8ClampedArray(5 * 5 * 4);
  filterPixels(light, { ...DEFAULT_EFFECTS, vignette: -100 }, 5, 5);
  expect(light[0]).toBeGreaterThan(0);
  expect(light[(2 * 5 + 2) * 4]).toBe(0);
  expect(light[3]).toBe(0);
  const soft = new Uint8ClampedArray([
      0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 0, 0, 0, 255, 100, 100,
      100, 255, 0, 0, 0, 255,
    ]),
    sharp = soft.slice();
  filterPixels(soft, { ...DEFAULT_EFFECTS, clarity: -100 }, 3, 2);
  filterPixels(sharp, { ...DEFAULT_EFFECTS, clarity: 100 }, 3, 2);
  expect(soft[4]).toBeLessThan(100);
  expect(sharp[4]).toBeGreaterThan(100);
});

it('blur weights transparent pixels by alpha rather than adding dark fringes', () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  blurPixels(pixels, 3, 1, 1);
  expect([...pixels.slice(4, 8)]).toEqual([255, 0, 0, 85]);
});

it('filter families produce distinct, repeatable pixels while preserving alpha', () => {
  const outputs = new Set<string>();
  for (const preset of [
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
  ] as const) {
    const pixels = new Uint8ClampedArray([170, 90, 30, 128]);
    filterPixels(pixels, { ...DEFAULT_EFFECTS, preset });
    expect(pixels[3]).toBe(128);
    outputs.add([...pixels].join(','));
  }
  expect(outputs.size).toBe(11);
});
