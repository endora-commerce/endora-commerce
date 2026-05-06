import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DEPRECATED — `pnpm modules:install` has been superseded by
 * `pnpm module:install` (singular). This thin shim prints a
 * deprecation notice and forwards argv to the new script. Will be
 * removed in the next minor release.
 */

const here = dirname(fileURLToPath(import.meta.url));
const newScriptPath = resolve(
  here,
  '../../_lifecycle/scripts/install.ts',
);

process.stderr.write(
  `[deprecated] \`modules:install\` is deprecated; use \`module:install\` instead.\n`,
);

const args = process.argv.slice(2);
const child = spawn('tsx', [newScriptPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
