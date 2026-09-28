/**
 * `endora install <dir>` — the one command, its preconditions and the pipeline
 * it runs (`specs/125-first-mile-install/spec.md` §4.3, FR-140…FR-161;
 * `tasks.md` Phase 3, which is deliberately the **non-interactive** half: this
 * command never prompts, so `cli-product.md` R2.5c is satisfied by construction
 * and the whole pipeline ships before the wizard exists).
 *
 * ## What was measured before it existed
 *
 * §2.3's table, re-derived on this branch: **nineteen to twenty-one** typed
 * steps between a stranger and a running shop, of which one is an editor
 * session over a file with blanks in it. `endora new instance` writes 25 files
 * and stops; every step after it is the client's to type, in order, from a
 * block they have to read.
 *
 * ## The steps are data, and that is what makes them assertable
 *
 * FR-155 — *"the pipeline it runs is the printed next-steps sequence and
 * nothing else"* — is a statement about a **list**, so the list is a value this
 * command exposes rather than a sequence of calls buried in a function. The
 * runner is injected, so every case below asserts what would run, in what
 * order, with which arguments, without a package manager, a Docker daemon or a
 * database anywhere near the test.
 *
 * ## It composes and reimplements nothing (FR-143)
 *
 * `runNewInstance` and `runNewStorefront` are the two commands that write; this
 * one calls them. The case that asserts it reads this package's own source: a
 * template rendered beside the install would be a second scaffolder, which is
 * D-100's failure mode with a new name.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  InstallInputError,
  runInstall,
  type InstallStep,
} from '../src/install/index.js';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** One declared environment input, in the shape the contract's schema takes. */
function input(
  name: string,
  requirement: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    describes: { en: `what ${name} decides.`, pl: `co ${name} ustala.` },
    requirement,
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
    ...overrides,
  };
}

/** The packages an install leaves beside the target, as `pnpm add` writes them. */
function installFixture(root: string): void {
  const scopeDir = join(root, 'node_modules', '@endora-commerce');
  const write = (name: string, manifest: unknown, source: string): void => {
    const dir = join(scopeDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    writeFileSync(join(dir, 'manifest.js'), source, 'utf8');
  };
  write(
    'platform',
    {
      name: '@endora-commerce/platform',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'platform' },
      exports: { '.': { default: './manifest.js' } },
      peerDependencies: { fastify: '^5', zod: '^4' },
    },
    // What a scaffolded instance reads from its environment is the **installed**
    // platform's declaration, so the fixture carries one: the four the
    // development stack answers, plus the secret two trees share. The
    // `.env` this produces is what the derivation writes into, and an input
    // nothing declares gets no line — which is the intersection FR-105 states.
    `export const PLATFORM_ENVIRONMENT_INPUTS = ${JSON.stringify([
      input('DATABASE_URL', { kind: 'required' }),
      input('REDIS_URL', { kind: 'required' }),
      input('MEILISEARCH_URL', {
        kind: 'optional',
        without: { en: 'the liveness probe reports this instance degraded.', pl: 'x' },
      }),
      input('SMTP_URL', {
        kind: 'optional',
        without: { en: 'mail goes to a console mailer that delivers nothing.', pl: 'x' },
      }),
      input('REVALIDATE_SECRET', { kind: 'required' }, { secret: true }),
      input('SESSION_COOKIE_SECRET', { kind: 'required' }, { secret: true, generable: true }),
    ])};\n`,
  );
  write(
    'mod-settings',
    {
      name: '@endora-commerce/mod-settings',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'settings' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'settings', dependencies: [], activation: { nonDeactivatable: true, reason: 'the platform cannot run without it' } };\n`,
  );
  write(
    'mod-admin-users',
    {
      name: '@endora-commerce/mod-admin-users',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'admin_users' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'admin_users', dependencies: ['settings'] };\n`,
  );
}

/** A host directory: an install of ours, and nothing else. */
function host(): string {
  const root = temp('endora-install-');
  installFixture(root);
  return root;
}

