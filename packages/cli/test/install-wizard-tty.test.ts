/**
 * T4-A, spawned — `endora install` with a **real pseudo-terminal** on both
 * descriptors asks §6.2's questions, and with **pipes** asks nothing
 * (`specs/125-first-mile-install/tasks.md` T4-A; `input-resolution.md` R3.6).
 *
 * ## Why a pseudo-terminal, and why `script`
 *
 * R3.6: *"a hang is only observable from outside the process"*, and a wizard is
 * exactly the code that could hang — it is the one place this command opens
 * `readline`. The in-process cases in `install-wizard.test.ts` hand the
 * command *"both descriptors are terminals"* as a fact; this file makes it
 * true, so `process.stdin.isTTY`, raw mode and the password's missing echo are
 * the terminal's own rather than a seam's.
 *
 * `script` (util-linux) allocates the pair and needs no dependency: it is in
 * `node:22.18-slim`, which the package-test job runs on, and on the hosted
 * runners. A machine without it fails the case with a sentence saying so — a
 * skipped proof of a no-hang guarantee is a green for a step that did not run.
 *
 * ## How the run ends without installing anything
 *
 * The child's `PATH` names nothing, so after the questions the preconditions
 * refuse — no package manager, no Docker daemon — and the process exits `1`
 * having written nothing. The answers have all been read by then, which is the
 * property under test; the pipeline is `install.test.ts`'s.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ENDORA = fileURLToPath(new URL('../dist/bin/endora.js', import.meta.url));
const TIMEOUT_MS = 60_000;
const PASSWORD = 'typed-and-never-shown';

/** Question on the screen → what is typed at it. Order is the order asked. */
const CONVERSATION: readonly (readonly [string, string])[] = [
  ['Where should the instance go?', '\r'],
  ['> ', '\r'],
  ['[Y/n]', '\r'],
  ['Install demo data? [y/n]', 'n\r'],
  ['Administrator e-mail:', 'owner@example.com\r'],
  ['Administrator password (not shown):', `${PASSWORD}\r`],
  ['Administrator first name:', 'Ada\r'],
  ['Administrator last name:', 'Lovelace\r'],
];

/**
 * Where util-linux `script` is, resolved on **this** process's `PATH` — the
 * child's is deliberately empty — or `null` when it is not util-linux's.
 */
function scriptPath(): string | null {
  const found = spawnSync('sh', ['-c', 'command -v script'], { encoding: 'utf8' });
  const path = found.stdout.trim();
  if (found.status !== 0 || path.length === 0) return null;
  const version = spawnSync(path, ['--version'], { encoding: 'utf8' });
  return version.status === 0 && /util-linux/.test(version.stdout) ? path : null;
}

interface Run {
  readonly code: number | null;
  readonly screen: string;
  readonly timedOut: boolean;
  readonly answered: number;
}

/** Drive the command through a pseudo-terminal, answering each question as it appears. */
function converse(script: string, cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    const command = `'${process.execPath}' '${ENDORA}' install`;
    const child = spawn(script, ['-qfec', command, '/dev/null'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        // Nothing on PATH: the preconditions refuse after the questions, so the
        // run ends having read every answer and installed nothing.
        PATH: join(cwd, 'no-such-bin'),
        SHELL: '/bin/sh',
        TERM: 'dumb',
        HOME: cwd,
        DOCKER_HOST: 'unix:///nonexistent/endora-declared-absence.sock',
      },
    });
    let screen = '';
    let cursor = 0;
    let answered = 0;
    const answer = (): void => {
      while (answered < CONVERSATION.length) {
        const [question, typed] = CONVERSATION[answered]!;
        const at = screen.indexOf(question, cursor);
        if (at < 0) return;
        cursor = at + question.length;
        answered += 1;
        child.stdin.write(typed);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      screen += chunk.toString();
      answer();
    });
    child.stderr.on('data', (chunk: Buffer) => (screen += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, screen, timedOut: true, answered });
    }, TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, screen: `${screen}\n${error.message}`, timedOut: false, answered });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code, screen, timedOut: false, answered });
    });
  });
}

/** The same command with pipes on both descriptors and stdin closed at once. */
function piped(args: readonly string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENDORA, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: '', GITLAB_CI: '', GITHUB_ACTIONS: '' },
    });
    let screen = '';
    child.stdout.on('data', (chunk: Buffer) => (screen += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (screen += chunk.toString()));
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, screen, timedOut: true, answered: 0 });
    }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, screen, timedOut: false, answered: 0 });
    });
  });
}

describe('T4-A — spawned', () => {
  it(
    'at a terminal it asks every question in order, reads each answer, and shows no password',
    async () => {
      const script = scriptPath();
      expect(
        script,
        'util-linux `script` is not on this machine, and it is what allocates the terminal pair ' +
          'this case needs. Install util-linux (it ships in every Debian-based image, ' +
          'node:22.18-slim included); a skipped proof of a no-hang guarantee proves nothing.',
      ).not.toBeNull();
      const parent = mkdtempSync(join(tmpdir(), '136w52-tty-'));
      try {
        const run = await converse(script!, parent);
        expect(run.timedOut, `still running after ${String(TIMEOUT_MS)} ms:\n${run.screen}`).toBe(
          false,
        );
        expect(run.answered, run.screen).toBe(CONVERSATION.length);
        // Asked, answered, and then refused on the machine — nothing written.
        expect(run.code, run.screen).toBe(1);
        expect(run.screen).toContain('Nothing was written');
        expect(run.screen).toContain('no package manager');
        expect(existsSync(join(parent, 'endora-commerce'))).toBe(false);
        // §6.2 Q6 — read without echo.
        expect(run.screen).not.toContain(PASSWORD);
        // FR-147 — the one line before the first question.
        expect(run.screen).toContain('0 of 7 answers came from flags');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'with pipes it asks nothing and refuses naming every answer still owed, the directory included',
    async () => {
      const parent = mkdtempSync(join(tmpdir(), '136w52-pipe-'));
      try {
        const run = await piped(['install', '--no-storefront', '--no-services'], parent);
        expect(run.timedOut).toBe(false);
        expect(run.code).toBe(1);
        for (const owed of [
          '<dir>',
          '--admin-email',
          '--admin-password',
          '--admin-first-name',
          '--admin-last-name',
          '--demo',
          '--no-demo',
        ]) {
          expect(run.screen, `the refusal does not name ${owed}`).toContain(owed);
        }
        expect(run.screen).not.toContain('Where should the instance go?');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );
});
