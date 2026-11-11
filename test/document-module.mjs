import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(path.join(tmpdir(), 'image-document-module-'));
try {
  // A package with no node_modules proves that neither format loads React.
  cpSync(path.join(root, 'package.json'), path.join(directory, 'package.json'));
  cpSync(path.join(root, 'dist'), path.join(directory, 'dist'), {
    recursive: true,
  });
  const guards = `
    for (const key of ['window', 'document', 'Image', 'HTMLElement'])
      Object.defineProperty(globalThis, key, { get() { throw Error('DOM access: ' + key); } });
  `;
  const checks = `
    const original = api.createDocument(320, 200);
    const options = api.parseExportOptions({ type: 'image/jpeg', fit: 'contain', upscale: false, width: 128 });
    if (options.fit !== 'contain' || options.upscale !== false) throw Error('Invalid output settings');
    const parsed = api.parseDocument(JSON.stringify(original));
    if (JSON.stringify(parsed) !== JSON.stringify(original)) throw Error('Invalid round trip');
    parsed.effects.brightness = 50;
    if (original.effects.brightness !== 0) throw Error('Shared state');
    let rejected = false;
    try { api.parseDocument({ ...original, imageMatrix: [0,0,0,0,0,0] }); } catch { rejected = true; }
    if (!rejected) throw Error('Invalid transform accepted');
    console.log('document module works without React or DOM');
  `;
  for (const [format, statement] of [
    ['commonjs', "const api = require('@lofcz/react-image-editor/document');"],
    [
      'module',
      "const api = await import('@lofcz/react-image-editor/document');",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [`--input-type=${format}`, '--eval', guards + statement + checks],
      { cwd: directory, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, `${format}: ${result.stderr}`);
    assert.match(result.stdout, /works without React or DOM/);
  }
  for (const extension of ['d.ts', 'd.mts']) {
    const declaration = readFileSync(
      path.join(directory, `dist/document.${extension}`),
      'utf8'
    );
    assert.doesNotMatch(
      declaration,
      /from ['"]react|CanvasRenderingContext|HTMLElement|CanvasImageSource/
    );
  }
  for (const extension of ['js', 'mjs']) {
    assert.match(
      readFileSync(
        path.join(directory, `dist/index.${extension}`),
        'utf8'
      ).slice(0, 100),
      /^(?:["']use strict["'];\s*)?["']use client["'];/
    );
    assert.doesNotMatch(
      readFileSync(path.join(directory, `dist/document.${extension}`), 'utf8'),
      /["']use client["']/
    );
  }
  console.info(
    'CJS and ESM document exports validate independently of React and browser globals.'
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