const ADMIN = {
  adminEmail: 'owner@example.com',
  adminPassword: 'a-password-they-remember',
  adminFirstName: 'Ada',
  adminLastName: 'Lovelace',
} as const;

/**
 * Every answer supplied, nothing asked, nothing run.
 *
 * **`dockerReachable` is one of those answers, and omitting it was a defect in
 * this helper rather than in the command.** `runInstall` reads
 * `options.dockerReachable ?? dockerIsReachable()`, so a case that wants the
 * services step and supplies no answer runs `docker info` against whichever
 * machine the suite is on. On a developer's laptop that is green; on
 * `node:22.18-slim` with no socket, every `services: true` case in this file —
 * six of them — fails with the command's refusal instead of asserting the step
 * list it was written to assert. That refusal is correct and is not weakened
 * here: it keeps its own case below, which supplies `false` deliberately. This
 * line is what finally makes the file's opening claim true — *"without a
 * package manager, a Docker daemon or a database anywhere near the test"*.
 */
function options(
  root: string,
  overrides: Record<string, unknown> = {},
): Parameters<typeof runInstall>[0] {
  return {
    dir: join(root, 'acme-shop'),
    cwd: root,
    storefront: false,
    services: false,
    dockerReachable: true,
    demo: false,
    ...ADMIN,
    ...overrides,
  } as Parameters<typeof runInstall>[0];
}

/** A runner that records what it was asked to do and answers success. */
function recorder(exitCodes: Readonly<Record<string, number>> = {}): {
  readonly steps: InstallStep[];
  readonly run: (step: InstallStep) => Promise<number>;
} {
  const steps: InstallStep[] = [];
  return {
    steps,
    run: async (step: InstallStep) => {
      steps.push(step);
      return exitCodes[step.id] ?? 0;
    },
  };
}

describe('FR-157 — it refuses its preconditions before it writes anything', () => {
  it('a run with no answers names every one of them, and the flag that supplies each', async () => {
    const root = host();
    const error = await runInstall({
      dir: join(root, 'acme-shop'),
      cwd: root,
      storefront: false,
      services: false,
    }).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(InstallInputError);
    const message = (error as Error).message;
    for (const flag of [
      '--admin-email',
      '--admin-password',
      '--admin-first-name',
      '--admin-last-name',
      '--demo',
      '--no-demo',
    ]) {
      expect(message, `the refusal does not name ${flag}`).toContain(flag);
    }
    // R5.2's discipline, one command over: nothing is written by a run that
    // refused, so there is no half-installed tree to clean up.
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
    expect(message).toContain('Nothing was written');
  });

  /**
   * T5-A. 125 PR-2 was ruled **(c)** by the owner on 2026-09-25 (D-269): the
   * question has no default in the wizard and none on the command line, so the
   * posture T3-I shipped is the final one and this case stays as it was.
   */
  it('FR-124 / D-269 — neither demo flag is a refusal: PR-2 was ruled (c), no default', async () => {
    const root = host();
    await expect(runInstall(options(root, { demo: undefined }))).rejects.toThrow(/--no-demo/);
  });

  it('a target directory that is occupied is refused with the rest of them', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'README.md'), 'mine\n', 'utf8');
    await expect(runInstall(options(root))).rejects.toThrow(/acme-shop/);
  });

  it('FR-158 — no package-manager runner is a refusal naming both ways to get one', async () => {
    const root = host();
    const error = await runInstall(options(root, { packageManagers: [] })).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain('pnpm');
    expect((error as Error).message).toContain('corepack');
    // …and what it offers to run is `corepack pnpm@…`, which changes nothing
    // about the machine. Baseline step A1 — `corepack enable`, which writes
    // shims into a directory this program does not own — is the thing this
    // command exists not to need, and the sentence says so.
    expect((error as Error).message).toContain('corepack pnpm@');
  });

  it('FR-157 — a run failing two preconditions names both, in one refusal', async () => {
    const root = host();
    const error = await runInstall({
      dir: join(root, 'acme-shop'),
      cwd: root,
      storefront: false,
      services: false,
      packageManagers: [],
    } as Parameters<typeof runInstall>[0]).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    const message = (error as Error).message;
    expect(message).toContain('pnpm');
    expect(message).toContain('--admin-email');
  });

  it('the Docker daemon is a precondition of the services step, and of nothing else', async () => {
    const root = host();
    // Unreachable daemon, services wanted: refused, naming the flag that skips
    // the step rather than the one that fixes Docker.
    await expect(
      runInstall(options(root, { services: true, dockerReachable: false })),
    ).rejects.toThrow(/--no-services/);
    // The same machine with `--no-services`: nothing about Docker.
    const { run, steps } = recorder();
    await runInstall(options(root, { services: false, dockerReachable: false, run }));
    expect(steps.map((step) => step.id)).not.toContain('services');
  });

  /**
   * The instrument rather than the behaviour: a case that supplies **no**
   * answer asks the machine, and this run's machine has no daemon to be asked,
   * because `vitest.config.base.ts` declared it absent — see
   * `scripts/declared-absence.ts`.
   *
   * That declaration is what the six cases above needed and did not have. They
   * omitted `dockerReachable` from the day this file landed, so they asserted a
   * step list on a developer's laptop and a Docker refusal in
   * `node:22.18-slim`: one defect, and only a job could see it. This is the one
   * place in the file where omitting the answer is deliberate, and on a machine
   * with a live daemon it goes red the moment the seam stops applying — which
   * is the property no other case here can have.
   *
   * It weakens nothing. The refusal it asserts is the command's correct
   * behaviour, asserted a second time from the other side of the probe.
   */
  it('a case that answers nothing gets no daemon — this run declared it absent', async () => {
    expect(process.env['DOCKER_HOST']).toBe('unix:///nonexistent/endora-declared-absence.sock');
    const root = host();
    await expect(
      runInstall(options(root, { services: true, dockerReachable: undefined })),
    ).rejects.toThrow(/--no-services/);
  });
});

