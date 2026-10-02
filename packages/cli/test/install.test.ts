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
  PASSWORD_PLACEHOLDER,
  composeProjectNameOf,
  runInstall,
  type InstallStep,
} from '../src/install/index.js';
import { writePackagedReference } from '../src/new-storefront/packaged.js';

/** No port on this machine is taken — the answer a hermetic case hands in. */
const NO_PORT_TAKEN = async (): Promise<boolean> => false;

/** A directory that holds no packaged reference storefront. */
const NO_PACKAGED_REFERENCE = join(tmpdir(), 'endora-no-packaged-reference-here');

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
function installFixture(
  root: string,
  fixture: {
    readonly origins?: boolean;
    readonly admin?: boolean;
    readonly mfa?: boolean;
    /** Read by `checkoutFixture`: the storefront depends on a workspace package. */
    readonly scopedDependency?: boolean;
  } = {},
): void {
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
      // The three inputs that name the other two machines
      // (`specs/138-separate-components/`), as the real platform declares them.
      ...(fixture.origins === true
        ? [
            input('PUBLIC_API_BASE_URL', { kind: 'required' }, { addressOf: 'backend' }),
            input('CORS_ALLOWED_ORIGINS', { kind: 'required' }),
            input('STOREFRONT_BASE_URL', { kind: 'required' }, { addressOf: 'storefront' }),
          ]
        : []),
    ])};\n`,
  );
  if (fixture.admin === true) {
    // §2.4's two packages: with both resolved the instance gets its admin
    // member, which is what `--only admin` builds.
    write(
      'admin-shell',
      {
        name: '@endora-commerce/admin-shell',
        version: '4.5.6',
        type: 'module',
        exports: { '.': { default: './manifest.js' } },
        peerDependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          vite: '^7.3.2',
          '@vitejs/plugin-react': '^5.2.0',
          tailwindcss: '^4.2.4',
          '@tailwindcss/vite': '^4.2.4',
        },
      },
      'export {};\n',
    );
    write(
      'admin-kit',
      {
        name: '@endora-commerce/admin-kit',
        version: '4.5.6',
        type: 'module',
        exports: { '.': { default: './manifest.js' } },
      },
      'export {};\n',
    );
  }
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
  if (fixture.mfa === true) {
    // The one module that declares `ADMIN_BASE_URL`, as `mfa` does.
    write(
      'mod-mfa',
      {
        name: '@endora-commerce/mod-mfa',
        version: '1.2.3',
        type: 'module',
        endora: { type: 'module', id: 'mfa' },
        exports: { '.': { default: './manifest.js' } },
      },
      `export const manifest = { id: 'mfa', dependencies: ['settings'], env: ${JSON.stringify(
        [
          input(
            'ADMIN_BASE_URL',
            { kind: 'optional', without: { en: 'links point at the development admin.', pl: 'x' } },
            { owner: { kind: 'module', moduleId: 'mfa' }, addressOf: 'admin' },
          ),
        ],
      )} };\n`,
    );
  }
  // The demo shop's composition, as a release installs it: every package of
  // the release index is in the host, this one included.
  write(
    'demo-composition',
    {
      name: '@endora-commerce/demo-composition',
      version: '1.2.4',
      type: 'module',
      endora: { type: 'demo-composition' },
      exports: { '.': { default: './manifest.js' } },
    },
    'export function createDemoComposition() { throw new Error("never called here"); }\n',
  );
}

/** A host directory: an install of ours, and nothing else. */
function host(fixture: Parameters<typeof installFixture>[1] = {}): string {
  const root = temp('endora-install-');
  installFixture(root, fixture);
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
/** No Compose project of any name exists on the machine a case runs on, unless it says so. */
const NO_PROJECT_HELD = async (): Promise<readonly string[]> => [];

/** `pnpm` on `PATH` — what this machine is declared to offer, unless a case says otherwise. */
const PNPM_ON_PATH = { command: 'pnpm', prefix: [], label: 'pnpm' } as const;

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
    // The same reasoning as `dockerReachable`, one probe over: the default asks
    // this machine which ports are taken, and a developer's laptop running a
    // PostgreSQL would then write a different `.env` from a CI container.
    portInUse: NO_PORT_TAKEN,
    // And the same again: the default is whatever this checkout's last build
    // left in `dist`, which is not a fact about the command.
    packagedReferenceDir: NO_PACKAGED_REFERENCE,
    // And once more. Unanswered, every case here spawned `pnpm --version` and
    // `corepack --version` on the machine running it. On a hosted runner `pnpm`
    // is corepack's shim, which may go to the network before it answers, and
    // the 10 s test timeout is shorter than the probe's own 20 s — so a case
    // about something else entirely ("a case that answers nothing gets no
    // daemon") timed out once, on nothing it asserts. The answer is the one
    // every step list in this file is written against: `pnpm`, on `PATH`.
    packageManagers: [PNPM_ON_PATH],
    // And Docker's projects: unanswered, a case would ask this machine's daemon
    // which Compose projects it holds.
    composeProjectInUse: NO_PROJECT_HELD,
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
    // The one real process this case starts is `docker info`, and the probe
    // gives it 20 s (`dockerIsReachable`). The timeout below is longer than
    // that, so a slow Docker CLI is answered by the probe — as a refusal, which
    // is what is asserted — and never by the test runner.
  }, 30_000);

  /**
   * The probe's own answer, not the seam's: **an exit status of 0 is not a
   * daemon**. Docker CLI 28 — the one GitHub's `ubuntu-24.04` image ships —
   * answers `docker info --format '{{.ServerVersion}}'` with exit 0 and an
   * empty line when nothing is listening; 29 exits 1. So the case above was
   * green on a laptop running 29 and red on the hosted runner, with the same
   * unreachable `DOCKER_HOST`, and a client on 28 with Docker stopped was sent
   * into `pnpm install` instead of being told to start it.
   *
   * Each case puts a `docker` of known behaviour first on `PATH`, so the
   * version installed on whichever machine runs this decides nothing.
   */
  function withDocker(script: string): () => void {
    const bin = temp('endora-fake-docker-');
    const path = join(bin, 'docker');
    writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    const previous = process.env['PATH'];
    process.env['PATH'] = `${bin}:${previous ?? ''}`;
    return () => {
      process.env['PATH'] = previous;
    };
  }

  it('a Docker CLI that exits 0 and names no server version has no daemon behind it', async () => {
    const restore = withDocker('exit 0');
    try {
      const root = host();
      const { run } = recorder();
      await expect(
        runInstall(options(root, { services: true, dockerReachable: undefined, run })),
      ).rejects.toThrow(/--no-services/);
    } finally {
      restore();
    }
  });

  it('a Docker CLI that names a server version is a daemon, so the probe is not simply "no"', async () => {
    const restore = withDocker("echo '28.0.4'");
    try {
      const root = host();
      const { run, steps } = recorder();
      await runInstall(options(root, { services: true, dockerReachable: undefined, run }));
      expect(steps.map((step) => step.id)).toContain('services');
    } finally {
      restore();
    }
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
    // The password is not an argument: a package manager echoes the script it
    // runs with its arguments, and the operator CLI logs them. It travels on
    // the step's standard input.
    expect(admin.argv).toEqual([
      'run',
      'admin:create',
      '--',
      `--email=${ADMIN.adminEmail}`,
      '--password-stdin',
      `--first-name=${ADMIN.adminFirstName}`,
      `--last-name=${ADMIN.adminLastName}`,
    ]);
    expect(admin.stdin).toBe(ADMIN.adminPassword);
    for (const step of steps) {
      expect(step.argv.join(' '), step.id).not.toContain(ADMIN.adminPassword);
      if (step.id !== 'admin') expect(step.stdin, step.id).toBeUndefined();
    }
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

  it('the resumable list starts at the step that failed, so following it skips nothing', async () => {
    // It used to start after it: `done` already held the failed step, so a
    // client who typed the list from its first line never re-ran the one step
    // the run had died on.
    const root = host();
    const { run } = recorder({ services: 125 });
    const result = await runInstall(options(root, { services: true, run }));
    const text = result.output.join('\n');
    const listed = text
      .slice(text.indexOf('Remaining steps, in order'))
      .split('\n')
      .slice(1)
      .filter((line) => line.startsWith('  cd '));
    expect(listed.map((line) => /&& (pnpm \S+ \S+)/.exec(line)?.[1])).toEqual([
      'pnpm run dev:services',
      'pnpm run setup',
      'pnpm run admin:create',
    ]);
    // Each line names where it runs: the storefront's install is in another tree.
    for (const line of listed) expect(line).toContain(`cd ${join(root, 'acme-shop')} && `);
  });

  it('the password is never printed: not in the echo, not in the dry run, not in the resumable list', async () => {
    const root = host();
    const { run, steps } = recorder({ setup: 3 });
    const failed = await runInstall(options(root, { run }));
    expect(failed.output.join('\n')).not.toContain(ADMIN.adminPassword);
    expect(failed.output.join('\n')).toContain(`--password=${PASSWORD_PLACEHOLDER}`);
    // It says what the placeholder is, so the list stays something a client can finish.
    expect(failed.output.join('\n')).toContain('stands for the administrator password');
    // What runs is still the value: only what is printed changed.
    expect(steps).toHaveLength(2);

    const second = host();
    const ok = recorder();
    const done = await runInstall(options(second, { run: ok.run }));
    expect(done.output.join('\n')).not.toContain(ADMIN.adminPassword);
    expect(ok.steps.find((step) => step.id === 'admin')!.stdin).toBe(ADMIN.adminPassword);

    const third = host();
    const dry = await runInstall(options(third, { dryRun: true }));
    expect(dry.output.join('\n')).not.toContain(ADMIN.adminPassword);
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

  it('`--demo` puts the demo composition in the module list, at its own version', async () => {
    // The defect of 2026-10-01: a `--demo` instance seeded every module's rows
    // and nothing joined them — 203 products no channel sold, administrators
    // with no role — because the composition was a file in our host and no
    // instance had one. The answer is one dependency: the platform finds the
    // installed package by its `endora.type` and runs it.
    const root = host();
    const { run } = recorder();
    await runInstall(options(root, { demo: true, run }));
    const manifest = JSON.parse(readFileSync(join(root, 'acme-shop', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['@endora-commerce/demo-composition']).toBe('^1.2.4');
  });

  it('`--no-demo` leaves it out — an instance a client trades from carries no demo package', async () => {
    const root = host();
    const { run } = recorder();
    await runInstall(options(root, { demo: false, run }));
    const manifest = JSON.parse(readFileSync(join(root, 'acme-shop', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).not.toContain('@endora-commerce/demo-composition');
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

describe('the ports the development stack publishes are decided before anything is written', () => {
  /** A probe over a fixed set of taken ports. */
  const taken =
    (...ports: readonly number[]) =>
    async (port: number): Promise<boolean> =>
      ports.includes(port);

  it('a default port that is taken is moved, written into `.env`, and the address follows it', async () => {
    const root = host();
    const { run } = recorder();
    const result = await runInstall(
      options(root, { services: true, run, portInUse: taken(5432, 6379, 15432) }),
    );
    const env = readFileSync(join(root, 'acme-shop', '.env'), 'utf8');
    // 15432 is taken too, so the next free one is the answer.
    expect(env).toMatch(/^POSTGRES_PORT=15433$/m);
    expect(env).toMatch(/^REDIS_PORT=16379$/m);
    expect(env).toMatch(/^DATABASE_URL=postgresql:\/\/.*@localhost:15433\//m);
    // The dangerous one: Redis takes no credential, so an address left on 6379
    // would be somebody else's Redis, used in silence.
    expect(env).toMatch(/^REDIS_URL=redis:\/\/localhost:16379$/m);
    expect(env).not.toMatch(/localhost:6379/);
    // A port that was free stays the document's own and is not written.
    expect(env).not.toMatch(/^MEILISEARCH_PORT=/m);
    expect(env).toMatch(/^MEILISEARCH_URL=http:\/\/localhost:7700$/m);
    const text = result.output.join('\n');
    expect(text).toContain('port 5432 is already in use on this machine');
    expect(text).toContain('POSTGRES_PORT=15433');
    expect(result.derived).toEqual(expect.arrayContaining(['POSTGRES_PORT', 'REDIS_PORT', 'DATABASE_URL']));
  });

  it('a port the operator set in `.env` is theirs: free, it moves the address', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'REDIS_PORT=6400\n', 'utf8');
    const { run } = recorder();
    await runInstall(options(root, { services: true, run, portInUse: taken(6379) }));
    const env = readFileSync(join(target, '.env'), 'utf8');
    expect(env).toMatch(/^REDIS_URL=redis:\/\/localhost:6400$/m);
    expect(env.match(/^REDIS_PORT=/gm)).toHaveLength(1);
  });

  it('a port the operator set and cannot have is a refusal, with nothing written', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'POSTGRES_PORT=5999\n', 'utf8');
    const { run, steps } = recorder();
    const error = await runInstall(
      options(root, { services: true, run, portInUse: taken(5999) }),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(InstallInputError);
    expect((error as Error).message).toContain('POSTGRES_PORT=5999');
    expect((error as Error).message).toContain('Nothing was written');
    expect(readdirSync(target)).toEqual(['.env']);
    expect(steps).toEqual([]);
  });

  it('a Compose project of this directory\'s name already on the machine is not shared: the stack gets a name of its own', async () => {
    // Compose names a project after its directory, so a second instance called
    // `acme-shop` — under another parent, or written again after the first was
    // deleted — adopted the first one's containers and mounted its volumes.
    const root = host();
    const { run } = recorder();
    const asked: string[] = [];
    const result = await runInstall(
      options(root, {
        services: true,
        run,
        composeProjectInUse: async (name: string) => {
          asked.push(name);
          return name === 'acme-shop' ? ['container acme-shop-postgres-1', 'volume acme-shop_postgres-data'] : [];
        },
      }),
    );
    expect(asked[0]).toBe('acme-shop');
    const written = /^COMPOSE_PROJECT_NAME=(.+)$/m.exec(readFileSync(join(root, 'acme-shop', '.env'), 'utf8'))?.[1];
    expect(written).toMatch(/^acme-shop-[0-9a-f]{6}$/);
    const text = result.output.join('\n');
    expect(text).toContain('a Compose project named acme-shop already exists on this machine');
    expect(text).toContain('container acme-shop-postgres-1, volume acme-shop_postgres-data');
    expect(text).toContain(`COMPOSE_PROJECT_NAME=${written!} in .env`);
    // `dev:services` and `dev:services:down` are untouched: Compose reads the
    // name from the `.env` beside the file both of them name.
    const scripts = (
      JSON.parse(readFileSync(join(root, 'acme-shop', 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['dev:services']).toBe('docker compose -f compose.dev.yml up -d --wait');
    expect(scripts['dev:services:down']).toBe('docker compose -f compose.dev.yml down');
  });

  it('a free project name writes nothing, and the name is derived the way Compose derives it', async () => {
    const root = host();
    await runInstall(options(root, { services: true, run: recorder().run }));
    expect(readFileSync(join(root, 'acme-shop', '.env'), 'utf8')).not.toMatch(/^COMPOSE_PROJECT_NAME=/m);
    expect(composeProjectNameOf('/srv/My Shop.v2')).toBe('myshopv2');
    expect(composeProjectNameOf('/srv/_Acme-Shop')).toBe('acme-shop');
  });

  it('a project name the operator pinned is theirs: taken, it is a refusal with nothing written', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'COMPOSE_PROJECT_NAME=theirs\n', 'utf8');
    const { run, steps } = recorder();
    const error = await runInstall(
      options(root, {
        services: true,
        run,
        composeProjectInUse: async (name: string) => (name === 'theirs' ? ['volume theirs_postgres-data'] : []),
      }),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(InstallInputError);
    expect((error as Error).message).toContain('COMPOSE_PROJECT_NAME=theirs');
    expect((error as Error).message).toContain('volume theirs_postgres-data');
    expect(readdirSync(target)).toEqual(['.env']);
    expect(steps).toEqual([]);
  });

  it('`--no-services` probes nothing and moves nothing', async () => {
    const root = host();
    const { run } = recorder();
    let asked = 0;
    const result = await runInstall(
      options(root, {
        services: false,
        run,
        composeProjectInUse: async () => {
          asked += 1;
          return [];
        },
        portInUse: async (port: number) => {
          // The API's own port is the one question a run without services asks.
          if (port !== 3001) asked += 1;
          return false;
        },
      }),
    );
    expect(asked).toBe(0);
    expect(readFileSync(join(root, 'acme-shop', '.env'), 'utf8')).not.toMatch(/^[A-Z_]+_PORT=/m);
    // No mail catcher was started, so none is promised.
    expect(result.output.join('\n')).not.toContain('is caught at');
    expect(result.output.join('\n')).toContain('no development services were started');
  });

  it('the closing block names the API on the instance\'s own PORT, and says when it is taken', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'PORT=4321\n', 'utf8');
    const { run } = recorder();
    const result = await runInstall(options(root, { run, portInUse: taken(4321) }));
    const text = result.output.join('\n');
    expect(text).toContain('# the API, on http://localhost:4321');
    expect(text).not.toContain('localhost:3001');
    expect(text).toContain('port 4321 is in use on this machine right now');
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
    // D-270 — it passes a seed policy and derives no module set of its own.
    expect(source).not.toContain('resolveModuleSet');
    expect(source).not.toContain('nonDeactivatable');
    expect(source).not.toContain("from '../new-instance/modules.js'");
  });

  it('the tree it writes is the tree `new instance` writes — same files, same kinds', async () => {
    const root = host();
    const { run } = recorder();
    const result = await runInstall(options(root, { run }));
    // Feature 122's artefacts are all here: the one-shot changes how many
    // commands write them and nothing about what they are (FR-161).
    const paths = result.instance!.plan.files.map((file) => file.path);
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
    expect(result.instance!.modules.ids).toContain('admin_users');
    expect(result.instance!.deployment).toBe('acme');
    expect(result.instance!.topology).toBe('three-host');
    expect(
      result.instance!.plan.files.map((file) => file.path),
    ).toContain('deploy/three-host/compose.backend.yml');
  });
});

describe('FR-160 — the storefront is a sibling, copied from the checkout or from what the CLI carries', () => {
  it('outside a checkout, with a CLI that carries no reference, it is refused before anything is written', async () => {
    const root = host();
    // What is left of the finding this case used to record. `endora new
    // storefront` needed a checkout of the platform repository, so the one-shot
    // refused the storefront everywhere a stranger stands. A published CLI now
    // carries the reference; the refusal is for a build that packaged none.
    const error = await runInstall(options(root, { storefront: true })).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((error as Error).message).toContain('--no-storefront');
    expect((error as Error).message).toContain('carries no packaged reference storefront');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('outside a checkout, the reference the CLI carries is written as the sibling storefront', async () => {
    // The packaged reference is built from a checkout, exactly as the package's
    // own `build` does it, and then read from a directory with no workspace
    // above it — a stranger's.
    const checkout = checkoutFixture();
    const packaged = join(temp('endora-install-packaged-'), 'storefront-reference');
    const cli = join(checkout, 'packages', 'cli');
    mkdirSync(cli, { recursive: true });
    writeFileSync(join(cli, 'package.json'), JSON.stringify({ name: '@x/cli', version: '9.9.9' }));
    expect((await writePackagedReference(cli, packaged)).written).toBe(true);

    const root = host();
    const { run, steps } = recorder();
    const result = await runInstall(
      options(root, { storefront: true, run, packagedReferenceDir: packaged }),
    );
    const storefrontDir = join(root, 'acme-shop-storefront');
    expect(result.storefrontDir).toBe(storefrontDir);
    expect(result.storefront!.source.kind).toBe('packaged');
    expect(existsSync(join(storefrontDir, 'app', 'page.tsx'))).toBe(true);
    // Its own install is a step of the pipeline, in its own repository.
    expect(steps.at(-1)).toMatchObject({ id: 'storefront-install', cwd: storefrontDir });
    // One secret, two trees — the property the one-shot exists for holds here too.
    const secretOf = (text: string): string | undefined =>
      /^REVALIDATE_SECRET=(.+)$/m.exec(text)?.[1];
    expect(secretOf(readFileSync(join(storefrontDir, '.env'), 'utf8'))).toBe(
      secretOf(readFileSync(join(root, 'acme-shop', '.env'), 'utf8')),
    );
    expect(result.output.join('\n')).toContain('from the reference storefront this CLI carries');
  });

  it('the storefront is pointed at the instance\'s own PORT, never at a constant', async () => {
    const root = checkoutFixture();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'PORT=4455\n', 'utf8');
    const { run } = recorder();
    await runInstall(options(root, { storefront: true, run }));
    expect(readFileSync(join(root, 'acme-shop-storefront', '.env'), 'utf8')).toMatch(
      /^NEXT_PUBLIC_API_BASE_URL=http:\/\/localhost:4455$/m,
    );
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

  /**
   * W5.5 against `0.100.1` (run 36868691058): with no `pnpm` on PATH the
   * closing block asked for a global install *before* its next command, the
   * stranger ran the next command, and `pnpm run dev:all` exited 127. A printed
   * command has to run as printed on a machine with only Node and npm, so a
   * corepack-run install prints the pinned pnpm through `npx`, which puts that
   * pnpm's `bin` on PATH for everything it starts — the instance's own scripts
   * call `pnpm -C backend run …`.
   */
  it('reached through corepack, every printed pnpm command runs the pinned pnpm through npx', async () => {
    const root = host();
    const { run } = recorder();
    const corepack = { command: 'corepack', prefix: ['pnpm@9.15.0'], label: 'corepack pnpm@9.15.0' };
    const output = (await runInstall(options(root, { run, demo: true, packageManagers: [corepack] }))).output;
    const text = output.join('\n');
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && npx --yes pnpm@9.15.0 run dev:all`);
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && npx --yes pnpm@9.15.0 run start`);
    expect(text).toContain('`npx --yes pnpm@9.15.0 run cli demo reset`');
    // No bare `pnpm` command and no precondition line before them.
    expect(text).not.toMatch(/(^|[\s`])pnpm run /m);
    expect(text).not.toContain('npm install -g');
  });

  it('a failed corepack-run step lists the remaining steps in the form that runs as typed', async () => {
    const root = host();
    const { run } = recorder({ install: 1 });
    const corepack = { command: 'corepack', prefix: ['pnpm@9.15.0'], label: 'corepack pnpm@9.15.0' };
    const result = await runInstall(options(root, { run, packageManagers: [corepack] }));
    const text = result.output.join('\n');
    const remaining = text.slice(text.indexOf('Remaining steps, in order'));
    expect(remaining).toContain('npx --yes pnpm@9.15.0 run setup');
    expect(remaining).not.toContain('corepack pnpm@9.15.0 run');
    // The echo of what ran stays true to what ran.
    expect(text).toContain('[1/');
    expect(text).toMatch(/\[1\/\d\] corepack pnpm@9\.15\.0 install/);
  });

  it('with pnpm on PATH, the printed commands stay plain `pnpm`', async () => {
    const root = host();
    const { run } = recorder();
    const onPath = { command: 'pnpm', prefix: [], label: 'pnpm' };
    const text = (await runInstall(options(root, { run, packageManagers: [onPath] }))).output.join('\n');
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && pnpm run dev:all`);
    expect(text).not.toContain('npx --yes pnpm@');
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
    // As pnpm runs it: no `--`, which pnpm would pass on to `endora dev` as an
    // argument of its own.
    expect(result.output.join('\n')).toContain(`pnpm run dev:all --storefront-dir ${elsewhere}`);
    expect(result.output.join('\n')).not.toContain('dev:all -- ');
  });
});

