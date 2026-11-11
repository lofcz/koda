import { filterPixels, fitView, zoomAt } from '../src/render';
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
