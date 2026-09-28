#!/usr/bin/env node
/**
 * `create-endora-commerce` — the npm front door to `endora install`, and
 * nothing else (`specs/125-first-mile-install/` FR-141, FR-142).
 *
 * The whole job: find the `endora` program of the `@endora-commerce/cli` this
 * package was released with, run its `install` verb with this process's
 * arguments exactly as typed, and exit with its code. Every decision a run
 * takes — what is written, what is asked, which answer is the default — is the
 * CLI's, so `npx create-endora-commerce <dir> …` and `endora install <dir> …`
 * are one product behind two names rather than two products behind one set of
 * arguments.
 *
 * **It adds no argument of its own** (D-268). Pre-answering any question here —
 * the demo-data one included — would be policy held in the one place FR-142
 * says holds none, and a different instance for the same typed command. This
 * file's own test asserts it names no option of the install question set, and
 * no double-dash token at all.
 *
 * **Its only dependency is the CLI.** The CLI is located by package name
 * through its `./package.json` export and its declared `bin`, never by a path
 * into its `dist`, so a CLI that moves its entry point moves it for both names.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The CLI verb this front door stands for. The one word it contributes to argv. */
const VERB = 'install';

/** The absolute path of the installed CLI's `endora` program. */
function endoraProgram(): string {
  const manifestPath = createRequire(import.meta.url).resolve('@endora-commerce/cli/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['endora'];
  if (entry === undefined) {
    throw new Error(`${manifestPath} declares no \`endora\` program.`);
  }
  return join(dirname(manifestPath), entry);
}

let program: string;
try {
  program = endoraProgram();
} catch (error: unknown) {
  process.stderr.write(
    'create-endora-commerce: the Endora Commerce CLI (@endora-commerce/cli) could not be ' +
      `located, so there is nothing to run. Reinstall this package and try again.\n  ${String(error)}\n`,
  );
  process.exit(1);
}

const child = spawn(process.execPath, [program, VERB, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

// A signal sent to this process alone (a supervisor's SIGTERM) is the child's
// to act on; a terminal's Ctrl-C already reaches both. Either way this process
// waits for the child and reports what the child did.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('error', (error) => {
  process.stderr.write(`create-endora-commerce: could not start ${program}: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    // Die of the same signal, so the caller's shell reports what happened.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
