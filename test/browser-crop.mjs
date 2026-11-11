import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const port = Number(process.env.EDITOR_CROP_PORT ?? 4246);
const base = `http://127.0.0.1:${port}`;
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
    cwd: `${root}/demo`,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  }
);
let log = '',
  browser,
  page;
server.stdout.on('data', (value) => (log += value));
server.stderr.on('data', (value) => (log += value));
const close = (a, b, tolerance = 1e-6) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const point = (m, p) => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
const sourcePoint = (m, p) => {
  const d = m[0] * m[3] - m[1] * m[2],
    x = p.x - m[4],
    y = p.y - m[5];
  return { x: (m[3] * x - m[2] * y) / d, y: (-m[1] * x + m[0] * y) / d };
};
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting. */
    }
    if (i === 119) throw Error(log);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  page = await browser.newPage({
    viewport: { width: 1100, height: 850 },
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const doc = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const changes = () => page.evaluate(() => window.changes.length);
  const surface = page.getByRole('application');
  const world = async (x, y) => {
    const b = await page.locator('.rie-artboard').boundingBox(),
      d = await doc();
    return {
      x: b.x + (x * b.width) / d.width,
      y: b.y + (y * b.height) / d.height,
    };
  };
  const crop = () =>
    page.evaluate(() => {
      const base = document.querySelector('.rie-artboard').style;
      const selected = document.querySelector('.rie-crop-artboard').style;
      const zoom =
        parseFloat(base.width) /
        window.localEditor.getSnapshot().document.width;
      return {
        x: (parseFloat(selected.left) - parseFloat(base.left)) / zoom,
        y: (parseFloat(selected.top) - parseFloat(base.top)) / zoom,
        width: parseFloat(selected.width) / zoom,
        height: parseFloat(selected.height) / zoom,
      };
    });
  const number = async (key, value) => {
    const input = page.getByTestId(`native-crop-${key}`);
    await input.fill(String(value));
    await input.press('Tab');
  };
  const drag = async (x, y, dx, dy, end = true) => {
    const a = await world(x, y),
      b = await world(x + dx, y + dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    if (end) await page.mouse.up();
  };
  const undo = () =>
    page.getByRole('button', { name: 'Undo', exact: true }).click();
  const restore = async (value, options = {}) => {
    await page.evaluate(
      async ({ value, options }) => {
        await window.localEditor.restoreDocument(value);
        window.localEditor.updateOptions({
          crop: {
            interactionFocus: 'image',
            enableLimitToggle: true,
            ...options,
          },
        });
      },
      { value, options }
    );
    await page.getByTestId('native-tool-crop').click();
    await page.getByTestId('native-crop-focus-image').waitFor();
  };
  const initial = await page.evaluate(() => window.localEditor.getDocument());
  const seed = structuredClone(initial);
  seed.layers = [
    {
      id: 'affine',
      kind: 'rectangle',
      matrix: [1.3, 0.2, -0.3, 0.8, 160, 90],
      width: 55,
      height: 45,
      color: '#22ff22',
      fill: '#22ff22',
      strokeWidth: 2,
      opacity: 1,
      locked: true,
    },
  ];
  seed.background = '#eeeecc';
  seed.frame = { style: 'solid', width: 8, color: '#ff00ff' };

  // A pending session transforms the image and every source-relative layer together.
  console.info('crop: pending affine transform and cancellation');
  await restore(seed);
  const entry = await doc(),
    before = await changes();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  const rect = await crop();
  await page.getByTestId('native-crop-zoom-in').click();
  const zoomed = await doc();
  await drag(300, 200, 35, -10);
  const moved = await doc();
  assert.deepEqual(await crop(), rect);
  assert.deepEqual(moved.frame, entry.frame);
  assert.equal(moved.background, entry.background);
  const global = point(
    moved.imageMatrix,
    sourcePoint(
      entry.imageMatrix,
      point(entry.layers[0].matrix, { x: 17, y: 12 })
    )
  );
  const annotation = point(moved.layers[0].matrix, { x: 17, y: 12 });
  close(global.x, annotation.x);
  close(global.y, annotation.y);
  assert.notDeepEqual(moved.imageMatrix, zoomed.imageMatrix);
  assert.equal(await changes(), before);
  await drag(300, 200, -25, 15, false);
  await page
    .locator('.upper-canvas')
    .dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  assert.deepEqual(await doc(), moved);
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await doc(), entry);
  assert.equal(await changes(), before);

  // Wheel zoom keeps its source point stationary and ignores the masked area.
  console.info('crop: wheel, keyboard and export ownership');
  await restore(initial, { allowOutsideImage: true });
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  let anchor = await world(230, 140),
    prior = await doc();
  await page.evaluate(() =>
    document.querySelector('.rie-canvas').addEventListener(
      'wheel',
      (event) => {
        const box = document
          .querySelector('.rie-canvas')
          .getBoundingClientRect();
        const style = document.querySelector('.rie-artboard').style;
        const zoom = parseFloat(style.width) / 600;
        window.cropWheelPoint = {
          x: (event.clientX - box.x - parseFloat(style.left)) / zoom,
          y: (event.clientY - box.y - parseFloat(style.top)) / zoom,
        };
      },
      { once: true }
    )
  );
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -180);
  await page.waitForFunction(
    (value) => window.localEditor.getSnapshot().document.imageMatrix[0] > value,
    prior.imageMatrix[0]
  );
  let next = await doc();
  const wheelPoint = await page.evaluate(() => window.cropWheelPoint);
  const a = sourcePoint(prior.imageMatrix, wheelPoint),
    b = sourcePoint(next.imageMatrix, wheelPoint);
  close(a.x, b.x, 1e-3);
  close(a.y, b.y, 1e-3);
  const outside = await world(40, 200);
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.wheel(0, -150);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(await doc(), next);
  await surface.focus();
  await page.keyboard.press('Shift+ArrowRight');
  close((await doc()).imageMatrix[4], next.imageMatrix[4] + 10);
  const pending = await changes();
  const exported = await page.evaluate(() => {
    window.localEditor.getImage();
    return window.localEditor.getDocument();
  });
  assert.deepEqual([exported.width, exported.height], [400, 400]);
  assert.equal(await changes(), pending + 1);
  await page.evaluate(() => window.localEditor.getImage());
  assert.equal(await changes(), pending + 1);
  await undo();
  assert.deepEqual(await doc(), initial);

  // Restoring a document takes ownership even while the old source drag is captured.
  console.info('crop: restore and reset ownership');
  await restore(initial, { allowOutsideImage: true });
  await drag(300, 200, 40, 20, false);
  const restored = { ...initial, background: '#123456' };
  await page.evaluate(
    (value) => window.localEditor.restoreDocument(value),
    restored
  );
  const owned = await doc(),
    count = await changes();
  await page.mouse.move(500, 250);
  await page.mouse.up();
  assert.deepEqual(await doc(), owned);
  assert.equal(await changes(), count);
  await restore(initial, { allowOutsideImage: true });
  await page.getByTestId('native-crop-zoom-in').click();
  await drag(300, 200, 40, 20, false);
  await page.evaluate(
    (value) => window.localEditor.restoreDocument(value),
    initial
  );
  await page.mouse.move(500, 250);
  await page.mouse.up();
  assert.deepEqual(await doc(), initial);
  await page.getByTestId('native-tool-crop').click();
  await drag(300, 200, 40, 20, false);
  await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
  await page.mouse.move(520, 270);
  await page.mouse.up();
  assert.deepEqual(await doc(), initial);

  // Source bounds use the transformed source, including rotated/sheared images.
  console.info('crop: affine source constraints');
  const rotated = structuredClone(initial);
  rotated.imageMatrix = [1.2, 0.4, -0.2, 1.4, 20, -50];
  await restore(rotated);
  const fixedFrame = await crop();
  close(fixedFrame.x, 0, 0.001);
  close(fixedFrame.y, 0, 0.001);
  close(fixedFrame.width, 600, 0.001);
  close(fixedFrame.height, 400, 0.001);
  await drag(300, 200, 800, -500);
  const covered = await page.evaluate(
    async ({ root, rect }) => {
      const { sourceContainsRect } = await import(`/@fs${root}/src/crop.ts`);
      return sourceContainsRect(
        {
          width: 600,
          height: 400,
          matrix: window.localEditor.getSnapshot().document.imageMatrix,
        },
        rect,
        0.001 // CSS serializes fractional visual bounds; core geometry has stricter unit coverage.
      );
    },
    { root, rect: await crop() }
  );
  assert.equal(covered, true);
  await page.getByTestId('native-crop-zoom-out').click();
  assert.equal(
    await page.evaluate(
      async ({ root, rect }) => {
        const { sourceContainsRect } = await import(`/@fs${root}/src/crop.ts`);
        return sourceContainsRect(
          {
            width: 600,
            height: 400,
            matrix: window.localEditor.getSnapshot().document.imageMatrix,
          },
          rect,
          0.001
        );
      },
      { root, rect: await crop() }
    ),
    true
  );
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await doc(), rotated);
  const repeatChanges = await changes();
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByTestId('native-tool-crop').click();
    assert.notDeepEqual((await doc()).imageMatrix, rotated.imageMatrix);
    await page.getByTestId('native-crop-cancel').click();
    assert.deepEqual(await doc(), rotated);
    assert.equal(await changes(), repeatChanges);
  }

  // Reopening exposes original source pixels beyond the old crop without rasterizing them.
  console.info('crop: source recovery');
  const cropped = {
    ...initial,
    width: 300,
    height: 400,
    imageMatrix: [1, 0, 0, 1, -300, 0],
  };
  await restore(cropped);
  await page.getByTestId('native-crop-center').click();
  await drag(150, 200, 150, 0);
  const output = await page.evaluate(async () => {
    const url = window.localEditor.getImage(),
      image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(150, 100, 1, 1).data];
  });
  assert.deepEqual(output, [255, 0, 0, 255]);

  // Disabled source zoom also disables wheel and keyboard zoom without changing viewport.
  await restore(initial, { enableZoom: false });
  const disabledZoom = await doc(),
    viewportZoom = await surface.getAttribute('data-zoom');
  const middle = await world(300, 200);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -180);
  await surface.focus();
  await page.keyboard.press('+');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(await doc(), disabledZoom);
  assert.equal(await surface.getAttribute('data-zoom'), viewportZoom);

  // Outside selection keeps negative origin; required ratios beat Shift and all handles.
  console.info('crop: outside selection and required ratio');
  await restore(initial, {
    interactionFocus: 'selection',
    allowOutsideImage: true,
    aspectRatio: 2,
    minSize: { width: 80, height: 40 },
    maxSize: { width: 800, height: 400 },
  });
  await page.locator('.rie-crop-details summary').click();
  await number('x', -90);
  await number('y', -60);
  let region = await crop();
  close(region.width / region.height, 2, 0.00001);
  await page.keyboard.down('Shift');
  await drag(region.x + region.width, region.y + region.height / 2, -100, 0);
  await page.keyboard.up('Shift');
  region = await crop();
  close(region.width / region.height, 2, 0.00001);
  close(region.x, -90, 0.001);
  close(region.y + region.height / 2, 90, 0.001);
  await page.getByTestId('native-crop-apply').click();
  next = await doc();
  close(next.imageMatrix[4], 90);
  assert(next.imageMatrix[5] > 0);

  // Touch promotion and demotion preserve one pending crop and roll back the whole gesture.
  console.info('crop: touch transitions');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await restore(initial, {
    allowOutsideImage: true,
    guides: { columns: [0.25, 0.75], rows: [0.5] },
    handleStyle: 'hook',
  });
  await page.getByTestId('native-crop-zoom-in').click();
  const touchBase = await doc(),
    touchChanges = await changes();
  const cdp = await page.context().newCDPSession(page);
  // Chromium aligns touch pointermove with animation frames, so a CDP touch
  // can resolve before its pointer event is handled. Wait a bounded number of
  // frames for the expected state; the assertion that follows still decides.
  const settle = async (check) => {
    for (let i = 0; i < 60 && !(await check()); i++)
      await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const p = { ...(await world(230, 190)), id: 1 },
    q = { ...(await world(370, 210)), id: 2 };
  await touch('touchStart', [p]);
  const p2 = { ...p, x: p.x + 12 };
  await touch('touchMove', [p2]);
  await touch('touchStart', [p2, q]);
  await touch('touchMove', [
    { ...p2, x: p2.x - 18 },
    { ...q, x: q.x + 18 },
  ]);
  await settle(
    async () => (await doc()).imageMatrix[0] > touchBase.imageMatrix[0]
  );
  const pinched = await doc();
  assert(pinched.imageMatrix[0] > touchBase.imageMatrix[0]);
  // CDP touchEnd releases the listed points; the second finger stays down and
  // must continue as a one-finger image drag.
  await touch('touchEnd', [{ ...p2, x: p2.x - 18 }]);
  await touch('touchMove', [{ ...q, x: q.x + 34 }]);
  await settle(async () =>
    (await doc()).imageMatrix.some((v, i) => v !== pinched.imageMatrix[i])
  );
  assert.notDeepEqual((await doc()).imageMatrix, pinched.imageMatrix);
  await touch('touchCancel', []);
  await settle(
    async () => JSON.stringify(await doc()) === JSON.stringify(touchBase)
  );
  assert.deepEqual(await doc(), touchBase);
  assert.equal(await changes(), touchChanges);
  await cdp.detach();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true
  );
  if (process.env.EDITOR_SCREENSHOT_DIR) {
    await mkdir(process.env.EDITOR_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.EDITOR_SCREENSHOT_DIR}/crop-mobile-dark.png`,
    });
  }
  await page.getByTestId('native-crop-apply').click();
  assert.equal(await changes(), touchChanges + 1);
  await undo();
  assert.deepEqual(await doc(), initial);
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify(
      {
        sourceRelativeAffineLayers: true,
        pendingSessionCancel: true,
        gestureCancel: true,
        anchoredWheel: true,
        outsideWheelIgnored: true,
        keyboardImageMovement: true,
        exportOneUndo: true,
        restoreOwnsCapturedPointer: true,
        affineSourceBounds: true,
        recoverUncroppedSource: true,
        outsideSelectionAndRequiredRatio: true,
        touchPromotionDemotionCancel: true,
        narrowDark: true,
        pageErrors: errors,
      },
      null,
      2
    )
  );
} catch (error) {
  await page
    ?.screenshot({ path: '/tmp/pintura-crop-interactions-failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
