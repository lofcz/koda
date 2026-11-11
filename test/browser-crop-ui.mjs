import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_CROP_UI_PORT ?? 4251);
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
    cwd: fileURLToPath(new URL('../demo', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  }
);
let logs = '',
  browser,
  page;
server.stdout.on('data', (data) => {
  logs += data;
});
server.stderr.on('data', (data) => {
  logs += data;
});
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting Vite. */
    }
    if (i === 119) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  page = await browser.newPage({
    viewport: { width: 1120, height: 800 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const read = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const seed = await read();
  const configure = async (crop = {}) => {
    await page.evaluate(async (crop) => {
      await window.localEditor.reset(window.sourceUrl);
      window.localEditor.updateOptions({
        crop,
        export: { type: 'image/png' },
        locale: 'en',
        theme: 'light',
      });
    }, crop);
  };
  const enter = () => page.getByTestId('native-tool-crop').click();
  const field = async (name, value) => {
    const input = page.getByTestId(`native-crop-${name}`);
    await input.fill(String(value));
    await input.press('Tab');
  };
  const size = async () => ({
    width: Number(await page.getByTestId('native-crop-width').inputValue()),
    height: Number(await page.getByTestId('native-crop-height').inputValue()),
  });
  const exportInfo = () =>
    page.evaluate(async () => {
      const data = window.localEditor.getImage();
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        corner: [...context.getImageData(0, 0, 1, 1).data],
        data,
      };
    });
  await configure({ interactionFocus: 'image', enableLimitToggle: true });
  await enter();
  assert.deepEqual(await read(), seed);
  await page.getByTestId('native-crop-apply').click();
  assert.equal(
    await page.evaluate(() => window.localEditor.hasChanges()),
    false
  );
  assert.equal(
    await page.evaluate(() => window.localEditor.getSnapshot().canUndo),
    false
  );
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.getByTestId('native-crop-zoom-in').click();
  await page.getByTestId('native-crop-zoom-in').click();
  assert.notDeepEqual((await read()).imageMatrix, seed.imageMatrix);
  assert.equal(
    await page.evaluate(() => window.localEditor.getSnapshot().canUndo),
    false
  );
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await read(), seed);
  assert.equal(
    await page.evaluate(() => window.localEditor.hasChanges()),
    false
  );
  console.info(
    'crop session cancel restores source, geometry and clean history'
  );

  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.getByTestId('native-crop-zoom-in').click();
  await page.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await page.getByTestId('native-crop-apply').click();
  const transformed = await read();
  assert.equal(transformed.width, 400);
  assert.equal(transformed.height, 400);
  assert.notDeepEqual(transformed.imageMatrix, seed.imageMatrix);
  const transformedPixels = await exportInfo();
  await page.evaluate(
    (doc) => window.localEditor.restoreDocument(doc),
    transformed
  );
  assert.equal((await exportInfo()).data, transformedPixels.data);
  await configure({ interactionFocus: 'image' });
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.getByTestId('native-crop-zoom-in').click();
  await page.getByTestId('native-crop-apply').click();
  await page.evaluate(() => window.localEditor.undo());
  assert.deepEqual(await read(), seed);
  assert.equal(
    await page.evaluate(() => window.localEditor.getSnapshot().canUndo),
    false
  );
  console.info(
    'crop Apply is one undo, image matrix and pixels survive restore'
  );

  const presets = [
    {
      id: 'banner',
      label: 'Wide banner',
      group: 'Web',
      size: { width: 200, height: 100 },
    },
    {
      id: 'portrait',
      label: 'Portrait card',
      group: 'Print',
      size: { width: 100, height: 150 },
    },
    { id: 'square', label: 'Square ratio', group: 'Ratios', aspectRatio: 1 },
  ];
  await configure({ presets });
  await enter();
  await page.getByTestId('native-crop-preset').click();
  assert.equal(await page.locator('.rie-picker-group').count(), 3);
  await page
    .getByRole('textbox', { name: 'Search…', exact: true })
    .fill('banner');
  await page
    .getByRole('textbox', { name: 'Search…', exact: true })
    .press('ArrowDown');
  await page
    .getByRole('option', { name: 'Wide banner', exact: true })
    .press('Enter');
  assert.equal(
    await page.evaluate(() => window.localEditor.getExportOptions().width),
    undefined
  );
  const presetPixels = await exportInfo();
  assert.equal(presetPixels.width, 200);
  assert.equal(presetPixels.height, 100);
  assert.equal((await read()).width / (await read()).height, 2);
  await configure({ presets });
  await enter();
  await page.getByTestId('native-crop-preset').click();
  await page.getByRole('option', { name: 'Wide banner', exact: true }).click();
  await page.getByTestId('native-crop-orientation').click();
  const portraitPixels = await exportInfo();
  assert.equal(portraitPixels.width, 100);
  assert.equal(portraitPixels.height, 200);
  await configure({ presets });
  await enter();
  await page.getByTestId('native-crop-preset').click();
  await page.getByRole('option', { name: 'Wide banner', exact: true }).click();
  const requiredOverridesPreset = await page.evaluate(async () => {
    window.localEditor.updateOptions({ crop: { aspectRatio: 1 } });
    const image = new Image();
    image.src = window.localEditor.getImage();
    await image.decode();
    return {
      width: image.width,
      height: image.height,
      target: window.localEditor.getExportOptions().width,
    };
  });
  assert.equal(requiredOverridesPreset.width, requiredOverridesPreset.height);
  assert.equal(requiredOverridesPreset.target, undefined);
  await configure({ presets });
  await enter();
  await page.getByTestId('native-crop-preset').click();
  await page
    .getByRole('option', { name: 'Portrait card', exact: true })
    .click();
  await page.getByTestId('native-crop-cancel').click();
  assert.equal(
    await page.evaluate(() => window.localEditor.getExportOptions().width),
    undefined
  );
  console.info(
    'grouped presets stage output settings, first export and orientation use correct target'
  );

  await configure({
    aspectRatio: 1.5,
    minSize: { width: 120, height: 80 },
    maxSize: { width: 300, height: 200 },
  });
  await enter();
  assert.deepEqual(await size(), { width: 300, height: 200 });
  assert.equal(await page.getByTestId('native-crop-orientation').count(), 0);
  assert.equal(
    await page.getByRole('button', { name: 'Square', exact: true }).count(),
    0
  );
  await field('width', 10);
  assert.deepEqual(await size(), { width: 120, height: 80 });
  await field('height', 999);
  assert.deepEqual(await size(), { width: 300, height: 200 });
  await page.evaluate(() =>
    window.localEditor.updateOptions({
      crop: {
        aspectRatio: 1,
        minSize: { width: 80, height: 80 },
        maxSize: { width: 200, height: 200 },
      },
    })
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="native-crop-width"]').value ===
      '200'
  );
  assert.deepEqual(await size(), { width: 200, height: 200 });
  const required = await exportInfo();
  assert.equal(required.width, 200);
  assert.equal(required.height, 200);
  console.info(
    'required ratio, numeric bounds and live host updates share constraints'
  );

  await configure({ allowOutsideImage: true, enableLimitToggle: true });
  await enter();
  await page.locator('.rie-crop-details summary').click();
  await field('x', -50);
  await field('y', -40);
  await field('width', 700);
  await field('height', 500);
  await page.getByTestId('native-crop-guides').click();
  await page.getByRole('option', { name: 'Diagonals', exact: true }).click();
  await page.getByTestId('native-crop-handles').click();
  await page.getByRole('option', { name: 'Corners', exact: true }).click();
  const outside = await exportInfo();
  assert.equal(outside.width, 700);
  assert.equal(outside.height, 500);
  assert.equal(outside.corner[3], 0);
  await configure({ allowOutsideImage: true, enableLimitToggle: true });
  await enter();
  await field('width', 700);
  await field('height', 500);
  await page.getByTestId('native-crop-limit').check();
  const limited = await size();
  assert(limited.width <= 600 && limited.height <= 400);
  await page.getByTestId('native-crop-cancel').click();
  console.info(
    'outside transparent export, guides, handles and source-bound toggle'
  );
  await configure({
    interactionFocus: 'image',
    allowOutsideImage: true,
    enableLimitToggle: true,
  });
  await enter();
  await field('width', 700);
  await field('height', 500);
  const fixedFrame = await size();
  await page.getByTestId('native-crop-limit').check();
  assert.deepEqual(await size(), fixedFrame);
  assert((await read()).imageMatrix[0] > 1);
  await page.getByTestId('native-crop-cancel').click();

  await configure();
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  const immediate = await page.evaluate(async () => {
    window.localEditor.updateOptions({ crop: { aspectRatio: 2 } });
    const image = new Image();
    image.src = window.localEditor.getImage();
    await image.decode();
    return image.width / image.height;
  });
  assert.equal(immediate, 2);
  await configure();
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  const invalidRejected = await page.evaluate(() => {
    try {
      window.localEditor.updateOptions({ crop: { aspectRatio: -1 } });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(invalidRejected, true);
  assert.equal((await exportInfo()).width, 400);
  await configure({ interactionFocus: 'image' });
  await enter();
  await page.getByTestId('native-crop-zoom-in').click();
  const pending = await read();
  await page.evaluate(() =>
    window.localEditor.updateOptions({
      crop: {
        interactionFocus: 'selection',
        minSize: { width: 2000, height: 2000 },
      },
    })
  );
  assert.deepEqual(await read(), pending);
  assert.equal(await page.getByTestId('native-crop-cancel').count(), 1);
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await read(), seed);
  console.info(
    'image limit preserves frame; synchronous and invalid option updates preserve ownership'
  );

  await configure();
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.evaluate((doc) => window.localEditor.restoreDocument(doc), seed);
  assert.equal((await exportInfo()).width, 600);
  assert.equal(await page.getByTestId('native-crop-apply').count(), 0);
  await enter();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.evaluate(() => window.localEditor.undo());
  assert.equal((await exportInfo()).width, 600);
  assert.equal(await page.getByTestId('native-crop-apply').count(), 0);
  await configure({ minSize: { width: 1000, height: 1000 } });
  await enter();
  assert.equal(await page.getByTestId('native-crop-apply').count(), 0);
  assert.equal(
    await page.evaluate(() => window.localEditor.inTransaction),
    false
  );
  assert.deepEqual(await read(), seed);
  assert.match(
    await page.locator('.rie-error').innerText(),
    /required dimensions/
  );
  console.info(
    'identical restore, no-op Undo and impossible opening preserve ownership'
  );

  await configure({ interactionFocus: 'image' });
  const affine = { ...seed, imageMatrix: [1.2, 0.4, -0.2, 1.4, 20, -50] };
  await page.evaluate((doc) => window.localEditor.restoreDocument(doc), affine);
  const notifications = await page.evaluate(() => window.changes.length);
  for (let repeat = 0; repeat < 2; repeat++) {
    await enter();
    assert.deepEqual(await size(), { width: 600, height: 400 });
    assert.notDeepEqual((await read()).imageMatrix, affine.imageMatrix);
    assert.equal(
      await page.evaluate(() => window.changes.length),
      notifications
    );
    const cropBox = await page.locator('.rie-crop-artboard').boundingBox();
    const canvasBox = await page.locator('.rie-canvas-wrap').boundingBox();
    assert(
      cropBox.y >= canvasBox.y &&
        cropBox.y + cropBox.height <= canvasBox.y + canvasBox.height
    );
    await page.getByTestId('native-crop-cancel').click();
    assert.deepEqual(await read(), affine);
  }
  await page.evaluate(() =>
    window.localEditor.updateOptions({
      crop: { interactionFocus: 'image', allowOutsideImage: true },
    })
  );
  await enter();
  assert.deepEqual(await read(), affine);
  await page.getByTestId('native-crop-cancel').click();
  console.info(
    'fixed image-focus frame previews coverage only when required; repeated Cancel has no drift'
  );

  await mkdir('.cache/crop-ui-review', { recursive: true });
  await configure({
    interactionFocus: 'image',
    presets,
    guides: { columns: [0.2, 0.8], rows: [0.2, 0.8] },
    handleStyle: 'hook',
  });
  await enter();
  await page.screenshot({ path: '.cache/crop-ui-review/crop-desktop.png' });
  for (const locale of ['en', 'cs', 'sk', 'pl']) {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate(
      (locale) => window.localEditor.updateOptions({ locale, theme: 'dark' }),
      locale
    );
    await page.getByTestId('native-crop-preset').click();
    await page
      .getByRole('option', { name: 'Wide banner', exact: true })
      .click();
    await page.getByTestId('native-crop-focus-selection').click();
    await page.getByTestId('native-crop-focus-image').click();
    await page.getByTestId('native-crop-zoom-in').click();
    await page.getByTestId('native-crop-center').click();
    const dimensions = await page
      .locator('.image-editor-root')
      .evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
      }));
    assert(
      dimensions.scroll <= dimensions.width + 1,
      `${locale} editor overflows horizontally`
    );
    await page.locator('.rie-options-content').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: `.cache/crop-ui-review/crop-${locale}-mobile-dark.png`,
    });
  }
  for (const [width, height] of [
    [848, 600],
    [848, 500],
    [358, 496],
    [358, 396],
  ]) {
    await page.setViewportSize({
      width: Math.max(390, width + 32),
      height: Math.max(700, height + 40),
    });
    await page.locator('.fixture').evaluate(
      (element, [width, height]) => {
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.maxHeight = 'none';
      },
      [width, height]
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) =>
          window.localEditor.updateOptions({
            theme,
            locale: 'en',
            showActions: false,
          }),
        theme
      );
      await page.locator('.rie-options-content').evaluate((element) => {
        element.scrollTop = 0;
      });
      const panel = await page.getByTestId('native-tool-options').boundingBox();
      const action = await page.getByTestId('native-crop-apply').boundingBox();
      assert(
        action.y >= panel.y &&
          action.y + action.height <= panel.y + panel.height
      );
      const canvas = await page.locator('.rie-canvas-wrap').boundingBox();
      assert(
        canvas.height >= 140,
        `${width}×${height} canvas too small: ${canvas.height}`
      );
      await page.locator('.image-editor-root').screenshot({
        path: `.cache/crop-ui-review/crop-host-${width}x${height}-${theme}.png`,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify({
      cropUi: true,
      groupedPresets: true,
      stagedExport: true,
      constraints: true,
      ownership: true,
      narrowFourLocales: true,
    })
  );
} catch (error) {
  await mkdir('.cache/crop-ui-review', { recursive: true });
  await page
    ?.screenshot({ path: '.cache/crop-ui-review/failure.png' })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* Already stopped. */
  }
}
