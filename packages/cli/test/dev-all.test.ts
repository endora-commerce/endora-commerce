/**
 * `pnpm run dev:all` — one development command over the three layers
 * (`specs/136-open-source-publication/spec.md` GAP-7, FR-060, FR-061; plan
 * W5.3; research R-10).
 *
 * ## What was measured before it existed
 *
 * `endora install` ended by printing three commands for three terminals — the
 * API, the admin preview and the storefront — so the shortest path from a
 * finished install to seeing all three layers was three shells. Medusa's one
 * command ends with a running server.
 *
 * ## What this file holds the supervisor to
 *
 * FR-060: it starts the API, the admin preview and, when present, the
 * storefront, in the foreground; an interrupt stops all three; a failure in any
 * one stops the others and names which. Every one of those is a property of
 * real processes, so the supervisor cases spawn real ones — a stub `spawn`
 * would pass while a backgrounded grandchild (the instance's own `dev` script
 * is `tsc --watch & node --watch …`) survived the stop.
 *
 * FR-061: nothing per-layer changes. The build, start and preview scripts keep
 * their values, and the composite is a supervisor over them rather than a
 * replacement for any of them — D-230's three deployable artefacts are
 * untouched, and feature 122's assertions in `new-instance.test.ts` are not
 * edited by this change.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DevHostError,
  DevInputError,
  DEV_ALL_SCRIPT,
  planDev,
  superviseDev,
  type SupervisedProcess,
} from '../src/dev/index.js';
import { planInstance, type PlanInput } from '../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';
const ENDORA = fileURLToPath(new URL('../dist/bin/endora.js', import.meta.url));

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map(),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    declared: [],
    existingEnv: '',
    generated: new Map(),
    ...overrides,
  };
}

function withAdminMember(overrides: Partial<PlanInput> = {}): PlanInput {
  return planInput({
    adminShellVersion: '4.5.6',
    adminKitVersion: '4.5.6',
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map(),
    ...overrides,
  });
}

function rootManifest(input: PlanInput): {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(
    planInstance(input).files.find((file) => file.path === 'package.json')!.content,
  ) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
}

/** An instance on disk: a root manifest with the scripts `planDev` reads. */
function instanceOnDisk(
  root: string,
  scripts: Record<string, string>,
  name = 'acme-shop',
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts }), 'utf8');
  return dir;
}

function storefrontOnDisk(dir: string, scripts: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'acme-shop-storefront', scripts }),
    'utf8',
  );
  return dir;
}

/** Is a process with this pid still alive? */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `check` holds or the deadline passes. */
async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/**
 * A node one-liner as a supervised process. `pidFile` receives the pid of the
 * process the supervisor spawned, so a case can ask afterwards whether it is
 * gone.
 */
function nodeProcess(label: string, cwd: string, code: string): SupervisedProcess {
  return { label, cwd, bin: process.execPath, argv: ['-e', code] };
}

const RUN_FOREVER = 'setInterval(() => {}, 1000);';

// ---------------------------------------------------------------------------
// FR-060 / FR-061 — the root script, in the template
// ---------------------------------------------------------------------------

