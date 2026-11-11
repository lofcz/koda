/** Tiny original TIFF directory with orientation, size, camera make and a thumbnail. */
export function exifFixture(orientation = 6, little = true) {
  const bytes = new Uint8Array(118),
    view = new DataView(bytes.buffer);
  bytes.set([
    255,
    225,
    0,
    116,
    69,
    120,
    105,
    102,
    0,
    0,
    little ? 73 : 77,
    little ? 73 : 77,
  ]);
  const short = (offset: number, value: number) =>
      view.setUint16(offset, value, little),
    long = (offset: number, value: number) =>
      view.setUint32(offset, value, little);
  short(12, 42);
  long(14, 8);
  short(18, 4);
  const entry = (
    offset: number,
    tag: number,
    type: number,
    count: number,
    value: number
  ) => {
    short(offset, tag);
    short(offset + 2, type);
    long(offset + 4, count);
    if (type === 3) short(offset + 8, value);
    else long(offset + 8, value);
  };
  entry(20, 0x0112, 3, 1, orientation);
  entry(32, 0x0100, 4, 1, 320);
  entry(44, 0x0101, 4, 1, 200);
  entry(56, 0x010f, 2, 4, 0);
  bytes.set([67, 65, 77, 0], 64);
  long(68, 62);
  short(72, 2);
  entry(74, 0x0201, 4, 1, 100);
  entry(86, 0x0202, 4, 1, 8);
  long(98, 0);
  bytes.set([255, 216, 1, 2, 3, 4, 255, 217], 110);
  return bytes;
}
