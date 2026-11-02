import { spawn as spawnProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SupervisorConfigError,
  WATCHDOG_EXIT_CODE,
  supervise,
  supervisorConfig,
} from '../scripts/supervise.mjs';

/**
 * Issue #152 — a storefront container that is alive but unresponsive is never
 * restarted.
 *
 * Docker restarts a container whose process has **exited**; an `unhealthy` one
 * is left as it is. So the image's command is a supervising parent
 * (`scripts/supervise.mjs`) that runs the Next.js server as its child, asks it
 * over HTTP whether it still answers, and after a run of unanswered probes
 * kills it and exits non-zero — which `restart: unless-stopped` turns into a
 * fresh container. These cases pin that logic with the child process, `fetch`
 * and the clock injected; the last block runs the real script against a real
 * child whose event loop is blocked.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/supervise.mjs', import.meta.url));

// ── configuration ───────────────────────────────────────────────────────────

describe('supervisorConfig — what the environment configures', () => {
  it('has defaults that need no variable at all, probing the port the server binds', () => {
    expect(supervisorConfig({})).toEqual({
      probe: true,
      probeUrl: 'http://127.0.0.1:3000/robots.txt',
      intervalMs: 10_000,
      timeoutMs: 5_000,
      failures: 3,
      startGraceMs: 30_000,
      killGraceMs: 5_000,
    });
    expect(supervisorConfig({ PORT: '4100' }).probeUrl).toBe('http://127.0.0.1:4100/robots.txt');
  });

  it('reads every override', () => {
    expect(
      supervisorConfig({
        STOREFRONT_SUPERVISOR_PROBE: 'on',
        STOREFRONT_SUPERVISOR_PROBE_URL: 'http://127.0.0.1:3000/',
        STOREFRONT_SUPERVISOR_INTERVAL_SECONDS: '15',
        STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS: '2.5',
        STOREFRONT_SUPERVISOR_FAILURES: '5',
        STOREFRONT_SUPERVISOR_START_GRACE_SECONDS: '0',
        STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS: '8',
      }),
    ).toEqual({
      probe: true,
      probeUrl: 'http://127.0.0.1:3000/',
      intervalMs: 15_000,
      timeoutMs: 2_500,
      failures: 5,
      startGraceMs: 0,
      killGraceMs: 8_000,
    });
  });

  it('switches the probe off, and only with a word that means off', () => {
    for (const off of ['off', 'OFF', 'false', '0', 'no']) {
      expect(supervisorConfig({ STOREFRONT_SUPERVISOR_PROBE: off }).probe).toBe(false);
    }
    for (const on of ['on', 'true', '1', 'yes', '']) {
      expect(supervisorConfig({ STOREFRONT_SUPERVISOR_PROBE: on }).probe).toBe(true);
    }
  });

  it('refuses a value it cannot read, naming the variable, rather than guessing', () => {
    const refused: Array<[string, string]> = [
      ['STOREFRONT_SUPERVISOR_PROBE', 'sometimes'],
      ['STOREFRONT_SUPERVISOR_PROBE_URL', '/robots.txt'],
      ['STOREFRONT_SUPERVISOR_PROBE_URL', 'ftp://127.0.0.1/'],
      ['STOREFRONT_SUPERVISOR_INTERVAL_SECONDS', '0'],
      ['STOREFRONT_SUPERVISOR_INTERVAL_SECONDS', 'ten'],
      ['STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS', '-1'],
      ['STOREFRONT_SUPERVISOR_FAILURES', '1.5'],
      ['STOREFRONT_SUPERVISOR_FAILURES', '0'],
      ['STOREFRONT_SUPERVISOR_START_GRACE_SECONDS', '-5'],
      ['STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS', 'soon'],
      ['PORT', 'http'],
    ];
    for (const [name, value] of refused) {
      expect(() => supervisorConfig({ [name]: value }), `${name}=${value}`).toThrow(
        SupervisorConfigError,
      );
      expect(() => supervisorConfig({ [name]: value })).toThrow(name);
    }
  });
});

// ── the supervision logic, with everything injected ─────────────────────────

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly signals: string[] = [];
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill(signal: string): boolean {
    this.signals.push(signal);
    return true;
  }
  /** The child ends, as the kernel would report it. */
  end(code: number | null, signal: string | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

type Answer = 'ok' | 'refused' | 'hang' | number;

interface Harness {
  readonly child: FakeChild;
  readonly lines: string[];
  readonly exits: number[];
  readonly spawned: Array<{ command: string; args: readonly string[]; options: unknown }>;
  readonly probes: string[];
  /** What the next probes answer, in order; the last one repeats. */
  answers: Answer[];
  signal(name: 'SIGTERM' | 'SIGINT' | 'SIGHUP'): void;
}

interface Config {
  readonly probe: boolean;
  readonly probeUrl: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly failures: number;
  readonly startGraceMs: number;
  readonly killGraceMs: number;
}

const BASE: Config = {
  probe: true,
  probeUrl: 'http://127.0.0.1:3000/robots.txt',
  intervalMs: 1_000,
  timeoutMs: 500,
  failures: 3,
  startGraceMs: 0,
  killGraceMs: 2_000,
};

function start(config: Partial<Config> = {}, answers: Answer[] = ['ok']): Harness {
  const child = new FakeChild();
  const handlers = new Map<string, () => void>();
  const harness: Harness = {
    child,
    lines: [],
    exits: [],
    spawned: [],
    probes: [],
    answers,
    signal: (name) => handlers.get(name)?.(),
  };
  supervise({
    config: { ...BASE, ...config },
    command: '/usr/local/bin/node',
    args: ['storefront/server.js'],
    spawn: (command: string, args: readonly string[], options: unknown) => {
      harness.spawned.push({ command, args, options });
      return child;
    },
    fetch: (url: string) => {
      harness.probes.push(url);
      const answer = harness.answers.length > 1 ? harness.answers.shift()! : harness.answers[0]!;
      if (answer === 'hang') return new Promise(() => {});
      if (answer === 'refused') return Promise.reject(new TypeError('fetch failed'));
      const status = answer === 'ok' ? 200 : answer;
      return Promise.resolve({ status, body: null });
    },
    timers: {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
      now: () => Date.now(),
    },
    log: (line: string) => harness.lines.push(line),
    exit: (code: number) => harness.exits.push(code),
    onSignal: (name: string, handler: () => void) => handlers.set(name, handler),
  });
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('supervise — the child', () => {
  it('runs the server as its child, on the same interpreter, with the container’s stdio', () => {
    const h = start();
    expect(h.spawned).toEqual([
      { command: '/usr/local/bin/node', args: ['storefront/server.js'], options: { stdio: 'inherit' } },
    ]);
  });

  it('exits with the child’s own code when the child ends by itself', () => {
    const h = start();
    h.child.end(3);
    expect(h.exits).toEqual([3]);
  });

  it('exits 128 + the signal number when the child was ended by a signal', () => {
    const h = start();
    h.child.end(null, 'SIGSEGV');
    expect(h.exits).toEqual([128 + 11]);
  });

  it('exits non-zero when the child cannot be started at all', () => {
    const h = start();
    h.child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(h.exits).toEqual([1]);
  });
});

describe('supervise — the liveness probe', () => {
  it('leaves a child that answers alone', async () => {
    const h = start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.probes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(h.probes)).toEqual(new Set(['http://127.0.0.1:3000/robots.txt']));
    expect(h.child.signals).toEqual([]);
    expect(h.exits).toEqual([]);
  });

  it('counts any HTTP status as an answer — a 503 for a backend outage is the process alive', async () => {
    const h = start({}, [503, 500, 404, 302]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.child.signals).toEqual([]);
  });

  it('kills the child after N consecutive failures, SIGTERM first, and exits non-zero', async () => {
    const h = start({}, ['ok', 'refused']);
    await vi.advanceTimersByTimeAsync(1_000); // probe 1: ok
    await vi.advanceTimersByTimeAsync(3_000); // probes 2–4: three failures
    expect(h.child.signals).toEqual(['SIGTERM']);
    expect(h.exits).toEqual([]);
    h.child.end(0);
    expect(h.exits).toEqual([WATCHDOG_EXIT_CODE]);
    expect(WATCHDOG_EXIT_CODE).not.toBe(0);
  });

  it('follows with SIGKILL when the child ignores SIGTERM — a starved loop never runs its handler', async () => {
    const h = start({}, ['refused']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.child.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.child.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    h.child.end(null, 'SIGKILL');
    expect(h.exits).toEqual([WATCHDOG_EXIT_CODE]);
  });

  it('exits anyway when even SIGKILL is not reported back, so the container still ends', async () => {
    const h = start({}, ['refused']);
    await vi.advanceTimersByTimeAsync(3_000 + 2_000);
    expect(h.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.exits).toEqual([WATCHDOG_EXIT_CODE]);
  });

  it('reads a probe that gets no answer within the timeout as a failure', async () => {
    const h = start({}, ['hang']);
    await vi.advanceTimersByTimeAsync(3 * (1_000 + 500));
    expect(h.child.signals).toEqual(['SIGTERM']);
    expect(h.lines.some((line) => /no answer within 500 ms/.test(line))).toBe(true);
  });

  it('never probes twice at once: the next probe waits for the last one plus the interval', async () => {
    const h = start({}, ['hang']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.probes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(h.probes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.probes).toHaveLength(2);
  });

  it('resets the count on an answer, so only a consecutive run kills', async () => {
    const h = start({}, ['refused', 'refused', 'ok', 'refused', 'refused', 'ok']);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.child.signals).toEqual([]);
    expect(h.lines.some((line) => /answered again after 2 failed probes/.test(line))).toBe(true);
  });

  it('does not count failures inside the start grace, and counts them after it', async () => {
    const h = start({ startGraceMs: 10_000 }, ['refused']);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(h.child.signals).toEqual([]);
    expect(h.lines.some((line) => /start grace/.test(line))).toBe(true);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(h.child.signals).toEqual(['SIGTERM']);
  });

  it('ends the start grace at the first answer', async () => {
    const h = start({ startGraceMs: 60_000 }, ['ok', 'refused']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.child.signals).toEqual(['SIGTERM']);
  });

  it('never probes when the probe is switched off, and still supervises the child', async () => {
    const h = start({ probe: false }, ['refused']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.probes).toEqual([]);
    expect(h.lines.some((line) => /probe is off/.test(line))).toBe(true);
    h.child.end(2);
    expect(h.exits).toEqual([2]);
  });

  it('stops probing once the child has exited', async () => {
    const h = start({}, ['ok']);
    await vi.advanceTimersByTimeAsync(1_000);
    h.child.end(0);
    const before = h.probes.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.probes).toHaveLength(before);
  });
});

describe('supervise — signals', () => {
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    it(`forwards ${name} to the child and exits with the child’s code`, () => {
      const h = start();
      h.signal(name);
      expect(h.child.signals).toEqual([name]);
      h.child.end(0);
      expect(h.exits).toEqual([0]);
    });
  }

  it('stops probing during a shutdown, so a slow stop is not read as a hang', async () => {
    const h = start({}, ['refused']);
    h.signal('SIGTERM');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.probes).toEqual([]);
    expect(h.child.signals).toEqual(['SIGTERM']);
  });

  it('kills a child that does not stop within the kill grace, and reports the signal it died of', async () => {
    const h = start();
    h.signal('SIGTERM');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    h.child.end(null, 'SIGKILL');
    expect(h.exits).toEqual([128 + 9]);
  });

  it('forwards a second signal rather than starting a second kill timer', async () => {
    const h = start();
    h.signal('SIGTERM');
    h.signal('SIGINT');
    expect(h.child.signals).toEqual(['SIGTERM', 'SIGINT']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.child.signals).toEqual(['SIGTERM', 'SIGINT', 'SIGKILL']);
  });
});

