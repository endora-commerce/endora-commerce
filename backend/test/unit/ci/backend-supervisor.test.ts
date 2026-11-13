import { spawn as spawnProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * Issue #596 — a backend container that is alive but no longer answering is
 * restarted, as the storefront's has been since #152.
 *
 * The backend image's command is a supervising parent,
 * `backend/scripts/supervise.mjs`, and that file is the **second copy** of
 * `storefront/scripts/supervise.mjs` (architect ruling, 2026-11-13): each image
 * carries only its own tree, so neither can read the other's. Two copies of one
 * piece of logic drift unless something holds them together, and this file is
 * that something — everything outside each file's *profile* block (the service
 * name, the environment prefix, the port, the probe path and the kill grace)
 * must be byte-identical. The logic itself is pinned once, by
 * `storefront/test/supervise.test.ts`; what is pinned here is the backend's
 * profile, and the real script run against a fake child.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_SCRIPT = join(REPO_ROOT, 'backend/scripts/supervise.mjs');
const STOREFRONT_SCRIPT = join(REPO_ROOT, 'storefront/scripts/supervise.mjs');

const PROFILE_START = '// ── profile: the only lines the two copies may differ in ──';
const PROFILE_END = '// ── end of profile ──';

interface SupervisorModule {
  readonly supervisorConfig: (env: Record<string, string | undefined>) => {
    readonly probe: boolean;
    readonly probeUrl: string;
    readonly intervalMs: number;
    readonly timeoutMs: number;
    readonly failures: number;
    readonly startGraceMs: number;
    readonly killGraceMs: number;
  };
  readonly SUPERVISOR_ENV: Readonly<Record<string, string>>;
  readonly WATCHDOG_EXIT_CODE: number;
  readonly EXIT_AFTER_KILL_MS: number;
}

async function load(path: string): Promise<SupervisorModule> {
  return (await import(pathToFileURL(path).href)) as SupervisorModule;
}

/** The file with its profile block cut out, and the block itself. */
function split(path: string): { readonly shared: string; readonly profile: string } {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(PROFILE_START);
  const end = text.indexOf(PROFILE_END);
  expect(start, `${path} has no profile start marker`).toBeGreaterThan(-1);
  expect(end, `${path} has no profile end marker`).toBeGreaterThan(start);
  expect(text.indexOf(PROFILE_START, start + 1), `${path} has two profile blocks`).toBe(-1);
  return {
    shared: text.slice(0, start) + text.slice(end),
    profile: text.slice(start, end),
  };
}

/** The `const` names a profile block declares, in order. */
function declared(profile: string): readonly string[] {
  return [...profile.matchAll(/^const (\w+) =/gm)].map((match) => match[1]!);
}

describe('backend/scripts/supervise.mjs — the second copy of the storefront supervisor', () => {
  it('exists', () => {
    expect(existsSync(BACKEND_SCRIPT), `${BACKEND_SCRIPT} does not exist`).toBe(true);
  });

  it('is byte-identical to the storefront copy outside the profile block', () => {
    const backend = split(BACKEND_SCRIPT);
    const storefront = split(STOREFRONT_SCRIPT);
    expect(
      backend.shared,
      'a change to one supervisor is a change to both: copy it across, keeping each profile',
    ).toBe(storefront.shared);
  });

  it('declares the same profile constants in both copies, so the shared body reads the same names', () => {
    const backend = declared(split(BACKEND_SCRIPT).profile);
    expect(backend.length).toBeGreaterThan(0);
    expect(backend).toEqual(declared(split(STOREFRONT_SCRIPT).profile));
  });
});

