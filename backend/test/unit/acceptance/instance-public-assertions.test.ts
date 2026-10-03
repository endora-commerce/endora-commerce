/**
 * The `public` acceptance mode's judgement, one red proof per finding
 * (`specs/136-open-source-publication/spec.md` §6.4, GAP-8, FR-070; plan W5.4).
 *
 * The mode itself needs a published version on npmjs, a GitHub-hosted runner,
 * Docker and a quarter of an hour, and until `0.100.0` exists it cannot run at
 * all — so the workflow lands dormant and **these** are what keep its verdicts
 * honest in the meantime. Every fixture enters at the top of the analysis — a
 * lockfile's text, the manifests an install left, an HTTP status — and never a
 * verdict the harness computes (issue #130).
 *
 * As in `instance-assertions.test.ts`, the discriminations matter as much as
 * the reds: a step that did not run is `unmeasured`, never a pass and never a
 * failure, and an empty population is not a green.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ASSERTION_CATALOGUE,
  PUBLIC_ASSERTION_IDS,
  PUBLIC_NPM_REGISTRY,
  adminPasswordFlag,
  cleanMachineRefusals,
  evaluateCommandCount,
  evaluateLicences,
  evaluateLockfile,
  evaluateLogin,
  evaluateStorefront,
  lockfileEntries,
  publicExitCode,
  oneShotCommand,
  printedDevAllCommand,
  strangerCommands,
  strangerEnvironment,
  withoutPassword,
} from '../../../scripts/acceptance/instance-public-assertions.js';

const SCRIPTS = fileURLToPath(new URL('../../../scripts/acceptance/', import.meta.url));

/** A pnpm v9 lockfile, trimmed to the parts the parser reads. */
function lockfile(packages: string): string {
  return [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    "      '@endora-commerce/platform':",
    '        specifier: ^0.100.0',
    '        version: 0.100.0',
    '',
    'packages:',
    '',
    packages,
    '',
    'snapshots:',
    '',
    "  '@endora-commerce/platform@0.100.0':",
    '    dependencies:',
    '      zod: 4.1.0',
    '',
  ].join('\n');
}

const FROM_NPMJS = [
  "  '@endora-commerce/platform@0.100.0':",
  '    resolution: {integrity: sha512-AAAA}',
  "    engines: {node: '>=22.18.0'}",
  '',
  "  '@endora-commerce/mod-settings@0.100.0':",
  '    resolution: {integrity: sha512-BBBB}',
  '',
  '  zod@4.1.0:',
  '    resolution: {integrity: sha512-CCCC}',
].join('\n');

describe('the catalogue', () => {
  it("names §6.4's five properties, and a title for each", () => {
    expect(PUBLIC_ASSERTION_IDS).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    for (const id of PUBLIC_ASSERTION_IDS) {
      expect(PUBLIC_ASSERTION_CATALOGUE[id].length).toBeGreaterThan(20);
    }
  });
});

