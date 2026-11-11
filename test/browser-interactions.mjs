import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_INTERACTIONS_PORT ?? 4202),
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
    detached: process.platform !== 'win32',
  }
);
let log = '',
  browser;
server.stdout.on('data', (chunk) => {
  log += chunk;
});
server.stderr.on('data', (chunk) => {
  log += chunk;
});
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Server starting. */
    }
    if (i === 119) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  const page = await browser.newPage({
      viewport: { width: 1100, height: 780 },
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const screenshots = process.env.EDITOR_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const capture = async (name) => {
    if (screenshots) await page.screenshot({ path: join(screenshots, name) });
  };
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const document = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const selected = () =>
    page.evaluate(() => window.localEditor.getSnapshot().selected);
  const image = () => page.evaluate(() => window.localEditor.getImage());
  const reset = async () => {
    await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="native-tool-select"]')
          ?.getAttribute('aria-pressed') === 'true'
    );
  };
  const frame = () => page.locator('.rie-artboard').boundingBox();
  const drag = async (x, y, dx, dy, finish = true) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    if (finish) await page.mouse.up();
  };
  const undo = () =>
    page.getByRole('button', { name: 'Undo', exact: true }).click();

  // Edge handles resize only their axis; Enter commits the pending crop exactly once.
  await page.getByTestId('native-tool-crop').click();
  let box = await frame();
  await drag(box.x + box.width, box.y + box.height / 2, -box.width / 5, 30);
  await capture('interaction-crop.png');
  await page.keyboard.press('Enter');
  let doc = await document();
  assert.deepEqual([doc.width, doc.height], [480, 400]);
  await undo();
  assert.deepEqual(
    [(await document()).width, (await document()).height],
    [600, 400]
  );
  await reset();
  await page.getByTestId('native-tool-crop').click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  box = await frame();
  const scale = box.width / 600;
  await drag(box.x + 500 * scale, box.y + 200 * scale, -80 * scale, 0);
  await page.keyboard.press('Enter');
  doc = await document();
  assert.deepEqual([doc.width, doc.height], [320, 320]);
  await reset();
  await page.getByTestId('native-tool-crop').click();
  box = await frame();
  await drag(box.x + box.width, box.y + box.height / 2, -100, 0, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.press('Enter');
  assert.deepEqual(
    [(await document()).width, (await document()).height],
    [600, 400]
  );

  // On-image multiline typing shares the live document; Escape restores one transaction.
  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  const textField = page.getByTestId('native-canvas-text');
  await textField.waitFor();
  const placeholder = (await document()).layers.at(-1).text;
  await textField.fill('First line\nSecond line');
  await capture('interaction-text.png');
  await page.keyboard.press('Control+Enter');
  assert.equal(await textField.count(), 0);
  assert.equal(
    (await document()).layers.at(-1).text,
    'First line\nSecond line'
  );
  await undo();
  assert.equal((await document()).layers.at(-1).text, placeholder);
  await page.getByRole('application').focus();
  await page.keyboard.press('Enter');
  await textField.fill('Exported draft');
  await image();
  await textField.fill('Continued edit');
  await page.keyboard.press('Control+Enter');
  await undo();
  assert.equal((await document()).layers.at(-1).text, 'Exported draft');
  await page.getByRole('application').focus();
  await page.keyboard.press('Enter');
  await textField.fill('Discard this change');
  await page.keyboard.press('Escape');
  assert.equal((await document()).layers.at(-1).text, 'Exported draft');
  await page.getByRole('application').focus();
  await page.keyboard.press('Enter');
  await textField.fill('Typing safety');
  await page.keyboard.press('Backspace');
  assert.equal((await document()).layers.length, 1);
  await page.keyboard.press('Control+Enter');
  box = await frame();
  const textLayer = (await document()).layers[0],
    z = box.width / 600;
  await page.mouse.dblclick(
    box.x + (textLayer.matrix[4] + textLayer.width / 2) * z,
    box.y + (textLayer.matrix[5] + textLayer.height / 2) * z
  );
  await textField.waitFor();
  await page.keyboard.press('Escape');

  // Manual zoom remains stable when the tool panel opens/closes; fitted view responds.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await page.getByRole('application').getAttribute('data-zoom');
  await page.getByTestId('native-tool-options-close').click();
  assert.equal(
    await page.getByRole('application').getAttribute('data-zoom'),
    zoom
  );
  await page.getByTestId('native-tool-shapes').click();
  assert.equal(
    await page.getByRole('application').getAttribute('data-zoom'),
    zoom
  );
  await page
    .getByRole('button', { name: 'Fit to screen', exact: true })
    .click();

  // A drag is a single undo item. Escape and lost capture restore its starting matrix.
  await reset();
  await page.getByTestId('native-tool-shapes').click();
  await page.getByTestId('native-shape-rectangle').click();
  let original = (await document()).layers[0];
  box = await frame();
  await drag(box.x + box.width / 2, box.y + box.height / 2, 30, 25, false);
  assert.notDeepEqual((await document()).layers[0].matrix, original.matrix);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual((await document()).layers[0].matrix, original.matrix);
  await drag(box.x + box.width / 2, box.y + box.height / 2, 30, 25);
  await undo();
  assert.deepEqual((await document()).layers[0].matrix, original.matrix);
  await drag(box.x + box.width / 2, box.y + box.height / 2, 20, 15, false);
  await page.locator('.upper-canvas').evaluate((canvas) => {
    if (canvas.hasPointerCapture(1)) canvas.releasePointerCapture(1);
  });
  await page.mouse.up();
  assert.deepEqual((await document()).layers[0].matrix, original.matrix);
  await page.getByRole('application').focus();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  assert.equal((await document()).layers[0].matrix[4], original.matrix[4] + 2);
  await undo();
  assert.deepEqual((await document()).layers[0].matrix, original.matrix);
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+d');
  assert.equal((await document()).layers.length, 2);
  await undo();

  // Locked layers cannot be hit or deleted by canvas keyboard actions.
  await page.getByTestId('native-tool-select').click();
  await page.evaluate(() => {
    const editor = window.localEditor,
      doc = editor.getSnapshot().document;
    editor.commit({
      ...doc,
      layers: doc.layers.map((layer) => ({ ...layer, locked: true })),
    });
  });
  original = (await document()).layers[0];
  box = await frame();
  await drag(box.x + box.width / 2, box.y + box.height / 2, 20, 20);
  assert.equal(await selected(), null);
  await page.keyboard.press('Delete');
  assert.deepEqual((await document()).layers[0], original);

  // Line endpoint handles work at nontrivial angles and retain the opposite endpoint.
  await reset();
  await page.getByTestId('native-tool-shapes').click();
  await page.getByTestId('native-shape-arrow').click();
  original = (await document()).layers[0];
  box = await frame();
  const zz = box.width / 600;
  await drag(
    box.x + (original.matrix[4] + original.width) * zz,
    box.y + (original.matrix[5] + original.height) * zz,
    30,
    -45
  );
  const arrow = (await document()).layers[0];
  assert.deepEqual(arrow.matrix.slice(4), original.matrix.slice(4));
  assert.notDeepEqual(arrow.matrix, original.matrix);
  await undo();
  assert.deepEqual((await document()).layers[0], original);

  // Live touch promotion cancels the tentative stroke; remaining finger pans only.
  await reset();
  await page.getByTestId('native-tool-draw').click();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  box = await frame();
  const x = box.x + box.width * 0.3,
    y = box.y + box.height * 0.4;
  await touch('touchStart', [[x, y]]);
  await touch('touchMove', [[x + 20, y + 20]]);
  assert.equal((await document()).layers.length, 1);
  await touch('touchStart', [
    [x + 20, y + 20],
    [x + 80, y + 20],
  ]);
  assert.equal((await document()).layers.length, 0);
  const touchZoom = Number(
    await page.getByRole('application').getAttribute('data-zoom')
  );
  await touch('touchMove', [
    [x, y + 20],
    [x + 110, y + 20],
  ]);
  await touch('touchEnd', [[x, y + 20]]);
  await touch('touchMove', [[x + 30, y + 50]]);
  await touch('touchEnd', []);
  assert(
    Number(await page.getByRole('application').getAttribute('data-zoom')) >
      touchZoom * 1.5
  );
  assert.equal((await document()).layers.length, 0);
  await page
    .getByRole('button', { name: 'Fit to screen', exact: true })
    .click();
  box = await frame();
  await touch('touchStart', [[box.x + 60, box.y + 60]]);
  await touch('touchMove', [[box.x + 100, box.y + 100]]);
  await touch('touchCancel', []);
  assert.equal((await document()).layers.length, 0);
  await cdp.detach();

  // Redactions are direct-drag layers with the same cancellation and undo model.
  await reset();
  await page.getByTestId('native-tool-redact').click();
  box = await frame();
  await drag(box.x + 40, box.y + 40, 100, 80);
  assert.equal((await document()).layers[0].kind, 'redaction');
  assert.equal(await selected(), (await document()).layers[0].id);
  await undo();
  assert.equal((await document()).layers.length, 0);

  // Comparison changes display only; image import remains a selectable object.
  await reset();
  await page.getByTestId('native-tool-filter').click();
  await page.getByTestId('native-filter-preset-sepia').click();
  const edited = await image();
  const editedPreview = await page
    .locator('.lower-canvas')
    .evaluate((canvas) => canvas.toDataURL());
  await page.getByTestId('native-compare').click();
  assert.equal(await image(), edited);
  assert.notEqual(
    await page
      .locator('.lower-canvas')
      .evaluate((canvas) => canvas.toDataURL()),
    editedPreview
  );
  await page.getByTestId('native-compare').click();
  await page.getByRole('application').evaluate(async (node) => {
    const blob = await (await fetch(window.sourceUrl)).blob(),
      data = new DataTransfer();
    data.items.add(new File([blob], 'sticker.png', { type: 'image/png' }));
    node.dispatchEvent(
      new DragEvent('drop', { bubbles: true, dataTransfer: data })
    );
  });
  await page.waitForFunction(() =>
    window.localEditor
      .getSnapshot()
      .document.layers.some((layer) => layer.kind === 'image')
  );
  assert.equal((await document()).layers.at(-1).kind, 'image');
  assert.equal(await selected(), (await document()).layers.at(-1).id);
  const imported = (await document()).layers.at(-1);
  box = await frame();
  await drag(
    box.x + ((imported.matrix[4] + imported.width / 2) * box.width) / 600,
    box.y + ((imported.matrix[5] + imported.height / 2) * box.height) / 400,
    25,
    -15
  );
  assert.notDeepEqual((await document()).layers.at(-1).matrix, imported.matrix);
  await undo();
  assert.deepEqual((await document()).layers.at(-1).matrix, imported.matrix);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await capture('interaction-mobile-dark.png');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true
  );
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify(
      {
        cropEdgeRatioAndCancel: true,
        directTextCommitUndoEscape: true,
        scopedTyping: true,
        zoomAcrossPanels: true,
        dragAndKeyboardTransactions: true,
        lockedLayerProtection: true,
        arrowEndpoints: true,
        touchPromotionCancelAndPan: true,
        comparisonPreservesExport: true,
        droppedImageSelectable: true,
        mobileDark: true,
        pageErrors: errors,
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    // A failed Vite launch may have already ended its process group.
  }
}
