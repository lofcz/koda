#!/usr/bin/env node
// One-time interactive bootstrap; subsequent releases use GitHub OIDC.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
  return result;
}
const version = spawnSync(npm, ['--version'], {
  encoding: 'utf8',
}).stdout.trim();
const [major, minor] = version.split('.').map(Number);
if (major < 11 || (major === 11 && minor < 15)) {
  throw new Error(
    'Use npm >=11.15 for npm trust. Run npm install -g npm@11.19.0.'
  );
}
for (const task of ['lint', 'typecheck', 'test', 'build'])
  run(pnpm, ['run', task]);
run(npm, ['pack', '--dry-run']);
const identity = spawnSync(npm, ['whoami'], { stdio: 'ignore' });
if (identity.status !== 0) run(npm, ['login', '--auth-type=web']);
const existing = spawnSync(
  npm,
  ['view', `${pkg.name}@${pkg.version}`, 'version', '--json'],
  {
    encoding: 'utf8',
  }
);
if (existing.status !== 0) {
  // Only a missing package/version permits initial publication. Fail closed
  // on registry/auth/network errors instead of guessing that it is absent.
  if (!`${existing.stdout}${existing.stderr}`.includes('E404')) {
    throw new Error(
      'Could not check the registry. Retry after resolving the npm error.'
    );
  }
  run(npm, ['publish', '--access', 'public']);
}
run(npm, [
  'trust',
  'github',
  pkg.name,
  '--repo',
  'lofcz/koda',
  '--file',
  'release.yml',
  '--allow-publish',
  '--yes',
]);
run(npm, ['trust', 'list', pkg.name]);
console.info(
  'Bootstrap complete. Future releases: gh workflow run release.yml -R lofcz/koda'
);