describe('a clean machine is a precondition, refused rather than assumed', () => {
  it('holds on a machine with no `.npmrc`, no credential and npmjs as the registry', () => {
    expect(
      cleanMachineRefusals({ npmrcFiles: [], env: {}, npmRegistry: PUBLIC_NPM_REGISTRY }),
    ).toEqual([]);
  });

  it('refuses an `.npmrc` anywhere it would be read, naming the file', () => {
    const refusals = cleanMachineRefusals({
      npmrcFiles: ['/home/runner/.npmrc'],
      env: {},
      npmRegistry: PUBLIC_NPM_REGISTRY,
    });
    expect(refusals.join('\n')).toContain('/home/runner/.npmrc');
  });

  it('refuses a registry credential in the environment, naming the variable and never its value', () => {
    const refusals = cleanMachineRefusals({
      npmrcFiles: [],
      env: { NODE_AUTH_TOKEN: 'secret-value-123', ENDORA_NPM_TOKEN: 'another-456' },
      npmRegistry: PUBLIC_NPM_REGISTRY,
    });
    const text = refusals.join('\n');
    expect(text).toContain('NODE_AUTH_TOKEN');
    expect(text).toContain('ENDORA_NPM_TOKEN');
    expect(text).not.toContain('secret-value-123');
    expect(text).not.toContain('another-456');
  });

  it('refuses a default registry that is not npmjs, and an unreadable one', () => {
    expect(
      cleanMachineRefusals({
        npmrcFiles: [],
        env: {},
        npmRegistry: 'https://gitlab.example.com/api/v4/packages/npm/',
      }),
    ).toHaveLength(1);
    expect(cleanMachineRefusals({ npmrcFiles: [], env: {}, npmRegistry: null })).toHaveLength(1);
  });

  it('refuses a registry override in the environment, and not one that names npmjs', () => {
    const redirected = cleanMachineRefusals({
      npmrcFiles: [],
      env: { npm_config_registry: 'https://gitlab.example.com/api/v4/packages/npm/' },
      npmRegistry: PUBLIC_NPM_REGISTRY,
    });
    expect(redirected.join('\n')).toContain('npm_config_registry');
    // `npx` exports its effective configuration into what it runs, so the
    // harness it starts sees npm's own default here — which is not an override.
    expect(
      cleanMachineRefusals({
        npmrcFiles: [],
        env: {
          npm_config_registry: 'https://registry.npmjs.org/',
          npm_config_userconfig: '/home/runner/.npmrc',
        },
        npmRegistry: PUBLIC_NPM_REGISTRY,
      }),
    ).toEqual([]);
  });

  it('an empty credential variable is not a credential', () => {
    expect(
      cleanMachineRefusals({
        npmrcFiles: [],
        env: { NPM_TOKEN: '' },
        npmRegistry: PUBLIC_NPM_REGISTRY,
      }),
    ).toEqual([]);
  });
});

describe("the stranger's commands run in a stranger's environment, not the harness's", () => {
  // Run 36834341414 (0.100.0): the workflow starts the harness with
  // `npx --package=tsx@4 -- tsx …`, `npx` exports `npm_config_package=tsx@4`
  // into it, and the one-shot's own `npx --yes create-endora-commerce@0.100.0`
  // inherited it — so npm ran `create-endora-commerce@0.100.0` as a command
  // inside the tsx package, exit 127, and nothing was measured.
  const npxBin = '/home/runner/.npm/_npx/17e7e13df003209e/node_modules/.bin';
  const inherited: Record<string, string | undefined> = {
    HOME: '/home/runner',
    PATH: [
      npxBin,
      '/home/runner/work/_temp/node_modules/.bin',
      '/node_modules/.bin',
      '/opt/hostedtoolcache/node/22.18.0/x64/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',
      '/opt/hostedtoolcache/node/22.18.0/x64/bin',
      '/usr/local/bin',
      '/usr/bin',
    ].join(':'),
    RUNNER_TEMP: '/home/runner/work/_temp',
    DOCKER_HOST: 'unix:///var/run/docker.sock',
    npm_config_package: 'tsx@4',
    npm_config_yes: 'true',
    npm_config_cache: '/home/runner/.npm',
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_user_agent: 'npm/10.9.3 node/v22.18.0 linux x64 workspaces/false',
    NPM_CONFIG_LOGLEVEL: 'silly',
    npm_config_userconfig: '/home/runner/.npmrc',
    npm_package_json: '/home/runner/work/_temp/package.json',
    npm_package_name: 'tsx',
    npm_lifecycle_event: 'npx',
    npm_lifecycle_script: 'tsx',
    npm_execpath: '/opt/hostedtoolcache/node/22.18.0/x64/lib/node_modules/npm/bin/npm-cli.js',
    npm_node_execpath: '/opt/hostedtoolcache/node/22.18.0/x64/bin/node',
    npm_command: 'exec',
    INIT_CWD: '/home/runner/work/_temp',
    NODE: '/opt/hostedtoolcache/node/22.18.0/x64/bin/node',
    COLOR: '0',
    PNPM_SCRIPT_SRC_DIR: '/home/runner/work/endora',
    pnpm_config_verify_deps_before_run: 'false',
    UNSET: undefined,
  };
  const stranger = strangerEnvironment(inherited);

  it('drops the variable that broke run 36834341414', () => {
    expect(stranger).not.toHaveProperty('npm_config_package');
  });

  it('drops every npm and pnpm configuration, package, lifecycle and exec variable it inherited', () => {
    const leaked = Object.keys(stranger).filter(
      (name) =>
        /^(npm|pnpm)_(config|package|lifecycle)_/i.test(name) && name !== 'npm_config_userconfig',
    );
    expect(leaked).toEqual([]);
    for (const name of [
      'npm_execpath',
      'npm_node_execpath',
      'npm_command',
      'INIT_CWD',
      'NODE',
      'COLOR',
      'PNPM_SCRIPT_SRC_DIR',
    ]) {
      expect(stranger, name).not.toHaveProperty(name);
    }
  });

  it('drops the `node_modules/.bin` directories npx put on PATH, and keeps the rest in order', () => {
    expect(stranger['PATH']).toBe(
      '/opt/hostedtoolcache/node/22.18.0/x64/bin:/usr/local/bin:/usr/bin',
    );
  });

  it('keeps what the harness relies on: HOME, the user config the clean-machine check read, and the rest', () => {
    expect(stranger['HOME']).toBe('/home/runner');
    // `npmrcFilesFor` decided this machine is clean by reading this path; the
    // commands it then runs must read the same one, not another.
    expect(stranger['npm_config_userconfig']).toBe('/home/runner/.npmrc');
    expect(stranger['RUNNER_TEMP']).toBe('/home/runner/work/_temp');
    expect(stranger['DOCKER_HOST']).toBe('unix:///var/run/docker.sock');
    expect(stranger).not.toHaveProperty('UNSET');
  });

  it('leaves an environment that never went through npx as it was', () => {
    const plain = { HOME: '/home/a', PATH: '/usr/local/bin:/usr/bin', LANG: 'C.UTF-8' };
    expect(strangerEnvironment(plain)).toEqual(plain);
  });

  it('is what the harness hands every `sh` and `npm` it spawns', () => {
    const source = readFileSync(`${SCRIPTS}instance-public.ts`, 'utf8');
    const calls = [...source.matchAll(/\bspawn(?:Sync)?\(\s*'(sh|npm)'[\s\S]*?\);/g)].map(
      (match) => match[0],
    );
    // A count of zero is a regex that stopped matching, not a harness that spawns nothing.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const bare = calls.filter((call) => !/\benv:\s*stranger\b/.test(call));
    expect(bare).toEqual([]);
  });
});

