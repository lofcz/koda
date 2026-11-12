import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTouch, launchBrowser } from './browser-env.mjs';

// Per-layer editing rights, exercised through pointer, touch, keyboard, the panels and export.
const port = Number(process.env.EDITOR_RIGHTS_PORT ?? 4239),
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
let log = '',
  browser;
server.stdout.on('data', (chunk) => {
  log += chunk;
});
server.stderr.on('data', (chunk) => {
  log += chunk;
});
const rect = (id, x, y, extra = {}) => ({
  id,
  kind: 'rectangle',
  matrix: [1, 0, 0, 1, x, y],
  width: 120,
  height: 80,
  color: '#0797a7',
  fill: '#00ff00',
  strokeWidth: 0,
  opacity: 1,
  ...extra,
});
const text = (id, x, y, extra = {}) => ({
  id,
  kind: 'text',
  matrix: [1, 0, 0, 1, x, y],
  width: 200,
  height: 48,
  color: '#202a38',
  fill: 'transparent',
  strokeWidth: 0,
  opacity: 1,
  text: 'Hello',
  fontSize: 40,
  fontFamily: 'sans-serif',
  ...extra,
});
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting Vite. */
    }
    if (i === 119) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await launchBrowser();
  const page = await browser.newPage({
      viewport: { width: 1180, height: 800 },
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const screenshots = process.env.EDITOR_SCREENSHOT_DIR;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const capture = async (name, locator = page) => {
    if (screenshots)
      await locator.screenshot({ path: join(screenshots, name) });
  };
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const doc = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const layer = async (id) => (await doc()).layers.find((l) => l.id === id);
  const order = async () => (await doc()).layers.map((l) => l.id);
  const selectedIds = () =>
    page.evaluate(() => window.localEditor.getSnapshot().selectedIds);
  const changes = () => page.evaluate(() => window.changes.length);
  const frames = (count = 2) =>
    page.evaluate(
      (count) =>
        new Promise((resolve) => {
          const step = (n) =>
            n ? requestAnimationFrame(() => step(n - 1)) : resolve();
          step(count);
        }),
      count
    );
  const load = async (layers) => {
    await page.evaluate(async (layers) => {
      const editor = window.localEditor;
      await editor.restoreDocument({ ...editor.getDocument(), layers });
    }, layers);
    await frames();
  };
  const world = async (x, y) => {
    const b = await page.locator('.rie-artboard').boundingBox(),
      d = await doc();
    return {
      x: b.x + (x * b.width) / d.width,
      y: b.y + (y * b.height) / d.height,
    };
  };
  const click = async (x, y, options) => {
    const p = await world(x, y);
    await page.mouse.click(p.x, p.y, options);
    await frames();
  };
  // Alt turns snapping off so allowed moves land exactly where the pointer went.
  const drag = async (from, to) => {
    const a = await world(from.x, from.y),
      b = await world(to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.keyboard.down('Alt');
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.keyboard.up('Alt');
    await page.mouse.up();
    await frames();
  };
  const near = (actual, expected) =>
    assert(
      actual.length === expected.length &&
        actual.every((value, i) => Math.abs(value - expected[i]) < 1.5),
      `${actual} differs from ${expected}`
    );
  const press = async (key) => {
    await page.getByRole('application').focus();
    await page.keyboard.press(key);
    await frames();
  };
  // Alpha of the selection overlay at a screen point. Probes sit inside a handle's
  // disc but outside the selection outline, so they see handles only.
  const overlay = async (point) => {
    await page.mouse.move(2, 2);
    await frames();
    return page.locator('.upper-canvas').evaluate((canvas, p) => {
      const r = canvas.getBoundingClientRect();
      return canvas
        .getContext('2d')
        .getImageData(
          Math.round(((p.x - r.left) * canvas.width) / r.width),
          Math.round(((p.y - r.top) * canvas.height) / r.height),
          1,
          1
        ).data[3];
    }, point);
  };
  const handles = async (x, y, width) => {
    const topLeft = await world(x, y),
      topMiddle = await world(x + width / 2, y);
    return {
      corner: await overlay({ x: topLeft.x - 3, y: topLeft.y - 3 }),
      rotate: await overlay({ x: topMiddle.x, y: topMiddle.y - 26 }),
    };
  };
  const panelButton = (name) =>
    page
      .getByTestId('native-tool-options')
      .getByRole('button', { name, exact: true })
      .first();

  // 1. Text that can be edited but not moved, resized, rotated, flipped, deleted,
  //    duplicated, restacked or given new lines. A free shape keeps every right.
  const captionRights = {
    move: false,
    resize: false,
    rotate: false,
    flip: false,
    delete: false,
    duplicate: false,
    reorder: false,
    textNewlines: false,
  };
  await load([
    text('caption', 100, 60, { rights: captionRights }),
    rect('free', 350, 250),
  ]);
  await click(150, 84);
  assert.deepEqual(await selectedIds(), ['caption']);
  assert.deepEqual(await handles(100, 60, 200), { corner: 0, rotate: 0 });
  const caption = await layer('caption'),
    history = await changes();
  // Pointer: body drag, a drag starting at the corner and at the rotation handle.
  await drag({ x: 150, y: 84 }, { x: 230, y: 160 });
  await drag({ x: 100, y: 60 }, { x: 40, y: 20 });
  const rotateAt = await world(200, 60);
  await page.mouse.move(rotateAt.x, rotateAt.y - 26);
  await page.mouse.down();
  await page.mouse.move(rotateAt.x + 80, rotateAt.y + 40, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual((await layer('caption')).matrix, caption.matrix);
  assert.equal((await layer('caption')).width, caption.width);
  // Touch drag uses the same gesture path; poll frame-aligned pointer events.
  const touchInput = await createTouch(page);
  const touchFrom = await world(150, 84);
  const touch = (type, points) =>
    touchInput.send(
      type,
      points.map(([x, y], id) => ({ x, y, id }))
    );
  await touch('touchStart', [[touchFrom.x, touchFrom.y]]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [[touchFrom.x + i * 12, touchFrom.y + i * 9]]);
    await frames(1);
  }
  await touch('touchEnd', [[touchFrom.x + 72, touchFrom.y + 54]]);
  await frames(4);
  assert.deepEqual((await layer('caption')).matrix, caption.matrix);
  // Keyboard: nudge, rotate, delete, duplicate, restack.
  for (const key of [
    'ArrowRight',
    'Shift+ArrowDown',
    'Alt+ArrowRight',
    'Delete',
    'Backspace',
    'Control+d',
    'Control+]',
    'Control+Shift+]',
  ])
    await press(key);
  assert.deepEqual((await layer('caption')).matrix, caption.matrix);
  assert.deepEqual(await order(), ['caption', 'free']);
  assert.equal(await changes(), history);
  // The public command keeps the protected layer as well.
  await page.evaluate(() => window.localEditor.removeSelected?.());
  assert.deepEqual(await order(), ['caption', 'free']);
  // UI: disabled controls explain themselves; the notice names what is off.
  const notice = page.getByTestId('native-rights-notice');
  await notice.waitFor();
  assert.match(await notice.innerText(), /moving/);
  assert.match(await notice.innerText(), /deleting/);
  assert.match(await notice.innerText(), /new lines/);
  assert.doesNotMatch(await notice.innerText(), /text editing|style/);
  const deleteButton = panelButton('Delete selection');
  assert.equal(await deleteButton.isDisabled(), true);
  assert.equal(
    await deleteButton.getAttribute('title'),
    'Delete selection: turned off for this object'
  );
  for (const name of [
    'Duplicate',
    'Bring forward',
    'Send backward',
    'Flip horizontally',
    'Flip vertically',
  ])
    assert.equal(await panelButton(name).isDisabled(), true, name);
  assert.equal(
    await page.getByTestId('native-selection-rotation').isDisabled(),
    true
  );
  // Style stays editable: opacity commits through the same panel.
  assert.equal(await panelButton('Lock layer').isDisabled(), false);
  const badge = page
    .locator('.rie-layer-row')
    .filter({ hasText: 'Hello' })
    .getByTestId('native-layer-rights');
  assert.match(await badge.getAttribute('aria-label'), /^Turned off: moving/);
  await capture('rights-panel-light.png');

  // Inline editing: typing works, Enter and Shift+Enter never add a line, pasted
  // line breaks become spaces, and Ctrl+Enter still finishes.
  await page.mouse.dblclick(...Object.values(await world(150, 84)));
  const field = page.getByTestId('native-canvas-text');
  await field.waitFor();
  assert.equal(await field.getAttribute('aria-multiline'), 'false');
  await page.keyboard.press('End');
  await page.keyboard.type(' you');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Enter');
  await field.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', '\nthere\nfriend');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await page.keyboard.press('Control+Enter');
  await frames();
  assert.equal((await layer('caption')).text, 'Hello you there friend');
  assert.deepEqual((await layer('caption')).matrix, caption.matrix);
  // The panel field enforces the same rule.
  await page.getByTestId('native-tool-text').click();
  const panelField = page.getByTestId('native-text-content');
  await panelField.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('!');
  await page.getByRole('application').focus();
  await frames();
  assert.equal((await layer('caption')).text, 'Hello you there friend!');

  // Allowed actions on the free shape still work through the same paths.
  await page.getByTestId('native-tool-select').click();
  await click(410, 290);
  assert.deepEqual(await selectedIds(), ['free']);
  const freeHandles = await handles(350, 250, 120);
  assert(freeHandles.corner > 0 && freeHandles.rotate > 0);
  await drag({ x: 410, y: 290 }, { x: 430, y: 300 });
  near((await layer('free')).matrix.slice(4), [370, 260]);
  await press('ArrowLeft');
  near([(await layer('free')).matrix[4]], [369]);
  await press('Control+[');
  assert.deepEqual(await order(), ['free', 'caption']);
  await press('Control+d');
  assert.equal((await doc()).layers.length, 3);
  await press('Delete');
  assert.equal((await doc()).layers.length, 2);

  // 2. Fixed content: the caption opens read-only, while formatting a range still works.
  await load([text('fixed', 100, 60, { rights: { editText: false } })]);
  await page.mouse.dblclick(...Object.values(await world(150, 84)));
  await field.waitFor();
  assert.equal(await field.getAttribute('aria-readonly'), 'true');
  await page.keyboard.press('End');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await field.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'pasted');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await field.evaluate((element) => {
    const range = document.createRange(),
      node = element.firstChild.firstChild ?? element.firstChild;
    range.setStart(node, 0);
    range.setEnd(node, 2);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Enter');
  await frames();
  let fixed = await layer('fixed');
  assert.equal(fixed.text, 'Hello');
  assert.equal(fixed.textRuns?.[0]?.style?.fontWeight, 700);
  assert.equal(fixed.textRuns?.[0]?.text, 'He');
  // With style fixed as well there is nothing to edit inline, and the panel locks formatting.
  await load([
    text('fixed', 100, 60, { rights: { editText: false, style: false } }),
  ]);
  await page.mouse.dblclick(...Object.values(await world(150, 84)));
  await frames();
  assert.equal(await field.count(), 0);
  await page.getByTestId('native-tool-text').click();
  assert.equal(
    await page.getByTestId('native-text-content').getAttribute('aria-readonly'),
    'true'
  );
  assert.equal(await panelButton('Bold').isDisabled(), true);
  await capture('rights-text-readonly.png');
  assert.equal(await page.getByTestId('native-text-size').isDisabled(), true);
  await page.getByTestId('native-text-content').click();
  await page.keyboard.press('Control+b');
  await page.keyboard.type('nope');
  await page.getByRole('application').focus();
  await frames();
  fixed = await layer('fixed');
  assert.equal(fixed.text, 'Hello');
  assert.equal(fixed.textRuns, undefined);
  // The status hint never promises a double-click edit the rights deny.
  const hint = () => page.locator('.rie-tool-hint').innerText();
  assert.equal(await hint(), 'This text cannot be changed.');
  await page.evaluate(() =>
    window.localEditor.setLayerRights('fixed', { editText: false })
  );
  await frames();
  assert.equal(
    await hint(),
    'Double-click text to format it on the image. The wording stays fixed.'
  );
  await page.evaluate(() => window.localEditor.setLayerRights('fixed', null));
  await frames();
  assert.equal(await hint(), 'Double-click text to edit it on the image.');
  await page.getByTestId('native-tool-select').click();

  // 3. A fixed text box: no side or corner handles, layout controls are disabled.
  await load([
    text('box', 100, 60, {
      textLayout: 'fixed',
      rights: { textLayout: false },
    }),
  ]);
  await click(150, 84);
  const sideMiddle = await world(300, 84);
  assert.equal(await overlay({ x: sideMiddle.x + 3, y: sideMiddle.y }), 0);
  const boxHandles = await handles(100, 60, 200);
  assert.equal(boxHandles.corner, 0);
  assert(boxHandles.rotate > 0, 'Rotation stays available');
  await drag({ x: 300, y: 84 }, { x: 380, y: 84 });
  assert.equal((await layer('box')).width, 200);
  await page.getByTestId('native-tool-text').click();
  await page
    .getByTestId('native-text-layout-controls')
    .locator('summary')
    .click();
  assert.equal(
    await page.getByTestId('native-text-box-width').isDisabled(),
    true
  );
  assert.equal(
    await page
      .getByTestId('native-text-layout-controls')
      .locator('.rie-picker-trigger')
      .isDisabled(),
    true
  );
  await page.getByTestId('native-tool-select').click();

  // 4. Move-only shape: dragging and nudging move it; no resize/rotate handles; style is fixed.
  await load([
    rect('mover', 100, 100, {
      rights: { resize: false, rotate: false, style: false },
    }),
  ]);
  await click(160, 140);
  assert.deepEqual(await handles(100, 100, 120), { corner: 0, rotate: 0 });
  await drag({ x: 160, y: 140 }, { x: 200, y: 160 });
  near((await layer('mover')).matrix.slice(4), [140, 120]);
  await press('ArrowDown');
  near([(await layer('mover')).matrix[5]], [121]);
  await press('Alt+ArrowRight');
  assert.deepEqual((await layer('mover')).matrix.slice(0, 4), [1, 0, 0, 1]);
  const swatch = page
    .getByTestId('native-tool-options')
    .getByRole('button', { name: 'Color: #e5484d', exact: true });
  assert.equal(await swatch.isDisabled(), true);
  await swatch.click({ force: true });
  assert.equal((await layer('mover')).color, '#0797a7');
  assert.equal(
    await page
      .getByTestId('native-selection-controls')
      .locator('input[type="range"]')
      .last()
      .isDisabled(),
    true
  );
  assert.equal(
    await page
      .getByTestId('native-tool-options')
      .getByRole('spinbutton', { name: 'Width', exact: true })
      .isDisabled(),
    true
  );

  // 5. Group transforms: translation skips fixed members; resize/rotate handles need every member.
  await load([
    rect('anchor', 60, 60, {
      rights: { move: false, delete: false, duplicate: false },
    }),
    rect('a', 260, 120),
    rect('b', 420, 240),
  ]);
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+a');
  await frames();
  assert.deepEqual(await selectedIds(), ['anchor', 'a', 'b']);
  // Group frame spans 60..540 × 60..320; no corner or rotation handle.
  assert.deepEqual(await handles(60, 60, 480), { corner: 0, rotate: 0 });
  const anchor = await layer('anchor');
  await drag({ x: 320, y: 160 }, { x: 340, y: 190 });
  assert.deepEqual((await layer('anchor')).matrix, anchor.matrix);
  near((await layer('a')).matrix.slice(4), [280, 150]);
  near((await layer('b')).matrix.slice(4), [440, 270]);
  await press('ArrowLeft');
  near([(await layer('a')).matrix[4]], [279]);
  assert.deepEqual((await layer('anchor')).matrix, anchor.matrix);
  // A drag on the fixed member alone does not move the group.
  await drag({ x: 120, y: 100 }, { x: 160, y: 140 });
  assert.deepEqual((await layer('anchor')).matrix, anchor.matrix);
  near([(await layer('a')).matrix[4]], [279]);
  assert.deepEqual(await selectedIds(), ['anchor', 'a', 'b']);
  // Align left: the fixed member sets the edge and stays put.
  await page.getByTestId('native-align-left').click();
  assert.equal((await layer('a')).matrix[4], 60);
  assert.equal((await layer('b')).matrix[4], 60);
  assert.deepEqual((await layer('anchor')).matrix, anchor.matrix);
  assert.equal(
    await page.getByTestId('native-distribute-horizontal').isDisabled(),
    true
  );
  const groupNotice = await page
    .getByTestId('native-rights-notice')
    .innerText();
  assert.match(groupNotice, /some selected objects/);
  // Duplicate and delete apply to members that allow them.
  await press('Control+d');
  assert.equal((await doc()).layers.length, 5);
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+a');
  await press('Delete');
  assert.deepEqual(await order(), ['anchor']);
  await capture('rights-group.png');
  // When every member allows it, the group shows its handles again.
  await load([rect('a', 260, 120), rect('b', 420, 240)]);
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+a');
  await frames();
  const groupHandles = await handles(260, 120, 280);
  assert(groupHandles.corner > 0 && groupHandles.rotate > 0);

  // 6. Path nodes: Enter and the panel cannot open point editing.
  await load([
    {
      ...rect('poly', 0, 0),
      kind: 'path',
      fill: 'transparent',
      color: '#ff00ff',
      strokeWidth: 8,
      width: 200,
      height: 160,
      matrix: [1, 0, 0, 1, 100, 100],
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 160 },
      ],
      pathClosed: true,
      pathEditable: true,
      rights: { pathPoints: false },
    },
  ]);
  await click(200, 100);
  assert.deepEqual(await selectedIds(), ['poly']);
  await press('Enter');
  const node = await world(300, 100);
  await page.mouse.move(node.x, node.y);
  await page.mouse.down();
  await page.mouse.move(node.x + 40, node.y + 40, { steps: 6 });
  await page.mouse.up();
  await frames();
  const poly = await layer('poly');
  assert.deepEqual(poly.points[1], { x: 200, y: 0 });
  assert.equal(await page.getByTestId('native-path-edit').isDisabled(), true);
  assert.equal(
    await panelButton('Closed path').isDisabled(),
    true,
    'Closing is a point edit'
  );

  // 7. Unselectable layers let clicks through and are disabled in the layer list.
  await load([
    rect('below', 100, 100),
    rect('glass', 80, 80, { fill: '#0000ff', rights: { select: false } }),
  ]);
  await click(160, 140);
  assert.deepEqual(await selectedIds(), ['below']);
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+a');
  await frames();
  assert.deepEqual(await selectedIds(), ['below']);
  const rows = page.locator('.rie-layer-row');
  assert.equal(await rows.nth(0).locator('button').first().isDisabled(), true);
  assert.match(
    await rows.nth(0).getByTestId('native-layer-rights').getAttribute('title'),
    /selecting/
  );
  await page.evaluate(() => window.localEditor.setLayerRights('glass', null));
  await click(90, 90);
  assert.deepEqual(await selectedIds(), ['glass']);

  // 8. Lock and visibility rights disable the layer-list toggles.
  await load([
    rect('pinned', 100, 100, { rights: { lock: false, visibility: false } }),
  ]);
  await click(160, 140);
  const pinnedRow = page.locator('.rie-layer-row').first();
  assert.equal(
    await pinnedRow.getByRole('button', { name: 'Lock layer' }).isDisabled(),
    true
  );
  assert.equal(
    await pinnedRow.getByRole('button', { name: 'Hide layer' }).isDisabled(),
    true
  );
  // `locked` from a saved document still behaves as before: render-only, unlockable.
  await load([rect('old', 100, 100, { locked: true })]);
  await click(160, 140);
  assert.deepEqual(await selectedIds(), []);
  await page.getByTestId('native-tool-select').click();
  await page
    .locator('.rie-layer-row')
    .first()
    .getByRole('button', { name: 'Lock layer' })
    .click();
  await click(160, 140);
  assert.deepEqual(await selectedIds(), ['old']);

  // 9. Option defaults per kind: rectangles cannot be deleted unless a layer says so.
  await page.evaluate(() =>
    window.localEditor.updateOptions({
      layerRights: { rectangle: { delete: false } },
    })
  );
  await load([
    rect('default', 100, 100),
    rect('override', 300, 100, { rights: { delete: true } }),
  ]);
  await click(160, 140);
  await press('Delete');
  assert.deepEqual(await order(), ['default', 'override']);
  await click(360, 140);
  await press('Delete');
  assert.deepEqual(await order(), ['default']);
  await page.evaluate(() =>
    window.localEditor.updateOptions({ layerRights: undefined })
  );

  // 10. Eraser: a real eraser stroke removes markup but keeps layers that deny erasing.
  await load([
    rect('erasable', 60, 120, { fill: '#00ff00' }),
    rect('protected', 260, 120, {
      fill: '#ff00ff',
      rights: { erase: false },
    }),
  ]);
  await page.getByTestId('native-tool-draw').click();
  await page.getByTestId('native-draw-eraser').click();
  await page.getByTestId('native-draw-size').fill('60');
  await drag({ x: 20, y: 160 }, { x: 420, y: 160 });
  const pixels = await page.evaluate(async () => {
    const image = new Image();
    image.src = window.localEditor.getImage();
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    return {
      erased: at(120, 160),
      protected: at(320, 160),
      kept: at(120, 190),
    };
  });
  assert.deepEqual(pixels.erased, [255, 0, 0, 255], 'The photo shows through');
  assert.deepEqual(pixels.protected, [255, 0, 255, 255]);
  assert.deepEqual(pixels.kept, [0, 255, 0, 255]);
  await page.getByTestId('native-tool-select').click();

  // A protected redaction keeps exactly the pixels it shows without the eraser,
  // sampled from the full scene, even though the markup beneath it is erased.
  const exportPixels = (points) =>
    page.evaluate(async (points) => {
      const image = new Image();
      image.src = window.localEditor.getImage();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    }, points);
  const redactionScene = (eraser) => [
    rect('marker', 40, 40, { width: 200, height: 200, fill: '#ffff00' }),
    {
      ...rect('cover', 80, 80, { width: 120, height: 120 }),
      kind: 'redaction',
      fill: 'transparent',
      redactionMode: 'pixelate',
      redactionSize: 16,
      rights: { erase: false },
    },
    ...(eraser
      ? [
          {
            ...rect('eraser', 0, 0, { width: 300, height: 1 }),
            kind: 'path',
            fill: 'transparent',
            color: '#000000',
            strokeWidth: 300,
            erase: true,
            points: [
              { x: 0, y: 140 },
              { x: 300, y: 140 },
            ],
            matrix: [1, 0, 0, 1, 0, 0],
          },
        ]
      : []),
  ];
  const probes = [
    [50, 50],
    [90, 90],
    [140, 140],
    [195, 195],
  ];
  await load(redactionScene(false));
  const unerased = await exportPixels(probes);
  assert.deepEqual(unerased[0], [255, 255, 0, 255]);
  assert.deepEqual(unerased[2], [255, 255, 0, 255], 'Pixelated marker');
  await load(redactionScene(true));
  const erased = await exportPixels(probes);
  assert.deepEqual(erased[0], [255, 0, 0, 255], 'Marker erased to the photo');
  assert.deepEqual(erased.slice(1), unerased.slice(1));

  // 11. Visual review: light/dark and a 358px-wide editor.
  await load([
    text('caption', 100, 60, { rights: captionRights }),
    rect('free', 350, 250),
  ]);
  await click(150, 84);
  await capture('rights-select-light.png');
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await frames();
  await capture('rights-select-dark.png');
  await page.setViewportSize({ width: 358, height: 760 });
  await frames(6);
  await click(150, 84);
  await capture('rights-mobile-dark.png');
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await frames();
  await capture('rights-mobile-light.png');
  await page.getByTestId('native-tool-options').evaluate((element) => {
    element.querySelector('.rie-options-content')?.scrollTo({ top: 10000 });
  });
  await capture('rights-mobile-layers.png');

  assert.deepEqual(errors, []);
  console.info(
    'Layer rights hold for pointer, touch, keyboard, panel, layer list, defaults and export.'
  );
} finally {
  await browser?.close();
  server.kill();
}