describe('FR-155 / FR-156 — the pipeline is the printed sequence, and every step is echoed', () => {
  it('T3-F — the steps are the sequence the spec names, in that order', async () => {
    const root = host();
    const { run, steps } = recorder();
    const result = await runInstall(options(root, { services: true, run }));
    expect(steps.map((step) => step.id)).toEqual([
      'install',
      'services',
      'setup',
      'admin',
    ]);
    expect(result.exitCode).toBe(0);
    // FR-156 — each one printed the command it was about to run, before it ran.
    for (const step of steps) {
      expect(result.output.join('\n')).toContain(step.command);
    }
  });

  it('it runs the instance\'s own root scripts, never a member\'s and never a second sequence', async () => {
    const root = host();
    const { run, steps } = recorder();
    await runInstall(options(root, { services: true, run }));
    const commands = steps.map((step) => step.command);
    expect(commands).toContain('pnpm install');
    expect(commands).toContain('pnpm run dev:services');
    expect(commands).toContain('pnpm run setup');
    expect(commands.some((command) => command.startsWith('pnpm run admin:create'))).toBe(true);
    // The composite is what the block prints, so the one-shot runs it rather
    // than its four parts: two products is what FR-155 refuses.
    expect(commands).not.toContain('pnpm run migrate');
    expect(commands).not.toContain('pnpm run build');
  });

  it('the administrator is created from the flags, and no password is generated', async () => {
    const root = host();
    const { run, steps } = recorder();
    await runInstall(options(root, { run }));
    const admin = steps.find((step) => step.id === 'admin')!;
    expect(admin.argv).toEqual([
      'run',
      'admin:create',
      '--',
      `--email=${ADMIN.adminEmail}`,
      `--password=${ADMIN.adminPassword}`,
      `--first-name=${ADMIN.adminFirstName}`,
      `--last-name=${ADMIN.adminLastName}`,
    ]);
  });

  it('T3-F — a failing step exits with its own code and prints what is left to do', async () => {
    const root = host();
    const { run, steps } = recorder({ setup: 7 });
    const result = await runInstall(options(root, { services: true, run }));
    expect(result.exitCode).toBe(7);
    // It stopped there: the administrator is not created against a schema that
    // was never migrated.
    expect(steps.map((step) => step.id)).toEqual(['install', 'services', 'setup']);
    const text = result.output.join('\n');
    expect(text).toContain('pnpm run setup');
    expect(text.toLowerCase()).toContain('remaining');
    expect(text).toContain('pnpm run admin:create');
  });

  it('FR-125 — a dry run names every step, runs none of them and writes nothing', async () => {
    const root = host();
    const { run, steps } = recorder();
    const result = await runInstall(options(root, { services: true, demo: true, dryRun: true, run }));
    expect(steps).toEqual([]);
    expect(existsSync(join(root, 'acme-shop', 'package.json'))).toBe(false);
    const text = result.output.join('\n');
    for (const command of ['pnpm install', 'pnpm run dev:services', 'pnpm run setup']) {
      expect(text).toContain(command);
    }
    // R2.4 — the seeding is named as a step it would run, and nothing is seeded.
    expect(text).toContain('pnpm run cli demo seed');
    expect(result.exitCode).toBe(0);
  });
});