describe('supervise — the log', () => {
  it('writes every decision on exactly one line, under one prefix', async () => {
    const h = start({ startGraceMs: 1_500 }, ['refused', 'refused', 'ok', 'refused']);
    await vi.advanceTimersByTimeAsync(10_000);
    h.child.end(null, 'SIGKILL');
    expect(h.lines.length).toBeGreaterThanOrEqual(6);
    for (const line of h.lines) {
      expect(line).not.toMatch(/\n/);
      expect(line).toMatch(/^storefront-supervisor: /);
    }
    const text = h.lines.join('\n');
    expect(text).toMatch(/started the server/);
    expect(text).toMatch(/probe failed \(1\/3\)/);
    expect(text).toMatch(/sending SIGTERM/);
    expect(text).toMatch(/exiting with 1/);
  });
});

// ── the real script, against a real child ───────────────────────────────────

describe('the script, run for real against a server whose event loop is blocked', () => {
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

  function run(
    child: string,
    env: Record<string, string>,
  ): Promise<{ code: number | null; output: string; elapsedMs: number }> {
    const dir = mkdtempSync(join(tmpdir(), 'supervise-'));
    dirs.push(dir);
    const server = join(dir, 'server.mjs');
    writeFileSync(server, child);
    const began = Date.now();
    return new Promise((resolve) => {
      const proc = spawnProcess(process.execPath, [SCRIPT, server], {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      proc.stdout.on('data', (chunk) => (output += String(chunk)));
      proc.stderr.on('data', (chunk) => (output += String(chunk)));
      proc.on('exit', (code) => resolve({ code, output, elapsedMs: Date.now() - began }));
    });
  }

  const FAST = {
    STOREFRONT_SUPERVISOR_INTERVAL_SECONDS: '0.2',
    STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS: '0.2',
    STOREFRONT_SUPERVISOR_FAILURES: '3',
    STOREFRONT_SUPERVISOR_START_GRACE_SECONDS: '5',
    STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS: '0.5',
  };

  it('kills a child that answers and then blocks its loop, and exits non-zero', async () => {
    vi.useRealTimers();
    const port = await freePort();
    // Answers for a second, then spins forever: alive, listening, unresponsive.
    // It also ignores SIGTERM, as a starved loop does.
    const result = await run(
      [
        "import { createServer } from 'node:http';",
        "process.on('SIGTERM', () => {});",
        "createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');",
        'setTimeout(() => { for (;;) {} }, 1000);',
      ].join('\n'),
      { ...FAST, PORT: String(port) },
    );
    expect(result.code, result.output).toBe(WATCHDOG_EXIT_CODE);
    expect(result.output).toMatch(/probe failed \(3\/3\)/);
    expect(result.output).toMatch(/sending SIGTERM/);
    expect(result.output).toMatch(/sending SIGKILL/);
    expect(result.elapsedMs).toBeLessThan(10_000);
  }, 20_000);

  it('forwards SIGTERM to a healthy child and exits with its code', async () => {
    vi.useRealTimers();
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'supervise-'));
    dirs.push(dir);
    const server = join(dir, 'server.mjs');
    writeFileSync(
      server,
      [
        "import { createServer } from 'node:http';",
        "const s = createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');",
        "process.on('SIGTERM', () => s.close(() => process.exit(0)));",
      ].join('\n'),
    );
    const proc = spawnProcess(process.execPath, [SCRIPT, server], {
      env: { ...process.env, ...FAST, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout.on('data', (chunk) => (output += String(chunk)));
    proc.stderr.on('data', (chunk) => (output += String(chunk)));
    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (/answered/.test(output)) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
    });
    const code = await new Promise<number | null>((resolve) => {
      proc.on('exit', (exitCode) => resolve(exitCode));
      proc.kill('SIGTERM');
    });
    expect(code, output).toBe(0);
    expect(output).toMatch(/received SIGTERM/);
  }, 20_000);

  it('refuses to start on a configuration it cannot read', async () => {
    vi.useRealTimers();
    const result = await run('', { STOREFRONT_SUPERVISOR_FAILURES: 'many' });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/STOREFRONT_SUPERVISOR_FAILURES/);
  }, 20_000);
});
