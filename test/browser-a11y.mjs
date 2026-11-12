// Accessibility gate: axe-core over the main editor states plus keyboard-only
// task flows. Runs on any EDITOR_BROWSER engine.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { browserName, launchBrowser } from './browser-env.mjs';

const port = Number(process.env.EDITOR_A11Y_PORT ?? 4253),
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
server.stdout.on('data', (chunk) => (log += chunk));
server.stderr.on('data', (chunk) => (log += chunk));

const tools = [
  'select',
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
];
const root = '[data-testid="image-editor-theme"]';
// WCAG 2.2 A/AA plus the best-practice rules that apply to an embedded
// widget. Page-level rules (landmarks, h1, document title) belong to the host.
const tags = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];
const pageLevel = [
  'region',
  'landmark-one-main',
  'page-has-heading-one',
  'landmark-complementary-is-top-level',
];

try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Starting Vite. */
    }
    if (i === 119) throw new Error(log || 'A11y test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await launchBrowser();
  const context = await browser.newContext({
      viewport: { width: 1120, height: 800 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/verification.html`);
  await page.waitForFunction(
    () => window.localEditor?.getSnapshot().phase === 'ready'
  );
  const frames = (count = 2) =>
    page.evaluate(
      (count) =>
        new Promise((resolve) => {
          const step = (left) =>
            left ? requestAnimationFrame(() => step(left - 1)) : resolve();
          step(count);
        }),
      count
    );
  const options = (patch) =>
    page.evaluate((patch) => window.localEditor.updateOptions(patch), patch);
  const reset = async () => {
    await page.evaluate(() => window.localEditor.reset(window.sourceUrl));
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="native-tool-select"]')
          ?.getAttribute('aria-pressed') === 'true'
    );
  };
  let audits = 0;
  const audit = async (state) => {
    audits++;
    await frames();
    const result = await new AxeBuilder({ page })
      .include(root)
      .withTags(tags)
      .disableRules(pageLevel)
      .analyze();
    return result.violations.map((violation) => ({
      state,
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 4).map((node) => ({
        target: node.target.join(' '),
        summary: node.failureSummary?.split('\n').slice(0, 3).join(' '),
      })),
    }));
  };
  const openTool = async (tool) => {
    const button = page.getByTestId(`native-tool-${tool}`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    if (tool === 'select') {
      // The select panel needs a layer to show its controls.
      await page.evaluate(async () => {
        const doc = window.localEditor.getDocument();
        await window.localEditor.restoreDocument({
          ...doc,
          layers: [
            {
              id: 'a11y-shape',
              kind: 'rectangle',
              matrix: [1, 0, 0, 1, 120, 80],
              width: 160,
              height: 120,
              color: '#202a38',
              fill: '#facc15',
              strokeWidth: 4,
              opacity: 1,
            },
          ],
        });
        window.localEditor.select('a11y-shape');
      });
    }
    if (tool === 'text')
      await page
        .getByTestId('native-text-add')
        .click()
        .catch(() => {});
    if (tool === 'shapes')
      await page
        .getByTestId('native-shape-rectangle')
        .click()
        .catch(() => {});
  };

  // 1. axe over every tool panel × desktop/compact × light/dark.
  // EDITOR_A11Y_AXE=0 runs only the keyboard and live-region flows.
  const runAxe = process.env.EDITOR_A11Y_AXE !== '0';
  const violations = [];
  for (const viewport of runAxe
    ? [
        { name: 'desktop', width: 1120, height: 800 },
        { name: 'compact', width: 358, height: 720 },
      ]
    : [])
    for (const theme of ['light', 'dark']) {
      console.info(
        `axe: ${viewport.name} ${theme} (${violations.length} violations so far)`
      );
      await page.setViewportSize(viewport);
      await options({ theme, locale: 'en' });
      for (const tool of tools) {
        await reset();
        await openTool(tool);
        violations.push(...(await audit(`${viewport.name}/${theme}/${tool}`)));
      }
      await reset();
      await page.getByTestId('native-export-settings').click();
      await page.getByRole('button', { name: 'JPEG', exact: true }).click();
      violations.push(...(await audit(`${viewport.name}/${theme}/export`)));
      await page.keyboard.press('Escape');
      // Compact layouts hide the shortcuts button: touch has no shortcuts.
      const help = page.getByRole('button', { name: 'Keyboard shortcuts' });
      if (await help.isVisible()) {
        await help.click();
        violations.push(...(await audit(`${viewport.name}/${theme}/help`)));
        await help.click();
      }
      await openTool('text');
      const picker = page.locator('.rie-picker-trigger').first();
      if (await picker.count()) {
        await picker.click();
        violations.push(...(await audit(`${viewport.name}/${theme}/picker`)));
        await page.keyboard.press('Escape');
      }
      await page.getByTestId('native-compare').click();
      violations.push(...(await audit(`${viewport.name}/${theme}/compare`)));
      await page.getByTestId('native-compare').click();
    }
  // 2. Every locale on the crop and effects panels.
  await page.setViewportSize({ width: 1120, height: 800 });
  for (const locale of runAxe ? ['en', 'cs', 'sk', 'pl'] : [])
    for (const theme of ['light', 'dark']) {
      await options({ theme, locale });
      for (const tool of ['crop', 'filter']) {
        await reset();
        await openTool(tool);
        violations.push(...(await audit(`locale ${locale}/${theme}/${tool}`)));
      }
    }
  await options({ theme: 'light', locale: 'en' });
  if (violations.length) {
    const ids = new Map();
    for (const v of violations) {
      const entry = ids.get(v.id) ?? { ...v, states: [] };
      entry.states.push(v.state);
      ids.set(v.id, entry);
    }
    console.error(
      JSON.stringify(
        [...ids.values()].map(({ state: _state, ...rest }) => rest),
        null,
        2
      )
    );
    assert.fail(
      `${violations.length} axe violations in ${ids.size} rules: ${[
        ...ids.keys(),
      ].join(', ')}`
    );
  }

  console.info('keyboard flows');
  // 3. Keyboard-only flows. Focus must stay inside the editor and return to
  // the control that opened a panel or popover after it closes.
  await reset();
  const active = () =>
    page.evaluate(() => {
      const element = document.activeElement,
        editor = document.querySelector('[data-testid="image-editor-theme"]');
      return {
        inside: !!editor?.contains(element),
        testId: element?.getAttribute('data-testid') ?? null,
        name:
          element?.getAttribute('aria-label') ??
          element?.textContent?.trim().slice(0, 40) ??
          null,
        tag: element?.tagName,
        visibleFocus: (() => {
          if (!element || element === document.body) return false;
          const style = getComputedStyle(element);
          return (
            (style.outlineStyle !== 'none' &&
              parseFloat(style.outlineWidth) >= 2) ||
            style.boxShadow !== 'none'
          );
        })(),
      };
    });
  const tabTo = async (predicate, limit = 80, key = 'Tab') => {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press(key);
      const now = await active();
      assert(now.inside || i === 0, `Focus left the editor: ${now.tag}`);
      if (predicate(now)) return now;
    }
    throw new Error('Keyboard focus never reached the target');
  };
  const focusEditorStart = async () => {
    await page.getByRole('button', { name: 'Theme', exact: true }).focus();
  };
  // 3a. Tab order reaches every tool button, in toolbar order, with a visible indicator.
  await focusEditorStart();
  const order = [];
  for (let i = 0; i < 60 && order.length < tools.length; i++) {
    await page.keyboard.press('Tab');
    const now = await active();
    assert(now.inside, `Focus left the editor while tabbing: ${now.tag}`);
    assert(
      now.visibleFocus,
      `No visible focus indicator on ${now.testId ?? now.name}`
    );
    if (
      now.testId?.startsWith('native-tool-') &&
      now.testId !== 'native-tool-nav'
    )
      order.push(now.testId.slice('native-tool-'.length));
  }
  assert.deepEqual(order, tools);
  // 3b. Arrow keys move between tools inside the tool bar (roving focus).
  await page.getByTestId('native-tool-crop').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal((await active()).testId, 'native-tool-adjust');
  await page.keyboard.press('ArrowUp');
  assert.equal((await active()).testId, 'native-tool-crop');
  await page.keyboard.press('End');
  assert.equal((await active()).testId, 'native-tool-resize');
  await page.keyboard.press('Home');
  assert.equal((await active()).testId, 'native-tool-select');
  // 3c. Open Effects, change a value with the keyboard, close: focus returns.
  await page.getByTestId('native-tool-filter').focus();
  await page.keyboard.press('Enter');
  await tabTo((now) => now.testId === 'native-filter-preset-invert');
  const beforeEffect = await page.evaluate(
    () => window.localEditor.getDocument().effects.preset
  );
  await page.keyboard.press('Enter');
  assert.notEqual(
    await page.evaluate(() => window.localEditor.getDocument().effects.preset),
    beforeEffect
  );
  await tabTo(
    (now) => now.testId === 'native-tool-options-close',
    80,
    'Shift+Tab'
  );
  await page.keyboard.press('Enter');
  await frames();
  assert.equal(
    (await active()).testId,
    'native-tool-filter',
    'Closing a panel returns focus to its tool'
  );
  // 3d. Slider: arrow keys change an adjustment and stay one undo step.
  await page.getByTestId('native-tool-adjust').focus();
  await page.keyboard.press('Enter');
  const slider = await tabTo((now) => now.tag === 'INPUT');
  assert(slider.inside);
  const history = () => page.evaluate(() => window.changes.length);
  const historyBefore = await history(),
    valueBefore = await page.evaluate(
      () => window.localEditor.getDocument().effects.brightness
    );
  // One press is one undo step; a held key (auto-repeat) is also one step.
  await page.keyboard.press('ArrowRight');
  assert.equal(await history(), historyBefore + 1);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await frames();
  assert.equal(await history(), historyBefore + 2);
  assert(
    (await page.evaluate(
      () => window.localEditor.getDocument().effects.brightness
    )) > valueBefore
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.evaluate(
      () => window.localEditor.getDocument().effects.brightness
    ),
    valueBefore
  );
  // 3e. Crop with the keyboard only: preset, Apply, then undo.
  await reset();
  await page.getByTestId('native-tool-crop').focus();
  await page.keyboard.press('Enter');
  await tabTo((now) => now.name === 'Square');
  await page.keyboard.press('Enter');
  await tabTo((now) => now.testId === 'native-crop-apply', 80, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await frames();
  assert.equal(
    await page.evaluate(() => window.localEditor.getDocument().width),
    400
  );
  const afterCrop = await active();
  assert(afterCrop.inside, 'Apply crop keeps focus in the editor');
  assert.equal(afterCrop.testId, 'native-tool-crop');
  await page.keyboard.press('Control+z');
  assert.equal(
    await page.evaluate(() => window.localEditor.getDocument().width),
    600
  );
  // 3f. Popovers: Escape closes export settings and returns focus.
  await page.getByTestId('native-export-settings').focus();
  await page.keyboard.press('Enter');
  await tabTo((now) => now.name === 'JPEG');
  await page.keyboard.press('Escape');
  await frames();
  assert.equal((await active()).testId, 'native-export-settings');
  assert.equal(await page.getByTestId('native-export-panel').count(), 0);
  // Close button inside the popover returns focus too.
  await page.keyboard.press('Enter');
  await tabTo((now) => now.name === 'Close');
  await page.keyboard.press('Enter');
  await frames();
  assert.equal((await active()).testId, 'native-export-settings');
  // 3g. Picker listbox: open, choose with arrows, focus returns to the trigger.
  await reset();
  await page.getByTestId('native-tool-text').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('native-text-add').focus();
  await page.keyboard.press('Enter');
  const trigger = page.locator('.rie-picker-trigger').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(
    await trigger.evaluate((element) => element === document.activeElement),
    true
  );
  // 3h. The canvas application never traps Tab, in either direction.
  await reset();
  await page.getByRole('application').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const afterCanvas = await active();
  assert(afterCanvas.tag !== 'DIV' || afterCanvas.testId, 'Tab leaves canvas');
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.getAttribute('role')),
    'application'
  );
  await page.getByRole('application').focus();
  await page.keyboard.press('Shift+Tab');
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.getAttribute('role')),
    'application'
  );

  // 4. Live region announces selection and history changes.
  await reset();
  const announced = () =>
    page
      .locator(`${root} [data-testid="native-announcer"]`)
      .textContent()
      .then((text) => text.trim());
  await openTool('select');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="native-announcer"]')
        ?.textContent.trim() !== ''
  );
  assert.match(await announced(), /Rectangle/);
  assert.equal(
    await page
      .getByTestId('native-announcer')
      .evaluate((element) =>
        [element.getAttribute('role'), element.getAttribute('aria-live')].join()
      ),
    'status,polite'
  );
  await page.getByRole('application').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() =>
    /Last change undone/.test(
      document.querySelector('[data-testid="native-announcer"]')?.textContent
    )
  );
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(() =>
    /Change redone/.test(
      document.querySelector('[data-testid="native-announcer"]')?.textContent
    )
  );
  await options({ locale: 'cs' });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() =>
    /Poslední změna vrácena/.test(
      document.querySelector('[data-testid="native-announcer"]')?.textContent
    )
  );
  await options({ locale: 'en' });

  assert.deepEqual(errors, []);
  console.info(
    JSON.stringify(
      {
        browser: browserName,
        axeStates: audits,
        axeViolations: 0,
        keyboardFlows: true,
        focusReturn: true,
        liveRegion: true,
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