describe('FR-121 / FR-126 — the demo decision runs a command and writes no file', () => {
  it('T3-I — seeding runs after `module:install --all` and after the administrator', async () => {
    const root = host();
    const { run, steps } = recorder();
    await runInstall(options(root, { demo: true, run }));
    const ids = steps.map((step) => step.id);
    expect(ids.indexOf('demo')).toBeGreaterThan(ids.indexOf('setup'));
    expect(ids.indexOf('demo')).toBeGreaterThan(ids.indexOf('admin'));
    expect(steps.find((step) => step.id === 'demo')!.command).toBe('pnpm run cli demo seed');
  });

  it('T3-I — a failed seed does not fail the install, and names the retry', async () => {
    const root = host();
    const { run } = recorder({ demo: 1 });
    const result = await runInstall(options(root, { demo: true, run }));
    // The instance is complete without demo rows: an optional extra may not red
    // a mandatory outcome.
    expect(result.exitCode).toBe(0);
    expect(result.output.join('\n')).toContain('pnpm run cli demo seed');
    expect(result.output.join('\n')).toContain('pnpm run cli demo reset');
  });

  it('SC-105 / D-216 — a `--demo` run writes the demo vocabulary into no file of the tree', async () => {
    const root = host();
    const { run } = recorder();
    await runInstall(options(root, { demo: true, run }));
    const target = join(root, 'acme-shop');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (entry === 'node_modules' || entry === '.git') continue;
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        const text = readFileSync(path, 'utf8').toLowerCase();
        if (/\bdemo\b/.test(entry.toLowerCase()) || text.includes('demo seed')) {
          // The next-steps block is output, not a file; `README.md` renders the
          // root scripts and names no demo verb.
          offenders.push(path.slice(target.length + 1));
        }
      }
    };
    walk(target);
    expect(offenders).toEqual([]);
  });
});

describe('FR-105 — the instance reaches the services this run started', () => {
  it('the derived values are written into `.env`, from the document this run rendered', async () => {
    const root = host();
    const { run } = recorder();
    await runInstall(options(root, { services: true, run }));
    const env = readFileSync(join(root, 'acme-shop', '.env'), 'utf8');
    const compose = readFileSync(join(root, 'acme-shop', 'compose.dev.yml'), 'utf8');
    for (const line of env.split('\n')) {
      const port = /^(?:DATABASE_URL|REDIS_URL|MEILISEARCH_URL|SMTP_URL)=.*?:(\d+)/.exec(line);
      if (port === null) continue;
      expect(compose, `${line} names a port the compose file does not publish`).toContain(
        `:-${port[1]!}}:`,
      );
    }
    expect(env).toMatch(/^DATABASE_URL=postgresql:\/\//m);
    expect(env).toMatch(/^REDIS_URL=redis:\/\/localhost:6379$/m);
    // The hazard the block is required to name (spec §5.3.5).
    expect(env).toContain('compose.dev.yml');
  });

  it('T2-E — `--no-services` writes neither the values nor a promise of them', async () => {
    const root = host();
    const { run } = recorder();
    await runInstall(options(root, { services: false, run }));
    const env = readFileSync(join(root, 'acme-shop', '.env'), 'utf8');
    expect(env).not.toContain('DATABASE_URL=postgresql://');
    expect(env).toMatch(/^#DATABASE_URL=$/m);
  });

  it('a value the operator placed in a `.env` beforehand is not written over', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'DATABASE_URL=postgresql://mine@elsewhere/db\n', 'utf8');
    const { run } = recorder();
    await runInstall(options(root, { services: true, run }));
    expect(readFileSync(join(target, '.env'), 'utf8')).toContain(
      'DATABASE_URL=postgresql://mine@elsewhere/db',
    );
  });
});

