import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.EDITOR_CORE_PORT ?? 4199);
const base = process.env.EDITOR_CORE_BASE ?? `http://127.0.0.1:${port}`;
let server, browser;
let serverLog = '';
try {
  if (!process.env.EDITOR_CORE_BASE) {
    server = spawn(
      path.join(root, 'demo/node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: path.join(root, 'demo'), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    server.stdout.on('data', (chunk) => {
      serverLog += chunk;
    });
    server.stderr.on('data', (chunk) => {
      serverLog += chunk;
    });
  }
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting Vite. */
    }
    if (i === 119)
      throw new Error(serverLog || 'Core test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage();
  await page.route('**/core-check.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Core pixel checks</title>',
    })
  );
  await page.goto(`${base}/core-check.html`);
  const result = await page.evaluate(async (root) => {
    const model = await import(`/@fs${root}/src/model.ts`),
      render = await import(`/@fs${root}/src/render.ts`),
      { CanvasEngine } = await import(`/@fs${root}/src/engine.ts`);
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const equal = (a, b, message) =>
      check(
        JSON.stringify(a) === JSON.stringify(b),
        `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
      );
    const make = (width = 64, height = 48) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    const pixel = (canvas, x, y) => [
      ...canvas.getContext('2d').getImageData(x, y, 1, 1).data,
    ];
    const fromBlob = async (blob) => {
      const image = await createImageBitmap(blob),
        canvas = make(image.width, image.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      image.close();
      return canvas;
    };
    const source = make(),
      sourceContext = source.getContext('2d');
    sourceContext.fillStyle = '#ff0000';
    sourceContext.fillRect(0, 0, 32, 48);
    sourceContext.fillStyle = 'rgba(0,0,255,0.5)';
    sourceContext.fillRect(32, 0, 16, 48);
    const original = model.createDocument(64, 48),
      rectangle = {
        id: 'box',
        kind: 'rectangle',
        width: 16,
        height: 16,
        matrix: model.translate(8, 8),
        fill: '#00ff00',
        color: '#00ff00',
        strokeWidth: 0,
        opacity: 1,
      };
    let doc = {
      ...original,
      layers: [rectangle],
      effects: { ...model.DEFAULT_EFFECTS, preset: 'invert' },
    };
    let canvas = render.exportCanvas(doc, source);
    equal(
      pixel(canvas, 10, 10),
      [0, 255, 0, 255],
      'Photo filters leave annotation colors intact'
    );
    equal(pixel(canvas, 3, 3), [0, 255, 255, 255], 'Photo invert pixels');
    check(pixel(canvas, 40, 10)[3] === 128, 'Photo effects preserve alpha');
    const preview = make();
    render.paintDocument(preview.getContext('2d'), doc, source);
    equal(
      preview.toDataURL(),
      canvas.toDataURL(),
      'Preview and export share identical composition'
    );

    const erased = model.pathLayer(
      [
        { x: 16, y: 0 },
        { x: 16, y: 48 },
      ],
      { erase: true, strokeWidth: 6, color: '#000000' }
    );
    doc = { ...original, layers: [rectangle, erased] };
    canvas = render.exportCanvas(doc, source);
    equal(
      pixel(canvas, 16, 12),
      [255, 0, 0, 255],
      'Eraser restores the photo beneath markup'
    );
    equal(
      pixel(canvas, 10, 12),
      [0, 255, 0, 255],
      'Eraser leaves surrounding markup'
    );
    const overAlpha = { ...rectangle, matrix: model.translate(32, 8) },
      alphaErase = model.pathLayer(
        [
          { x: 40, y: 0 },
          { x: 40, y: 48 },
        ],
        { erase: true, strokeWidth: 6, color: '#000000' }
      );
    canvas = render.exportCanvas(
      { ...original, layers: [overAlpha, alphaErase] },
      source
    );
    equal(
      pixel(canvas, 40, 12),
      pixel(source, 40, 12),
      'Eraser restores semitransparent photo alpha'
    );

    const patterned = make();
    const patternContext = patterned.getContext('2d');
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        patternContext.fillStyle = (x + y) % 2 ? '#ffffff' : '#000000';
        patternContext.fillRect(x, y, 1, 1);
      }
    const region = {
      ...rectangle,
      id: 'redact',
      kind: 'redaction',
      matrix: model.translate(8, 8),
      width: 32,
      height: 24,
      redactionMode: 'pixelate',
      redactionSize: 8,
    };
    canvas = render.exportCanvas({ ...original, layers: [region] }, patterned);
    equal(
      pixel(canvas, 10, 10),
      pixel(canvas, 11, 10),
      'Pixelation removes source detail within each block'
    );
    check(
      pixel(canvas, 10, 10)[0] > 80 && pixel(canvas, 10, 10)[0] < 180,
      'Pixelation samples underlying photo'
    );
    equal(
      pixel(canvas, 2, 2),
      pixel(patterned, 2, 2),
      'Pixelation leaves pixels outside region unchanged'
    );
    const upper = {
      ...rectangle,
      id: 'upper',
      matrix: model.translate(8, 8),
      width: 32,
      height: 24,
    };
    canvas = render.exportCanvas(
      { ...original, layers: [upper, region] },
      patterned
    );
    equal(
      pixel(canvas, 16, 16),
      [0, 255, 0, 255],
      'Redaction samples lower annotation layers'
    );
    canvas = render.exportCanvas(
      {
        ...original,
        layers: [model.rotateLayer({ ...region, redactionMode: 'blur' }, 20)],
      },
      patterned
    );
    const blurred = pixel(canvas, 20, 20);
    check(
      blurred[0] > 80 && blurred[0] < 180 && blurred[3] === 255,
      'Rotated blur samples and covers original detail'
    );
    canvas = render.exportCanvas(
      {
        ...original,
        layers: [{ ...region, redactionMode: 'solid', color: '#112233' }],
      },
      patterned
    );
    equal(
      pixel(canvas, 20, 20),
      [17, 34, 51, 255],
      'Solid redaction produces the chosen cover color'
    );
    canvas = render.exportCanvas(
      {
        ...original,
        layers: [
          {
            ...region,
            matrix: model.translate(32, 8),
            width: 16,
            opacity: 0.5,
          },
        ],
      },
      source
    );
    equal(
      pixel(canvas, 40, 16),
      pixel(source, 40, 16),
      'Redaction opacity blends without doubling source alpha'
    );

    const rounded = {
      ...original,
      cornerRadius: 12,
      background: '#ffffff',
      frame: { style: 'solid', width: 4, color: '#000000' },
    };
    canvas = render.exportCanvas(rounded, source);
    check(pixel(canvas, 0, 0)[3] === 0, 'Rounded output corners retain alpha');
    equal(pixel(canvas, 32, 1), [0, 0, 0, 255], 'Frame lies inside the output');
    equal(
      pixel(canvas, 58, 24),
      [255, 255, 255, 255],
      'Background fills transparent image pixels'
    );
    const frameOutputs = new Set();
    for (const style of [
      'none',
      'solid',
      'inset',
      'double',
      'mat',
      'polaroid',
      'bevel',
      'hooks',
      'cross',
      'edge',
    ]) {
      const framed = render.exportCanvas(
        { ...original, frame: { style, width: 4, color: '#4455aa' } },
        patterned
      );
      frameOutputs.add(framed.toDataURL());
    }
    check(
      frameOutputs.size === 10,
      'Each frame style produces a distinct rendered frame'
    );

    const engine = new CanvasEngine();
    await engine.reset(source.toDataURL());
    engine.commit({ ...engine.getSnapshot().document, layers: [rectangle] });
    const sticker = make(8, 8);
    sticker.getContext('2d').fillStyle = '#ff00ff';
    sticker.getContext('2d').fillRect(0, 0, 8, 8);
    const objectUrl = URL.createObjectURL(
      await new Promise((resolve) => sticker.toBlob(resolve))
    );
    await engine.addImage(objectUrl);
    URL.revokeObjectURL(objectUrl);
    const saved = engine.getDocument(),
      serialized = JSON.stringify(saved),
      before = engine.getImage();
    check(
      saved.layers[1].imageSource.startsWith('data:image/png;base64,'),
      'Sticker state embeds durable raster data'
    );
    equal(
      pixel(await fromBlob(await engine.getBlob()), 32, 24),
      [255, 0, 255, 255],
      'Sticker renders through owned resource map'
    );
    await engine.reset(source.toDataURL());
    await engine.restoreDocument(serialized);
    equal(
      engine.getImage(),
      before,
      'Editable state restores pixels after original source reload'
    );
    engine.undo();
    check(
      engine.getDocument().layers.length === 0,
      'Document restoration is one undoable change'
    );
    engine.redo();
    equal(engine.getImage(), before, 'Redo retains owned sticker resources');

    const png = await engine.getBlob({ width: 32 }),
      pngCanvas = await fromBlob(png);
    equal(
      [png.type, pngCanvas.width, pngCanvas.height],
      ['image/png', 32, 24],
      'PNG export size keeps aspect ratio'
    );
    check(
      pixel(pngCanvas, 30, 20)[3] === 0,
      'PNG output preserves transparency'
    );
    const jpeg = await engine.getBlob({ type: 'image/jpeg', quality: 0.85 }),
      jpegCanvas = await fromBlob(jpeg);
    equal(jpeg.type, 'image/jpeg', 'JPEG output MIME');
    check(
      pixel(jpegCanvas, 60, 40).every((channel) => channel > 245),
      'JPEG defaults to white behind transparent pixels'
    );
    const webp = await engine.getBlob({ type: 'image/webp', quality: 0.9 }),
      webpCanvas = await fromBlob(webp);
    equal(webp.type, 'image/webp', 'WebP output MIME');
    check(pixel(webpCanvas, 60, 40)[3] === 0, 'WebP output retains alpha');
    check(
      engine.getImage({ type: 'image/jpeg' }).startsWith('data:image/jpeg'),
      'Synchronous data URL respects requested encoding'
    );
    engine.destroy();
    return {
      photoEffects: true,
      previewExportMatch: true,
      markupOnlyEraser: true,
      semitransparentEraser: true,
      redactionCompositing: true,
      rotatedBlur: true,
      frames: frameOutputs.size,
      roundedAlpha: true,
      embeddedStickers: true,
      restoreUndoRedo: true,
      pngJpegWebp: true,
      outputSizing: true,
    };
  }, root);
  assert.equal(result.previewExportMatch, true);
  console.info(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
