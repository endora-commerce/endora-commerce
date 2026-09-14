/**
 * **No command blocks on a prompt nobody can answer** — proved by spawning
 * (`specs/117-instance-bring-up/contracts/input-resolution.md` R3.3, R3.6;
 * FR-012, SC-003).
 *
 * ## Why this is not a unit test over `mayPrompt`
 *
 * R3.6 says it in one line and it is worth restating because the temptation is
 * strong: *"the failure this rule exists to prevent is a hang, and a hang is
 * only observable from outside the process."* `mayPrompt` returning `false` is
 * a fact about a predicate. What an operator's pipeline experiences is a
 * process that never exits — and every plausible way of getting that wrong
 * leaves the predicate correct:
 *
 *   * the predicate is right and a caller does not consult it;
 *   * the predicate is right, the caller consults it, and `readline` is opened
 *     anyway on some other path;
 *   * the refusal is thrown and something above it retries interactively;
 *   * `process.stdin` is resumed by a library and the process stays alive with
 *     nothing to read.
 *
 * A predicate test passes in all four. Only a real process with real pipes and
 * a real timeout tells them apart, so the assertion here is **that the process
 * exited**, and the exit code and the message are what it exited *with*.
 *
 * ## What each case pins
 *
 * Every one spawns the built `endora` with stdin **and** stdout as pipes and no
 * TTY on either — which is what CI, a pipe and a redirect all look like — and
 * asserts the process is gone well inside the timeout. `--non-interactive` and
 * the CI marker are the two cases that would still be interactive if only the
 * TTY test were implemented, and they are here for that reason rather than for
 * completeness.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENDORA = fileURLToPath(new URL('../dist/bin/endora.js', import.meta.url));

/**
 * How long a run gets before it is called hung.
 *
 * Generous — the command resolves a reference storefront and reads a git tree —
 * and the assertion is not about speed. A run that has not exited by here is
 * waiting for an answer, which is the defect.
 */
const TIMEOUT_MS = 60_000;

interface SpawnResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Run the command with pipes on both descriptors, and **close stdin at once**.
 *
 * Closing it is what makes a hang a hang rather than a slow test: a `readline`
 * over a closed pipe resolves its question with an empty line, so a command
 * that prompted anyway would spin on the re-ask rather than block on a read,
 * and would still be here when the timeout fires. Either way the process is
 * alive and the assertion sees it.
 */
function run(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENDORA, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // The inherited environment is a developer's or a runner's, and either
        // may already carry `CI`. Clearing it makes each case below test the
        // condition it names rather than whichever one the host happened to
        // satisfy — the two CI cases then set it themselves.
        CI: '',
        GITLAB_CI: '',
        GITHUB_ACTIONS: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, signal: 'SIGKILL', stdout, stderr, timedOut: true });
    }, TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut: false });
    });
  });
}

/** A target directory that does not exist yet, plus a cleanup. */
function target(): { dir: string; parent: string } {
  const parent = mkdtempSync(join(tmpdir(), 'endora-tty-'));
  return { dir: join(parent, 'shop'), parent };
}

describe('a run with no terminal refuses instead of asking', () => {
  it(
    'exits 1 naming every missing input and the flag that supplies each',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(['new', 'storefront', dir], REPO_ROOT);
        // The assertion the whole file exists for: the process is **gone**.
        expect(result.timedOut, `it was still running after ${TIMEOUT_MS} ms`).toBe(false);
        expect(result.code).toBe(1);
        // Every one of them, in one refusal — not one per run (R3.2).
        expect(result.stderr).toContain('--next-public-api-base-url <value>');
        expect(result.stderr).toContain('--backend-base-url <value>');
        expect(result.stderr).toContain('--next-public-site-url <value>');
        expect(result.stderr).toContain('--next-public-sales-channel-code <value>');
        expect(result.stderr).toContain('--revalidate-secret <value>');
        expect(result.stderr).toContain('Nothing was written.');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'refuses under `--non-interactive` too, which is the condition a TTY test alone would miss',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(['new', 'storefront', dir, '--non-interactive'], REPO_ROOT);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('`--non-interactive` was given');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'refuses when a CI marker is set',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(['new', 'storefront', dir], REPO_ROOT, { CI: 'true' });
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(1);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );
});

