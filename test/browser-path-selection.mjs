import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTouch, launchBrowser, pointerQuantum } from './browser-env.mjs';

const port = Number(process.env.EDITOR_PATH_SELECTION_PORT ?? 4232),
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
const near = (actual, expected, epsilon = 0.02) =>
  assert(
    Math.abs(actual - expected) < epsilon,
    `${actual} differs from ${expected}`
  );
const point = (layer, p) => ({
  x: layer.matrix[0] * p.x + layer.matrix[2] * p.y + layer.matrix[4],
  y: layer.matrix[1] * p.x + layer.matrix[3] * p.y + layer.matrix[5],
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
  const capture = async (name) => {
    if (screenshots) await page.screenshot({ path: join(screenshots, name) });
  };
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const doc = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const ids = () =>
    page.evaluate(() => window.localEditor.getSnapshot().selectedIds);
  const historyCount = () => page.evaluate(() => window.changes.length);
  // Opening or closing the inspector refits the viewport on a later
  // ResizeObserver tick (later in WebKit than in Chromium); map coordinates
  // only once the artboard has stopped moving.
  const artboard = async () => {
    let box = await page.locator('.rie-artboard').boundingBox();
    for (let i = 0; i < 30; i++) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      const next = await page.locator('.rie-artboard').boundingBox();
      if (JSON.stringify(next) === JSON.stringify(box)) break;
      box = next;
    }
    return box;
  };
  const world = async (x, y) => {
    const b = await artboard(),
      d = await doc();
    return {
      x: b.x + (x * b.width) / d.width,
      y: b.y + (y * b.height) / d.height,
    };
  };
  // Drag deltas are exact on Chromium. Engines that report whole-pixel pointer
  // coordinates (pointerQuantum) can land up to one CSS pixel off.
  const dragTolerance = async () => {
    const b = await page.locator('.rie-artboard').boundingBox(),
      d = await doc();
    return Math.max(0.02, (pointerQuantum * d.width) / b.width);
  };
  const click = async (x, y) => {
    const p = await world(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const drag = async (from, to, finish = true) => {
    const a = await world(from.x, from.y),
      b = await world(to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    if (finish) await page.mouse.up();
  };
  const undo = () =>
    page.getByRole('button', { name: 'Undo', exact: true }).click();
  const redo = () =>
    page.getByRole('button', { name: 'Redo', exact: true }).click();
  const reset = async () => {
    await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="native-tool-select"]')
          ?.getAttribute('aria-pressed') === 'true'
    );
  };
  const choosePath = async () => {
    await page.getByTestId('native-tool-shapes').click();
    await page.getByTestId('native-shape-path').click();
  };

  // A real vertex tool produces one editable closed path and one history entry.
  await choosePath();
  const count = await historyCount();
  await click(80, 80);
  await click(220, 80);
  await click(220, 200);
  await click(80, 80);
  let polygon = (await doc()).layers[0];
  assert.equal(polygon.kind, 'path');
  assert.equal(polygon.pathClosed, true);
  assert.equal(polygon.pathEditable, true);
  assert.equal(polygon.points.length, 3);
  await capture('path-desktop.png');
  assert.equal(await historyCount(), count + 1);
  await undo();
  assert.equal((await doc()).layers.length, 0);
  await redo();
  polygon = (await doc()).layers[0];
  // Restore the editable path mode via keyboard, then drag one vertex and cancel.
  const first = point(polygon, polygon.points[0]),
    second = point(polygon, polygon.points[1]);
  await click((first.x + second.x) / 2, (first.y + second.y) / 2);
  await page.getByRole('application').focus();
  await page.keyboard.press('Enter');
  await drag(first, { x: first.x - 35, y: first.y + 25 }, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual((await doc()).layers[0], polygon);
  // Re-enter point mode if Escape exited an idle edit; either state is handled by the button.
  await page.getByRole('application').focus();
  await drag(first, { x: first.x - 35, y: first.y + 25 });
  let changed = (await doc()).layers[0];
  near(
    point(changed, changed.points[0]).x,
    first.x - 35,
    await dragTolerance()
  );
  near(
    point(changed, changed.points[0]).y,
    first.y + 25,
    await dragTolerance()
  );
  near(point(changed, changed.points[1]).x, second.x);
  near(point(changed, changed.points[1]).y, second.y);
  await undo();
  assert.deepEqual((await doc()).layers[0], polygon);
  // Midpoint handles add a real vertex; Delete removes that vertex, not the path.
  await click((first.x + second.x) / 2, (first.y + second.y) / 2);
  assert.equal((await doc()).layers[0].points.length, 4);
  await page.keyboard.press('Delete');
  assert.equal((await doc()).layers.length, 1);
  assert.equal((await doc()).layers[0].points.length, 3);
  await undo();
  assert.equal((await doc()).layers[0].points.length, 4);
  await undo();
  assert.deepEqual((await doc()).layers[0], polygon);
  // An in-progress path rolls back completely; open paths finish by tapping their endpoint.
  await click(350, 70);
  await click(480, 130);
  await page.keyboard.press('Escape');
  assert.equal((await doc()).layers.length, 1);
  await click(350, 70);
  await page.keyboard.down('Shift');
  await click(480, 78);
  await page.keyboard.up('Shift');
  let open = (await doc()).layers.at(-1),
    last = point(open, open.points.at(-1));
  // Shift snaps to the first point, which was placed by a pointer click.
  near(last.y, 70, await dragTolerance());
  await click(last.x, last.y);
  open = (await doc()).layers.at(-1);
  assert.equal(open.pathClosed, false);
  assert.equal(open.points.length, 2);
  // Host export finalizes a pending path, preserving subsequent undo ownership.
  await click(350, 250);
  await click(470, 290);
  await page.evaluate(() => window.localEditor.getImage());
  assert.equal((await doc()).layers.length, 3);
  await undo();
  assert.equal((await doc()).layers.length, 2);

  // Mixed affine layers are prepared through the public document API. All edits below are pointer/keyboard UI.
  await reset();
  await page.evaluate(async () => {
    const editor = window.localEditor,
      document = editor.getDocument();
    document.layers = [
      {
        id: 'a',
        kind: 'rectangle',
        width: 100,
        height: 60,
        matrix: [1.4, 0.3, -0.2, 0.8, 90, 70],
        color: '#045',
        fill: '#00aabb',
        strokeWidth: 2,
        opacity: 1,
      },
      {
        id: 'b',
        kind: 'rectangle',
        width: 90,
        height: 65,
        matrix: [0.9, -0.25, 0.4, 1.1, 330, 140],
        color: '#640',
        fill: '#dd8800',
        strokeWidth: 2,
        opacity: 1,
      },
      {
        id: 'locked',
        kind: 'rectangle',
        width: 50,
        height: 50,
        matrix: [1, 0, 0, 1, 30, 300],
        color: '#000',
        fill: '#777',
        strokeWidth: 2,
        opacity: 1,
        locked: true,
      },
    ];
    await editor.restoreDocument(document);
  });
  const original = await doc(),
    a = original.layers[0],
    b = original.layers[1];
  await click(point(a, { x: 50, y: 30 }).x, point(a, { x: 50, y: 30 }).y);
  await page.keyboard.down('Shift');
  await click(point(b, { x: 45, y: 32 }).x, point(b, { x: 45, y: 32 }).y);
  await page.keyboard.up('Shift');
  assert.deepEqual(await ids(), ['a', 'b']);
  await capture('selection-desktop.png');
  const moveStart = point(a, { x: 50, y: 30 }),
    beforeMove = await historyCount();
  await page.keyboard.down('Alt');
  await drag(moveStart, { x: moveStart.x + 25, y: moveStart.y + 15 });
  await page.keyboard.up('Alt');
  changed = await doc();
  for (let i = 0; i < 2; i++) {
    near(
      changed.layers[i].matrix[4],
      original.layers[i].matrix[4] + 25,
      await dragTolerance()
    );
    near(
      changed.layers[i].matrix[5],
      original.layers[i].matrix[5] + 15,
      await dragTolerance()
    );
    assert.deepEqual(
      changed.layers[i].matrix.slice(0, 4),
      original.layers[i].matrix.slice(0, 4)
    );
  }
  assert.deepEqual(changed.layers[2], original.layers[2]);
  assert.equal(await historyCount(), beforeMove + 1);
  await undo();
  assert.deepEqual((await doc()).layers, original.layers);
  const bounds = (layers) => {
    const corners = layers.flatMap((layer) =>
        [
          { x: 0, y: 0 },
          { x: layer.width, y: 0 },
          { x: layer.width, y: layer.height },
          { x: 0, y: layer.height },
        ].map((p) => point(layer, p))
      ),
      xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  };
  const group = bounds(original.layers.slice(0, 2));
  await drag(
    { x: group.right, y: group.bottom },
    { x: group.right + 70, y: group.bottom + 35 }
  );
  const resized = bounds((await doc()).layers.slice(0, 2));
  near(resized.x, group.x);
  near(resized.y, group.y);
  near(resized.right, group.right + 70, await dragTolerance());
  near(resized.bottom, group.bottom + 35, await dragTolerance());
  await undo();
  assert.deepEqual((await doc()).layers, original.layers);
  const top = await world((group.x + group.right) / 2, group.y),
    rotation = { x: top.x, y: top.y - 26 };
  await page.mouse.move(rotation.x, rotation.y);
  await page.mouse.down();
  await page.mouse.move(rotation.x + 45, rotation.y + 15, { steps: 10 });
  await page.mouse.up();
  assert.notDeepEqual((await doc()).layers[0].matrix, a.matrix);
  assert.notDeepEqual((await doc()).layers[1].matrix, b.matrix);
  await undo();
  assert.deepEqual((await doc()).layers, original.layers);
  await drag(moveStart, { x: moveStart.x + 30, y: moveStart.y + 20 }, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual((await doc()).layers, original.layers);
  await page.getByRole('application').focus();
  await page.keyboard.press('Shift+ArrowRight');
  near((await doc()).layers[0].matrix[4], a.matrix[4] + 10);
  near((await doc()).layers[1].matrix[4], b.matrix[4] + 10);
  await undo();
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+d');
  assert.equal((await doc()).layers.length, 5);
  assert.equal((await ids()).length, 2);
  await undo();
  await page.getByRole('application').focus();
  await page.keyboard.press('Control+a');
  assert.deepEqual(await ids(), ['a', 'b']);
  await page.keyboard.press('Delete');
  assert.deepEqual(
    (await doc()).layers.map((layer) => layer.id),
    ['locked']
  );
  await undo();
  // Marquee selects all intersecting editable shapes; Escape restores the previous selection.
  await page.keyboard.press('Escape');
  await drag({ x: 60, y: 40 }, { x: 470, y: 250 });
  assert.deepEqual(await ids(), ['a', 'b']);
  await page.keyboard.press('Escape');
  await click(moveStart.x, moveStart.y);
  const previousIds = await ids();
  await page.keyboard.down('Shift');
  await drag({ x: 300, y: 100 }, { x: 490, y: 250 }, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.deepEqual(await ids(), previousIds);
  // A host restore owns the new document even if an older pointer gesture is still captured.
  await drag(moveStart, { x: moveStart.x + 20, y: moveStart.y + 10 }, false);
  const restored = { ...original, background: '#123456' };
  await page.evaluate(
    (document) => window.localEditor.restoreDocument(document),
    restored
  );
  const afterRestore = await historyCount(),
    continueAt = await world(moveStart.x + 55, moveStart.y + 30);
  await page.mouse.move(continueAt.x, continueAt.y, { steps: 6 });
  await page.mouse.up();
  assert.deepEqual(await doc(), restored);
  assert.equal(await historyCount(), afterRestore);
  await undo();
  assert.deepEqual(await doc(), original);
  // Selection shortcuts never take ownership from an active text field.
  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  await page.getByTestId('native-canvas-text').fill('Select this text');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal((await doc()).layers.length, 4);
  assert.equal((await doc()).layers.at(-1).text, '');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  // Touch creates and edits the same vertices, with cancellation restoring the whole gesture.
  await reset();
  await choosePath();
  const touchInput = await createTouch(page);
  // Chromium aligns touch pointermove with animation frames, so a CDP touch
  // can resolve before its pointer event is handled. Wait a bounded number of
  // frames for the expected state; the assertion that follows still decides.
  const settle = async (check) => {
    for (let i = 0; i < 60 && !(await check()); i++)
      await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  const touch = (type, points) =>
    touchInput.send(
      type,
      points.map((p, id) => ({ ...p, id }))
    );
  const tap = async (x, y) => {
    await touch('touchStart', [await world(x, y)]);
    await touch('touchEnd', []);
  };
  await tap(80, 70);
  await tap(340, 70);
  await tap(220, 260);
  await tap(80, 70);
  const touchPolygon = (await doc()).layers[0];
  assert.equal(touchPolygon.pathClosed, true);
  assert.equal(touchPolygon.points.length, 3);
  const beforeTouch = await historyCount(),
    vertex = point(touchPolygon, touchPolygon.points[0]);
  await touch('touchStart', [await world(vertex.x, vertex.y)]);
  await touch('touchMove', [await world(vertex.x - 30, vertex.y + 35)]);
  const unchanged = async () =>
    JSON.stringify((await doc()).layers[0]) === JSON.stringify(touchPolygon);
  await settle(async () => !(await unchanged()));
  assert.notDeepEqual((await doc()).layers[0], touchPolygon);
  await touch('touchCancel', []);
  await settle(unchanged);
  assert.deepEqual((await doc()).layers[0], touchPolygon);
  assert.equal(await historyCount(), beforeTouch);
  await capture('path-mobile-dark.png');
  const start = await world(450, 300),
    other = { x: start.x - 45, y: start.y };
  await touch('touchStart', [start]);
  assert.equal((await doc()).layers.length, 2);
  await touch('touchStart', [start, other]);
  assert.equal((await doc()).layers.length, 1);
  await touch('touchMove', [
    { x: start.x + 20, y: start.y },
    { x: other.x - 20, y: other.y },
  ]);
  await touch('touchEnd', []);
  assert.deepEqual((await doc()).layers[0], touchPolygon);
  await touchInput.detach();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true
  );
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify(
      {
        polygonCreationOneUndo: true,
        vertexMoveCancelAndUndo: true,
        midpointInsertAndNodeDelete: true,
        openPathSnapAndExport: true,
        shiftAndMarqueeSelection: true,
        affineGroupMoveResizeRotate: true,
        groupKeyboardDuplicateDelete: true,
        protectedLayers: true,
        typingOwnership: true,
        narrowDark: true,
        touchPathNodesCancelAndPinch: true,
        restoreDuringDragOwnsDocument: true,
        pageErrors: errors,
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
