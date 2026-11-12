/**
 * Custom font catalogs, image backgrounds and 9-slice image frames in real
 * Chromium. Fonts are generated in memory (test/fixtures/block-font.mjs) and
 * served by request interception; nothing is fetched from the internet.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { blockFont } from './fixtures/block-font.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.EDITOR_ASSETS_PORT ?? 4214);
const base = `http://127.0.0.1:${port}`;
const shots = path.join(root, '.cache/ui-review/assets');
const server = spawn(
  process.execPath,
  [
    path.join(root, 'demo/node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { cwd: path.join(root, 'demo'), stdio: ['ignore', 'pipe', 'pipe'] }
);
let logs = '',
  browser;
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));

const font = blockFont('RIE Block'),
  slowFont = blockFont('RIE Slow');
/** Poll a bounded number of animation frames for a condition evaluated in the page. */
async function until(page, predicate, arg, frames = 240) {
  for (let i = 0; i < frames; i++) {
    if (await page.evaluate(predicate, arg)) return;
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  throw new Error(`Condition not met: ${predicate}`);
}

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/assets-verification.html${query}`);
  await page.locator('[data-ready="true"]').waitFor();
  await until(page, () => !!window.localEditor);
  return errors;
}

/** In-page helpers: export via getBlob and sample decoded pixels. */
const helpers = `
  window.samplePixels = async (blobPromise, points) => {
    const blob = await blobPromise;
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      pixels: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
    };
  };
  window.baseDocument = (patch = {}) => ({
    width: 300,
    height: 200,
    imageMatrix: [1, 0, 0, 1, 0, 0],
    layers: [],
    background: 'transparent',
    frame: { style: 'none', color: '#ffffff', width: 16 },
    cornerRadius: 0,
    ...patch,
  });