/**
 * The second command is **the one the one-shot printed**, read from its output,
 * and never a copy written here. W5.5 against `0.100.1` (run 36868691058) is
 * why: this file said `cd shop && pnpm run dev:all` while the CLI, on a machine
 * with no `pnpm`, needed another spelling — so the harness typed a command no
 * stranger was told to type, and measured its own assumption (exit 127).
 */
describe('the second command is the one the one-shot printed', () => {
  const printed = [
    'Done. To start it:',
    '  (`pnpm` is not on your PATH, so these run pnpm@9.15.0 through `npx`, which comes with Node.)',
    '  cd /tmp/endora-public-x/shop && npx --yes pnpm@9.15.0 run dev:all   # every layer, one terminal; Ctrl-C stops them',
    '',
    'Or one layer at a time:',
    '  cd /tmp/endora-public-x/shop && npx --yes pnpm@9.15.0 run start      # the API, on http://localhost:3001',
  ].join('\n');

  it('reads the `run dev:all` line, without its comment', () => {
    expect(printedDevAllCommand(printed)).toBe(
      'cd /tmp/endora-public-x/shop && npx --yes pnpm@9.15.0 run dev:all',
    );
  });

  it('keeps the arguments the line carries', () => {
    expect(
      printedDevAllCommand('  cd /s && pnpm run dev:all -- --storefront-dir /f   # every layer'),
    ).toBe('cd /s && pnpm run dev:all -- --storefront-dir /f');
  });

  it('answers nothing when the one-shot printed no such line', () => {
    expect(printedDevAllCommand('endora: something failed\n')).toBeNull();
  });

  it('types the one-shot, then exactly what it printed', () => {
    const typed = strangerCommands({
      packageName: 'create-endora-commerce',
      version: '0.100.1',
      dir: 'shop',
      admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
      installOutput: printed,
    });
    expect(typed).toEqual([
      oneShotCommand({
        packageName: 'create-endora-commerce',
        version: '0.100.1',
        dir: 'shop',
        admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
      }),
      'cd /tmp/endora-public-x/shop && npx --yes pnpm@9.15.0 run dev:all',
    ]);
  });

  it('is one command long when nothing was printed, so the sequence did not reach its end', () => {
    const typed = strangerCommands({
      packageName: 'create-endora-commerce',
      version: '0.100.1',
      dir: 'shop',
      admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
      installOutput: '',
    });
    expect(typed).toHaveLength(1);
  });
});