// ---------------------------------------------------------------------------
// specs/138-separate-components — one component on its own machine
// ---------------------------------------------------------------------------

/** The answers a run with `api` owes, and nothing a run without it may carry. */
function only(
  root: string,
  components: string,
  overrides: Record<string, unknown> = {},
): Parameters<typeof runInstall>[0] {
  const api = components.split(',').includes('api');
  return {
    dir: join(root, 'acme-shop'),
    cwd: root,
    only: components.split(','),
    nonInteractive: true,
    dockerReachable: true,
    portInUse: NO_PORT_TAKEN,
    packagedReferenceDir: NO_PACKAGED_REFERENCE,
    ...(api ? { demo: false, services: false, ...ADMIN } : {}),
    ...overrides,
  } as Parameters<typeof runInstall>[0];
}

const refusalOf = async (given: Parameters<typeof runInstall>[0]): Promise<string> => {
  const error = await runInstall(given).then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error, 'the run was not refused').toBeInstanceOf(InstallInputError);
  return (error as Error).message;
};

const THE_API = 'https://api.example.com';
const THE_SHOP = 'https://shop.example.com';
const THE_ADMIN = 'https://admin.example.com';

describe('138 SC-003 — a run with no `--only` plans what it planned before', () => {
  /**
   * Recorded on `feat/storefront-from-registry` at `609c03c70`, before `--only`
   * existed, and unchanged since. The list is the product (FR-155): a step this
   * feature added to the run that selects nothing would be a different product
   * under the same command.
   */
  const BEFORE_138 = [
    ['install', 'pnpm install'],
    ['services', 'pnpm run dev:services'],
    ['setup', 'pnpm run setup'],
    [
      'admin',
      `pnpm run admin:create -- --email=owner@example.com --password=${PASSWORD_PLACEHOLDER} --first-name=Ada --last-name=Lovelace`,
    ],
    ['demo', 'pnpm run cli demo seed'],
    ['storefront-install', 'pnpm install'],
  ] as const;

  it('every part, the services and the demo rows: the six steps, in order, as typed', async () => {
    const root = checkoutFixture();
    const { run, steps } = recorder();
    const result = await runInstall(
      options(root, { storefront: true, services: true, demo: true, run }),
    );
    expect(steps.map((step) => [step.id, step.command])).toEqual(BEFORE_138);
    expect(result.steps.map((step) => step.cwd)).toEqual([
      ...Array.from({ length: 5 }, () => join(root, 'acme-shop')),
      join(root, 'acme-shop-storefront'),
    ]);
  });

  it('`--only api,admin,storefront` is the same run: the same steps and the same lines', async () => {
    const bare = checkoutFixture();
    const named = checkoutFixture();
    const given = { storefront: undefined, services: true, demo: true };
    const first = await runInstall(options(bare, { ...given, run: recorder().run }));
    const second = await runInstall(
      options(named, { ...given, only: ['api', 'admin', 'storefront'], run: recorder().run }),
    );
    // Two lines differ and both are about provenance, not about the run: the
    // parts answer came from a flag in one and was the recommendation in the
    // other, and the run says which.
    const neutral = (result: typeof first, root: string): string[] =>
      result.output
        .map((line) => line.replaceAll(root, '<root>'))
        .filter((line) => !line.includes('[answers]') && !line.includes('every part this build can write'));
    expect(neutral(second, named)).toEqual(neutral(first, bare));
    expect(first.answers).toContain('recommended=2 (parts, services)');
    expect(second.answers).toContain('recommended=1 (services)');
    expect(second.steps.map((step) => step.id)).toEqual(BEFORE_138.map(([id]) => id));
  });
});

