import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChromium, launchBrowser, skipped } from './browser-env.mjs';

const port = Number(process.env.EDITOR_RICH_TEXT_PORT ?? 4242),
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
const point = (layer, x, y) => ({
  x: layer.matrix[0] * x + layer.matrix[2] * y + layer.matrix[4],
  y: layer.matrix[1] * x + layer.matrix[3] * y + layer.matrix[5],
});
const near = (a, b, e = 0.1) =>
  assert(Math.abs(a - b) <= e, `${a} differs from ${b}`);
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting isolated Vite. */
    }
    if (i === 119) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1180, height: 820 },
  });
  const errors = [],
    remote = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/tracker\.test/.test(request.url())) remote.push(request.url());
  });
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const doc = () =>
    page.evaluate(() => window.localEditor.getSnapshot().document);
  const count = () => page.evaluate(() => window.changes.length);
  const layer = async () =>
    (await doc()).layers.find((item) => item.kind === 'text');
  const undo = () =>
    page.getByRole('button', { name: 'Undo', exact: true }).click();
  const redo = () =>
    page.getByRole('button', { name: 'Redo', exact: true }).click();
  const input = page.getByTestId('native-canvas-text');
  const selectRange = async (locator, anchor, focus) =>
    locator.evaluate(
      (element, [anchor, focus]) => {
        element.focus();
        const at = (offset) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (offset <= node.textContent.length) return [node, offset];
            offset -= node.textContent.length;
          }
          return [element, element.childNodes.length];
        };
        const a = at(anchor),
          f = at(focus);
        getSelection().setBaseAndExtent(a[0], a[1], f[0], f[1]);
        document.dispatchEvent(new Event('selectionchange'));
      },
      [anchor, focus]
    );
  const begin = async () => {
    const item = await layer();
    await page.evaluate((id) => window.localEditor.select(id), item.id);
    await page.getByRole('application').focus();
    await page.keyboard.press('Enter');
    await input.waitFor();
  };
  const paste = async (locator, html, plain = '') =>
    locator.evaluate(
      (element, { html, plain }) => {
        const data = new DataTransfer();
        if (html) data.setData('text/html', html);
        data.setData('text/plain', plain);
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        // Firefox ignores clipboardData in the constructor; a real paste
        // carries it, so attach it the same way on every engine.
        if (event.clipboardData !== data)
          Object.defineProperty(event, 'clipboardData', { value: data });
        element.dispatchEvent(event);
      },
      { html, plain }
    );
  const world = async (p) => {
    const box = await page.locator('.rie-artboard').boundingBox(),
      document = await doc();
    return {
      x: box.x + (p.x * box.width) / document.width,
      y: box.y + (p.y * box.height) / document.height,
    };
  };
  const drag = async (a, b, finish = true) => {
    a = await world(a);
    b = await world(b);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    if (finish) await page.mouse.up();
  };

  await page.getByTestId('native-tool-text').click();
  await page.getByTestId('native-text-add').click();
  await input.fill('Alpha Beta');
  await page.keyboard.press('Control+Enter');
  const plain = await layer();
  const beforeNoop = await count();
  await begin();
  await page.keyboard.press('Control+Enter');
  assert.equal(await count(), beforeNoop);
  assert.deepEqual(await layer(), plain);
  await begin();
  const beforeFormat = await count();
  await selectRange(input, 0, 5);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'Alpha');
  assert.equal(
    (await layer()).textRuns.find((run) => run.text === 'Alpha').style
      .fontWeight,
    700
  );
  // Unformatted runs may omit styles that equal the layer defaults: Firefox's
  // fill commits through an IME composition, which reads the DOM, while
  // Chromium's goes through beforeinput and stores the resolved caret style.
  const unformatted = await layer();
  assert.equal(
    unformatted.textRuns.at(-1).style?.fontWeight ??
      unformatted.fontWeight ??
      (unformatted.bold ? 700 : 400),
    400
  );
  await page.getByTestId('native-text-size').fill('32');
  assert.equal(
    await page
      .getByTestId('native-text-size')
      .evaluate((el) => el === document.activeElement),
    true
  );
  await page.getByTestId('native-text-size').press('Tab');
  assert.equal((await layer()).textRuns[0].style.fontSize, 32);
  await input.focus();
  await page.keyboard.press('Control+Enter');
  const rich = await layer();
  assert.equal(await count(), beforeFormat + 1);
  await undo();
  assert.deepEqual(await layer(), plain);
  await redo();
  assert.deepEqual(await layer(), rich);

  // A collapsed selection changes only subsequently typed characters.
  await begin();
  await selectRange(input, 10, 10);
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await page.keyboard.type('!');
  assert.equal((await layer()).text, 'Alpha Beta!');
  assert.equal((await layer()).textRuns.at(-1).style.italic, true);
  await page.keyboard.press('Escape');
  assert.deepEqual(await layer(), rich);
  await begin();
  await selectRange(input, 10, 10);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('?');
  assert.equal((await layer()).textRuns.at(-1).style.fontWeight, 400);
  await page.keyboard.press('Escape');
  assert.deepEqual(await layer(), rich);

  // Sanitized HTML never mounts resource attributes, preserving empty/trailing paragraphs.
  await begin();
  await selectRange(input, 0, rich.text.length);
  const beforePaste = await count();
  await paste(
    input,
    '<p><b>One</b> <em>two</em></p><p></p><p><span style="background-color:yellow;text-decoration:underline line-through;color:#bb2233">Three</span></p><p></p><img src="https://tracker.test/a" onerror="alert(1)"><script>alert(1)</script>'
  );
  assert.equal((await layer()).text, 'One two\n\nThree\n');
  assert.equal(await input.locator('script,img,iframe,a').count(), 0);
  const exported = await page.evaluate(() => window.localEditor.getDocument());
  assert.equal(await count(), beforePaste + 1);
  assert.equal(exported.layers[0].text, 'One two\n\nThree\n');
  assert.equal(
    (await page.evaluate(() => window.localEditor.getDocument())).layers[0]
      .text,
    exported.layers[0].text
  );
  assert.equal(await count(), beforePaste + 1);
  await selectRange(input, 0, 0);
  await paste(input, '', '<literal>\r\n');
  assert((await layer()).text.startsWith('<literal>\n'));
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await page.evaluate(() => window.localEditor.getDocument()),
    exported
  );
  assert.deepEqual(remote, []);

  // Real IME events remain in the same transaction and never duplicate composition text.
  await begin();
  await selectRange(input, 0, (await layer()).text.length);
  const beforeIme = await count();
  if (isChromium) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {
      text: '漢',
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send('Input.insertText', { text: '漢字' });
    await cdp.detach();
  } else {
    // Firefox and WebKit have no Playwright composition API. Commit the same
    // CJK text through the engine's native insertText path instead, which
    // still checks the single-transaction contract without the IME session.
    skipped('IME composition session', 'Input.imeSetComposition is CDP-only');
    await page.keyboard.insertText('漢字');
  }
  assert.equal((await layer()).text, '漢字');
  assert.equal(await count(), beforeIme);
  await page.keyboard.press('Control+Enter');
  assert.equal(await count(), beforeIme + 1);
  await undo();
  assert.deepEqual(
    await page.evaluate(() => window.localEditor.getDocument()),
    exported
  );

  // A restored document wins over a stale editor/composition, even when exported immediately.
  await begin();
  const restored = {
    ...(await doc()),
    background: '#234567',
    layers: [
      {
        ...(await layer()),
        text: 'Restored',
        textRuns: [{ text: 'Restored', style: { underline: true } }],
      },
    ],
  };
  await input.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    );
    element.textContent = 'Unpublished composition';
  });
  const afterRestore = await page.evaluate(async (document) => {
    await window.localEditor.restoreDocument(document);
    return window.localEditor.getDocument();
  }, restored);
  assert.equal(afterRestore.layers[0].text, 'Restored');
  assert.equal(await input.count(), 0);
  assert.equal((await layer()).text, 'Restored');
  await page.evaluate(
    (id) => window.localEditor.select(id),
    restored.layers[0].id
  );

  // Panel uses the same input and selection model.
  const panel = page.getByTestId('native-text-content');
  await panel.fill('Panel rich text');
  await selectRange(panel, 6, 10);
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'rich');
  await panel.press('Control+Enter');
  assert(
    (await layer()).textRuns.some(
      (run) => run.text === 'rich' && run.style.underline === false
    )
  );
  assert.equal((await layer()).textRuns[0].style.underline, true);
  await panel.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    );
    element.textContent = 'Stale panel composition';
  });
  const undone = await page.evaluate(() => {
    window.localEditor.undo();
    return window.localEditor.getDocument();
  });
  assert.equal(undone.layers[0].text, 'Restored');
  await panel.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true })
    )
  );
  assert.equal((await layer()).text, 'Restored');

  // Auto-height width handles reflow without changing font size or the affine glyph transform.
  await panel.blur();
  const source = await doc();
  const text = {
    ...(await layer()),
    text: 'Several words wrap across the resized text box',
    textRuns: undefined,
    textLayout: 'auto-height',
    width: 240,
    height: 100,
    fontSize: 24,
    fontWeight: 400,
    matrix: [1.2, 0.15, -0.1, 0.9, 70, 100],
  };
  await page.evaluate(
    async ({ source, text }) => {
      await window.localEditor.restoreDocument({ ...source, layers: [text] });
      window.localEditor.select(text.id);
    },
    { source, text }
  );
  await page.getByTestId('native-tool-select').click();
  const textBefore = await layer();
  const beforeResize = await count();
  await drag(
    point(text, text.width, text.height / 2),
    point(text, 130, text.height / 2)
  );
  const wrapped = await layer();
  near(wrapped.width, 130, 1.5);
  assert(wrapped.height > text.height);
  assert.deepEqual(wrapped.matrix, text.matrix);
  assert.equal(wrapped.fontSize, text.fontSize);
  assert.equal(await count(), beforeResize + 1);
  await undo();
  assert.deepEqual(await layer(), textBefore);
  await drag(
    point(text, text.width, text.height / 2),
    point(text, 130, text.height / 2),
    false
  );
  await page
    .locator('.upper-canvas')
    .dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  assert.deepEqual(await layer(), textBefore);

  const fixed = { ...text, textLayout: 'fixed', width: 180, height: 52 };
  await page.evaluate(
    async ({ source, fixed }) => {
      await window.localEditor.restoreDocument({ ...source, layers: [fixed] });
      window.localEditor.select(fixed.id);
    },
    { source, fixed }
  );
  await drag(point(fixed, fixed.width, fixed.height), point(fixed, 130, 80));
  const fixedResized = await layer();
  near(fixedResized.width, 130, 1.5);
  near(fixedResized.height, 80, 1.5);
  assert.deepEqual(fixedResized.matrix, fixed.matrix);
  await begin();
  assert.equal(
    await input.evaluate((el) => getComputedStyle(el).overflow),
    'hidden'
  );
  const image = await page.evaluate(() => window.localEditor.getImage());
  assert(image.startsWith('data:image/png;'));
  await page.keyboard.press('Control+Enter');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await begin();
  await input.fill('Mobile\nrich text');
  await selectRange(input, 0, 6);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Enter');
  assert(
    (await layer()).textRuns.some(
      (run) => run.text === 'Mobile' && run.style.fontWeight === 700
    )
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= 390),
    true
  );
  if (process.env.EDITOR_SCREENSHOT_DIR) {
    await mkdir(process.env.EDITOR_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: join(process.env.EDITOR_SCREENSHOT_DIR, 'rich-text-mobile.png'),
    });
  }
  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify(
      {
        mixedSelectionAndCaret: true,
        numericFocus: true,
        oneEditingTransaction: true,
        collapsedTypingMarks: true,
        safeRichAndPlainPaste: true,
        pendingExportAndContinue: true,
        realIme: true,
        restoreOwnsPendingComposition: true,
        sharedPanelInput: true,
        affineReflowResizeCancel: true,
        fixedBoxClipping: true,
        narrowDark: true,
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