describe('P5 — the commands a stranger typed are counted, not described', () => {
  const typed = strangerCommands({
    packageName: 'create-endora-commerce',
    version: '0.100.0',
    dir: 'shop',
    admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
    installOutput: '  cd /h/shop && pnpm run dev:all   # every layer\n',
  });

  it('is the two-command sequence §6.2 names as the target', () => {
    expect(typed).toHaveLength(2);
    expect(typed[0]).toMatch(/^npx --yes create-endora-commerce@0\.100\.0 shop /);
    expect(typed[0]).toContain('--non-interactive');
    expect(typed[1]).toBe('cd /h/shop && pnpm run dev:all');
  });

  it('passes at two, the target, and at five, 123 SC-001 pass line', () => {
    expect(evaluateCommandCount(typed).state).toBe('pass');
    expect(evaluateCommandCount(['a', 'b', 'c', 'd', 'e']).state).toBe('pass');
    expect(evaluateCommandCount(['a', 'b', 'c', 'd', 'e']).detail).toContain('target is 2');
  });

  it('fails at six', () => {
    expect(evaluateCommandCount(['a', 'b', 'c', 'd', 'e', 'f']).state).toBe('fail');
  });

  it('a sequence that stopped part way is unmeasured, not a short count', () => {
    const result = evaluateCommandCount(typed.slice(0, 1), false);
    expect(result.state).toBe('unmeasured');
  });

  it('never prints the administrator password it was typed with', () => {
    expect(evaluateCommandCount(typed).detail).not.toContain('--admin-password');
  });

  it('an empty sequence is not a stranger who typed nothing — it is a harness that ran nothing', () => {
    expect(evaluateCommandCount([]).state).toBe('unmeasured');
  });
});

