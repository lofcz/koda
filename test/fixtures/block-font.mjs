/**
 * Builds a tiny TrueType font in memory for browser tests, so no font file is
 * fetched from the internet or committed. Every printable ASCII character is a
 * solid square (x 100..900, y 0..700 of a 1000-unit em) advancing one em; the
 * space is empty. Text in this face is easy to tell from any fallback by both
 * width and pixels. Released to the public domain (CC0).
 */
export function blockFont(familyName = 'RIE Block') {
  const glyphCount = 2 + 94;
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const i16 = (n) => u16(n < 0 ? n + 65536 : n);
  const u32 = (n) => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
  const square = [
    ...i16(1),
    ...i16(100),
    ...i16(0),
    ...i16(900),
    ...i16(700),
    ...u16(3),
    ...u16(0),
    1,
    1,
    1,
    1,
    // x deltas: 100, 0, 800, 0; y deltas: 0, 700, 0, -700 (clockwise).
    ...i16(100),
    ...i16(0),
    ...i16(800),
    ...i16(0),
    ...i16(0),
    ...i16(700),
    ...i16(0),
    ...i16(-700),
  ];
  const glyf = [],
    loca = [];
  for (let glyph = 0; glyph < glyphCount; glyph++) {
    loca.push(...u16(glyf.length / 2));
    if (glyph >= 2) glyf.push(...square);
  }
  loca.push(...u16(glyf.length / 2));
  const head = [
    ...u32(0x00010000),
    ...u32(0x00010000),
    ...u32(0),
    ...u32(0x5f0f3cf5),
    ...u16(0x000b),
    ...u16(1000),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...i16(0),
    ...i16(0),
    ...i16(900),
    ...i16(700),
    ...u16(0),
    ...u16(8),
    ...i16(2),
    ...i16(0),
    ...i16(0),
  ];
  const hhea = [
    ...u32(0x00010000),
    ...i16(800),
    ...i16(-200),
    ...i16(0),
    ...u16(1000),
    ...i16(0),
    ...i16(0),
    ...i16(900),
    ...i16(1),
    ...i16(0),
    ...i16(0),
    ...i16(0),
    ...i16(0),
    ...i16(0),
    ...i16(0),
    ...i16(0),
    ...u16(glyphCount),
  ];
  const maxp = [
    ...u32(0x00010000),
    ...u16(glyphCount),
    ...u16(4),
    ...u16(1),
    ...u16(0),
    ...u16(0),
    ...u16(2),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
  ];
  const os2 = [
    ...u16(4),
    ...i16(1000),
    ...u16(400),
    ...u16(5),
    ...u16(0),
    ...i16(650),
    ...i16(600),
    ...i16(0),
    ...i16(75),
    ...i16(650),
    ...i16(600),
    ...i16(0),
    ...i16(350),
    ...i16(50),
    ...i16(250),
    ...i16(0),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...[...'RIE '].map((c) => c.charCodeAt(0)),
    ...u16(0x40),
    ...u16(0x20),
    ...u16(0x7e),
    ...i16(800),
    ...i16(-200),
    ...i16(0),
    ...u16(800),
    ...u16(200),
    ...u32(1),
    ...u32(0),
    ...i16(700),
    ...i16(700),
    ...u16(0),
    ...u16(32),
    ...u16(1),
  ];
  const hmtx = [];
  for (let glyph = 0; glyph < glyphCount; glyph++)
    hmtx.push(...u16(1000), ...i16(glyph >= 2 ? 100 : 0));
  const segments = [
    [0x20, 0x20, 1 - 0x20],
    [0x21, 0x7e, 2 - 0x21],
    [0xffff, 0xffff, 1],
  ];
  const segX2 = segments.length * 2;
  const cmapBody = [
    ...u16(segX2),
    ...u16(4),
    ...u16(1),
    ...u16(segX2 - 4),
    ...segments.flatMap(([, end]) => u16(end)),
    ...u16(0),
    ...segments.flatMap(([start]) => u16(start)),
    ...segments.flatMap(([, , delta]) =>
      i16(((delta + 32768) % 65536) - 32768)
    ),
    ...segments.flatMap(() => u16(0)),
  ];
  const subtable = [
    ...u16(4),
    ...u16(6 + cmapBody.length),
    ...u16(0),
    ...cmapBody,
  ];
  const cmap = [
    ...u16(0),
    ...u16(1),
    ...u16(3),
    ...u16(1),
    ...u32(12),
    ...subtable,
  ];
  const names = [
    [1, familyName],
    [2, 'Regular'],
    [3, `${familyName} Regular`],
    [4, `${familyName} Regular`],
    [6, familyName.replace(/\s+/g, '') + '-Regular'],
  ];
  const storage = [],
    records = [];
  for (const [id, text] of names) {
    const bytes = [...text].flatMap((c) => u16(c.charCodeAt(0)));
    records.push(
      ...u16(3),
      ...u16(1),
      ...u16(0x409),
      ...u16(id),
      ...u16(bytes.length),
      ...u16(storage.length)
    );
    storage.push(...bytes);
  }
  const name = [
    ...u16(0),
    ...u16(names.length),
    ...u16(6 + records.length),
    ...records,
    ...storage,
  ];
  const post = [
    ...u32(0x00030000),
    ...u32(0),
    ...i16(-100),
    ...i16(50),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u32(0),
  ];
  const tables = Object.entries({
    'OS/2': os2,
    cmap,
    glyf,
    head,
    hhea,
    hmtx,
    loca,
    maxp,
    name,
    post,
  }).sort(([a], [b]) => (a < b ? -1 : 1));
  const checksum = (bytes) => {
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4)
      sum =
        (sum +
          (((bytes[i] ?? 0) << 24) |
            ((bytes[i + 1] ?? 0) << 16) |
            ((bytes[i + 2] ?? 0) << 8) |
            (bytes[i + 3] ?? 0))) >>>
        0;
    return sum;
  };
  const count = tables.length,
    power = 2 ** Math.floor(Math.log2(count));
  const directory = [
    ...u32(0x00010000),
    ...u16(count),
    ...u16(power * 16),
    ...u16(Math.log2(power)),
    ...u16(count * 16 - power * 16),
  ];
  let offset = 12 + count * 16;
  const body = [];
  let headOffset = 0;
  for (const [tag, bytes] of tables) {
    if (tag === 'head') headOffset = offset;
    directory.push(
      ...[...tag].map((c) => c.charCodeAt(0)),
      ...u32(checksum(bytes)),
      ...u32(offset),
      ...u32(bytes.length)
    );
    const padded = [...bytes];
    while (padded.length % 4) padded.push(0);
    body.push(...padded);
    offset += padded.length;
  }
  const font = new Uint8Array([...directory, ...body]);
  const adjustment = (0xb1b0afba - checksum(font)) >>> 0;
  font.set(u32(adjustment), headOffset + 8);
  return font;
}
