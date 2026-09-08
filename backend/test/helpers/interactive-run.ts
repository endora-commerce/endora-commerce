/**
 * Run a `module:*` entry point with every interactivity signal reading **true**
 * — the launcher `uninstall-hard-needs-force.integration.test.ts` spawns to pin
 * owner ruling **D-217**.
 *
 * ## Why a launcher and not a pty
 *
 * D-217 makes `module:uninstall --hard` require `--force` *whether or not the
 * run has a terminal*, so the case that pins it is a run that could be mistaken
 * for interactive. The existing proof spawns with pipes, which cannot tell
 * *"refuses because non-interactive"* from *"refuses always"* — it is green
 * under both the ruled behaviour and the one D-217 struck.
 *
 * A real pty would need `node-pty` (a runtime dependency, Constitution IV) or
 * util-linux's `script`, whose presence a Node test cannot assume and whose
 * absence would make this case vacuously green. Forging the signals costs
 * neither and is **stronger** than a pty in the direction that matters: a pty
 * gives a caller `stdout.isTTY`, and this gives it `stdout`, `stderr`, `stdin`
 * *and* an environment with no CI marker — which is exactly the conjunction
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` R2.7 names as
 * the one an entry point would supply `OperatorRuntime.confirm` on. That is the
 * fail-open D-217 closes: `confirm` supplied from an entry point, with no prompt
 * behind it, would take `--hard` straight through to reverting migrations and
 * deleting the registry row.
 *
 * ## What it does not claim
 *
 * Forging `isTTY` is not a terminal. A future prompt built on `readline` over a
 * real fd would read this process's *pipe* and see EOF, not a human — which is
 * fine, because under D-217 there is no prompt to reach and the platform reads
 * no stdin at all. If that is ever revisited, this launcher stops being the
 * right instrument and the case it drives should say so before it is changed.
 *
 * Usage: `tsx test/helpers/interactive-run.ts <script.ts> [args…]`. The target
 * is imported rather than re-spawned, so it sees `process.argv.slice(2)` as its
 * own arguments — a launcher's path occupies `argv[1]` exactly as its own would.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
if (target === undefined) {
  process.stderr.write('usage: interactive-run.ts <script.ts> [args…]\n');
  process.exit(2);
}

// Every signal a caller could read to conclude "a human is here".
process.stdout.isTTY = true;
process.stderr.isTTY = true;
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
for (const marker of ['CI', 'GITLAB_CI', 'CONTINUOUS_INTEGRATION', 'BUILD_NUMBER']) {
  delete process.env[marker];
}

// The target takes over from here: it parses `process.argv.slice(2)`, which is
// everything after this file's own path, and ends in its own `process.exit`.
process.argv = [process.argv[0]!, resolve(target), ...process.argv.slice(3)];
void import(pathToFileURL(resolve(target)).href);