describe('138 FR-002 / FR-010 / FR-012 / FR-013 — what a selection requires, and what it refuses', () => {
  it('`--only admin` needs the API\'s origin, and nothing about a database or an administrator', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(only(root, 'admin', { dockerReachable: false }));
    expect(message).toContain('1 thing to settle first');
    expect(message).toContain('`--api-url` is required');
    expect(message).not.toContain('demo');
    expect(message).not.toContain('administrator');
    expect(message).not.toContain('Docker');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('`--only storefront` names its three in one refusal, and writes nothing', async () => {
    const root = checkoutFixture();
    const message = await refusalOf(only(root, 'storefront'));
    expect(message).toContain('3 things to settle first');
    expect(message).toContain('`--api-url` is required');
    expect(message).toContain('`--storefront-url` is required');
    expect(message).toContain('`--revalidate-secret` is required');
    expect(message).not.toContain('demo');
    expect(message).not.toContain('administrator');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('`--only api` still owes the administrator and the demo decision', async () => {
    const root = host();
    const message = await refusalOf({
      dir: join(root, 'acme-shop'),
      cwd: root,
      only: ['api'],
      nonInteractive: true,
      dockerReachable: true,
    });
    expect(message).toContain('--admin-email');
    expect(message).toContain('--no-demo');
    expect(message).not.toContain('--api-url` is required');
  });

  it('a selection that is not one is in the same refusal as everything else', async () => {
    const root = host();
    const message = await refusalOf({
      dir: join(root, 'acme-shop'),
      cwd: root,
      only: ['api', 'till'],
      nonInteractive: true,
      packageManagers: [],
    });
    expect(message).toContain('2 things to settle first');
    expect(message).toContain('`--only` names till');
    expect(message).toContain('corepack');
  });

  it('D7 — a flag for a question the selection removed is refused, never ignored', async () => {
    const root = checkoutFixture();
    const storefront = {
      apiUrl: THE_API,
      storefrontUrl: THE_SHOP,
      revalidateSecret: 'the-api-already-holds-this',
    };
    expect(await refusalOf(only(root, 'storefront', { ...storefront, demo: true }))).toMatch(
      /`--demo` answers a question this run does not have/,
    );
    expect(
      await refusalOf(only(root, 'storefront', { ...storefront, services: false, ...ADMIN })),
    ).toMatch(
      /`--no-services`, `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` answer a question/,
    );
    expect(
      await refusalOf(
        only(root, 'storefront', {
          ...storefront,
          without: ['docs'],
          modules: ['settings'],
          deployment: 'acme',
          topology: 'three-host',
        }),
      ),
    ).toMatch(/`--without`, `--module`, `--deployment`, `--topology` name something this run does not write/);
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('`--only admin` refuses the storefront\'s values and the API\'s, by name', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(
      only(root, 'admin', {
        apiUrl: THE_API,
        adminUrl: THE_ADMIN,
        storefrontUrl: THE_SHOP,
        salesChannel: 'b2b',
        revalidateSecret: 'x',
      }),
    );
    // `--admin-url` is the admin's own address, so a run that stands the admin
    // up has a use for it (FR-025) and it is not among the refused.
    expect(message).not.toContain('`--admin-url`');
    for (const flag of ['--storefront-url', '--sales-channel', '--revalidate-secret']) {
      expect(message, flag).toContain(`\`${flag}\``);
    }
    expect(message).not.toContain('`--api-url`');
  });

  it('FR-011 — a value that is not an origin is refused, naming the flag and the value', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(only(root, 'admin', { apiUrl: 'https://api.example.com/' }));
    expect(message).toContain('`--api-url https://api.example.com/` is not an origin');
    expect(message).toContain('scheme and host, an optional port, no path');
  });

  it('`--only admin` where no admin member can be written is refused before anything is', async () => {
    // The fixture without the shell and the kit: `new instance` would write a
    // headless API and say so, which is a tree with nothing to build.
    const root = host();
    const message = await refusalOf(only(root, 'admin', { apiUrl: THE_API }));
    expect(message).toContain('`--only admin`');
    expect(message).toContain('admin-shell');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });
});

describe('138 FR-005…FR-009 — the pipeline each selection runs', () => {
  const ids = (steps: readonly InstallStep[]): string[] => steps.map((step) => step.id);

  it('`api` — the tree without its admin member, and today\'s steps', async () => {
    const root = host({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(only(root, 'api', { services: true, run }));
    expect(ids(steps)).toEqual(['install', 'services', 'setup', 'admin']);
    expect(result.instance!.plan.members).not.toContain('admin');
    expect(existsSync(join(root, 'acme-shop', 'admin'))).toBe(false);
    expect(result.storefrontDir).toBeNull();
    expect(existsSync(join(root, 'acme-shop-storefront'))).toBe(false);
  });

  it('`api,admin` — the whole tree, the same steps', async () => {
    const root = host({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(only(root, 'api,admin', { demo: true, run }));
    expect(ids(steps)).toEqual(['install', 'setup', 'admin', 'demo']);
    expect(result.instance!.plan.members).toContain('admin');
  });

  it('`api,storefront` — then the storefront\'s own install', async () => {
    const root = checkoutFixture({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(only(root, 'api,storefront', { run }));
    expect(ids(steps)).toEqual(['install', 'setup', 'admin', 'storefront-install']);
    expect(result.instance!.plan.members).not.toContain('admin');
    expect(result.storefrontDir).toBe(join(root, 'acme-shop-storefront'));
  });

  it('`admin` — install, then one build, with the backend member in the tree', async () => {
    const root = host({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(
      only(root, 'admin', { apiUrl: THE_API, dockerReachable: false, run }),
    );
    expect(steps.map((step) => [step.id, step.command, step.cwd])).toEqual([
      ['install', 'pnpm install', join(root, 'acme-shop')],
      ['build-admin', 'pnpm run build:admin', join(root, 'acme-shop')],
    ]);
    expect(result.instance!.plan.members).toEqual(expect.arrayContaining(['backend', 'admin']));
    expect(existsSync(join(root, 'acme-shop', 'backend', 'package.json'))).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('`storefront` — no instance tree: `<dir>` is the storefront\'s own directory', async () => {
    const root = checkoutFixture();
    const { run, steps } = recorder();
    const result = await runInstall(
      only(root, 'storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'the-api-already-holds-this',
        packageManagers: [{ command: 'pnpm', prefix: [], label: 'pnpm' }],
        run,
      }),
    );
    expect(steps.map((step) => [step.id, step.cwd])).toEqual([
      ['storefront-install', join(root, 'acme-shop')],
    ]);
    expect(result.instance).toBeNull();
    expect(result.hostStep).toBeNull();
    expect(result.storefrontDir).toBe(join(root, 'acme-shop'));
    expect(existsSync(join(root, 'acme-shop', 'app', 'page.tsx'))).toBe(true);
    expect(existsSync(join(root, 'acme-shop', 'backend'))).toBe(false);
    expect(existsSync(join(root, 'acme-shop-storefront'))).toBe(false);
  });

  it('`admin,storefront` — the tree and its one build, and the storefront beside it', async () => {
    const root = checkoutFixture({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(
      only(root, 'admin,storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'the-api-already-holds-this',
        run,
      }),
    );
    expect(ids(steps)).toEqual(['install', 'build-admin', 'storefront-install']);
    expect(result.storefrontDir).toBe(join(root, 'acme-shop-storefront'));
  });

  it('FR-009 — a dry run reports the same plan for a subset, and writes nothing', async () => {
    const root = checkoutFixture({ admin: true });
    const { run, steps } = recorder();
    const result = await runInstall(
      only(root, 'admin,storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'the-api-already-holds-this',
        dryRun: true,
        run,
      }),
    );
    expect(steps).toEqual([]);
    expect(ids(result.steps)).toEqual(['install', 'build-admin', 'storefront-install']);
    const text = result.output.join('\n');
    expect(text).toContain('pnpm run build:admin');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
    expect(existsSync(join(root, 'acme-shop-storefront'))).toBe(false);
  });
});

describe('138 FR-012…FR-016 — the values that cross a machine boundary', () => {
  const env = (path: string): Map<string, string> => {
    const values = new Map<string, string>();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match !== null) values.set(match[1]!, match[2]!);
    }
    return values;
  };

  it('FR-012 — the admin alone: `VITE_API_BASE_URL` in `admin/.env`, and no secret generated', async () => {
    const root = host({ admin: true, origins: true });
    const result = await runInstall(only(root, 'admin', { apiUrl: THE_API, run: recorder().run }));
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toEqual(
      new Map([['VITE_API_BASE_URL', THE_API]]),
    );
    // The tree's own `.env` names nothing about the other machines: this run
    // stands up no API to read it.
    const instance = env(join(root, 'acme-shop', '.env'));
    for (const name of ['PUBLIC_API_BASE_URL', 'CORS_ALLOWED_ORIGINS', 'REVALIDATE_SECRET']) {
      expect(instance.has(name), name).toBe(false);
    }
    expect(result.output.join('\n')).not.toContain('REVALIDATE_SECRET');
  });

  it('FR-013 — the storefront alone: the five values, the secret verbatim', async () => {
    const root = checkoutFixture();
    await runInstall(
      only(root, 'storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        salesChannel: 'b2b',
        revalidateSecret: 'the-api-already-holds-this',
        run: recorder().run,
      }),
    );
    expect(env(join(root, 'acme-shop', '.env'))).toEqual(
      new Map([
        ['NEXT_PUBLIC_API_BASE_URL', THE_API],
        ['BACKEND_BASE_URL', THE_API],
        ['NEXT_PUBLIC_SITE_URL', THE_SHOP],
        ['NEXT_PUBLIC_SALES_CHANNEL_CODE', 'b2b'],
        ['REVALIDATE_SECRET', 'the-api-already-holds-this'],
      ]),
    );
  });

  it('FR-013 — `--sales-channel` not given is the platform\'s own `default`', async () => {
    const root = checkoutFixture();
    await runInstall(
      only(root, 'storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'x',
        run: recorder().run,
      }),
    );
    expect(env(join(root, 'acme-shop', '.env')).get('NEXT_PUBLIC_SALES_CHANNEL_CODE')).toBe('default');
  });

  it('FR-013 — a storefront without the API and without the secret is refused, and no file is written', async () => {
    const root = checkoutFixture();
    const message = await refusalOf(
      only(root, 'storefront', { apiUrl: THE_API, storefrontUrl: THE_SHOP }),
    );
    expect(message).toContain('never generates it');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('FR-014 — the API alone, told all three: its `.env` names the other two machines', async () => {
    const root = host({ admin: true, origins: true, mfa: true });
    await runInstall(
      only(root, 'api', {
        apiUrl: THE_API,
        adminUrl: THE_ADMIN,
        storefrontUrl: THE_SHOP,
        run: recorder().run,
      }),
    );
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance.get('PUBLIC_API_BASE_URL')).toBe(THE_API);
    expect(instance.get('ADMIN_BASE_URL')).toBe(THE_ADMIN);
    expect(instance.get('STOREFRONT_BASE_URL')).toBe(THE_SHOP);
    expect(instance.get('CORS_ALLOWED_ORIGINS')).toBe(`${THE_ADMIN},${THE_SHOP}`);
  });

  it('FR-014 — an origin not given stands as its development address in the allow-list', async () => {
    const root = host({ origins: true });
    await runInstall(only(root, 'api', { adminUrl: THE_ADMIN, run: recorder().run }));
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance.get('CORS_ALLOWED_ORIGINS')).toBe(`${THE_ADMIN},http://localhost:3000`);
    expect(instance.has('PUBLIC_API_BASE_URL')).toBe(false);
    expect(instance.has('STOREFRONT_BASE_URL')).toBe(false);
  });

  it('FR-014 — `ADMIN_BASE_URL` is written only where the instance declares it', async () => {
    const root = host({ origins: true });
    await runInstall(only(root, 'api', { adminUrl: THE_ADMIN, run: recorder().run }));
    expect(readFileSync(join(root, 'acme-shop', '.env'), 'utf8')).not.toContain('ADMIN_BASE_URL');
  });

  it('FR-014 — none given, nothing is written and the development fallbacks apply', async () => {
    const root = host({ origins: true, mfa: true });
    await runInstall(only(root, 'api', { run: recorder().run }));
    const instance = env(join(root, 'acme-shop', '.env'));
    for (const name of ['PUBLIC_API_BASE_URL', 'ADMIN_BASE_URL', 'STOREFRONT_BASE_URL', 'CORS_ALLOWED_ORIGINS']) {
      expect(instance.has(name), name).toBe(false);
    }
  });

  it('FR-014 — with the admin on the same machine, `--api-url` is in `admin/.env` too', async () => {
    const root = host({ admin: true, origins: true });
    await runInstall(only(root, 'api,admin', { apiUrl: THE_API, run: recorder().run }));
    expect(env(join(root, 'acme-shop', 'admin', '.env')).get('VITE_API_BASE_URL')).toBe(THE_API);
    expect(env(join(root, 'acme-shop', '.env')).get('PUBLIC_API_BASE_URL')).toBe(THE_API);
  });

  it('FR-015 — the API without the storefront originates the secret, names its file, never its value', async () => {
    const root = host({ origins: true });
    const result = await runInstall(only(root, 'api', { run: recorder().run }));
    const secret = env(join(root, 'acme-shop', '.env')).get('REVALIDATE_SECRET');
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(20);
    const text = result.output.join('\n');
    expect(text).not.toContain(secret!);
    expect(text).toContain(`REVALIDATE_SECRET is in ${join(root, 'acme-shop', '.env')}`);
    expect(text).toContain('--revalidate-secret');
  });

  it('FR-015 — a `.env` the operator placed first gets the secret too: it has no placeholder to fill', async () => {
    // `new instance` merges into a placed `.env` and writes no placeholder
    // there; the declaration is then the `.env.example` beside it. Reading the
    // placeholders alone left the instance without the secret its storefront
    // was given — in the two-tree run as well.
    const root = host({ origins: true });
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'PORT=4455\n', 'utf8');
    const result = await runInstall(only(root, 'api', { run: recorder().run }));
    expect(env(join(target, '.env')).get('REVALIDATE_SECRET')?.length).toBeGreaterThan(20);
    expect(result.output.join('\n')).toContain(`REVALIDATE_SECRET is in ${join(target, '.env')}`);
  });

  it('FR-015 — `--revalidate-secret` is written verbatim, and still not printed', async () => {
    const root = host({ origins: true });
    const result = await runInstall(
      only(root, 'api', { revalidateSecret: 'a-value-the-operator-chose', run: recorder().run }),
    );
    expect(env(join(root, 'acme-shop', '.env')).get('REVALIDATE_SECRET')).toBe(
      'a-value-the-operator-chose',
    );
    expect(result.output.join('\n')).not.toContain('a-value-the-operator-chose');
  });

  it('FR-016 — a line the operator already answered is never written over', async () => {
    const root = host({ origins: true });
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, '.env'),
      'CORS_ALLOWED_ORIGINS=https://mine.example.com\nREVALIDATE_SECRET=mine\n',
      'utf8',
    );
    await runInstall(
      only(root, 'api', { adminUrl: THE_ADMIN, storefrontUrl: THE_SHOP, run: recorder().run }),
    );
    const instance = env(join(target, '.env'));
    expect(instance.get('CORS_ALLOWED_ORIGINS')).toBe('https://mine.example.com');
    expect(instance.get('REVALIDATE_SECRET')).toBe('mine');
    expect(instance.get('STOREFRONT_BASE_URL')).toBe(THE_SHOP);
  });

  it('a run with no `--only` and no origin writes none of this — today\'s `.env`', async () => {
    const root = host({ admin: true, origins: true, mfa: true });
    await runInstall(options(root, { run: recorder().run }));
    const instance = env(join(root, 'acme-shop', '.env'));
    for (const name of ['PUBLIC_API_BASE_URL', 'ADMIN_BASE_URL', 'STOREFRONT_BASE_URL', 'CORS_ALLOWED_ORIGINS', 'REVALIDATE_SECRET']) {
      expect(instance.has(name), name).toBe(false);
    }
    expect(existsSync(join(root, 'acme-shop', 'admin', '.env'))).toBe(false);
  });
});

describe('138 — each part on a port of its own', () => {
  const env = (path: string): string => readFileSync(path, 'utf8');
  /** 3000 and 3002 are somebody else's on this machine. */
  const TAKEN = async (port: number): Promise<boolean> => port === 3000 || port === 3002;

  it('a taken admin port is moved, written where Vite reads it, and allowed by the API', async () => {
    const root = host({ admin: true, origins: true });
    const result = await runInstall(
      only(root, 'api,admin', { portInUse: TAKEN, run: recorder().run }),
    );
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toMatch(/^PORT=13002$/m);
    expect(env(join(root, 'acme-shop', '.env'))).toMatch(
      /^CORS_ALLOWED_ORIGINS=http:\/\/localhost:13002,http:\/\/localhost:3000$/m,
    );
    const text = result.output.join('\n');
    expect(text).toContain('port 3002 is already in use on this machine');
    expect(text).toContain('http://localhost:13002');
  });

  it('a taken storefront port moves the storefront, its own address and the allow-list together', async () => {
    const root = checkoutFixture({ origins: true });
    const result = await runInstall(
      options(root, { storefront: true, portInUse: TAKEN, run: recorder().run }),
    );
    const shop = env(join(root, 'acme-shop-storefront', '.env'));
    expect(shop).toMatch(/^PORT=13000$/m);
    expect(shop).toMatch(/^NEXT_PUBLIC_SITE_URL=http:\/\/localhost:13000$/m);
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance).toMatch(/^STOREFRONT_BASE_URL=http:\/\/localhost:13000$/m);
    expect(instance).toMatch(/^CORS_ALLOWED_ORIGINS=http:\/\/localhost:3002,http:\/\/localhost:13000$/m);
    expect(result.output.join('\n')).toContain('the shop, on http://localhost:13000');
  });

  it('a loopback `--storefront-url` names the port: it is used as given, never moved', async () => {
    const root = checkoutFixture();
    const result = await runInstall(
      only(root, 'storefront', {
        apiUrl: 'http://localhost:43001',
        storefrontUrl: 'http://localhost:43000',
        revalidateSecret: 'x',
        portInUse: async () => true,
        run: recorder().run,
      }),
    );
    const shop = env(join(root, 'acme-shop', '.env'));
    expect(shop).toMatch(/^PORT=43000$/m);
    expect(shop).toMatch(/^NEXT_PUBLIC_SITE_URL=http:\/\/localhost:43000$/m);
    const text = result.output.join('\n');
    expect(text).not.toContain('already in use');
    expect(text).toContain('the shop, on http://localhost:43000');
  });

  it('a public `--storefront-url` says nothing about the port this machine serves on', async () => {
    const root = checkoutFixture();
    await runInstall(
      only(root, 'storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'x',
        run: recorder().run,
      }),
    );
    expect(env(join(root, 'acme-shop', '.env'))).not.toMatch(/^PORT=/m);
  });

  it('a loopback `--admin-url` is the port the admin beside the API is served on', async () => {
    const root = host({ admin: true, origins: true });
    await runInstall(
      only(root, 'api,admin', {
        adminUrl: 'http://127.0.0.1:43002',
        portInUse: TAKEN,
        run: recorder().run,
      }),
    );
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toMatch(/^PORT=43002$/m);
    expect(env(join(root, 'acme-shop', '.env'))).toMatch(
      /^CORS_ALLOWED_ORIGINS=http:\/\/127\.0\.0\.1:43002,http:\/\/localhost:3000$/m,
    );
  });

  it('a taken API port moves the API, and everything that names it moves with it', async () => {
    // It was only reported: the closing block said 3001 was busy and left the
    // admin bundle and the storefront pointed at whatever held it, so the
    // `dev:all` this run printed could not start the API.
    const root = checkoutFixture({ admin: true, origins: true });
    const result = await runInstall(
      options(root, { storefront: true, portInUse: async (port: number) => port === 3001, run: recorder().run }),
    );
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance).toMatch(/^PORT=13001$/m);
    expect(instance).toMatch(/^PUBLIC_API_BASE_URL=http:\/\/localhost:13001$/m);
    // The admin bundle is built against the API's address.
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toMatch(
      /^VITE_API_BASE_URL=http:\/\/localhost:13001$/m,
    );
    // The storefront's two backend addresses: the browser's and its own server's.
    const shop = env(join(root, 'acme-shop-storefront', '.env'));
    expect(shop).toMatch(/^NEXT_PUBLIC_API_BASE_URL=http:\/\/localhost:13001$/m);
    expect(shop).toMatch(/^BACKEND_BASE_URL=http:\/\/localhost:13001$/m);
    const text = result.output.join('\n');
    expect(text).toContain('port 3001 is already in use on this machine, so the API is served on http://localhost:13001 instead');
    expect(text).toContain('# the API, on http://localhost:13001');
    expect(text).not.toContain('localhost:3001');
    // Nothing is left for the operator to move by hand.
    expect(text).not.toContain('is in use on this machine right now');
  });

  it('a `PORT` the operator pinned is never moved: a taken one is said, with everything that names it', async () => {
    const root = checkoutFixture({ admin: true });
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'PORT=3001\n', 'utf8');
    const result = await runInstall(
      options(root, { storefront: true, portInUse: async (port: number) => port === 3001, run: recorder().run }),
    );
    expect(env(join(target, '.env')).match(/^PORT=/gm)).toHaveLength(1);
    expect(env(join(target, '.env'))).toMatch(/^PORT=3001$/m);
    const line = result.output.find((entry) => entry.includes('port 3001 is in use'))!;
    expect(line).toContain(join(root, 'acme-shop', '.env'));
    expect(line).toContain(join(root, 'acme-shop-storefront', '.env'));
    // The admin bundle is built against the API's address, so moving the API
    // is a line in `admin/.env` and a rebuild — not a restart.
    expect(line).toContain('VITE_API_BASE_URL');
    expect(line).toContain('pnpm run build:admin');
  });

  it('a moved API port never overwrites `--public-url`: the address is the operator\'s, the port this machine\'s', async () => {
    const root = host({ admin: true, origins: true });
    await runInstall(
      options(root, {
        publicUrl: 'https://shop.example.com',
        portInUse: async (port: number) => port === 3001,
        run: recorder().run,
      }),
    );
    const instance = env(join(root, 'acme-shop', '.env'));
    // Where the API listens moved; what the world calls it did not.
    expect(instance).toMatch(/^PORT=13001$/m);
    expect(instance).toMatch(/^PUBLIC_API_BASE_URL=https:\/\/shop\.example\.com$/m);
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toMatch(
      /^VITE_API_BASE_URL=https:\/\/shop\.example\.com$/m,
    );
  });

  it('a loopback `--public-url` names the proxy\'s port, not the API\'s', async () => {
    const root = host({ admin: true, origins: true });
    await runInstall(options(root, { publicUrl: 'http://localhost:8080', run: recorder().run }));
    expect(env(join(root, 'acme-shop', '.env'))).not.toMatch(/^PORT=8080$/m);
  });

  it('a loopback `--api-url` names the port this API listens on', async () => {
    const root = host({ origins: true });
    await runInstall(
      only(root, 'api', { apiUrl: 'http://localhost:43001', portInUse: TAKEN, run: recorder().run }),
    );
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance).toMatch(/^PORT=43001$/m);
    expect(instance).toMatch(/^PUBLIC_API_BASE_URL=http:\/\/localhost:43001$/m);
  });

  it('free ports move nothing and write no `PORT` line', async () => {
    const root = checkoutFixture({ admin: true, origins: true });
    await runInstall(options(root, { storefront: true, run: recorder().run }));
    expect(env(join(root, 'acme-shop-storefront', '.env'))).not.toMatch(/^PORT=/m);
    expect(existsSync(join(root, 'acme-shop', 'admin', '.env'))).toBe(false);
    expect(env(join(root, 'acme-shop', '.env'))).not.toMatch(/^CORS_ALLOWED_ORIGINS=/m);
  });

  it('an API on a port of its own is where the admin bundle is pointed', async () => {
    const root = host({ admin: true });
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'PORT=4455\n', 'utf8');
    await runInstall(options(root, { run: recorder().run }));
    expect(env(join(target, 'admin', '.env'))).toMatch(
      /^VITE_API_BASE_URL=http:\/\/localhost:4455$/m,
    );
  });

  it('`--registry` reaches the storefront as well as the instance', async () => {
    const root = checkoutFixture({ scopedDependency: true });
    await runInstall(
      options(root, {
        storefront: true,
        registry: 'https://registry.example.com/npm/',
        run: recorder().run,
      }),
    );
    expect(env(join(root, 'acme-shop', '.npmrc'))).toContain('registry.example.com');
    expect(env(join(root, 'acme-shop-storefront', '.npmrc'))).toContain('registry.example.com');
  });
});