describe('FR-060 — a scaffolded instance offers one root script for all three layers', () => {
  it('declares `dev:all`, and it runs the CLI the instance already declares', () => {
    for (const input of [planInput(), withAdminMember()]) {
      const manifest = rootManifest(input);
      expect(manifest.scripts[DEV_ALL_SCRIPT]).toBe('endora dev');
      // The supervisor is the CLI's, so the binary has to be on the root's own
      // path — the same reason `generate` needs it.
      expect(manifest.devDependencies[`${SCOPE}cli`]).toBeDefined();
    }
  });

  it('FR-061 — changes no per-layer build, start or preview script', () => {
    // The values feature 122 and 125 T1-G/T1-H assert elsewhere, restated here
    // only as "unchanged by the composite": a supervisor that re-decided what a
    // layer runs would be D-230's topology fused through a development script.
    const scripts = rootManifest(withAdminMember()).scripts;
    expect(scripts['build:backend']).toBe('pnpm -C backend run build');
    expect(scripts['build:admin']).toBe('pnpm -C admin run build');
    expect(scripts['start']).toBe('pnpm -C backend run start');
    expect(scripts['preview:admin']).toBe('pnpm -C admin run preview');
    expect(scripts['dev']).toBe('pnpm -C backend run dev');
    expect(Object.values(scripts).filter((value) => value.includes('endora dev'))).toEqual([
      'endora dev',
    ]);
  });

  it('the README names it, in the command block a client reads', () => {
    const readme = planInstance(withAdminMember()).files.find(
      (file) => file.path === 'README.md',
    )!.content;
    expect(readme).toMatch(/^pnpm run dev:all\s+# /m);
  });
});

// ---------------------------------------------------------------------------
// What it starts — decided from the tree, never from a list of members
// ---------------------------------------------------------------------------

describe('planDev — the layers it starts are the ones this tree has', () => {
  it('the API, the admin preview and the sibling storefront when all three are there', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, {
      start: 'pnpm -C backend run start',
      'preview:admin': 'pnpm -C admin run preview',
    });
    const storefront = storefrontOnDisk(join(root, 'acme-shop-storefront'), { dev: 'next dev' });
    const plan = planDev({ cwd: instance });
    expect(plan.processes.map((entry) => [entry.label, entry.cwd, entry.script])).toEqual([
      ['api', instance, 'start'],
      ['admin', instance, 'preview:admin'],
      ['storefront', storefront, 'dev'],
    ]);
    expect(plan.storefrontDir).toBe(storefront);
  });

  it('no storefront beside it is not a refusal: FR-060 says "when present"', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, {
      start: 'pnpm -C backend run start',
      'preview:admin': 'pnpm -C admin run preview',
    });
    const plan = planDev({ cwd: instance });
    expect(plan.processes.map((entry) => entry.label)).toEqual(['api', 'admin']);
    expect(plan.storefrontDir).toBeNull();
    expect(plan.notes.join('\n')).toContain('--storefront-dir');
  });

  it('an instance with no admin member starts no admin preview, and says so', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { start: 'pnpm -C backend run start' });
    const plan = planDev({ cwd: instance, storefront: false });
    expect(plan.processes.map((entry) => entry.label)).toEqual(['api']);
    expect(plan.notes.join('\n')).toContain('preview:admin');
  });

  it('`--storefront-dir` names a storefront somewhere else, relative to where it was typed', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { start: 'x' });
    const storefront = storefrontOnDisk(join(root, 'shops', 'front'), { dev: 'next dev' });
    const plan = planDev({ cwd: instance, storefront: '../shops/front' });
    expect(plan.storefrontDir).toBe(storefront);
    expect(plan.processes.at(-1)!.label).toBe('storefront');
  });

  it('a `--storefront-dir` that holds no storefront is a refusal naming the flag', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { start: 'x' });
    expect(() => planDev({ cwd: instance, storefront: '../nowhere' })).toThrow(DevInputError);
    expect(() => planDev({ cwd: instance, storefront: '../nowhere' })).toThrow(
      /--storefront-dir/,
    );
  });

  it('a storefront with no `dev` script is a refusal, not a silently missing layer', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { start: 'x' });
    storefrontOnDisk(join(root, 'acme-shop-storefront'), { build: 'next build' });
    expect(() => planDev({ cwd: instance })).toThrow(DevInputError);
  });

  it('`--no-storefront` leaves a present storefront alone', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { start: 'x' });
    storefrontOnDisk(join(root, 'acme-shop-storefront'), { dev: 'next dev' });
    const plan = planDev({ cwd: instance, storefront: false });
    expect(plan.processes.map((entry) => entry.label)).toEqual(['api']);
  });

  it('outside an instance it is exit-2 territory: there is no manifest to read', () => {
    const root = temp('dev-plan-');
    expect(() => planDev({ cwd: root })).toThrow(DevHostError);
  });

  it('a root manifest with no `start` is a refusal: there is no API to start', () => {
    const root = temp('dev-plan-');
    const instance = instanceOnDisk(root, { build: 'x' });
    expect(() => planDev({ cwd: instance })).toThrow(DevInputError);
  });
});

// ---------------------------------------------------------------------------
// FR-060 — the supervisor, over real processes
// ---------------------------------------------------------------------------

