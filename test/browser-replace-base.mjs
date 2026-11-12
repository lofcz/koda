/** Base export and history-preserving base replacement (the host AI edit path), with pixel checks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_REPLACE_BASE_PORT ?? 4552),
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
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page
    .locator('[data-editor-engine="local-canvas"] [data-ready="true"]')
    .waitFor();
  await page.waitForFunction(() => !!window.localEditor);
  /** RGBA samples of an exported data URL at document coordinates. */
  const pixels = (dataUrl, points) =>
    page.evaluate(
      async ({ url, points }) => {
        const image = await createImageBitmap(await (await fetch(url)).blob()),
          canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return {
          size: [canvas.width, canvas.height],
          ...Object.fromEntries(
            Object.entries(points).map(([name, [x, y]]) => [
              name,
              [...ctx.getImageData(x, y, 1, 1).data],
            ])
          ),
        };
      },
      { url: dataUrl, points }
    );
  const snapshot = () => page.evaluate(() => window.localEditor.getImage());
  const baseImage = () =>
    page.evaluate(() => window.localEditor.getBaseImage());
  const doc = () => page.evaluate(() => window.localEditor.getDocument());
  const screen = () =>
    page
      .locator('canvas.lower-canvas')
      .evaluate((canvas) => canvas.toDataURL());
  /** The visible canvas repaints on animation frames; poll a bounded number. */
  const waitForScreen = async (predicate, message) => {
    for (let frame = 0; frame < 60; frame++) {
      const value = await screen();
      if (predicate(value)) return value;
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve))
      );
    }
    throw new Error(message);
  };
  // Document coordinates in the 600x400 fixture: red left half, blue top-right
  // quadrant, transparent bottom-right quadrant.
  const points = {
    photo: [20, 20],
    stroke: [165, 160],
    aiPatch: [250, 150],
    transparent: [560, 330],
    corner: [2, 2],
  };

  /** The unfiltered preset preview cover-fits the source into 144x96; (60,36)
   * maps to document (250,150), inside the simulated AI patch. */
  const thumbnail = async () => {
    await page.getByTestId('native-tool-filter').click();
    return page
      .getByTestId('native-filter-preset-none')
      .locator('canvas')
      .evaluate((canvas) => [
        ...canvas.getContext('2d').getImageData(60, 36, 1, 1).data,
      ]);
  };
  assert.deepEqual(await thumbnail(), [255, 0, 0, 255]);

  // Manual edits before the AI step: a photo filter, a frame, a background fill,
  // a brush stroke and a text layer.
  await page.getByTestId('native-tool-filter').click();
  await page.getByTestId('native-filter-preset-invert').click();
  await page.getByTestId('native-tool-frame').click();
  await page.getByTestId('native-frame-solid').click();
  await page.getByTestId('native-tool-fill').click();
  await page
    .getByRole('button', { name: 'Color: #facc15', exact: true })
    .click();
  await page.getByTestId('native-tool-draw').click();
  const artboard = await page.locator('.rie-artboard').boundingBox();
  assert(artboard);
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
  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  await page.getByTestId('native-text-content').fill('Before AI');
  await page.getByTestId('native-text-content').blur();
  const beforeDoc = await doc();
  assert.deepEqual(
    beforeDoc.layers.map((layer) => layer.kind),
    ['path', 'text']
  );
  const beforeImage = await snapshot(),
    beforeBase = await baseImage(),
    beforeScreen = await screen();
  const flat = await pixels(beforeImage, points),
    raw = await pixels(beforeBase, points);
  assert.deepEqual(raw.size, [600, 400], 'Base export uses document size');
  assert.deepEqual(raw.photo, [0, 255, 255, 255], 'Base includes effects');
  assert.deepEqual(raw.stroke, [0, 255, 255, 255], 'Base excludes the stroke');
  assert.deepEqual(flat.stroke.slice(0, 3), [229, 72, 77], 'Export has it');
  assert.equal(raw.transparent[3], 0, 'Base excludes the background fill');
  assert.deepEqual(flat.transparent, [250, 204, 21, 255]);
  assert.deepEqual(raw.corner, [0, 255, 255, 255], 'Base excludes the frame');
  assert.notDeepEqual(flat.corner, raw.corner);

  // A failed AI result leaves the draft untouched.
  const failure = await page.evaluate(() =>
    window.localEditor.replaceBase('data:image/png;base64,broken').then(
      () => 'applied',
      (error) => error.message
    )
  );
  assert.notEqual(failure, 'applied');
  assert.equal(await snapshot(), beforeImage);
  assert.deepEqual(await doc(), beforeDoc);

  // Simulated AI result: the base at half resolution with a green patch painted
  // over document rect (200,100)-(300,200).
  const changesBefore = await page.evaluate(() => window.changes.length);
  await page.evaluate(async (url) => {
    const image = await createImageBitmap(await (await fetch(url)).blob()),
      canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 300, 200);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(100, 50, 50, 50);
    await window.localEditor.replaceBase(canvas.toDataURL('image/png'));
  }, beforeBase);
  assert.equal(
    await page.evaluate(() => window.changes.length),
    changesBefore + 1,
    'One committed change'
  );
  const afterDoc = await doc();
  assert.deepEqual(afterDoc.layers, beforeDoc.layers, 'Layers are untouched');
  assert.deepEqual(afterDoc.imageMatrix, [2, 0, 0, 2, 0, 0]);
  assert.equal(afterDoc.effects.preset, 'none', 'Effects are baked in');
  assert.deepEqual(afterDoc.frame, beforeDoc.frame);
  assert.equal(afterDoc.background, beforeDoc.background);
  const afterImage = await snapshot(),
    after = await pixels(afterImage, points),
    afterBase = await pixels(await baseImage(), points);
  assert.deepEqual(after.size, [600, 400]);
  assert.deepEqual(after.aiPatch, [0, 255, 0, 255], 'AI pixels in place');
  assert.deepEqual(after.photo, [0, 255, 255, 255], 'Inverted once, not twice');
  assert.deepEqual(after.stroke, flat.stroke, 'The stroke stays on top');
  assert.deepEqual(after.transparent, flat.transparent, 'Background remains');
  assert.deepEqual(after.corner, flat.corner, 'Frame remains');
  assert.deepEqual(afterBase.stroke, [0, 255, 255, 255]);
  assert.deepEqual(afterBase.aiPatch, [0, 255, 0, 255]);
  const afterScreen = await waitForScreen(
    (value) => value !== beforeScreen,
    'The visible canvas shows the replaced base'
  );
  // The editor UI did not restart: the text panel still edits the selected layer.
  assert.equal(
    await page.getByTestId('native-text-content').innerText(),
    'Before AI'
  );
  assert.deepEqual(
    await thumbnail(),
    [0, 255, 0, 255],
    'Filter previews show the new base'
  );

  // Both layers stay editable after the AI step.
  await page.getByTestId('native-tool-select').click();
  await page
    .locator('.rie-layer-row > button:first-child')
    .filter({ hasText: 'Before AI' })
    .click();
  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-content').fill('After AI');
  await page.getByTestId('native-text-content').blur();
  assert.equal((await doc()).layers[1].text, 'After AI');
  await page.getByRole('application').focus();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), afterImage, 'Text edit undone, AI kept');
  await page.getByTestId('native-tool-select').click();
  await page
    .locator('.rie-layer-row > button:first-child')
    .filter({ hasText: 'Drawing' })
    .click();
  const selectedPath = await page.evaluate(
    () => window.localEditor.getDocument().layers[0].matrix
  );
  await page.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  assert.notDeepEqual((await doc()).layers[0].matrix, selectedPath);
  await page.keyboard.press('Control+z');
  assert.equal(await snapshot(), afterImage, 'Stroke move undone, AI kept');

  // Undo the AI step: previous source pixels, effects and geometry exactly.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await snapshot(), beforeImage, 'Undo restores exact pixels');
  assert.equal(await baseImage(), beforeBase, 'Undo restores the base');
  assert.deepEqual(await doc(), beforeDoc);
  await waitForScreen(
    (value) => value === beforeScreen,
    'The visible canvas returns to the pre-AI pixels'
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await snapshot(), afterImage, 'Redo re-applies the AI step');
  assert.deepEqual(await doc(), afterDoc);
  await waitForScreen(
    (value) => value === afterScreen,
    'The visible canvas shows the AI pixels again'
  );

  // Save/reopen: the current source plus the document restore the same output.
  const reopened = await page.evaluate(async () => {
    const editor = window.localEditor,
      document = editor.getDocument(),
      blob = await editor.getSourceBlob(),
      url = URL.createObjectURL(blob),
      expected = editor.getImage();
    await editor.reset(url);
    await editor.restoreDocument(document);
    URL.revokeObjectURL(url);
    return {
      source: [blob.type, blob.size > 0],
      same: editor.getImage() === expected,
      layers: editor.getDocument().layers.map((layer) => layer.kind),
    };
  });
  assert.deepEqual(reopened, {
    source: ['image/png', true],
    same: true,
    layers: ['path', 'text'],
  });
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify({
      baseExcludesLayersFrameBackground: true,
      failedReplacementKeepsDraft: true,
      replacementKeepsLayers: true,
      layersEditableAfterReplacement: true,
      undoRestoresExactPixels: true,
      redoReappliesReplacement: true,
      filterPreviewsRefresh: true,
      saveReopenRoundTrip: true,
    })
  );
} finally {
  await browser?.close();
  server.kill();
}