describe('138 FR-020 — the closing block is about this machine, and says what the others owe it', () => {
  const closingOf = (result: { readonly output: readonly string[] }): string => {
    const text = result.output.join('\n');
    return text.slice(text.lastIndexOf('Done. To start it:'));
  };

  it('`admin` — the bundle\'s command only, and the four facts under one heading', async () => {
    const root = host({ admin: true });
    const result = await runInstall(only(root, 'admin', { apiUrl: THE_API, run: recorder().run }));
    const text = closingOf(result);
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && pnpm run preview:admin`);
    expect(text).toContain('http://localhost:3002');
    expect(text).not.toContain('pnpm run start');
    expect(text).not.toContain('dev:all');
    expect(text).not.toContain('Sign in as');
    expect(text).not.toContain('demo');
    expect(text).not.toContain('mail');
    expect(text.split('What the other machines owe this one').length - 1).toBe(1);
    expect(text).toContain('CORS_ALLOWED_ORIGINS');
    expect(text).toContain('at build time');
    expect(text).toContain('same-site');
    expect(text).toContain('SameSite=Lax');
    expect(text).toContain('the modules this tree installed');
    expect(text).toContain(THE_API);
  });

  it('`storefront` — the shop\'s commands only, in its own directory', async () => {
    const root = checkoutFixture();
    const result = await runInstall(
      only(root, 'storefront', {
        apiUrl: THE_API,
        storefrontUrl: THE_SHOP,
        revalidateSecret: 'the-api-already-holds-this',
        run: recorder().run,
      }),
    );
    const text = closingOf(result);
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && pnpm run build && pnpm run start`);
    expect(text).not.toContain('preview:admin');
    expect(text).not.toContain('dev:all');
    expect(text).not.toContain('Sign in as');
    expect(text).toContain('What the other machines owe this one');
    expect(text).toContain(THE_SHOP);
    expect(result.output.join('\n')).not.toContain('the-api-already-holds-this');
  });

  it('`api` — the API\'s command, no admin and no shop, and where the secret is', async () => {
    const root = host({ admin: true, origins: true });
    const result = await runInstall(only(root, 'api', { run: recorder().run }));
    const text = closingOf(result);
    expect(text).toContain(`cd ${join(root, 'acme-shop')} && pnpm run start`);
    expect(text).not.toContain('preview:admin');
    expect(text).not.toContain('the shop');
    expect(text).toContain('Sign in as owner@example.com');
    expect(text).toContain('What the other machines owe this one');
    expect(text).toContain(`REVALIDATE_SECRET is in ${join(root, 'acme-shop', '.env')}`);
  });

  it('all three — no such heading: nothing is on another machine', async () => {
    const root = checkoutFixture({ admin: true });
    const result = await runInstall(options(root, { storefront: true, run: recorder().run }));
    expect(closingOf(result)).not.toContain('What the other machines owe this one');
  });

  it('FR-019 — the `[answers]` line counts the questions the selection has', async () => {
    const admin = host({ admin: true });
    expect(
      (await runInstall(only(admin, 'admin', { apiUrl: THE_API, run: recorder().run }))).answers,
    ).toBe('[answers] resolved: total=3 flags=3 prompted=0 recommended=0 defaulted=0');
    const api = host();
    expect((await runInstall(only(api, 'api', { adminUrl: THE_ADMIN, run: recorder().run }))).answers).toBe(
      '[answers] resolved: total=10 flags=8 prompted=0 recommended=2 (api-url, storefront-url) defaulted=0',
    );
  });
});

