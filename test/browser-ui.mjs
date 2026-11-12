import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-env.mjs';

const port = Number(process.env.EDITOR_UI_TEST_PORT ?? 4204);
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
  browser;
server.stdout.on('data', (chunk) => {
  logs += chunk;
});
server.stderr.on('data', (chunk) => {
  logs += chunk;
});
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting. */
    }
    if (i === 119) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await launchBrowser();
  const page = await browser.newPage({
      viewport: { width: 1120, height: 800 },
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.locator('[data-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  const darkColors = await page
    .locator('.image-editor-root')
    .evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      comparison: getComputedStyle(
        element.querySelector('[data-testid="native-compare"]')
      ).color,
      transition: getComputedStyle(
        element.querySelector('[data-testid="native-compare"]')
      ).transitionProperty,
    }));
  assert.equal(
    darkColors.comparison,
    darkColors.foreground,
    'Theme changes must not leave dark icons on dark chrome'
  );
  assert.equal(
    darkColors.transition,
    'transform',
    'Theme colors change together without a contrast flash'
  );
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  const doc = () => page.evaluate(() => window.localEditor.getDocument());
  const snapshot = () => page.evaluate(() => window.localEditor.getImage());
  const original = await snapshot();

  await page.getByTestId('native-tool-adjust').click();
  const exposure = page.getByTestId('native-filter-exposure');
  await exposure.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await doc()).effects.exposure, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await doc()).effects.exposure, 0);

  await page.getByTestId('native-tool-filter').click();
  assert.equal(await page.locator('.rie-presets canvas').count(), 16);
  await page.getByTestId('native-filter-preset-noir').click();
  assert.equal((await doc()).effects.preset, 'noir');
  const filtered = await snapshot();
  await page.getByTestId('native-compare').click();
  assert.equal(
    await snapshot(),
    filtered,
    'Comparison must not mutate exported pixels'
  );
  await page.getByTestId('native-compare').click();

  await page.getByTestId('native-tool-frame').click();
  await page.getByTestId('native-frame-polaroid').click();
  assert.equal((await doc()).frame.style, 'polaroid');
  await page.getByTestId('native-frame-corners').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await doc()).cornerRadius, 1);

  await page.getByTestId('native-tool-fill').click();
  await page
    .getByRole('button', { name: 'Color: #facc15', exact: true })
    .click();
  assert.equal((await doc()).background, '#facc15');

  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  await page.getByTestId('native-text-content').fill('First line\nSecond line');
  await page.getByTestId('native-text-content').blur();
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await page
    .getByRole('button', { name: 'Font Sans serif', exact: true })
    .click();
  await page.getByPlaceholder('Search…').fill('Georgia');
  await page.getByRole('option', { name: 'Georgia', exact: true }).click();
  assert.equal((await doc()).layers.at(-1).text, 'First line\nSecond line');
  assert.equal((await doc()).layers.at(-1).textAlign, 'center');
  assert.equal((await doc()).layers.at(-1).underline, true);
  assert.equal((await doc()).layers.at(-1).fontFamily, 'Georgia, serif');

  // Styling controls change the editable document and exported pixels.
  const beforeTextEffects = await snapshot();
  await mkdir('.cache/ui-review', { recursive: true });
  await page.getByText('Text effects', { exact: true }).click();
  await page.getByLabel('Outline width', { exact: true }).fill('3');
  await page.getByLabel('Outline width', { exact: true }).blur();
  await page.getByRole('button', { name: 'Text shadow', exact: true }).click();
  await page
    .getByRole('button', { name: 'Text background: #facc15', exact: true })
    .click();
  assert.equal((await doc()).layers.at(-1).textOutline.width, 3);
  assert.equal((await doc()).layers.at(-1).textShadow.blur, 4);
  assert.equal((await doc()).layers.at(-1).fill, '#facc15');
  assert.notEqual(await snapshot(), beforeTextEffects);
  await page.screenshot({ path: '.cache/ui-review/text-effects.png' });

  const beforeMarkup = await doc();
  await page.getByTestId('native-tool-shapes').click();
  await page.getByTestId('native-shape-rectangle').click();
  await page.getByText('Stroke style', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Pattern Solid', exact: true })
    .click();
  await page.getByRole('option', { name: 'Dashed', exact: true }).click();
  await page
    .getByRole('button', { name: 'Stroke caps Round', exact: true })
    .click();
  await page.getByRole('option', { name: 'Square', exact: true }).click();
  await page
    .getByRole('button', { name: 'Stroke joins Round', exact: true })
    .click();
  await page.getByRole('option', { name: 'Beveled', exact: true }).click();
  await page.getByLabel('Corner radius', { exact: true }).fill('12');
  await page.getByLabel('Corner radius', { exact: true }).blur();
  const styledRectangle = (await doc()).layers.at(-1);
  assert(styledRectangle.strokeDash.length === 2);
  assert.equal(styledRectangle.strokeCap, 'square');
  assert.equal(styledRectangle.strokeJoin, 'bevel');
  assert.equal(styledRectangle.cornerRadius, 12);

  // A selected path tool inserts nothing until the user places points.
  await page.getByTestId('native-shape-path').click();
  const beforePath = (await doc()).layers.length;
  assert.equal(beforePath, beforeMarkup.layers.length + 1);
  const surface = await page.locator('.rie-canvas').boundingBox();
  for (const [x, y] of [
    [0.32, 0.28],
    [0.62, 0.3],
    [0.55, 0.65],
  ]) {
    await page.mouse.click(
      surface.x + surface.width * x,
      surface.y + surface.height * y
    );
  }
  await page.getByRole('button', { name: 'Close path', exact: true }).click();
  assert.equal((await doc()).layers.length, beforePath + 1);
  assert.equal((await doc()).layers.at(-1).pathClosed, true);
  assert.equal((await doc()).layers.at(-1).pathEditable, true);
  assert.equal((await doc()).layers.at(-1).points.length, 3);
  await page.screenshot({ path: '.cache/ui-review/path-controls.png' });

  // Touch-friendly layer selection drives group commands with one undo step.
  await page.getByTestId('native-tool-select').click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const groupCount = (await doc()).layers.length;
  assert.equal(await page.getByTestId('native-group-controls').count(), 1);
  await page.getByTestId('native-align-left').click();
  const aligned = await doc();
  const leftEdges = aligned.layers.map((item) => item.matrix[4]);
  assert(leftEdges.every((left) => Math.abs(left - leftEdges[0]) < 0.01));
  await page
    .getByRole('button', { name: 'Color: #8b5cf6', exact: true })
    .click();
  assert((await doc()).layers.every((item) => item.color === '#8b5cf6'));
  await page.screenshot({ path: '.cache/ui-review/group-controls.png' });
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  assert.equal((await doc()).layers.length, groupCount * 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await doc()).layers.length, groupCount);
  await page.evaluate(
    (document) => window.localEditor.restoreDocument(document),
    beforeMarkup
  );

  await page.getByTestId('native-tool-stickers').click();
  await page.getByTestId('native-sticker-file').setInputFiles({
    name: 'sticker.png',
    mimeType: 'image/png',
    buffer: Buffer.from(original.split(',')[1], 'base64'),
  });
  await page.waitForFunction(() =>
    window.localEditor
      .getDocument()
      .layers.some((layer) => layer.kind === 'image')
  );
  const imageId = (await doc()).layers.at(-1).id;
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  assert.equal(
    (await doc()).layers.filter((layer) => layer.kind === 'image').length,
    2
  );
  assert.notEqual((await doc()).layers.at(-1).id, imageId);
  await page
    .getByRole('button', { name: 'Flip horizontally', exact: true })
    .click();
  assert((await doc()).layers.at(-1).matrix[0] < 0);
  await page.getByTestId('native-tool-select').click();
  const lastLayer = page.locator('.rie-layer-row').first();
  await lastLayer
    .getByRole('button', { name: 'Lock layer', exact: true })
    .click();
  assert.equal((await doc()).layers.at(-1).locked, true);
  await lastLayer
    .getByRole('button', { name: 'Lock layer', exact: true })
    .click();
  assert.equal((await doc()).layers.at(-1).locked, false);
  await lastLayer
    .getByRole('button', { name: 'Hide layer', exact: true })
    .click();
  assert.equal((await doc()).layers.at(-1).hidden, true);
  await lastLayer
    .getByRole('button', { name: 'Hide layer', exact: true })
    .click();
  assert.equal((await doc()).layers.at(-1).hidden, false);

  await page.getByTestId('native-export-settings').click();
  await page.getByRole('button', { name: 'JPEG', exact: true }).click();
  assert.match(await snapshot(), /^data:image\/jpeg;/);
  await page.getByRole('button', { name: 'WEBP', exact: true }).click();
  assert.match(await snapshot(), /^data:image\/webp;/);
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Host-owned actions remain hidden while format controls continue to work.
  await page.evaluate(() =>
    window.localEditor.updateOptions({ showActions: false })
  );
  assert.equal(
    await page.getByRole('button', { name: 'Save', exact: true }).count(),
    0
  );
  assert.equal(await page.getByTestId('native-export-settings').count(), 1);

  await mkdir('.cache/ui-review', { recursive: true });
  for (const locale of ['en', 'cs', 'sk', 'pl']) {
    await page.evaluate(
      (language) => window.localEditor.updateOptions({ locale: language }),
      locale
    );
    await page.setViewportSize({ width: 320, height: 600 });
    for (const tool of [
      'crop',
      'adjust',
      'filter',
      'draw',
      'text',
      'shapes',
      'stickers',
      'redact',
      'frame',
      'fill',
      'resize',
    ]) {
      await page.getByTestId(`native-tool-${tool}`).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true,
        `${locale}/${tool} overflows horizontally`
      );
      const canvas = await page.locator('.rie-canvas-wrap').boundingBox();
      assert(
        canvas.width >= 300 && canvas.height >= 100,
        `${locale}/${tool} leaves too little canvas: ${JSON.stringify(canvas)}`
      );
    }
  }
  await page.evaluate(() => window.localEditor.updateOptions({ locale: 'en' }));
  await page.getByTestId('native-tool-shapes').click();
  await page.getByTestId('native-shape-path').click();
  const mobileCanvas = await page.locator('.rie-canvas').boundingBox();
  for (const [x, y] of [
    [0.25, 0.25],
    [0.7, 0.3],
    [0.6, 0.7],
  ])
    await page.mouse.click(
      mobileCanvas.x + mobileCanvas.width * x,
      mobileCanvas.y + mobileCanvas.height * y
    );
  const finishPath = page.getByRole('button', {
    name: 'Finish path',
    exact: true,
  });
  const pathAction = await finishPath.boundingBox(),
    inspector = await page.locator('.rie-options-content').boundingBox();
  assert(
    pathAction.y >= inspector.y &&
      pathAction.y + pathAction.height <= inspector.y + inspector.height,
    'Mobile path actions must be visible above the shape chooser'
  );
  await finishPath.click();
  await page.evaluate(() => {
    window.localEditor.updateOptions({ locale: 'en' });
    document.querySelector('.fixture').style.height = '240px';
  });
  await page.getByTestId('native-tool-filter').click();
  await page.screenshot({ path: '.cache/ui-review/compact-240.png' });
  const dimensions = await page.locator('.rie-theme').evaluate((element) => ({
    height: element.clientHeight,
    scroll: element.scrollHeight,
  }));
  assert(
    dimensions.scroll <= dimensions.height + 1,
    `Short editor clips controls: ${JSON.stringify(dimensions)}`
  );
  assert.deepEqual(errors, []);
  console.info(
    'UI browser checks passed: effects, comparison, frames, fill, styled text/shapes, editable paths, group commands, stickers, export, host actions, four locales and compact layouts.'
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}
