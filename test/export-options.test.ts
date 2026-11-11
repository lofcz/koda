import { parseExportOptions, resolveExportSize } from '../src/exportOptions';

it('validates an independent persistence-safe output settings object', () => {
  const source = {
    type: 'image/jpeg',
    quality: 0.8,
    fit: 'contain',
    upscale: false,
    resampling: 'high',
    metadata: 'preserve',
    width: 800,
    height: 600,
    background: '#ffffff',
  };
  expect(parseExportOptions(source)).toEqual(source);
  expect(parseExportOptions(source)).not.toBe(source);
  expect(parseExportOptions({ type: undefined })).toEqual({
    type: 'image/png',
  });
  for (const invalid of [
    null,
    [],
    { fit: 'other' },
    { upscale: 0 },
    { resampling: 'other' },
    { metadata: 'other' },
    { width: NaN },
    { background: 42 },
    { type: 'text/html' },
    { quality: Infinity },
  ])
    expect(() => parseExportOptions(invalid)).toThrow();
});

it('contain, cover and force sizing follow aspect and no-upscale ownership rules', () => {
  const source = { width: 400, height: 200 };
  expect(
    resolveExportSize(source, { width: 100, height: 100, fit: 'contain' })
  ).toMatchObject({ width: 100, height: 50 });
  expect(
    resolveExportSize(source, { width: 100, height: 100, fit: 'cover' })
  ).toEqual({
    width: 100,
    height: 100,
    sourceRect: { x: 100, y: 0, width: 200, height: 200 },
  });
  expect(resolveExportSize(source, { width: 100, height: 100 })).toEqual({
    width: 100,
    height: 100,
    sourceRect: { x: 0, y: 0, ...source },
  });
  expect(
    resolveExportSize(source, {
      width: 800,
      height: 800,
      fit: 'cover',
      upscale: false,
    })
  ).toEqual({
    width: 200,
    height: 200,
    sourceRect: { x: 100, y: 0, width: 200, height: 200 },
  });
  expect(
    resolveExportSize(source, {
      width: 800,
      height: 800,
      fit: 'contain',
      upscale: false,
    })
  ).toMatchObject({ width: 400, height: 200 });
  expect(resolveExportSize(source, { height: 50 })).toMatchObject({
    width: 100,
    height: 50,
  });
});
