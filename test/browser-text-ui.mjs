import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.EDITOR_TEXT_UI_PORT ?? 4241);
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
      /* Server is starting. */
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
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.locator('[data-ready="true"]').waitFor();
  const read = () => page.evaluate(() => window.localEditor.getDocument());
  const seed = await read();
  const textLayer = {
    id: 'text-ui',
    kind: 'text',
    matrix: [1, 0, 0, 1, 70, 80],
    width: 260,
    height: 45,
    color: '#202a38',
    fill: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    fontSize: 32,
    text: 'Alpha Beta',
    fontFamily: 'sans-serif',
    textLayout: 'auto-width',
  };
  const restore = async (layers) => {
    await page.evaluate(async (layers) => {
      const doc = window.localEditor.getDocument();
      await window.localEditor.restoreDocument({ ...doc, layers });
    }, layers);
  };
  await restore([textLayer]);
  await page.getByTestId('native-tool-select').click();
  await page
    .locator('.rie-layer-row')
    .first()
    .locator('button')
    .first()
    .click();
  await page.getByTestId('native-tool-text').click();
  const content = page.getByTestId('native-text-content');
  const select = async (from, to) => {
    await content.focus();
    await content.evaluate(
      (element, [from, to]) => {
        const point = (index) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          );
          let node = walker.nextNode();
          while (node) {
            if (index <= node.textContent.length) return [node, index];
            index -= node.textContent.length;
            node = walker.nextNode();
          }
          return [element, element.childNodes.length];
        };
        const [a, ao] = point(from),
          [f, fo] = point(to);
        window.getSelection().setBaseAndExtent(a, ao, f, fo);
        document.dispatchEvent(new Event('selectionchange'));
      },
      [from, to]
    );
  };
  await select(0, 5);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  let layer = (await read()).layers[0];
  assert.equal(layer.textRuns[0].text, 'Alpha');
  assert.equal(layer.textRuns[0].style.fontWeight, 700);
  assert.equal(layer.textRuns[0].style.underline, true);
  assert(!layer.textRuns.at(-1).style?.underline);
  await select(2, 8);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Bold"]')
        .getAttribute('aria-pressed') === 'mixed'
  );
  assert.equal(await page.getByTestId('native-text-weight').inputValue(), '');
  const size = page.getByTestId('native-text-size');
  await size.fill('');
  await size.pressSequentially('48');
  assert.equal(await size.inputValue(), '48');
  assert(
    await size.evaluate((element) => document.activeElement === element),
    'Formatting must not steal focus from a numeric control'
  );
  layer = (await read()).layers[0];
  assert(layer.textRuns.some((run) => run.style?.fontSize === 48));
  assert.equal(
    layer.textRuns[0].style?.fontSize ?? layer.fontSize,
    32,
    'Unselected characters retain size'
  );

  await select(0, 5);
  await page.locator('summary').filter({ hasText: 'Highlight' }).click();
  await page
    .getByRole('button', { name: 'Highlight: #facc15', exact: true })
    .click();
  assert(
    (await read()).layers[0].textRuns.some((run) =>
      ['#facc15', 'rgb(250, 204, 21)'].includes(run.style?.background)
    )
  );
  await select(10, 10);
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await page.keyboard.insertText('!');
  layer = (await read()).layers[0];
  assert.equal(layer.text, 'Alpha Beta!');
  assert.equal(layer.textRuns.at(-1).style.italic, true);

  // Layout changes affect reflow/box geometry; text content remains editable.
  await content.blur();
  await page
    .getByTestId('native-text-layout-controls')
    .locator('summary')
    .click();
  await page
    .getByRole('button', { name: 'Text layout Fit to text', exact: true })
    .click();
  await page.getByRole('option', { name: 'Wrap text', exact: true }).click();
  await page.getByTestId('native-text-box-width').fill('100');
  await page.getByTestId('native-text-box-width').blur();
  layer = (await read()).layers[0];
  assert.equal(layer.textLayout, 'auto-height');
  assert.equal(layer.width, 100);
  assert(layer.height > 60);
  const wrapped = await page.evaluate(() => window.localEditor.getImage());
  await page
    .getByRole('button', { name: 'Text layout Wrap text', exact: true })
    .click();
  await page.getByRole('option', { name: 'Fixed box', exact: true }).click();
  await page.getByTestId('native-text-box-height').fill('24');
  await page.getByTestId('native-text-box-height').blur();
  layer = (await read()).layers[0];
  assert.equal(layer.height, 24);
  assert.equal(layer.text, 'Alpha Beta!');
  assert.notEqual(
    await page.evaluate(() => window.localEditor.getImage()),
    wrapped
  );
  await mkdir('.cache/text-ui-review', { recursive: true });
  await page.screenshot({
    path: '.cache/text-ui-review/fixed-box-desktop.png',
  });

  // No first-selection-value substitution: text marks and generic layer style are mixed.
  await restore([
    textLayer,
    {
      ...textLayer,
      id: 'text-second',
      text: 'Second',
      fontSize: 44,
      fontWeight: 700,
      matrix: [1, 0, 0, 1, 300, 200],
    },
  ]);
  await page.getByTestId('native-tool-select').click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByTestId('native-tool-text').click();
  assert.equal(await page.getByTestId('native-text-size').inputValue(), '');
  assert.equal(
    await page.getByTestId('native-text-size').getAttribute('placeholder'),
    'Mixed'
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Bold', exact: true })
      .getAttribute('aria-pressed'),
    'mixed'
  );
  await page.getByTestId('native-text-weight').fill('600');
  await page.getByTestId('native-text-weight').blur();
  assert(
    (await read()).layers.every(
      (item) =>
        item.fontWeight === 600 &&
        item.textRuns.every((run) => run.style.fontWeight === 600)
    )
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await read()).layers[0].fontWeight, undefined);

  for (const locale of ['en', 'cs', 'sk', 'pl']) {
    await page.evaluate(
      (locale) =>
        window.localEditor.updateOptions({
          locale,
          theme: 'dark',
          showActions: false,
        }),
      locale
    );
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByTestId('native-tool-text').click();
    assert(await page.getByTestId('native-text-size').isVisible());
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
    assert.equal(
      await page.locator('[data-testid="native-text-content"]').count(),
      0,
      'Group styling must not offer an ambiguous shared text editor'
    );
    const box = await page.locator('.rie-canvas-wrap').boundingBox();
    assert(box.height > 140);
    await page.screenshot({
      path: `.cache/text-ui-review/mixed-${locale}-mobile.png`,
    });
  }
  assert.deepEqual(errors, []);
  assert.equal(seed.width, 600);
  console.info(
    'Rich text UI passed: selected ranges, mixed marks, numeric focus, highlights, typing marks, layout/reflow/clipping, group formatting/undo and four locales on mobile.'
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}
