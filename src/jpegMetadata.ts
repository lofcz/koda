/** JPEG APP1/Exif handling. No browser or package dependencies. */
export function readJpegExif(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let position = 2; position + 4 <= bytes.length;) {
    if (bytes[position] !== 0xff) return null;
    const marker = bytes[position + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const size = (bytes[position + 2] << 8) | bytes[position + 3];
    if (size < 2 || position + 2 + size > bytes.length) return null;
    if (
      marker === 0xe1 &&
      size >= 16 &&
      bytes[position + 4] === 69 &&
      bytes[position + 5] === 120 &&
      bytes[position + 6] === 105 &&
      bytes[position + 7] === 102 &&
      bytes[position + 8] === 0 &&
      bytes[position + 9] === 0
    )
      return bytes.slice(position, position + size + 2);
    position += size + 2;
  }
  return null;
}

/** Keep descriptive EXIF while ensuring metadata cannot contain an unedited preview. */
export function normalizeJpegExif(
  original: Uint8Array,
  width: number,
  height: number
): Uint8Array | null {
  const bytes = original.slice(),
    tiff = 10,
    view = new DataView(bytes.buffer),
    little = bytes[tiff] === 73 && bytes[tiff + 1] === 73;
  if (!little && !(bytes[tiff] === 77 && bytes[tiff + 1] === 77)) return null;
  const u16 = (offset: number) =>
      offset >= 0 && offset + 2 <= bytes.length
        ? view.getUint16(offset, little)
        : null,
    u32 = (offset: number) =>
      offset >= 0 && offset + 4 <= bytes.length
        ? view.getUint32(offset, little)
        : null;
  if (u16(tiff + 2) !== 42) return null;
  const seen = new Set<number>();
  const clearValue = (entry: number, length: number) => {
    const offset =
      length <= 4 ? entry + 8 : tiff + (u32(entry + 8) ?? bytes.length);
    if (offset >= tiff && offset + length <= bytes.length)
      bytes.fill(0, offset, offset + length);
    view.setUint32(entry + 4, 0, little);
    view.setUint32(entry + 8, 0, little);
  };
  const directory = (relative: number, thumbnail = false): boolean => {
    const offset = tiff + relative;
    if (seen.has(offset)) return false;
    seen.add(offset);
    const count = u16(offset);
    if (
      count === null ||
      offset + 2 + count * 12 + 4 > bytes.length ||
      count > 4096
    )
      return false;
    let thumbnailOffset = 0,
      thumbnailLength = 0;
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12,
        tag = u16(entry)!,
        type = u16(entry + 2)!,
        amount = u32(entry + 4)!;
      if (tag === 0x8769 || tag === 0x8825) {
        const child = u32(entry + 8);
        if (child && !directory(child)) return false;
      }
      if (tag === 0x927c) {
        const lengths: Record<number, number> = {
          1: 1,
          2: 1,
          3: 2,
          4: 4,
          5: 8,
          7: 1,
          9: 4,
          10: 8,
        };
        clearValue(entry, amount * (lengths[type] ?? 1));
      }
      if (thumbnail && tag === 0x0201) thumbnailOffset = u32(entry + 8) ?? 0;
      if (thumbnail && tag === 0x0202) thumbnailLength = u32(entry + 8) ?? 0;
      const value =
        tag === 0x0112
          ? 1
          : tag === 0x0100 || tag === 0xa002
            ? width
            : tag === 0x0101 || tag === 0xa003
              ? height
              : null;
      if (value !== null && amount === 1) {
        if (type === 3)
          view.setUint16(entry + 8, Math.min(65535, value), little);
        else if (type === 4) view.setUint32(entry + 8, value, little);
      }
    }
    if (thumbnailOffset && thumbnailLength) {
      if (tiff + thumbnailOffset + thumbnailLength > bytes.length) return false;
      bytes.fill(
        0,
        tiff + thumbnailOffset,
        tiff + thumbnailOffset + thumbnailLength
      );
    }
    const nextPosition = offset + 2 + count * 12,
      next = u32(nextPosition);
    if (next) {
      if (!directory(next, true)) return false;
      view.setUint32(nextPosition, 0, little);
    }
    return true;
  };
  const first = u32(tiff + 4);
  return first && directory(first) ? bytes : null;
}

export function addJpegExif(
  jpeg: Uint8Array,
  exif: Uint8Array | null,
  width: number,
  height: number
): Uint8Array {
  if (!exif || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const normalized = normalizeJpegExif(exif, width, height);
  if (!normalized) return jpeg;
  const result = new Uint8Array(jpeg.length + normalized.length);
  result.set(jpeg.subarray(0, 2));
  result.set(normalized, 2);
  result.set(jpeg.subarray(2), 2 + normalized.length);
  return result;
}

export function addJpegExifToDataUrl(
  url: string,
  exif: Uint8Array | null,
  width: number,
  height: number
): string {
  if (!exif || !url.startsWith('data:image/jpeg;base64,')) return url;
  const binary = atob(url.slice(url.indexOf(',') + 1)),
    source = Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    bytes = addJpegExif(source, exif, width, height);
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:image/jpeg;base64,${btoa(result)}`;
}
