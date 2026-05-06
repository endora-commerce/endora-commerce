import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DEPRECATED — `pnpm modules:uninstall` has been superseded by
 * `pnpm module:uninstall` (singular). The new script accepts `--hard`
 * for destructive uninstall (data deletion) and treats the bare form
 * as soft (data preserved). This shim translates the legacy flags:
 *   --remove-settings  →  --hard --force
 *   --preserve-settings → (soft default)
 */

const here = dirname(fileURLToPath(import.meta.url));
const newScriptPath = resolve(
  here,
  '../../_lifecycle/scripts/uninstall.ts',
);

process.stderr.write(
  `[deprecated] \`modules:uninstall\` is deprecated; use \`module:uninstall\` instead.\n`,
);

const args = process.argv.slice(2);
const child = spawn('tsx', [newScriptPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