describe('a run that has its values does not ask for them', () => {
  it(
    'writes the tree, prompts for nothing, and prints `defaulted=0`',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(
          [
            'new',
            'storefront',
            dir,
            '--next-public-api-base-url',
            'https://api.example.com',
            '--backend-base-url',
            'https://api.internal.example.com',
            '--next-public-site-url',
            'https://shop.example.com',
            '--next-public-sales-channel-code',
            'default',
            '--revalidate-secret',
            'a-secret-both-trees-share',
          ],
          REPO_ROOT,
        );
        expect(result.timedOut).toBe(false);
        expect(result.stderr).toBe('');
        expect(result.code).toBe(0);
        // SC-002 — the literal, on every run.
        expect(result.stdout).toContain('defaulted=0');
        expect(result.stdout).toContain('flags=5');
        expect(result.stdout).toContain('prompted=0');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'takes the values from a `.env` the operator placed in the target beforehand',
    async () => {
      // The owner's own second tier, in their words: *"or place the required
      // things in a `.env` beforehand"*. It is also the one case that proves
      // the target-directory rule is reachable at all — the command refuses a
      // non-empty directory, and this is its one exception.
      const { dir, parent } = target();
      try {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, '.env'),
          [
            '# placed by the operator before scaffolding',
            'NEXT_PUBLIC_API_BASE_URL=https://api.example.com',
            'BACKEND_BASE_URL=https://api.internal.example.com',
            'NEXT_PUBLIC_SITE_URL=https://shop.example.com',
            'NEXT_PUBLIC_SALES_CHANNEL_CODE=default',
            'REVALIDATE_SECRET=a-secret-both-trees-share',
            '',
          ].join('\n'),
          'utf8',
        );
        const result = await run(['new', 'storefront', dir], REPO_ROOT);
        expect(result.timedOut).toBe(false);
        expect(result.stderr).toBe('');
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('env-file=5');
        expect(result.stdout).toContain('defaulted=0');
        // The operator's own comment survives: the command merges into the file
        // rather than rewriting it.
        const { readFileSync } = await import('node:fs');
        expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(
          '# placed by the operator before scaffolding',
        );
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'reports rather than refuses under `--dry-run`, and writes nothing',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(['new', 'storefront', dir, '--dry-run'], REPO_ROOT);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('would ask for NEXT_PUBLIC_API_BASE_URL');
        expect(result.stdout).toContain('prompted=0');
        expect(result.stdout).toContain('generated=0');
        expect(result.stdout).toContain('defaulted=0');
        const { existsSync } = await import('node:fs');
        expect(existsSync(dir)).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );
});

/**
 * SC-106 — **including `endora install`**, which is the command with the most
 * to hang on: it runs a package manager, a Docker daemon and a database
 * migration, and it is the one a stranger meets first
 * (`specs/125-first-mile-install/spec.md` §4.3, T3-A).
 *
 * Phase 3 of that feature is deliberately the non-interactive half — the verb
 * asks nothing at all — so what these cases prove is that the whole of it,
 * refusals included, is reachable with both descriptors piped and stdin closed.
 */
describe('`endora install` never blocks, and refuses completely', () => {
  it(
    'a run with no answers exits 1 naming every one of them, in one refusal',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(['install', dir, '--no-storefront', '--no-services'], parent);
        expect(result.timedOut, `it was still running after ${TIMEOUT_MS} ms`).toBe(false);
        expect(result.code).toBe(1);
        for (const flag of [
          '--admin-email',
          '--admin-password',
          '--admin-first-name',
          '--admin-last-name',
          '--demo',
          '--no-demo',
        ]) {
          expect(result.stderr, `the refusal does not name ${flag}`).toContain(flag);
        }
        expect(result.stderr).toContain('Nothing was written');
        const { existsSync } = await import('node:fs');
        expect(existsSync(dir)).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'outside a checkout it refuses the storefront in advance, naming the flag that skips it',
    async () => {
      const { dir, parent } = target();
      try {
        // The finding this case records: `endora new storefront` copies the
        // reference storefront out of a checkout of the platform repository, so
        // an installed CLI standing in an empty directory cannot write one. The
        // one-shot refuses **before** writing an instance rather than failing
        // half way through the pipeline, and the refusal names the remedy.
        const result = await run(
          [
            'install',
            dir,
            '--no-services',
            '--no-demo',
            '--admin-email',
            'owner@example.com',
            '--admin-password',
            'a-password-they-remember',
            '--admin-first-name',
            'Ada',
            '--admin-last-name',
            'Lovelace',
          ],
          parent,
        );
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('--no-storefront');
        expect(result.stderr).toContain('Nothing was written');
        const { existsSync } = await import('node:fs');
        expect(existsSync(dir)).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );

  it(
    'both demo flags at once is a refusal rather than a precedence rule',
    async () => {
      const { dir, parent } = target();
      try {
        const result = await run(
          ['install', dir, '--demo', '--no-demo', '--no-storefront'],
          parent,
        );
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('two answers to one question');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS + 15_000,
  );
});