describe('FR-143 / FR-161 — it composes the two commands and changes no topology', () => {
  it('T3-B — its source imports the two runners and names no template', () => {
    const source = readFileSync(
      join(repositoryRoot(), 'packages/cli/src/install/index.ts'),
      'utf8',
    );
    expect(source).toContain("from '../new-instance/index.js'");
    expect(source).toContain("from '../new-storefront/index.js'");
    // A second scaffolder is what FR-142 and FR-143 both refuse. The names are
    // the two this package renders trees with.
    expect(source).not.toContain('planInstance');
    expect(source).not.toContain('planStorefront');
    expect(source).not.toContain('template.js');
  });

  it('the tree it writes is the tree `new instance` writes — same files, same kinds', async () => {
    const root = host();
    const { run } = recorder();
    const result = await runInstall(options(root, { run }));
    // Feature 122's artefacts are all here: the one-shot changes how many
    // commands write them and nothing about what they are (FR-161).
    const paths = result.instance.plan.files.map((file) => file.path);
    expect(paths).toContain('deploy/compose.prod.yml');
    expect(paths).toContain('compose.dev.yml');
    expect(paths).toContain('package.json');
    const scripts = (
      JSON.parse(readFileSync(join(root, 'acme-shop', 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['build:backend']).toBe('pnpm -C backend run build');
  });

  it('the pass-through flags reach `new instance` and are not re-decided here', async () => {
    const root = host();
    const { run } = recorder();
    const result = await runInstall(
      options(root, { run, modules: ['admin_users'], deployment: 'acme', topology: 'three-host' }),
    );
    expect(result.instance.modules.ids).toContain('admin_users');
    expect(result.instance.deployment).toBe('acme');
    expect(result.instance.topology).toBe('three-host');
    expect(
      result.instance.plan.files.map((file) => file.path),
    ).toContain('deploy/three-host/compose.backend.yml');
  });
});

describe('FR-160 — the storefront is a sibling, and this checkout is what it is copied from', () => {
  it('outside a checkout it is refused before anything is written, naming the flag', async () => {
    const root = host();
    // The finding this case records: `endora new storefront` copies the
    // reference storefront out of a checkout of the platform repository, so an
    // installed CLI standing in an empty directory cannot write one. The
    // one-shot refuses in advance rather than writing an instance and failing
    // half way.
    const error = await runInstall(options(root, { storefront: true })).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain('--no-storefront');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('T3-G — the two trees share one `REVALIDATE_SECRET`, which no sequence of the two commands can do', async () => {
    const root = checkoutFixture();
    const { run } = recorder();
    const result = await runInstall({
      dir: join(root, 'acme-shop'),
      cwd: root,
      storefront: true,
      services: false,
      demo: false,
      run,
      ...ADMIN,
    } as Parameters<typeof runInstall>[0]);
    expect(result.storefrontDir).toBe(join(root, 'acme-shop-storefront'));
    const instanceEnv = readFileSync(join(root, 'acme-shop', '.env'), 'utf8');
    const storefrontEnv = readFileSync(join(root, 'acme-shop-storefront', '.env'), 'utf8');
    const secretOf = (text: string): string | undefined =>
      /^REVALIDATE_SECRET=(.+)$/m.exec(text)?.[1];
    expect(secretOf(instanceEnv)).toBeDefined();
    expect(secretOf(instanceEnv)).toBe(secretOf(storefrontEnv));
    // FR-160 — a sibling, never a child: a storefront inside the instance would
    // be swept into its `pnpm-workspace.yaml` globs and become a member of a
    // workspace it is not part of.
    expect(result.storefrontDir!.startsWith(join(root, 'acme-shop') + '/')).toBe(false);
  });

  it('a storefront directory inside the instance is refused', async () => {
    const root = checkoutFixture();
    await expect(
      runInstall({
        dir: join(root, 'acme-shop'),
        cwd: root,
        storefront: true,
        storefrontDir: join(root, 'acme-shop', 'storefront'),
        services: false,
        demo: false,
        ...ADMIN,
      } as Parameters<typeof runInstall>[0]),
    ).rejects.toThrow(/workspace/);
  });
});

describe('GAP-7 — the closing block leads with the one development command', () => {
  // `specs/136-open-source-publication/` FR-060: the three per-layer commands
  // were three terminals. They stay printed — a layer on its own is still a
  // thing an operator wants — but the first line is the one that starts all of
  // them.
  it('names `pnpm run dev:all` first, and keeps every per-layer command after it', async () => {
    const root = host();
    const { run } = recorder();
    const result = await runInstall(options(root, { run }));
    const text = result.output.join('\n');
    const devAll = text.indexOf(`cd ${join(root, 'acme-shop')} && pnpm run dev:all`);
    const start = text.indexOf(`cd ${join(root, 'acme-shop')} && pnpm run start`);
    expect(devAll).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(devAll);
    expect(text).not.toContain('--storefront-dir');
  });

  it('a storefront somewhere other than the default sibling is named on that line', async () => {
    const root = checkoutFixture();
    const { run } = recorder();
    const elsewhere = join(root, 'shops', 'front');
    const result = await runInstall({
      dir: join(root, 'acme-shop'),
      cwd: root,
      storefront: true,
      storefrontDir: elsewhere,
      services: false,
      demo: false,
      run,
      ...ADMIN,
    } as Parameters<typeof runInstall>[0]);
    expect(result.output.join('\n')).toContain(
      `pnpm run dev:all -- --storefront-dir ${elsewhere}`,
    );
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('install.test: no `pnpm-workspace.yaml` above this file');
}

/**
 * A checkout with a reference storefront in it, and our packages installed.
 *
 * Both halves in one fixture, because `endora install` is the one command that
 * needs both: the instance's packages come from beside the target and the
 * storefront is copied out of the checkout the command is standing in. Small on
 * purpose — the storefront half's real subject is the shared secret, not the
 * copy, which `new-storefront.test.ts` owns.
 */
function checkoutFixture(): string {
  const root = temp('endora-install-checkout-');
  installFixture(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - shop\n');
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-root', private: true, packageManager: 'pnpm@9.15.0' }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'shop'), { recursive: true });
  writeFileSync(
    join(root, 'shop', 'package.json'),
    `${JSON.stringify(
      { name: 'shop', version: '0.0.0', private: true, scripts: { build: 'next build' }, dependencies: { next: '^15.0.0' } },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(root, 'shop', 'app'), { recursive: true });
  writeFileSync(join(root, 'shop', 'app', 'page.tsx'), 'export default () => null;\n', 'utf8');
  writeFileSync(
    join(root, 'shop', 'environment-inputs.mjs'),
    `export const STOREFRONT_ENVIRONMENT_INPUTS = [
  {
    name: 'NEXT_PUBLIC_API_BASE_URL',
    describes: { en: 'the backend address.', pl: 'adres backendu.' },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: 'backend',
  },
  {
    name: 'REVALIDATE_SECRET',
    describes: { en: 'the shared revalidation secret.', pl: 'wspolny sekret.' },
    requirement: { kind: 'required' },
    secret: true,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: null,
  },
];
`,
    'utf8',
  );
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.error) throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
  return root;
}
