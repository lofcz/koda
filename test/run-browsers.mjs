// Run the `test:browser` suites on another engine without duplicating the list:
//   node test/run-browsers.mjs firefox
//   node test/run-browsers.mjs webkit chromium
// EDITOR_PORT_BASE=4600 assigns every suite's Vite port from a base, so
// concurrent runs on one machine do not collide.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const browsers = process.argv.slice(2);
if (!browsers.length) browsers.push(process.env.EDITOR_BROWSER ?? 'chromium');
const { scripts } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
const files = [
  ...scripts['test:browser'].matchAll(/node (test\/\S+\.mjs)/g),
].map((match) => match[1]);
// Not yet verified on Firefox/WebKit: these 2.2 suites run on Chromium only
// until their engine differences are fixed (Firefox fails a crop-overlay pixel
// check in browser-crop-overlays.mjs).
const chromiumOnly = new Set([
  'test/browser-crop-overlays.mjs',
  'test/browser-assets.mjs',
  'test/browser-rights.mjs',
  'test/browser-replace-base.mjs',
]);
const portVariables = [
  'EDITOR_TEST_PORT',
  'EDITOR_CORE_PORT',
  'EDITOR_CROP_PORT',
  'EDITOR_CROP_UI_PORT',
  'EDITOR_INTERACTIONS_PORT',
  'EDITOR_PATH_SELECTION_PORT',
  'EDITOR_RICH_TEXT_PORT',
  'EDITOR_TEXT_CONTRAST_PORT',
  'EDITOR_TEXT_UI_PORT',
  'EDITOR_UI_TEST_PORT',
  'EDITOR_A11Y_PORT',
  'EDITOR_CROP_OVERLAYS_PORT',
  'EDITOR_ASSETS_PORT',
  'EDITOR_RIGHTS_PORT',
  'EDITOR_REPLACE_BASE_PORT',
];
const ports = process.env.EDITOR_PORT_BASE
  ? Object.fromEntries(
      portVariables.map((name, i) => [
        name,
        String(Number(process.env.EDITOR_PORT_BASE) + i),
      ])
    )
  : {};
const failures = [];
for (const browser of browsers)
  for (const file of files) {
    if (browser !== 'chromium' && chromiumOnly.has(file)) {
      console.info(`\n↷ ${browser} ${file} (Chromium only for now)`);
      continue;
    }
    console.info(`\n▶ ${browser} ${file}`);
    const result = spawnSync(process.execPath, [file], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...ports, EDITOR_BROWSER: browser },
    });
    if (result.status !== 0) failures.push(`${browser} ${file}`);
    if (result.status !== 0 && !process.env.EDITOR_KEEP_GOING) break;
  }
if (failures.length) {
  console.error(`\nFailed:\n${failures.join('\n')}`);
  process.exit(1);
}