describe('superviseDev — one foreground, one stop, and the failing layer named', () => {
  it('a failure in one stops the others, names which, and exits with its code', async () => {
    const dir = temp('dev-run-');
    const pids = join(dir, 'pids');
    mkdirSync(pids);
    const record = (label: string): string =>
      `require('fs').writeFileSync(${JSON.stringify(join(pids, label))}, String(process.pid));`;
    const lines: string[] = [];
    const code = await superviseDev(
      [
        nodeProcess('api', dir, `${record('api')} ${RUN_FOREVER}`),
        nodeProcess('admin', dir, `${record('admin')} ${RUN_FOREVER}`),
        nodeProcess(
          'storefront',
          dir,
          // Wait for the other two to have started, so the stop is what ends
          // them rather than never having started them.
          `const fs = require('fs'); const t = setInterval(() => {` +
            ` if (fs.readdirSync(${JSON.stringify(pids)}).length >= 2) {` +
            ` clearInterval(t); console.error('boom'); process.exit(3); } }, 20);`,
        ),
      ],
      { write: (line) => lines.push(line), graceMs: 2_000 },
    );
    expect(code).toBe(3);
    const output = lines.join('\n');
    expect(output).toContain('[storefront] boom');
    expect(output).toMatch(/storefront exited with code 3/);
    expect(output).toMatch(/stopping api, admin/);
    for (const label of ['api', 'admin']) {
      const pid = Number(readFileSync(join(pids, label), 'utf8'));
      expect(await eventually(() => !alive(pid)), `${label} (${String(pid)}) survived the stop`).toBe(
        true,
      );
    }
  });

  it('an interrupt stops every layer and is a clean exit — the operator asked for it', async () => {
    const dir = temp('dev-run-');
    const pidFile = join(dir, 'api.pid');
    const controller = new AbortController();
    const lines: string[] = [];
    const running = superviseDev(
      [
        nodeProcess(
          'api',
          dir,
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${RUN_FOREVER}`,
        ),
        nodeProcess('admin', dir, RUN_FOREVER),
      ],
      { write: (line) => lines.push(line), signal: controller.signal, graceMs: 2_000 },
    );
    expect(await eventually(() => existsSync(pidFile))).toBe(true);
    controller.abort();
    expect(await running).toBe(0);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(await eventually(() => !alive(pid))).toBe(true);
    expect(lines.join('\n')).toMatch(/stopping api, admin/);
  });

  it('a backgrounded grandchild is stopped with its parent — the `tsc --watch &` case', async () => {
    if (process.platform === 'win32') return;
    const dir = temp('dev-run-');
    const grandchildPid = join(dir, 'grandchild.pid');
    const controller = new AbortController();
    const running = superviseDev(
      [
        {
          label: 'api',
          cwd: dir,
          bin: 'sh',
          argv: [
            '-c',
            // The shape of the instance's own `dev`: one process sent to the
            // background, one in the foreground. Killing only the shell's pid
            // leaves the first one running with nobody to stop it.
            `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
              `require('fs').writeFileSync(${JSON.stringify(grandchildPid)}, String(process.pid)); ${RUN_FOREVER}`,
            )} & ${JSON.stringify(process.execPath)} -e ${JSON.stringify(RUN_FOREVER)}`,
          ],
        },
      ],
      { write: () => undefined, signal: controller.signal, graceMs: 2_000 },
    );
    expect(await eventually(() => existsSync(grandchildPid))).toBe(true);
    controller.abort();
    expect(await running).toBe(0);
    const pid = Number(readFileSync(grandchildPid, 'utf8'));
    expect(await eventually(() => !alive(pid)), 'the backgrounded process survived').toBe(true);
  });

  it('a layer that ignores the polite stop is stopped anyway once the grace runs out', async () => {
    const dir = temp('dev-run-');
    const pidFile = join(dir, 'stubborn.pid');
    const controller = new AbortController();
    const running = superviseDev(
      [
        nodeProcess(
          'api',
          dir,
          `process.on('SIGTERM', () => {}); process.on('SIGINT', () => {});` +
            ` require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ${RUN_FOREVER}`,
        ),
      ],
      { write: () => undefined, signal: controller.signal, graceMs: 300 },
    );
    expect(await eventually(() => existsSync(pidFile))).toBe(true);
    controller.abort();
    expect(await running).toBe(0);
    expect(await eventually(() => !alive(Number(readFileSync(pidFile, 'utf8'))))).toBe(true);
  });

  it('a layer that ends on its own is a stop too — a server that returned is not running', async () => {
    const dir = temp('dev-run-');
    const lines: string[] = [];
    const code = await superviseDev(
      [nodeProcess('api', dir, RUN_FOREVER), nodeProcess('admin', dir, 'process.exit(0)')],
      { write: (line) => lines.push(line), graceMs: 2_000 },
    );
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/admin exited with code 0/);
  });

  it('every line a layer prints reaches the one terminal, prefixed with the layer', async () => {
    const dir = temp('dev-run-');
    const lines: string[] = [];
    await superviseDev(
      [nodeProcess('api', dir, "console.log('listening'); console.error('warned'); process.exit(5)")],
      { write: (line) => lines.push(line), graceMs: 2_000 },
    );
    expect(lines).toContain('[api] listening');
    expect(lines).toContain('[api] warned');
  });
});

// ---------------------------------------------------------------------------
// The argv layer — `endora dev`
// ---------------------------------------------------------------------------

describe('`endora dev` — the verb `dev:all` runs', () => {
  it('outside an instance it exits 2 and asks nothing', () => {
    const root = temp('dev-cli-');
    const result = spawnSync(process.execPath, [ENDORA, 'dev'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('package.json');
  });

  it('a layer that fails takes the others down and the verb exits with its code', () => {
    const root = temp('dev-cli-');
    // Scripts that stand in for the three layers: the API fails at once, the
    // admin preview would run forever. `pnpm run` is what the supervisor
    // invokes, so this is the real chain an instance runs.
    const instance = instanceOnDisk(root, {
      start: `node -e "console.error('no database'); process.exit(4)"`,
      'preview:admin': `node -e "setInterval(() => {}, 1000)"`,
    });
    const result = spawnSync(process.execPath, [ENDORA, 'dev', '--no-storefront'], {
      cwd: instance,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    expect(result.status).toBe(4);
    expect(`${result.stdout}${result.stderr}`).toContain('[api]');
    expect(`${result.stdout}${result.stderr}`).toMatch(/api exited with code 4/);
  });
});