describe('P1 — an administrator logs in', () => {
  it('passes on 200', () => {
    expect(evaluateLogin({ healthStatus: 200, loginStatus: 200, body: '{}' }).state).toBe('pass');
  });

  it('fails on anything else, quoting the body', () => {
    const result = evaluateLogin({ healthStatus: 200, loginStatus: 401, body: 'invalid credentials' });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('401');
    expect(result.detail).toContain('invalid credentials');
  });

  it('fails when the API never answered its health check — the stranger has nothing to log in to', () => {
    const result = evaluateLogin({ healthStatus: null, loginStatus: null, body: 'ECONNREFUSED' });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('fails when the one-shot itself failed — a published version a stranger cannot install is red', () => {
    const result = evaluateLogin({
      healthStatus: null,
      loginStatus: null,
      body: '',
      installFailed: 'the one-shot exited 1',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('the one-shot exited 1');
  });
});

describe('P2 — with `--demo`, the storefront renders a catalogue', () => {
  const RAN = { installed: true, started: true, written: true } as const;

  it('the one-shot is typed without `--no-storefront`: a stranger no longer has to', () => {
    const command = oneShotCommand({
      packageName: 'create-endora-commerce',
      version: '0.101.0',
      dir: 'shop',
      admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
    });
    expect(command).not.toContain('--no-storefront');
    expect(command).toContain('--demo');
  });

  it('a one-shot that exited 0 and wrote no storefront is a failure, not an unmeasured', () => {
    // It was `unmeasured` while the CLI refused the storefront outside a
    // checkout. The command is now typed without the flag that skips it, so
    // nothing written is the product doing less than it was asked.
    const result = evaluateStorefront({ ...RAN, written: false });
    expect(result.state).toBe('fail');
    expect(result.detail).toMatch(/wrote no storefront/);
  });

  it('is unmeasured when the one-shot failed or nothing started — P1 carries that', () => {
    expect(evaluateStorefront({ ...RAN, installed: false }).state).toBe('unmeasured');
    expect(evaluateStorefront({ ...RAN, started: false }).state).toBe('unmeasured');
  });

  it('passes when the catalogue answers 200 and links a product', () => {
    expect(
      evaluateStorefront({ ...RAN, status: 200, html: '<a href="/p/blue-chair">' }).state,
    ).toBe('pass');
  });

  it('fails on a catalogue with no product in it — a demo that seeded nothing', () => {
    expect(
      evaluateStorefront({ ...RAN, status: 200, html: '<main>No products</main>' }).state,
    ).toBe('fail');
  });

  it('fails on a storefront that did not answer', () => {
    expect(evaluateStorefront({ ...RAN, status: 500, html: '' }).state).toBe('fail');
    expect(evaluateStorefront({ ...RAN, status: null }).state).toBe('fail');
  });
});

describe('P3 — every `@endora-commerce/*` entry in the lockfile resolves from npmjs', () => {
  it('reads the packages section, and only it', () => {
    const entries = lockfileEntries(lockfile(FROM_NPMJS));
    expect(entries.map((entry) => entry.name)).toEqual([
      '@endora-commerce/platform',
      '@endora-commerce/mod-settings',
      'zod',
    ]);
    expect(entries[0]).toMatchObject({ version: '0.100.0', integrity: true, tarball: null });
  });

  it('passes when every one of ours is an integrity-only resolution from the default registry', () => {
    const result = evaluateLockfile({ lockfile: lockfile(FROM_NPMJS), instanceNpmrc: null });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('2');
  });

  it('fails on a tarball URL on another host, naming the package and the host', () => {
    const result = evaluateLockfile({
      lockfile: lockfile(
        [
          FROM_NPMJS,
          '',
          "  '@endora-commerce/mod-orders@0.100.0':",
          '    resolution: {integrity: sha512-DDDD, tarball: https://gitlab.example.com/api/v4/packages/npm/@endora-commerce/mod-orders/-/mod-orders-0.100.0.tgz}',
        ].join('\n'),
      ),
      instanceNpmrc: null,
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('@endora-commerce/mod-orders');
    expect(result.detail).toContain('gitlab.example.com');
  });

  it('a tarball on registry.npmjs.org itself is npmjs', () => {
    const result = evaluateLockfile({
      lockfile: lockfile(
        [
          "  '@endora-commerce/platform@0.100.0':",
          '    resolution: {integrity: sha512-AAAA, tarball: https://registry.npmjs.org/@endora-commerce/platform/-/platform-0.100.0.tgz}',
        ].join('\n'),
      ),
      instanceNpmrc: null,
    });
    expect(result.state).toBe('pass');
  });

  it('fails on a local tarball or a directory — the tarball mode leaking into a public run', () => {
    for (const resolution of [
      '{integrity: sha512-AAAA, tarball: file:../tarballs/platform.tgz}',
      '{directory: ../packages/platform, type: directory}',
    ]) {
      const result = evaluateLockfile({
        lockfile: lockfile(
          ["  '@endora-commerce/platform@0.100.0':", `    resolution: ${resolution}`].join('\n'),
        ),
        instanceNpmrc: null,
      });
      expect(result.state, resolution).toBe('fail');
    }
  });

  it('fails when the instance carries an `.npmrc` sending our scope somewhere else', () => {
    const result = evaluateLockfile({
      lockfile: lockfile(FROM_NPMJS),
      instanceNpmrc: '@endora-commerce:registry=https://gitlab.example.com/api/v4/packages/npm/\n',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('.npmrc');
  });

  it('is unmeasured with no lockfile, and with a lockfile naming none of ours — never a vacuous pass', () => {
    expect(evaluateLockfile({ lockfile: null, instanceNpmrc: null }).state).toBe('unmeasured');
    expect(
      evaluateLockfile({
        lockfile: lockfile('  zod@4.1.0:\n    resolution: {integrity: sha512-CCCC}'),
        instanceNpmrc: null,
      }).state,
    ).toBe('unmeasured');
  });
});

describe('P4 — no installed package declares `SEE LICENSE IN`', () => {
  it('passes over a population of MIT and other SPDX identifiers', () => {
    const result = evaluateLicences([
      { name: '@endora-commerce/platform', version: '0.100.0', license: 'MIT' },
      { name: 'zod', version: '4.1.0', license: 'MIT' },
      { name: 'pg', version: '8.0.0', license: 'MIT OR Apache-2.0' },
    ]);
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('3');
  });

  it('fails naming every package with terms of its own', () => {
    const result = evaluateLicences([
      { name: '@endora-commerce/platform', version: '0.100.0', license: 'MIT' },
      { name: '@endora-commerce/mod-ksef', version: '0.100.0', license: 'SEE LICENSE IN LICENSE.md' },
      { name: 'other', version: '1.0.0', license: 'see license in terms.txt' },
    ]);
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('@endora-commerce/mod-ksef@0.100.0');
    expect(result.detail).toContain('other@1.0.0');
    expect(result.detail).not.toContain('platform');
  });

  it('is unmeasured over an empty population', () => {
    expect(evaluateLicences([]).state).toBe('unmeasured');
  });
});

describe('the exit code', () => {
  it('is 0 all pass, 1 any fail, 2 any unmeasured and none failed', () => {
    const pass = { id: 'P1', state: 'pass', detail: '' } as const;
    const fail = { id: 'P2', state: 'fail', detail: '' } as const;
    const unmeasured = { id: 'P3', state: 'unmeasured', detail: '' } as const;
    expect(publicExitCode([pass])).toBe(0);
    expect(publicExitCode([pass, unmeasured])).toBe(2);
    expect(publicExitCode([pass, unmeasured, fail])).toBe(1);
    expect(publicExitCode([])).toBe(2);
  });
});

describe('the harness runs on a machine with nothing of ours installed', () => {
  // The whole premise of the mode: a GitHub-hosted runner with Node and Docker
  // and **no workspace install**. The harness is run from a bare checkout with
  // `npx tsx`, so neither file may import a workspace package — the first one
  // that did would make the mode need `pnpm install` of this repository, and
  // a machine that has done that is not a stranger's.
  //
  // `process-teardown.ts` is the harness's second sibling — how it stops what it
  // started and bounds its own exit — and is held to the same rule here, so the
  // property stays true of everything the harness loads rather than of the two
  // files it began with. The workflow's sparse checkout is the whole
  // `backend/scripts/acceptance` directory, so a sibling is present there.
  const SIBLINGS = ['./instance-public-assertions.js', './process-teardown.js'];
  for (const file of ['instance-public.ts', 'instance-public-assertions.ts', 'process-teardown.ts']) {
    it(`${file} imports only node builtins and its siblings`, () => {
      const source = readFileSync(`${SCRIPTS}${file}`, 'utf8');
      const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(
        (match) => match[1]!,
      );
      // The harness imports at least its judgement; a count of zero there is
      // a regex that stopped matching, not a file with no dependencies.
      if (file === 'instance-public.ts') expect(specifiers.length).toBeGreaterThan(1);
      const foreign = specifiers.filter(
        (specifier) => !specifier.startsWith('node:') && !SIBLINGS.includes(specifier),
      );
      expect(foreign).toEqual([]);
    });
  }
});

describe('a password that starts with `-` reaches the CLI as a value', () => {
  // `randomBytes(18).toString('base64url')` starts with `-` one time in 64, and
  // `--admin-password -x…` is refused by the CLI's parser as an option missing
  // its value — P1 went red on runs with nothing wrong with them.
  const password = '-Xy_9-secret';

  it('the one-shot carries it in the `=` form', () => {
    const command = oneShotCommand({
      packageName: 'create-endora-commerce',
      version: '0.102.0',
      dir: 'shop',
      admin: { email: 'owner@example.com', password, firstName: 'Ada', lastName: 'L' },
    });
    expect(command).toContain(`--admin-password=${password}`);
    expect(command).not.toContain('--admin-password ');
    expect(adminPasswordFlag(password)).toBe(`--admin-password=${password}`);
  });

  it('what is printed stops before it, in either form', () => {
    expect(withoutPassword(`npx x shop --admin-password=${password} --admin-first-name Ada`)).toBe('npx x shop');
    expect(withoutPassword(`npx x shop --admin-password ${password}`)).toBe('npx x shop');
  });

  it('no harness passes the password as an argument of its own', () => {
    for (const file of ['instance-local-registry.ts', 'instance-public.ts', 'separate-components.ts']) {
      const source = readFileSync(`${SCRIPTS}${file}`, 'utf8');
      expect(source, file).not.toMatch(/'--admin-password',/);
    }
  });
});
