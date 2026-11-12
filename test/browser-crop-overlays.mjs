import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-env.mjs';

const port = Number(process.env.EDITOR_CROP_OVERLAYS_PORT ?? 4252);
const base = `http://127.0.0.1:${port}`;
const shots = '.cache/crop-overlays-review';
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
const RED = [255, 0, 0, 255];
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
  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1120, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const read = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const seed = await read();
  const configure = async (crop = {}, doc = null) => {
    await page.evaluate(
      async ({ crop, doc }) => {
        await window.localEditor.reset(window.sourceUrl);
        if (doc) await window.localEditor.restoreDocument(doc);
        window.localEditor.updateOptions({
          crop,
          export: { type: 'image/png' },
          locale: 'en',
          theme: 'light',
        });
      },
      { crop, doc }
    );
  };
  const enter = async () => {
    await page.getByTestId('native-tool-crop').click();
    await page.getByTestId('native-crop-apply').waitFor();
  };
  const canUndo = () =>
    page.evaluate(() => window.localEditor.getSnapshot().canUndo);
  const exportInfo = (points = []) =>
    page.evaluate(async (points) => {
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
        data,
        width: image.width,
        height: image.height,
        pixels: points.map(([x, y]) => [
          ...context.getImageData(x, y, 1, 1).data,
        ]),
      };
    }, points);
  // Pixel of the interaction canvas at a document point, after layout settles.
  const overlayAt = (x, y) =>
    page.evaluate(
      async ([x, y]) => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const art = document
            .querySelector('.rie-artboard')
            .getBoundingClientRect(),
          canvas = document.querySelector('.upper-canvas'),
          box = canvas.getBoundingClientRect(),
          doc = window.localEditor.getSnapshot().document,
          ratio = canvas.width / box.width;
        const sx = art.left + (x * art.width) / doc.width - box.left,
          sy = art.top + (y * art.height) / doc.height - box.top;
        return [
          ...canvas
            .getContext('2d')
            .getImageData(Math.floor(sx * ratio), Math.floor(sy * ratio), 1, 1)
            .data,
        ];
      },
      [x, y]
    );
  const waitOverlay = async (x, y, predicate, message) => {
    let last;
    for (let frame = 0; frame < 60; frame++) {
      last = await overlayAt(x, y);
      if (predicate(last)) return last;
    }
    assert.fail(`${message}: overlay pixel at ${x},${y} is ${last}`);
  };
  const dimmed = (pixel) => pixel[3] > 150 && pixel[0] < 40;
  const clear = (pixel) => pixel[3] === 0;
  const tinted = (pixel) => pixel[3] > 40 && pixel[0] > pixel[1] + 60;
  const openDetails = async () => {
    const details = page.locator('.rie-crop-details');
    if (!(await details.evaluate((element) => element.open)))
      await details.locator('summary').click();
  };
  const cropRect = () =>
    page.evaluate(() => {
      const art = document.querySelector('.rie-artboard').style,
        crop = document.querySelector('.rie-crop-artboard').style,
        zoom =
          parseFloat(art.width) /
          window.localEditor.getSnapshot().document.width;
      return {
        x: (parseFloat(crop.left) - parseFloat(art.left)) / zoom,
        y: (parseFloat(crop.top) - parseFloat(art.top)) / zoom,
        width: parseFloat(crop.width) / zoom,
        height: parseFloat(crop.height) / zoom,
      };
    });
  const sameRect = (actual, expected, label) => {
    for (const key of ['x', 'y', 'width', 'height'])
      close(actual[key], expected[key], 2, `${label} ${key}`);
  };
  const close = (actual, expected, digits = 3, label = '') =>
    assert(
      Math.abs(actual - expected) < 10 ** -digits,
      `${label} expected ${expected}, got ${actual}`
    );

  // Circular profile overlay: dims the crop corners in the viewport, never the export.
  await configure({ guides: 'none' });
  await enter();
  await waitOverlay(12, 12, clear, 'plain crop leaves corners undimmed');
  const plainExport = await exportInfo([[12, 12]]);
  assert.deepEqual(plainExport.pixels[0], RED);
  // Export commits the pending crop, so each scenario starts from a fresh reset.
  await configure({ guides: 'none', overlay: 'circle' });
  await enter();
  await waitOverlay(12, 12, dimmed, 'circle dims the crop corner');
  await waitOverlay(150, 200, clear, 'circle keeps its inside clear');
  await waitOverlay(300, 200, clear, 'circle keeps its center clear');
  await openDetails();
  assert.equal(
    await page.getByTestId('native-crop-overlay-circle').isChecked(),
    true
  );
  await page.getByText('The saved image stays rectangular.').waitFor();
  // The toggle keeps a checkbox-sized box and a readable label beside it.
  const toggle = await page
    .getByTestId('native-crop-overlay-circle')
    .evaluate((input) => {
      const range = document.createRange();
      range.selectNodeContents(input.closest('label'));
      range.setStartAfter(input);
      return {
        box: input.getBoundingClientRect().width,
        text: range.getBoundingClientRect().width,
      };
    });
  assert(toggle.box <= 20, `checkbox stretched to ${toggle.box}px`);
  assert(toggle.text >= 60, `checkbox label collapsed to ${toggle.text}px`);
  const circleExport = await exportInfo([[12, 12]]);
  assert.deepEqual(circleExport.pixels[0], RED);
  assert.equal(circleExport.data, plainExport.data);
  console.info('circle overlay renders in the viewport only');

  // The panel toggle and presets switch the overlay; a preset hands control back.
  await configure({
    guides: 'none',
    presets: [
      {
        id: 'profile',
        label: 'Profile photo',
        aspectRatio: 1,
        overlay: 'circle',
      },
      { id: 'wide', label: 'Wide', aspectRatio: 2 },
    ],
  });
  await enter();
  await openDetails();
  await page.getByTestId('native-crop-overlay-circle').check();
  await waitOverlay(12, 12, dimmed, 'toggle enables the circle');
  await page.getByTestId('native-crop-overlay-circle').uncheck();
  await waitOverlay(12, 12, clear, 'toggle disables the circle');
  await page.getByTestId('native-crop-preset').click();
  await page
    .getByRole('option', { name: 'Profile photo', exact: true })
    .click();
  const square = await cropRect();
  close(square.width, square.height, 6, 'profile preset is square');
  await waitOverlay(
    square.x + 8,
    square.y + 8,
    dimmed,
    'profile preset requests the circle'
  );
  assert.equal(
    await page.getByTestId('native-crop-overlay-circle').isChecked(),
    true
  );
  await page.getByTestId('native-crop-preset').click();
  await page.getByRole('option', { name: 'Wide', exact: true }).click();
  const wide = await cropRect();
  await waitOverlay(
    wide.x + 4,
    wide.y + 4,
    clear,
    'switching away from the profile preset restores the host overlay'
  );
  assert.equal(
    await page.getByTestId('native-crop-overlay-circle').isChecked(),
    false
  );
  const profileExport = await exportInfo([[2, 2]]);
  assert.equal(profileExport.width, 2 * profileExport.height);
  assert.deepEqual(profileExport.pixels[0], RED);
  console.info('profile preset and panel toggle drive the circle overlay');

  // Print guides: bleed band and lines inside the crop, absent from the export.
  await configure({ bleed: { bleed: 20, safe: 20 } });
  await enter();
  await waitOverlay(8, 120, tinted, 'bleed band is tinted');
  await waitOverlay(100, 120, clear, 'safe area stays clear');
  assert.equal(
    await page.getByTestId('native-crop-bleed-hint').innerText(),
    'The red edge is trimmed off in print. Keep text and faces inside the dashed line.'
  );
  const bleedExport = await exportInfo([
    [8, 120],
    [100, 120],
  ]);
  assert.deepEqual(bleedExport.pixels, [RED, RED]);
  assert.equal(bleedExport.data, plainExport.data);
  // Pixel insets are output pixels: a 1200 px wide preset halves them on a 600 px crop.
  await configure({
    presets: [
      {
        id: 'card',
        label: 'Print card',
        size: { width: 1200, height: 800 },
        bleed: { bleed: 60 },
      },
    ],
  });
  await enter();
  await waitOverlay(20, 120, clear, 'no guides before the print preset');
  assert.equal(await page.getByTestId('native-crop-bleed-hint').count(), 0);
  await page.getByTestId('native-crop-preset').click();
  await page.getByRole('option', { name: 'Print card', exact: true }).click();
  await waitOverlay(20, 120, tinted, 'preset bleed covers 30 crop units');
  await waitOverlay(45, 120, clear, 'preset bleed stops at 30 crop units');
  assert.equal(
    await page.getByTestId('native-crop-bleed-hint').innerText(),
    'The red edge is trimmed off in print.'
  );
  const cardExport = await exportInfo([[20, 120]]);
  assert.equal(cardExport.width, 1200);
  assert.deepEqual(cardExport.pixels[0], RED);
  console.info('print bleed guides measure output pixels and never export');

  // Recenter in image focus: moves the photo center under the crop, keeps zoom.
  const imageCenter = (matrix) => ({
    x: matrix[0] * 300 + matrix[2] * 200 + matrix[4],
    y: matrix[1] * 300 + matrix[3] * 200 + matrix[5],
  });
  const offCenter = async () => {
    await page.getByTestId('native-crop-zoom-in').click();
    await page.getByTestId('native-crop-zoom-in').click();
    await page.getByTestId('native-crop-zoom-in').click();
    await page.getByRole('application').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp');
    const moved = await read();
    const center = imageCenter(moved.imageMatrix);
    assert(Math.abs(center.x - 270) < 1e-6 && Math.abs(center.y - 180) < 1e-6);
    return moved;
  };
  await configure({ interactionFocus: 'image' });
  await enter();
  const moved = await offCenter();
  const centerButton = page.getByTestId('native-crop-center');
  assert.equal(
    await centerButton.getAttribute('title'),
    'Moves the photo so its center is in the middle of the crop.'
  );
  await centerButton.focus();
  await page.keyboard.press('Enter');
  const recentered = await read();
  const centered = imageCenter(recentered.imageMatrix);
  close(centered.x, 300, 6, 'image center x');
  close(centered.y, 200, 6, 'image center y');
  assert.deepEqual(
    recentered.imageMatrix.slice(0, 4),
    moved.imageMatrix.slice(0, 4)
  );
  assert.equal(await canUndo(), false);
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await read(), seed);
  await enter();
  await offCenter();
  await centerButton.click();
  await page.getByTestId('native-crop-apply').click();
  assert.equal(await canUndo(), true);
  await page.evaluate(() => window.localEditor.undo());
  assert.deepEqual(await read(), seed);
  assert.equal(await canUndo(), false);
  console.info(
    'image-focus recenter keeps zoom; Cancel restores, Apply is one undo'
  );

  // Recenter in selection focus: moves the crop to the photo center.
  await configure();
  await enter();
  await openDetails();
  for (const [name, value] of [
    ['width', 200],
    ['height', 120],
    ['x', 10],
    ['y', 20],
  ]) {
    const input = page.getByTestId(`native-crop-${name}`);
    await input.fill(String(value));
    await input.press('Tab');
  }
  sameRect(
    await cropRect(),
    { x: 10, y: 20, width: 200, height: 120 },
    'typed crop'
  );
  assert.equal(await centerButton.innerText(), 'Center crop on photo');
  assert.equal(
    await centerButton.getAttribute('title'),
    'Moves the crop to the middle of the photo.'
  );
  await centerButton.click();
  sameRect(
    await cropRect(),
    { x: 200, y: 140, width: 200, height: 120 },
    'recentered crop'
  );
  // The number fields carry the exact state behind the rounded CSS artboard.
  for (const [name, value] of [
    ['x', '200'],
    ['y', '140'],
    ['width', '200'],
    ['height', '120'],
  ])
    assert.equal(
      await page.getByTestId(`native-crop-${name}`).inputValue(),
      value
    );
  assert.deepEqual((await read()).imageMatrix, seed.imageMatrix);
  await page.getByTestId('native-crop-cancel').click();
  assert.deepEqual(await read(), seed);
  // A crop recovered from the source pans the view so the moved crop stays visible.
  const cropped = {
    ...seed,
    width: 300,
    height: 400,
    imageMatrix: [1, 0, 0, 1, -300, 0],
  };
  await configure({}, cropped);
  await enter();
  await centerButton.click();
  sameRect(
    await cropRect(),
    { x: -150, y: 0, width: 300, height: 400 },
    'recovered crop'
  );
  const cropBox = await page.locator('.rie-crop-artboard').boundingBox(),
    wrap = await page.locator('.rie-canvas-wrap').boundingBox();
  assert(
    cropBox.x >= wrap.x - 0.5 &&
      cropBox.y >= wrap.y - 0.5 &&
      cropBox.x + cropBox.width <= wrap.x + wrap.width + 0.5 &&
      cropBox.y + cropBox.height <= wrap.y + wrap.height + 0.5,
    'recentered crop stays in view'
  );
  await page.getByTestId('native-crop-apply').click();
  const recovered = await read();
  assert.deepEqual(recovered.imageMatrix, [1, 0, 0, 1, -150, 0]);
  assert.deepEqual(
    (
      await exportInfo([
        [10, 100],
        [200, 100],
      ])
    ).pixels,
    [RED, [0, 0, 255, 255]]
  );
  await page.evaluate(() => window.localEditor.undo());
  assert.deepEqual(await read(), cropped);
  console.info('selection-focus recenter moves the crop and keeps it in view');

  // Straighten readout: typing, keyboard, reset and persistence with flips.
  const angleField = page.getByTestId('native-crop-straighten-angle'),
    slider = page.getByTestId('native-crop-straighten'),
    reset = page.getByTestId('native-crop-straighten-reset');
  const tilt = async () => {
    const m = (await read()).imageMatrix;
    return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  };
  const typeAngle = async (text) => {
    await angleField.fill(text);
    await angleField.press('Enter');
  };
  for (const focus of ['selection', 'image']) {
    await configure({ interactionFocus: focus });
    await enter();
    const opened = await read();
    assert.equal(await angleField.inputValue(), '0');
    await typeAngle('-3,5');
    assert.equal(await angleField.inputValue(), '−3.5');
    assert.equal(await slider.inputValue(), '-3.5');
    assert.equal(await slider.getAttribute('aria-valuetext'), '−3.5°');
    close(await tilt(), -3.5, 6, `${focus} typed tilt`);
    // Separate edits compose from one base: returning to 0 restores the opened image.
    await typeAngle('10');
    await reset.click();
    assert.equal(await angleField.inputValue(), '0');
    (await read()).imageMatrix.forEach((value, index) =>
      close(value, opened.imageMatrix[index], 6, `${focus} reset matrix`)
    );
    await typeAngle('−3.5°');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await angleField.inputValue(), '−3');
    close(await tilt(), -3, 6, `${focus} slider keyboard tilt`);
    await angleField.press('ArrowDown');
    assert.equal(await angleField.inputValue(), '−3.1');
    // Escape reverts an unfinished entry without closing the crop.
    await angleField.fill('20');
    await angleField.press('Escape');
    assert.equal(await angleField.inputValue(), '−3.1');
    assert.equal(await page.getByTestId('native-crop-apply').count(), 1);
    // Out-of-range input clamps to the configured limit.
    await typeAngle('90');
    assert.equal(await angleField.inputValue(), '45');
    await typeAngle('-3.5');
    await page
      .getByRole('button', { name: 'Rotate right', exact: true })
      .click();
    assert.equal(await angleField.inputValue(), '−3.5');
    await page
      .getByRole('button', { name: 'Flip horizontally', exact: true })
      .click();
    assert.equal(await angleField.inputValue(), '3.5');
    await page.getByTestId('native-crop-apply').click();
    assert.equal(await canUndo(), true);
    await enter();
    assert.equal(await angleField.inputValue(), '3.5');
    await typeAngle('8');
    await page.getByTestId('native-crop-cancel').click();
    await enter();
    assert.equal(await angleField.inputValue(), '3.5');
    await page.getByTestId('native-crop-cancel').click();
    await page.evaluate(() => window.localEditor.undo());
    assert.deepEqual(await read(), seed);
    await enter();
    assert.equal(await angleField.inputValue(), '0');
    await page.getByTestId('native-crop-cancel').click();
    console.info(`${focus}-focus angle readout, typing, reset and persistence`);
  }
  // A host range above 45° keeps the chosen angle instead of an equivalent one.
  await configure({ rotationRange: 90 });
  await enter();
  await typeAngle('60');
  await page.getByTestId('native-crop-apply').click();
  await enter();
  assert.equal(await angleField.inputValue(), '60');
  await page.getByTestId('native-crop-cancel').click();
  // Czech decimal comma in the readout.
  await configure();
  await page.evaluate(() => window.localEditor.updateOptions({ locale: 'cs' }));
  await enter();
  await typeAngle('-2.25');
  assert.equal(await angleField.inputValue(), '−2,25');
  await page.getByTestId('native-crop-cancel').click();
  console.info('wide host range and localized decimal readout');

  // Visual review: light/dark, desktop and narrow hosts, all locales.
  await mkdir(shots, { recursive: true });
  const reviewOptions = {
    overlay: 'circle',
    bleed: { bleed: 16, safe: 16 },
    presets: [
      {
        id: 'profile',
        label: 'Profile photo',
        aspectRatio: 1,
        overlay: 'circle',
      },
    ],
  };
  await configure(reviewOptions);
  await enter();
  await typeAngle('-3.5');
  await page.screenshot({ path: `${shots}/overlays-desktop-light.png` });
  await page.evaluate(() =>
    window.localEditor.updateOptions({ theme: 'dark' })
  );
  await page.screenshot({ path: `${shots}/overlays-desktop-dark.png` });
  await page.getByTestId('native-crop-cancel').click();
  for (const [width, height] of [
    [358, 496],
    [358, 396],
    [848, 500],
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
    for (const locale of ['en', 'cs', 'sk', 'pl']) {
      for (const theme of locale === 'en' ? ['light', 'dark'] : ['dark']) {
        await configure(reviewOptions);
        await page.evaluate(
          ({ locale, theme }) =>
            window.localEditor.updateOptions({ locale, theme }),
          { locale, theme }
        );
        await enter();
        await typeAngle('-3.5');
        await openDetails();
        const dimensions = await page
          .locator('.image-editor-root')
          .evaluate((element) => ({
            width: element.clientWidth,
            scroll: element.scrollWidth,
          }));
        assert(
          dimensions.scroll <= dimensions.width + 1,
          `${locale} ${width}×${height} editor overflows horizontally`
        );
        const row = await page
          .locator('.rie-crop-straighten > span')
          .boundingBox();
        const panel = await page
          .getByTestId('native-tool-options')
          .boundingBox();
        assert(
          row.x >= panel.x - 0.5 &&
            row.x + row.width <= panel.x + panel.width + 0.5,
          `${locale} ${width}×${height} straighten row leaves the panel`
        );
        const field = await angleField.boundingBox(),
          button = await reset.boundingBox();
        assert(
          field.y + field.height > button.y &&
            button.y + button.height > field.y,
          `${locale} ${width}×${height} angle field and reset share a row`
        );
        await angleField.scrollIntoViewIfNeeded();
        await page.locator('.image-editor-root').screenshot({
          path: `${shots}/overlays-${width}x${height}-${locale}-${theme}.png`,
        });
        if (locale === 'en' || width === 358) {
          await page
            .getByTestId('native-crop-overlay-circle')
            .scrollIntoViewIfNeeded();
          await page.locator('.image-editor-root').screenshot({
            path: `${shots}/overlays-${width}x${height}-${locale}-${theme}-details.png`,
          });
        }
        await page.getByTestId('native-crop-cancel').click();
      }
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify({
      circleOverlay: true,
      bleedOverlay: true,
      exportsClean: true,
      recenterImage: true,
      recenterSelection: true,
      angleReadout: true,
      narrowFourLocales: true,
    })
  );
} catch (error) {
  await mkdir(shots, { recursive: true });
  await page?.screenshot({ path: `${shots}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* Already stopped. */
  }
}