`;

try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting. */
    }
    if (i === 119) throw new Error(logs || 'Asset test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await mkdir(shots, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });

  /* ------------------------------------------------ font readiness/export */
  {
    const page = await browser.newPage({
      viewport: { width: 1120, height: 800 },
    });
    let releaseBlock;
    const blockGate = new Promise((resolve) => (releaseBlock = resolve));
    const requests = [];
    await page.route('**/__rie-test/*.ttf', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      requests.push(name);
      if (name === 'block.ttf') {
        await blockGate;
        await route.fulfill({
          body: Buffer.from(font),
          contentType: 'font/ttf',
        });
      } else if (name === 'slow.ttf') {
        // Answers well after the 600 ms export timeout, then succeeds.
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route
          .fulfill({ body: Buffer.from(slowFont), contentType: 'font/ttf' })
          .catch(() => {});
      } else await route.fulfill({ status: 404, body: 'missing' });
    });
    const errors = await open(page, '?fontTimeout=20000');
    await page.addScriptTag({ content: helpers });

    // A restored layer with a stale auto-width box that uses a catalog font.
    await page.evaluate(() =>
      window.localEditor.restoreDocument(
        window.baseDocument({
          layers: [
            {
              id: 'block-text',
              kind: 'text',
              matrix: [1, 0, 0, 1, 20, 20],
              width: 10,
              height: 48,
              color: '#000000',
              fill: 'transparent',
              strokeWidth: 0,
              opacity: 1,
              text: 'HH',
              fontFamily: '"RIE Block", monospace',
              fontSize: 40,
              textLayout: 'auto-width',
            },
          ],
        })
      )
    );
    for (let i = 0; !requests.includes('block.ttf'); i++) {
      if (i > 100) throw new Error('The catalog font was never requested');
      await page.waitForTimeout(20);
    }
    // Export must wait for the face rather than drawing the fallback.
    await page.evaluate(() => {
      window.exportDone = false;
      window.pendingExport = window.localEditor.getBlob().then((blob) => {
        window.exportDone = true;
        return blob;
      });
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.exportDone),
      false,
      'getBlob waits while a catalog font is loading'
    );
    releaseBlock();
    const exported = await page.evaluate(() =>
      window.samplePixels(window.pendingExport, [
        [40, 42],
        [60, 42],
        [80, 42],
        [200, 42],
      ])
    );
    // Block glyphs: squares at x 24..56 and 64..96, y 28..56 (baseline 56).
    assert.deepEqual(exported.pixels[0], [0, 0, 0, 255], 'first glyph');
    assert.deepEqual(
      exported.pixels[1],
      [255, 0, 0, 255],
      'gap between glyphs'
    );
    assert.deepEqual(exported.pixels[2], [0, 0, 0, 255], 'second glyph');
    assert.equal(exported.pixels[3][3], 0, 'transparent photo half');
    await until(
      page,
      () => window.localEditor.getDocument().layers[0].width === 80
    );
    const reflowed = (
      await page.evaluate(() => window.localEditor.getDocument())
    ).layers[0];
    assert.equal(reflowed.width, 80, 'auto-width box reflows to 2 em');
    assert.equal(reflowed.fontFamily, '"RIE Block", monospace');
    assert.equal(
      await page.evaluate(() => window.localEditor.hasChanges()),
      true
    );

    // Timeout path: a face that never arrives fails within fontLoadTimeout,
    // and the export uses the documented CSS fallback.
    const slowDoc = await page.evaluate(() =>
      window.baseDocument({
        layers: [
          {
            id: 'slow-text',
            kind: 'text',
            matrix: [1, 0, 0, 1, 20, 20],
            width: 120,
            height: 48,
            color: '#000000',
            fill: 'transparent',
            strokeWidth: 0,
            opacity: 1,
            text: 'Slow',
            fontFamily: '"RIE Slow", monospace',
            fontSize: 40,
            textLayout: 'auto-width',
            textRuns: [
              { text: 'Sl' },
              { text: 'ow', style: { fontFamily: '"RIE Broken", serif' } },
            ],
          },
        ],
      })
    );
    await page.evaluate((doc) => {
      window.localEditor.updateOptions({ fontLoadTimeout: 600 });
      return window.localEditor.restoreDocument(doc);
    }, slowDoc);
    const timed = await page.evaluate(async () => {
      const started = performance.now();
      const result = await window.localEditor.fontsReady();
      const blob = await window.localEditor.getBlob();
      return { result, elapsed: performance.now() - started, size: blob.size };
    });
    assert.deepEqual(timed.result.loaded, []);
    assert.deepEqual(timed.result.failed.sort(), ['broken', 'slow']);
    assert.ok(timed.elapsed >= 550 && timed.elapsed < 3000, `${timed.elapsed}`);
    assert.ok(timed.size > 0, 'export still completes with the fallback');
    const kept = (await page.evaluate(() => window.localEditor.getDocument()))
      .layers[0];
    assert.equal(kept.fontFamily, '"RIE Slow", monospace');
    assert.equal(kept.textRuns[1].style.fontFamily, '"RIE Broken", serif');

    // Families missing from the catalog are kept and never requested.
    const before = requests.length;
    await page.evaluate((doc) => {
      doc.layers[0].fontFamily = '"Not In Catalog", cursive';
      delete doc.layers[0].textRuns;
      return window.localEditor.restoreDocument(doc);
    }, slowDoc);
    const missing = await page.evaluate(() => window.localEditor.fontsReady());
    assert.deepEqual(missing, { loaded: [], failed: [] });
    assert.equal(requests.length, before);
    assert.equal(
      (await page.evaluate(() => window.localEditor.getDocument())).layers[0]
        .fontFamily,
      '"Not In Catalog", cursive'
    );

    // Picker: each loaded font previews in its own face, failures are marked.
    await page.getByTestId('native-tool-text').click();
    await page.getByTestId('native-text-add').click();
    await page.getByTestId('native-text-content').fill('Brand');
    await page.getByTestId('native-text-content').blur();
    await page.getByTestId('native-text-font').click();
    const block = page.getByRole('option', { name: 'RIE Block', exact: true });
    await block.waitFor();
    assert.match(
      await block
        .locator('.rie-choice-label')
        .evaluate((element) => getComputedStyle(element).fontFamily),
      /RIE Block/
    );
    const broken = page.getByRole('option', { name: /Broken face/ });
    await until(
      page,
      () =>
        !!document.querySelector(
          '[role="option"] .rie-font-status[data-status="failed"]'
        )
    );
    assert.match(await broken.innerText(), /Unavailable/);
    assert.equal(
      await broken
        .locator('.rie-choice-label')
        .evaluate((element) => element.style.fontFamily),
      '',
      'a failed font is not previewed with a misleading fallback'
    );
    await page.screenshot({ path: path.join(shots, 'font-picker.png') });
    await page.evaluate(() => window.setTheme('dark'));
    await page.setViewportSize({ width: 358, height: 760 });
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(shots, 'font-picker-mobile-dark.png'),
    });
    await block.click();
    const brand = (
      await page.evaluate(() => window.localEditor.getDocument())
    ).layers.at(-1);
    assert.equal(brand.fontFamily, '"RIE Block", monospace');
    assert.ok(
      brand.width >= 5 * brand.fontSize - 0.5,
      'box measured in the face'
    );
    assert.deepEqual(errors, []);
    await page.close();
  }

  /* ---------------------------------------------------- image backgrounds */
  {
    const page = await browser.newPage({
      viewport: { width: 1120, height: 800 },
    });
    const errors = await open(page);
    await page.addScriptTag({ content: helpers });
    const sample = (patch, points) =>
      page.evaluate(
        async ({ patch, points }) => {
          const doc = window.baseDocument({
            backgroundImage: {
              position: { x: 0.5, y: 0.5 },
              scale: 1,
              opacity: 1,
              ...patch,
            },
          });
          await window.localEditor.restoreDocument(doc);
          return (
            await window.samplePixels(window.localEditor.getBlob(), points)
          ).pixels;
        },
        { patch, points }
      );
    const urls = await page.evaluate(() => window.assetUrls);
    const orange = [255, 136, 0, 255],
      blue = [0, 136, 255, 255],
      green = [0, 170, 0, 255],
      purple = [128, 0, 255, 255],
      red = [255, 0, 0, 255];
    // Repeat, origin top-left: 20 px tiles, orange top-left quadrant.
    assert.deepEqual(
      await sample(
        { source: urls.tile, fit: 'repeat', position: { x: 0, y: 0 } },
        [
          [155, 5],
          [165, 5],
          [165, 15],
          [100, 100],
        ]
      ),
      [blue, orange, blue, red],
      'tiles show through transparent pixels only'
    );
    // Repeat with scale 2 and centered: tile 40, origin (300-40)/2 % 40 = 10.
    assert.deepEqual(
      await sample({ source: urls.tile, fit: 'repeat', scale: 2 }, [
        [175, 15],
        [195, 15],
      ]),
      [orange, blue]
    );
    // Cover: 400 × 200 centered, halves split at x = 150.
    assert.deepEqual(
      await sample({ source: urls.halves, fit: 'cover' }, [
        [200, 100],
        [290, 190],
      ]),
      [purple, purple]
    );
    // Cover anchored left: halves split at x = 200.
    assert.deepEqual(
      await sample(
        { source: urls.halves, fit: 'cover', position: { x: 0, y: 0.5 } },
        [
          [180, 100],
          [220, 100],
        ]
      ),
      [green, purple]
    );
    // Contain: 300 × 150 at y 25..175.
    const contain = await sample({ source: urls.halves, fit: 'contain' }, [
      [200, 10],
      [200, 100],
      [200, 190],
    ]);
    assert.equal(contain[0][3], 0);
    assert.deepEqual(contain[1], purple);
    assert.equal(contain[2][3], 0);
    // Stretch covers everything; opacity halves alpha.
    assert.deepEqual(
      await sample({ source: urls.halves, fit: 'stretch' }, [[200, 10]]),
      [purple]
    );
    const faded = await sample(
      { source: urls.halves, fit: 'stretch', opacity: 0.5 },
      [[200, 100]]
    );
    assert.ok(Math.abs(faded[0][3] - 128) <= 1, `${faded[0]}`);

    // Outside-image margins: the photo scaled to the top-left quarter.
    const margins = await page.evaluate(async () => {
      await window.localEditor.restoreDocument(
        window.baseDocument({
          imageMatrix: [0.5, 0, 0, 0.5, 0, 0],
          background: '#ffffff',
          backgroundImage: {
            source: window.assetUrls.tile,
            fit: 'repeat',
            position: { x: 0, y: 0 },
            scale: 1,
            opacity: 1,
          },
        })
      );
      return (
        await window.samplePixels(window.localEditor.getBlob(), [
          [30, 50],
          [245, 145],
          [255, 155],
        ])
      ).pixels;
    });
    assert.deepEqual(margins, [red, orange, blue]);

    // Preview, crop preview and export agree pixel for pixel.
    const agreement = await page.evaluate(async (root) => {
      const render = await import(`/@fs${root}/src/render.ts`);
      const editor = window.localEditor,
        doc = editor.getDocument(),
        source = editor.getSource();
      const assets = new Map();
      for (const url of [doc.backgroundImage.source]) {
        const image = new Image();
        image.src = url;
        await image.decode();
        assets.set(url, image);
      }
      const exported = render.exportCanvas(doc, source, {}, assets);
      const preview = document.createElement('canvas');
      preview.width = doc.width;
      preview.height = doc.height;
      render.paintDocument(
        preview.getContext('2d'),
        doc,
        source,
        undefined,
        assets
      );
      const crop = document.createElement('canvas');
      crop.width = doc.width;
      crop.height = doc.height;
      render.paintCropPreview(
        crop.getContext('2d'),
        doc,
        source,
        { x: 0, y: 0, width: doc.width, height: doc.height },
        assets
      );
      const bytes = (canvas) =>
        canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
          .data;
      const a = bytes(exported),
        b = bytes(preview),
        c = bytes(crop);
      let previewDiff = 0,
        cropDiff = 0;
      for (let i = 0; i < a.length; i++) {
        previewDiff = Math.max(previewDiff, Math.abs(a[i] - b[i]));
        cropDiff = Math.max(cropDiff, Math.abs(a[i] - c[i]));
      }
      return { previewDiff, cropDiff };
    }, root);
    assert.deepEqual(agreement, { previewDiff: 0, cropDiff: 0 });

    // UI: catalog choice embeds pixels, fit/position/opacity controls, remove.
    await page.evaluate(() =>
      window.localEditor.restoreDocument(window.baseDocument())
    );
    await page.getByTestId('native-tool-fill').click();
    await page.getByTestId('native-fill-image-sky').waitFor();
    await until(
      page,
      () =>
        !document
          .querySelector('[data-testid="native-fill-image-sky"]')
          .hasAttribute('aria-busy')
    );
    await page.getByTestId('native-fill-image-sky').click();
    await until(page, () => !!window.localEditor.getDocument().backgroundImage);
    let doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.match(doc.backgroundImage.source, /^data:image\/png;base64,/);
    assert.equal(doc.backgroundImage.fit, 'cover');
    assert.equal(
      await page
        .getByTestId('native-fill-image-sky')
        .getAttribute('aria-pressed'),
      'true'
    );
    await page.getByTestId('native-fill-fit-repeat').click();
    await page.getByTestId('native-fill-position-top_left').click();
    await page.getByTestId('native-fill-image-opacity').focus();
    await page.keyboard.press('ArrowLeft');
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.equal(doc.backgroundImage.fit, 'repeat');
    assert.deepEqual(doc.backgroundImage.position, { x: 0, y: 0 });
    assert.equal(doc.backgroundImage.opacity, 0.99);
    await page.getByTestId('native-fill-tile-size').focus();
    await page.keyboard.press('ArrowRight');
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.equal(doc.backgroundImage.scale, 1.01);
    await page.getByTestId('native-fill-image-halves').click();
    await until(
      page,
      (source) =>
        window.localEditor.getDocument().backgroundImage.source !== source,
      doc.backgroundImage.source
    );
    await page.getByTestId('native-fill-fit-cover').click();
    await page.screenshot({ path: path.join(shots, 'fill-panel.png') });
    // Upload uses the same embedding path as stickers.
    const png = Buffer.from(urls.tile.split(',')[1], 'base64');
    await page.getByTestId('native-fill-image-file').setInputFiles({
      name: 'pattern.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await until(
      page,
      (tile) =>
        window.localEditor.getDocument().backgroundImage.source.length ===
        tile.length,
      urls.tile
    );
    assert.equal(
      await page.locator('.rie-asset-name').innerText(),
      'Tiles',
      'an upload identical to a catalog image is labeled by the catalog'
    );
    // Dropping an image on the canvas while the background panel is open sets the background.
    await page.getByTestId('native-fill-image-remove').click();
    assert.equal(
      (await page.evaluate(() => window.localEditor.getDocument()))
        .backgroundImage,
      undefined
    );
    await page.evaluate(async (url) => {
      const blob = await (await fetch(url)).blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
      const target = document.querySelector('.rie-canvas');
      for (const type of ['dragover', 'drop'])
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
    }, urls.halves);
    await until(page, () => !!window.localEditor.getDocument().backgroundImage);
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.equal(
      doc.layers.length,
      0,
      'a drop on the background panel is not a sticker'
    );
    await page.evaluate(() => window.setTheme('dark'));
    await page.setViewportSize({ width: 358, height: 760 });
    await page.waitForTimeout(150);
    await page.getByTestId('native-fill-image').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(shots, 'fill-panel-mobile-dark.png'),
    });
    await page.evaluate(() => window.setTheme('light'));
    await page.setViewportSize({ width: 1120, height: 800 });
    assert.deepEqual(errors, []);
    await page.close();
  }

  /* --------------------------------------------------------- image frames */
  let savedFrameDocument, savedFramePixels;
  {
    const page = await browser.newPage({
      viewport: { width: 1120, height: 800 },
    });
    const errors = await open(page);
    await page.addScriptTag({ content: helpers });
    const frameDoc = (width, height, patch = {}) =>
      page.evaluate(
        async ({ width, height, patch }) => {
          await window.localEditor.restoreDocument(
            window.baseDocument({
              width,
              height,
              frame: {
                style: 'image',
                color: '#ffffff',
                width: 20,
                image: {
                  source: window.assetUrls.frame,
                  sourceWidth: 30,
                  sourceHeight: 30,
                  slice: { top: 10, right: 10, bottom: 10, left: 10 },
                  repeat: 'stretch',
                },
                ...patch,
              },
            })
          );
        },
        { width, height, patch }
      );
    const pixels = (points) =>
      page.evaluate(
        async (points) =>
          (await window.samplePixels(window.localEditor.getBlob(), points))
            .pixels,
        points
      );
    const red = [255, 0, 0, 255],
      green = [0, 255, 0, 255],
      blue = [0, 0, 255, 255],
      yellow = [255, 255, 0, 255],
      cyan = [0, 255, 255, 255],
      black = [0, 0, 0, 255],
      white = [255, 255, 255, 255];
    // Corners are exactly 20 px (slice 10 × scale 2) on both canvas sizes.
    for (const [width, height] of [
      [300, 200],
      [180, 120],
    ]) {
      await frameDoc(width, height);
      const [tl, tlEdge, tr, br, bl, top, left, bottom, inside] = await pixels([
        [19, 19],
        [20, 5],
        [width - 20, 19],
        [width - 20, height - 20],
        [19, height - 20],
        [width / 2, 0],
        [0, height / 2],
        [width / 2, height - 1],
        [30, 30],
      ]);
      assert.deepEqual(
        [tl, tlEdge, tr, br, bl, top, left, bottom],
        [red, cyan, green, blue, yellow, cyan, black, white],
        `9-slice at ${width} × ${height}`
      );
      assert.deepEqual(inside, red, 'the center shows the photo');
    }
    // Transparent export keeps the frame's alpha over transparent photo pixels.
    await frameDoc(300, 200);
    const [rightEdge] = await pixels([[290, 100]]);
    assert.deepEqual(rightEdge.slice(0, 3), [255, 0, 255]);
    assert.ok(Math.abs(rightEdge[3] - 128) <= 1, `${rightEdge}`);
    // Repeated edges: whole 20 px tiles of the 10 px cyan edge.
    await page.evaluate(async () => {
      const doc = window.localEditor.getDocument();
      await window.localEditor.restoreDocument({
        ...doc,
        frame: {
          ...doc.frame,
          image: { ...doc.frame.image, repeat: 'round' },
        },
      });
    });
    assert.deepEqual(await pixels([[150, 5]]), [cyan]);
    // Outside placement grows the canvas; the photo keeps its pixels.
    await frameDoc(300, 200, { placement: 'outside' });
    // restoreDocument keeps the size it is given; applyFrame grows it.
    const grown = await page.evaluate(async (root) => {
      const model = await import(`/@fs${root}/src/model.ts`);
      const doc = window.localEditor.getDocument();
      const inside = model.applyFrame(doc, {
        ...doc.frame,
        placement: 'inside',
      });
      const outside = model.applyFrame(inside, doc.frame);
      const back = model.applyFrame(outside, {
        ...doc.frame,
        placement: 'inside',
      });
      return {
        inside: [inside.width, inside.height],
        outside: [outside.width, outside.height, ...outside.imageMatrix],
        back: [back.width, back.height, ...back.imageMatrix],
      };
    }, root);
    assert.deepEqual(grown, {
      inside: [260, 160],
      outside: [300, 200, 1, 0, 0, 1, 0, 0],
      back: [260, 160, 1, 0, 0, 1, -20, -20],
    });

    // UI: host frames listed with real previews next to the vector frames.
    await page.evaluate(() =>
      window.localEditor.restoreDocument(window.baseDocument())
    );
    await page.getByTestId('native-tool-frame').click();
    const tiles = page.getByTestId('native-frame-image-tiles');
    await tiles.waitFor();
    await until(
      page,
      () =>
        !!document.querySelector(
          '[data-testid="native-frame-image-tiles"] canvas'
        )
    );
    const previewPixel = await tiles
      .locator('canvas')
      .evaluate((canvas) => [
        ...canvas.getContext('2d').getImageData(2, 2, 1, 1).data,
      ]);
    assert.deepEqual(previewPixel, red, 'frame preview draws the real image');
    await until(
      page,
      () =>
        document.querySelector('[data-testid="native-frame-image-bad"]')
          ?.disabled === true
    );
    assert.equal(
      await page.getByTestId('native-frame-image-bad').getAttribute('title'),
      'The frame could not be loaded.',
      'invalid slice insets cannot be chosen'
    );
    await tiles.click();
    let doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.equal(doc.frame.style, 'image');
    assert.equal(doc.frame.width, 20);
    assert.equal(doc.frame.image.id, 'tiles');
    assert.match(doc.frame.image.source, /^data:image\/png;base64,/);
    assert.deepEqual(doc.frame.image.slice, {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    });
    await page.getByTestId('native-frame-placement-outside').click();
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.deepEqual([doc.width, doc.height], [340, 240]);
    await page.getByTestId('native-frame-edges-round').click();
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.equal(doc.frame.image.repeat, 'round');
    await page.getByTestId('native-frame-image-ornament').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(shots, 'frame-panel.png') });
    await page.getByTestId('native-frame-image-tiles').click();
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.deepEqual([doc.width, doc.height], [340, 240]);
    await page.getByTestId('native-frame-placement-inside').click();
    doc = await page.evaluate(() => window.localEditor.getDocument());
    assert.deepEqual([doc.width, doc.height], [300, 200]);
    await page.getByTestId('native-frame-placement-outside').click();
    savedFrameDocument = await page.evaluate(() =>
      JSON.stringify(window.localEditor.getDocument())
    );
    savedFramePixels = await pixels([
      [5, 5],
      [25, 5],
      [100, 120],
      [330, 230],
    ]);
    assert.deepEqual(savedFramePixels[0], red);
    assert.deepEqual(
      savedFramePixels[2],
      red,
      'outside frame leaves the photo'
    );
    await page.evaluate(() => window.setTheme('dark'));
    await page.setViewportSize({ width: 358, height: 760 });
    await page.waitForTimeout(150);
    await page
      .getByTestId('native-frame-placement-outside')
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(shots, 'frame-panel-mobile-dark.png'),
    });
    assert.deepEqual(errors, []);
    await page.close();
  }

  /* ------------------------------------------------ restore without catalog */
  {
    const page = await browser.newPage({
      viewport: { width: 1120, height: 800 },
    });
    const errors = await open(page, '?catalog=0&locale=cs');
    await page.addScriptTag({ content: helpers });
    await page.evaluate(
      (json) => window.localEditor.restoreDocument(json),
      savedFrameDocument
    );
    const restored = await page.evaluate(
      async () =>
        (
          await window.samplePixels(window.localEditor.getBlob(), [
            [5, 5],
            [25, 5],
            [100, 120],
            [330, 230],
          ])
        ).pixels
    );
    assert.deepEqual(
      restored,
      savedFramePixels,
      'restores without the catalog'
    );
    await page.getByTestId('native-tool-frame').click();
    const custom = page.getByTestId('native-frame-image-custom');
    await custom.waitFor();
    assert.equal(await custom.getAttribute('aria-pressed'), 'true');
    assert.equal(await custom.innerText(), 'Vlastní');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.info('Asset checks passed');
} finally {
  await browser?.close();
  server.kill();
}
