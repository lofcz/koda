import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_TEST_PORT ?? 4198),
  base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL('../demo/node_modules/vite/bin/vite.js', import.meta.url)
    ),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: fileURLToPath(new URL('../demo', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog += chunk;
});
server.stderr.on('data', (chunk) => {
  serverLog += chunk;
});
let browser;
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Server has not started listening yet. */
    }
    if (i === 119) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({
      viewport: { width: 1100, height: 760 },
    }),
    errors = [],
    blocked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/unlayer\.com/.test(url)) {
      blocked.push(url);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/verification.html`);
  await page
    .locator('[data-editor-engine="local-canvas"] [data-ready="true"]')
    .waitFor();
  await page.waitForFunction(() => !!window.localEditor);
  const inspect = async (dataUrl) =>
    page.evaluate(async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob()),
        canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        width: canvas.width,
        height: canvas.height,
        red: [
          ...pixels.slice(
            (10 * canvas.width + 10) * 4,
            (10 * canvas.width + 10) * 4 + 4
          ),
        ],
        transparent: [
          ...pixels.slice(
            ((canvas.height - 10) * canvas.width + canvas.width - 10) * 4,
            ((canvas.height - 10) * canvas.width + canvas.width - 10) * 4 + 4
          ),
        ],
      };
    }, dataUrl);
  const snapshot = () => page.evaluate(() => window.localEditor.getImage());
  const initial = await snapshot();
  assert.deepEqual(await inspect(initial), {
    width: 600,
    height: 400,
    red: [255, 0, 0, 255],
    transparent: [0, 0, 0, 0],
  });
  assert.equal(
    await page.evaluate(() => window.localEditor.hasChanges()),
    false
  );
  // The host exports while the crop panel is still open; export must flush it once.
  await page.getByTestId('native-tool-crop').click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  const cropped = await snapshot();
  assert.equal((await inspect(cropped)).width, 400);
  assert.equal((await inspect(cropped)).height, 400);
  assert.equal(await snapshot(), cropped);
  assert.equal(await page.evaluate(() => window.changes.at(-1).width), 400);
  await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
  await page.getByTestId('native-tool-draw').click();
  const artboard = await page.locator('.rie-artboard').boundingBox();
  assert(artboard);
  const before = await snapshot(),
    events = await page.evaluate(() => window.changes.length);
  await page.mouse.move(
    artboard.x + artboard.width * 0.15,
    artboard.y + artboard.height * 0.2
  );
  await page.mouse.down();
  await page.mouse.move(
    artboard.x + artboard.width * 0.4,
    artboard.y + artboard.height * 0.6,
    { steps: 30 }
  );
  await page.mouse.up();
  const stroke = await snapshot();
  assert.notEqual(stroke, before);
  assert.equal(await page.evaluate(() => window.changes.length), events + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await snapshot(), stroke);
  // Effects operate on pixels, preserving alpha; export has no selection or UI chrome.
  await page.getByTestId('native-tool-filter').click();
  await page.getByTestId('native-filter-preset-invert').click();
  const inverted = await inspect(await snapshot());
  assert.deepEqual(inverted.red, [0, 255, 255, 255]);
  assert.equal(inverted.transparent[3], 0);
  await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
  await page.getByTestId('native-tool-shapes').click();
  await page.getByTestId('native-shape-rectangle').click();
  const shape = await snapshot();
  assert.equal((await inspect(shape)).transparent[3], 0);
  // Exercise actual object hit testing and canvas handles, then one-step undo.
  const box = await page.locator('.rie-artboard').boundingBox();
  assert(box);
  const drag = async (x, y, dx, dy) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
  };
  await drag(box.x + box.width / 2, box.y + box.height / 2, 35, 20);
  assert.notEqual(await snapshot(), shape);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), shape);
  await drag(box.x + box.width * 0.675, box.y + box.height * 0.625, 35, 20);
  assert.notEqual(await snapshot(), shape);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), shape);
  await drag(box.x + box.width / 2, box.y + box.height * 0.375 - 26, 35, 10);
  assert.notEqual(await snapshot(), shape);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), shape);
  await page.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await snapshot(), shape);
  await page.keyboard.press('Control+z');
  assert.equal(await snapshot(), shape);
  await page.getByTestId('native-selection-rotation').fill('35');
  await page.getByTestId('native-selection-rotation').blur();
  const rotated = await snapshot();
  assert.notEqual(rotated, shape);
  await page.getByRole('application').focus();
  await page.keyboard.press('Delete');
  assert.equal(await snapshot(), initial);
  await page.keyboard.press('Control+z');
  assert.equal(await snapshot(), rotated);
  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  await page.getByTestId('native-text-content').fill('Editable text');
  await page.getByTestId('native-text-content').blur();
  const text = await snapshot();
  assert.notEqual(text, rotated);
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  assert.equal(await snapshot(), text);
  assert.equal(
    await page
      .locator('[data-testid="image-editor-theme"]')
      .getAttribute('data-scheme'),
    'dark'
  );
  await page.getByTestId('native-tool-resize').click();
  await page.getByTestId('native-resize-width').fill('300');
  await page.getByTestId('native-resize-width').blur();
  assert.deepEqual(
    [
      (await inspect(await snapshot())).width,
      (await inspect(await snapshot())).height,
    ],
    [300, 200]
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => !!window.saved);
  assert.equal(await page.evaluate(() => window.saved), await snapshot());
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByTestId('native-tool-resize').click();
  const mobile = await page.getByRole('application').boundingBox();
  assert(mobile && mobile.width > 250 && mobile.height > 140);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true
  );
  // Native touch events exercise pinch zoom and cancellation without changing pixels.
  const cdp = await page.context().newCDPSession(page),
    touch = async (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id })),
      });
  const touchBox = await page.getByRole('application').boundingBox();
  assert(touchBox);
  const cx = touchBox.x + touchBox.width / 2,
    cy = touchBox.y + touchBox.height / 2,
    touchBefore = await snapshot(),
    zoomBefore = (await page.locator('.rie-artboard').boundingBox()).width;
  await touch('touchStart', [
    [cx - 25, cy],
    [cx + 25, cy],
  ]);
  await touch('touchMove', [
    [cx - 50, cy],
    [cx + 50, cy],
  ]);
  await touch('touchEnd', []);
  assert(
    (await page.locator('.rie-artboard').boundingBox()).width > zoomBefore * 1.5
  );
  assert.equal(await snapshot(), touchBefore);
  await page
    .getByRole('button', { name: 'Fit to screen', exact: true })
    .click();
  await page.getByTestId('native-tool-draw').click();
  const drawingBox = await page.locator('.rie-artboard').boundingBox(),
    tx = drawingBox.x + drawingBox.width * 0.2,
    ty = drawingBox.y + drawingBox.height * 0.3;
  await touch('touchStart', [[tx, ty]]);
  await touch('touchMove', [[tx + 30, ty + 20]]);
  await touch('touchCancel', []);
  assert.equal(await snapshot(), touchBefore);
  await touch('touchStart', [[tx, ty]]);
  await touch('touchMove', [[tx + 30, ty + 20]]);
  await touch('touchEnd', []);
  assert.notEqual(await snapshot(), touchBefore);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), touchBefore);
  await cdp.detach();
  // A failed replacement leaves the complete dirty draft available for continued editing.
  const draft = await snapshot();
  await page.route('**/missing.png', (route) =>
    route.fulfill({ status: 404, body: '' })
  );
  await page.evaluate(async () => {
    try {
      await window.localEditor.reset('/missing.png');
    } catch {
      /* Expected failed replacement. */
    }
  });
  assert.equal(await snapshot(), draft);
  assert.equal(
    await page.evaluate(() => window.localEditor.hasChanges()),
    true
  );
  await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
  await page.getByTestId('native-tool-crop').click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  const replacement = await page.evaluate(async () => {
    await window.localEditor.reset(window.sourceUrl);
    return window.localEditor.getImage();
  });
  assert.equal((await inspect(replacement)).width, 600);
  assert.equal(
    await page.getByTestId('native-tool-select').getAttribute('aria-pressed'),
    'true'
  );
  await page.getByTestId('native-tool-crop').click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.evaluate(async () => {
    try {
      await window.localEditor.reset('/missing.png');
    } catch {
      /* Expected failed replacement with a pending crop. */
    }
  });
  assert.equal((await inspect(await snapshot())).width, 400);
  assert.deepEqual(
    await page.evaluate(() =>
      [window.ImageEditor, window.__ImageEditorImpl__].map(
        (value) => typeof value
      )
    ),
    ['undefined', 'undefined']
  );
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  const result = {
    localOnly: true,
    pngPixelsAndAlpha: true,
    hostCropExport: true,
    gestureUndo: true,
    shapePointerHandles: true,
    text: true,
    effects: true,
    themePreservesDraft: true,
    resizeAndSave: true,
    mobile: true,
    touchDrawPinchCancel: true,
    failedResetPreservesDraft: true,
    pendingCropReplacement: true,
    unlayerRequests: 0,
    pageErrors: errors,
  };
  console.info(JSON.stringify(result, null, 2));
  await page.evaluate(() => window.unmountEditor());
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
