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
  cleanMachineRefusals,
  evaluateCommandCount,
  evaluateLicences,
  evaluateLockfile,
  evaluateLogin,
  evaluateStorefront,
  lockfileEntries,
  publicExitCode,
  strangerCommands,
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

describe('P5 — the commands a stranger typed are counted, not described', () => {
  const typed = strangerCommands({
    packageName: 'create-endora-commerce',
    version: '0.100.0',
    dir: 'shop',
    admin: { email: 'owner@example.com', password: 'pw', firstName: 'Ada', lastName: 'L' },
  });

  it('is the two-command sequence §6.2 names as the target', () => {
    expect(typed).toHaveLength(2);
    expect(typed[0]).toMatch(/^npx --yes create-endora-commerce@0\.100\.0 shop /);
    expect(typed[0]).toContain('--non-interactive');
    expect(typed[1]).toBe('cd shop && pnpm run dev:all');
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
  it('is unmeasured while the one-shot writes no storefront outside a checkout, naming why', () => {
    const result = evaluateStorefront({ written: false });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toMatch(/cli-product\.md/);
  });

  it('passes when the catalogue answers 200 and links a product', () => {
    expect(
      evaluateStorefront({ written: true, status: 200, html: '<a href="/p/blue-chair">' }).state,
    ).toBe('pass');
  });

  it('fails on a catalogue with no product in it — a demo that seeded nothing', () => {
    expect(
      evaluateStorefront({ written: true, status: 200, html: '<main>No products</main>' }).state,
    ).toBe('fail');
  });

  it('fails on a storefront that did not answer', () => {
    expect(evaluateStorefront({ written: true, status: 500, html: '' }).state).toBe('fail');
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
  for (const file of ['instance-public.ts', 'instance-public-assertions.ts']) {
    it(`${file} imports only node builtins and its sibling`, () => {
      const source = readFileSync(`${SCRIPTS}${file}`, 'utf8');
      const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(
        (match) => match[1]!,
      );
      // The harness imports at least its judgement; a count of zero there is
      // a regex that stopped matching, not a file with no dependencies.
      if (file === 'instance-public.ts') expect(specifiers.length).toBeGreaterThan(1);
      const foreign = specifiers.filter(
        (specifier) =>
          !specifier.startsWith('node:') && specifier !== './instance-public-assertions.js',
      );
      expect(foreign).toEqual([]);
    });
  }
});
