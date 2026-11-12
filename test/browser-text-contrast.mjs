import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-env.mjs';

const port = Number(process.env.EDITOR_TEXT_CONTRAST_PORT ?? 4243),
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
    detached: true,
  }
);
let browser,
  logs = '';
server.stdout.on('data', (data) => {
  logs += data;
});
server.stderr.on('data', (data) => {
  logs += data;
});
try {
  for (let n = 0; n < 120; n++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting. */
    }
    if (n === 119) throw Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
  await page.goto(`${base}/verification.html`);
  await page.locator('[data-ready="true"]').waitFor();
  await page.evaluate(async () => {
    const doc = window.localEditor.getDocument();
    await window.localEditor.restoreDocument({
      ...doc,
      layers: [
        {
          id: 'contrast',
          kind: 'text',
          matrix: [1, 0, 0, 1, 60, 90],
          width: 300,
          height: 50,
          color: '#202a38',
          fill: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          fontSize: 32,
          text: 'Dark White',
          textRuns: [
            { text: 'Dark ', style: { color: '#202a38' } },
            {
              text: 'White',
              style: { color: '#ffffff', background: '#facc15' },
            },
          ],
        },
      ],
    });
  });
  await page.getByTestId('native-tool-select').click();
  await page
    .locator('.rie-layer-row')
    .first()
    .locator('button')
    .first()
    .click();
  await page.getByTestId('native-tool-text').click();
  await mkdir('.cache/text-ui-review', { recursive: true });
  const before = await page.evaluate(() => ({
    document: window.localEditor.getDocument(),
    pixels: window.localEditor.getImage(),
  }));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => window.localEditor.updateOptions({ theme }),
      theme
    );
    await page.getByTestId('native-text-content').focus();
    const colors = await page
      .getByTestId('native-text-content')
      .evaluate((element) => {
        const expected = getComputedStyle(
          element.closest('.image-editor-root')
        ).color;
        const nodes = [element, ...element.querySelectorAll('*')];
        return {
          expected,
          actual: nodes.map((node) => getComputedStyle(node).color),
          authored: [...element.querySelectorAll('[style]')].map((node) =>
            node.getAttribute('style')
          ),
        };
      });
    assert(
      colors.actual.every((color) => color === colors.expected),
      'Panel text must remain readable for both white and dark authored colors'
    );
    assert(
      colors.authored.some(
        (style) => style.includes('255, 255, 255') || style.includes('#ffffff')
      ),
      'Authored white remains in markup'
    );
    await page.getByTestId('native-text-content').blur();
    const after = await page.evaluate(() => ({
      document: window.localEditor.getDocument(),
      pixels: window.localEditor.getImage(),
    }));
    assert.deepEqual(
      after,
      before,
      'Panel contrast and no-op focus must not change rich marks, geometry or export'
    );
    await page
      .locator('.rie-options-content')
      .evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({
      path: `.cache/text-ui-review/panel-contrast-${theme}.png`,
    });
  }
  console.info(
    'Panel contrast passed for dark/white mixed text in both themes; authored marks and exported pixels unchanged.'
  );
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}