// ---------------------------------------------------------------------------
// specs/138-separate-components, addendum — layout (b): one host with paths
// ---------------------------------------------------------------------------

describe('138 FR-023…FR-027 — one host with paths: the storefront at /, the admin under /admin, the API under /api', () => {
  const HOST = 'https://example.com';
  const env = (path: string): Map<string, string> => {
    const values = new Map<string, string>();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match !== null) values.set(match[1]!, match[2]!);
    }
    return values;
  };

  it('`--public-url` on the admin alone: built against the host, for the base path /admin', async () => {
    const root = host({ admin: true });
    const result = await runInstall(only(root, 'admin', { publicUrl: HOST, run: recorder().run }));
    expect(env(join(root, 'acme-shop', 'admin', '.env'))).toEqual(
      new Map([
        ['VITE_API_BASE_URL', HOST],
        ['ADMIN_BASE_PATH', '/admin/'],
      ]),
    );
    expect(result.steps.map((step) => step.id)).toEqual(['install', 'build-admin']);
    // The block is about this layout on this machine too: where the preview
    // answers — under the base path — and the routing the one host owes.
    const text = result.output.join('\n');
    expect(text).toContain('the admin bundle, on http://localhost:3002/admin/');
    expect(text).toContain(`One host, with paths (${HOST})`);
    expect(text).not.toContain('For this admin that is the address it is served at');
  });

  it('`--admin-url` with a base path of its own, on the admin alone', async () => {
    const root = host({ admin: true });
    await runInstall(
      only(root, 'admin', { apiUrl: THE_API, adminUrl: 'https://example.com/back/office', run: recorder().run }),
    );
    expect(env(join(root, 'acme-shop', 'admin', '.env')).get('ADMIN_BASE_PATH')).toBe('/back/office/');
  });

  it('an admin with no base path writes none: the bundle is the one built before', async () => {
    const root = host({ admin: true });
    await runInstall(only(root, 'admin', { apiUrl: THE_API, adminUrl: THE_ADMIN, run: recorder().run }));
    expect(env(join(root, 'acme-shop', 'admin', '.env')).has('ADMIN_BASE_PATH')).toBe(false);
  });

  it('`--public-url` on the API: one origin in the allow-list, and the admin\'s address with its path', async () => {
    const root = host({ origins: true, mfa: true });
    await runInstall(only(root, 'api', { publicUrl: HOST, run: recorder().run }));
    const instance = env(join(root, 'acme-shop', '.env'));
    expect(instance.get('PUBLIC_API_BASE_URL')).toBe(HOST);
    expect(instance.get('STOREFRONT_BASE_URL')).toBe(HOST);
    expect(instance.get('ADMIN_BASE_URL')).toBe(`${HOST}/admin`);
    // Origins, each once: a path is not part of what a browser sends as `Origin`.
    expect(instance.get('CORS_ALLOWED_ORIGINS')).toBe(HOST);
  });

  it('`--public-url` on the storefront alone: the API and the shop are one address', async () => {
    const root = checkoutFixture();
    await runInstall(
      only(root, 'storefront', { publicUrl: HOST, revalidateSecret: 'x', run: recorder().run }),
    );
    const shop = env(join(root, 'acme-shop', '.env'));
    expect(shop.get('NEXT_PUBLIC_API_BASE_URL')).toBe(HOST);
    expect(shop.get('BACKEND_BASE_URL')).toBe(HOST);
    expect(shop.get('NEXT_PUBLIC_SITE_URL')).toBe(HOST);
  });

  it('all three behind one proxy on this machine: the proxy\'s port is nobody\'s `PORT`', async () => {
    const root = checkoutFixture({ admin: true, origins: true });
    const result = await runInstall(
      options(root, { storefront: true, publicUrl: 'http://localhost:48080', run: recorder().run }),
    );
    const shop = env(join(root, 'acme-shop-storefront', '.env'));
    expect(shop.has('PORT')).toBe(false);
    expect(shop.get('NEXT_PUBLIC_SITE_URL')).toBe('http://localhost:48080');
    expect(shop.get('NEXT_PUBLIC_API_BASE_URL')).toBe('http://localhost:48080');
    // Its own server still reaches the API beside it directly.
    expect(shop.get('BACKEND_BASE_URL')).toBe('http://localhost:3001');
    const admin = env(join(root, 'acme-shop', 'admin', '.env'));
    expect(admin.has('PORT')).toBe(false);
    expect(admin.get('ADMIN_BASE_PATH')).toBe('/admin/');
    expect(env(join(root, 'acme-shop', '.env')).get('CORS_ALLOWED_ORIGINS')).toBe('http://localhost:48080');
    // FR-028 — the routing the one host owes, said once.
    const text = result.output.join('\n');
    expect(text).toContain('One host, with paths (http://localhost:48080)');
    expect(text).toContain('/api/revalidate');
    expect(text).toContain('/assets/file/');
    expect(text).toContain('/admin/');
    expect(text).toContain('deploy/nginx.paths.example.conf');
  });

  it('FR-024 — `--public-url` beside one of the three it stands for is refused', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(only(root, 'admin', { publicUrl: HOST, apiUrl: THE_API }));
    expect(message).toContain('`--public-url`');
    expect(message).toContain('`--api-url`');
    expect(message).toContain('Pass one');
  });

  it('FR-024 — `--public-url` is the host: a path on it is refused', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(only(root, 'admin', { publicUrl: 'https://example.com/shop' }));
    expect(message).toContain('`--public-url https://example.com/shop` is not an origin');
  });

  it('FR-023 — `--api-url` with a path is refused, saying the API\'s routes already begin with /api', async () => {
    const root = host({ admin: true });
    const message = await refusalOf(only(root, 'admin', { apiUrl: 'https://example.com/api' }));
    expect(message).toContain('`--api-url https://example.com/api`');
    expect(message).toContain('/api/v1');
    expect(message).toContain('https://example.com');
  });

  it('FR-023 — `--admin-url` with a trailing slash or a query is refused', async () => {
    const root = host({ admin: true });
    for (const value of ['https://example.com/admin/', 'https://example.com/admin?x=1']) {
      const message = await refusalOf(only(root, 'admin', { apiUrl: THE_API, adminUrl: value }));
      expect(message).toContain(`\`--admin-url ${value}\``);
      expect(message).toContain('base path');
    }
  });

  it('FR-025 — `--admin-url` is still refused where neither the admin nor the API is stood up', async () => {
    const root = checkoutFixture();
    const message = await refusalOf(
      only(root, 'storefront', { apiUrl: THE_API, storefrontUrl: THE_SHOP, revalidateSecret: 'x', adminUrl: THE_ADMIN }),
    );
    expect(message).toContain('`--admin-url`');
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
function checkoutFixture(fixture: Parameters<typeof installFixture>[1] = {}): string {
  const root = temp('endora-install-checkout-');
  installFixture(root, fixture);
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - shop\n${fixture.scopedDependency === true ? '  - packages/*\n' : ''}`,
  );
  if (fixture.scopedDependency === true) {
    // What `--registry` answers for: a scoped package the storefront reaches
    // through the workspace, which a standalone copy has to fetch.
    mkdirSync(join(root, 'packages', 'contracts'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'contracts', 'package.json'),
      `${JSON.stringify({ name: '@endora-commerce/contracts', version: '1.0.0' }, null, 2)}\n`,
    );
  }
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-root', private: true, packageManager: 'pnpm@9.15.0' }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'shop'), { recursive: true });
  writeFileSync(
    join(root, 'shop', 'package.json'),
    `${JSON.stringify(
      {
        name: 'shop',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: {
          next: '^15.0.0',
          ...(fixture.scopedDependency === true ? { '@endora-commerce/contracts': 'workspace:*' } : {}),
        },
      },
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
  ...['BACKEND_BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SALES_CHANNEL_CODE'].map((name) => ({
    name,
    describes: { en: 'one of the five values the one-shot owes a storefront.', pl: 'x.' },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'application', application: 'storefront' },
    consumers: ['storefront'],
    addressOf: name === 'BACKEND_BASE_URL' ? 'backend' : name === 'NEXT_PUBLIC_SITE_URL' ? 'storefront' : null,
  })),
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
