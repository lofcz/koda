import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_UI_TEST_PORT ?? 4204);
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  'pnpm',
  [
    '--dir',
    'demo',
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
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
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
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
    'UI browser checks passed: effects, comparison, frames, fill, text, stickers, export, host actions, four locales and compact layouts.'
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}