describe('the backend profile', () => {
  it('probes /api/v1/_health on the port the backend binds, with a 5 s timeout and a 25 s kill grace', async () => {
    const { supervisorConfig } = await load(BACKEND_SCRIPT);
    expect(supervisorConfig({})).toEqual({
      probe: true,
      probeUrl: 'http://127.0.0.1:3001/api/v1/_health',
      intervalMs: 10_000,
      timeoutMs: 5_000,
      failures: 3,
      startGraceMs: 30_000,
      // Room for BullMQ's drain on SIGTERM; see `stop_grace_period` below.
      killGraceMs: 25_000,
    });
    expect(supervisorConfig({ PORT: '4100' }).probeUrl).toBe(
      'http://127.0.0.1:4100/api/v1/_health',
    );
  });

  it('reads BACKEND_SUPERVISOR_* and leaves the storefront variables alone', async () => {
    const { supervisorConfig, SUPERVISOR_ENV } = await load(BACKEND_SCRIPT);
    for (const name of Object.values(SUPERVISOR_ENV)) {
      expect(name).toMatch(/^BACKEND_SUPERVISOR_[A-Z_]+$/);
    }
    expect(supervisorConfig({ BACKEND_SUPERVISOR_PROBE: 'off' }).probe).toBe(false);
    expect(supervisorConfig({ STOREFRONT_SUPERVISOR_PROBE: 'off' }).probe).toBe(true);
    expect(supervisorConfig({ BACKEND_SUPERVISOR_KILL_GRACE_SECONDS: '12' }).killGraceMs).toBe(
      12_000,
    );
  });

  it('kills and gives up inside the compose stop timeout, so `docker stop` never SIGKILLs a draining backend first', async () => {
    const { supervisorConfig, EXIT_AFTER_KILL_MS } = await load(BACKEND_SCRIPT);
    const compose = readFileSync(join(REPO_ROOT, 'deploy/compose.prod.yml'), 'utf8');
    const block = /^ {2}backend:\n((?: {4}.*\n|\s*\n| *#.*\n)*)/m.exec(compose)?.[1] ?? '';
    const grace = /^ {4}stop_grace_period:\s*(\d+)s\s*$/m.exec(block);
    expect(grace, 'the backend service declares no `stop_grace_period`').not.toBeNull();
    const stopMs = Number(grace![1]) * 1000;
    expect(supervisorConfig({}).killGraceMs + EXIT_AFTER_KILL_MS).toBeLessThanOrEqual(stopMs);
  });
});

// ── the real script, against a fake backend ─────────────────────────────────

describe('the backend supervisor, run for real against a fake child', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
      });
    });
  }

  function childFile(lines: readonly string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'backend-supervise-'));
    dirs.push(dir);
    const file = join(dir, 'index.mjs');
    writeFileSync(file, lines.join('\n'));
    return file;
  }

  function launch(child: string, env: Record<string, string>) {
    const began = Date.now();
    const proc = spawnProcess(process.execPath, [BACKEND_SCRIPT, child], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout.on('data', (chunk) => (output += String(chunk)));
    proc.stderr.on('data', (chunk) => (output += String(chunk)));
    const exited = new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
      proc.on('exit', (code) => resolve({ code, elapsedMs: Date.now() - began }));
    });
    const waitFor = (pattern: RegExp): Promise<void> =>
      new Promise((resolve) => {
        const wait = setInterval(() => {
          if (pattern.test(output)) {
            clearInterval(wait);
            resolve();
          }
        }, 25);
      });
    return { proc, exited, waitFor, output: () => output };
  }

  const FAST = {
    BACKEND_SUPERVISOR_INTERVAL_SECONDS: '0.2',
    BACKEND_SUPERVISOR_TIMEOUT_SECONDS: '0.2',
    BACKEND_SUPERVISOR_FAILURES: '3',
    BACKEND_SUPERVISOR_START_GRACE_SECONDS: '5',
    BACKEND_SUPERVISOR_KILL_GRACE_SECONDS: '0.5',
  };

  it('kills a backend that answers its health route and then blocks its loop, and exits non-zero', async () => {
    const { WATCHDOG_EXIT_CODE } = await load(BACKEND_SCRIPT);
    const port = await freePort();
    const child = childFile([
      "import { createServer } from 'node:http';",
      "process.on('SIGTERM', () => {});",
      'createServer((req, res) => {',
      "  res.statusCode = req.url === '/api/v1/_health' ? 200 : 404;",
      "  res.end('ok');",
      "}).listen(Number(process.env.PORT), '127.0.0.1');",
      'setTimeout(() => { for (;;) {} }, 1000);',
    ]);
    const run = launch(child, { ...FAST, PORT: String(port) });
    const result = await run.exited;
    expect(result.code, run.output()).toBe(WATCHDOG_EXIT_CODE);
    expect(run.output()).toMatch(/^backend-supervisor: /m);
    expect(run.output()).toMatch(/\/api\/v1\/_health; sending SIGTERM/);
    expect(run.output()).toMatch(/sending SIGKILL/);
    expect(result.elapsedMs).toBeLessThan(10_000);
  }, 20_000);

  it('leaves a backend alone whose health route answers 503 — a dependency outage is not a hang', async () => {
    const port = await freePort();
    const child = childFile([
      "import { createServer } from 'node:http';",
      'const s = createServer((_, res) => { res.statusCode = 503; res.end(); })',
      "  .listen(Number(process.env.PORT), '127.0.0.1');",
      "process.on('SIGTERM', () => s.close(() => process.exit(0)));",
    ]);
    const run = launch(child, { ...FAST, PORT: String(port) });
    await run.waitFor(/answered its first probe/);
    // Ten probe intervals' worth of 503s.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // A probe before the child listens is inside the start grace and not counted.
    expect(run.output()).not.toMatch(/probe failed \(/);
    run.proc.kill('SIGTERM');
    expect((await run.exited).code, run.output()).toBe(0);
  }, 20_000);

  it('forwards SIGTERM and waits for a draining backend to exit by itself, rather than killing it', async () => {
    const port = await freePort();
    // A drain that takes 1.5 s — longer than the probe interval, shorter than the grace.
    const child = childFile([
      "import { createServer } from 'node:http';",
      "const s = createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');",
      "process.on('SIGTERM', () => { s.close(); setTimeout(() => process.exit(0), 1500); });",
    ]);
    const run = launch(child, {
      ...FAST,
      BACKEND_SUPERVISOR_KILL_GRACE_SECONDS: '10',
      PORT: String(port),
    });
    await run.waitFor(/answered its first probe/);
    run.proc.kill('SIGTERM');
    const result = await run.exited;
    expect(result.code, run.output()).toBe(0);
    expect(run.output()).toMatch(/received SIGTERM/);
    expect(run.output()).not.toMatch(/SIGKILL/);
    // A probe before the child listens is inside the start grace and not counted.
    expect(run.output()).not.toMatch(/probe failed \(/);
  }, 20_000);
});
