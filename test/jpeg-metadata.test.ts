import {
  addJpegExif,
  normalizeJpegExif,
  readJpegExif,
} from '../src/jpegMetadata';
import { exifFixture } from './exif-fixture';

it.each([true, false])(
  'normalizes orientation and size while retaining camera metadata and deleting embedded previews (little endian %s)',
  (little) => {
    const original = exifFixture(6, little),
      normalized = normalizeJpegExif(original, 120, 80)!;
    const view = new DataView(normalized.buffer);
    expect(view.getUint16(28, little)).toBe(1);
    expect(view.getUint32(40, little)).toBe(120);
    expect(view.getUint32(52, little)).toBe(80);
    expect([...normalized.slice(64, 68)]).toEqual([67, 65, 77, 0]);
    expect(view.getUint32(68, little)).toBe(0);
    expect([...normalized.slice(110)]).toEqual(Array(8).fill(0));
    expect(new DataView(original.buffer).getUint16(28, little)).toBe(6);
    expect(original[110]).toBe(255);
  }
);

it('inserts normalized metadata without altering JPEG scan data and rejects malformed directories', () => {
  const jpeg = new Uint8Array([255, 216, 255, 218, 0, 2, 7, 8, 255, 217]),
    combined = addJpegExif(jpeg, exifFixture(), 40, 30),
    metadata = readJpegExif(combined)!;
  expect(metadata).toHaveLength(118);
  expect([...combined.slice(120)]).toEqual([...jpeg.slice(2)]);
  const cyclic = exifFixture();
  new DataView(cyclic.buffer).setUint32(68, 8, true);
  expect(normalizeJpegExif(cyclic, 40, 30)).toBeNull();
  expect(normalizeJpegExif(exifFixture().slice(0, 20), 40, 30)).toBeNull();
  expect(
    readJpegExif(new Uint8Array([255, 216, 255, 225, 255, 255]))
  ).toBeNull();
  expect(readJpegExif(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(addJpegExif(jpeg, null, 40, 30)).toBe(jpeg);
});

it('removes proprietary maker note payloads that can contain original image previews', () => {
  const source = exifFixture(),
    view = new DataView(source.buffer);
  view.setUint16(56, 0x927c, true);
  view.setUint16(58, 7, true);
  view.setUint32(60, 8, true);
  view.setUint32(64, 100, true);
  const normalized = normalizeJpegExif(source, 40, 30)!;
  expect([...normalized.slice(110)]).toEqual(Array(8).fill(0));
  expect(new DataView(normalized.buffer).getUint32(60, true)).toBe(0);
});
