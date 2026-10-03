/**
 * A scaffold of release X names every package of release X at exactly X
 * (`specs/140-instance-upgrade/` M8, owner decision 2026-10-03).
 *
 * ## The defect this file holds shut
 *
 * `create-endora-commerce@0.101.0`, run after `0.101.1` was published, wrote
 * `^0.101.0` for the platform and every module and `0.101.0` — exactly — for
 * `@endora-commerce/contracts`. The install resolved the carets to `0.101.1`
 * and the pin to `0.101.0`: two copies of the contracts and 62 unmet-peer
 * warnings in a tree nobody had touched. A scaffold of X is now X everywhere,
 * so it is reproducible on any later day and moves forward only through
 * `pnpm run upgrade`.
 *
 * ## What "a package of the release" is, here
 *
 * The run resolves every package from a host the release index pins exactly,
 * and a release publishes every package at one number (lockstep,
 * `specs/conventions/release-intent.md`). So a package resolved at the
 * platform's version **is** a package of this release; one at another version
 * is not — a module versioned on its own keeps its caret. Third-party ranges
 * are untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { planInstance, releaseRange, type PlanInput } from '../src/new-instance/template.js';
import { resolveReference } from '../src/new-storefront/reference.js';
import { rewriteManifest } from '../src/new-storefront/rewrite.js';
import { memberDirectories } from '../src/new-storefront/reference.js';

const SCOPE = '@endora-commerce/';
const X = '1.2.3';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: X,
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [
      { id: 'settings', packageName: `${SCOPE}mod-settings`, version: X },
      // A module versioned on its own, outside the release.
      { id: 'carrier', packageName: `${SCOPE}mod-carrier`, version: '0.10.0' },
    ],
    demoComposition: { packageName: `${SCOPE}demo-composition`, version: X },
    contractsVersion: X,
    adminShellVersion: X,
    adminKitVersion: X,
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map([
      [`${SCOPE}page-builder-admin`, X],
      ['@puckeditor/core', '^0.21.0'],
    ]),
    cliVersion: X,
    docsRanges: new Map([
      ['@docusaurus/core', '^3.9.0'],
      ['@docusaurus/preset-classic', '^3.9.0'],
    ]),
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

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function manifestAt(input: PlanInput, path: string): Manifest {
  const file = planInstance(input).files.find((entry) => entry.path === path);
  expect(file, `${path} is not in the plan`).toBeDefined();
  return JSON.parse(file!.content) as Manifest;
}

function scoped(manifest: Manifest): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) =>
      name.startsWith(SCOPE),
    ),
  );
}

describe('releaseRange — exact for the release, a caret for anything else', () => {
  it('names a package of the release at exactly its version', () => {
    expect(releaseRange('0.101.0', '0.101.0')).toBe('0.101.0');
  });
  it('keeps a caret for a package at another version than the release', () => {
    expect(releaseRange('0.10.0', '0.101.0')).toBe('^0.10.0');
  });
});

describe('planInstance — every release package at exactly X (M8)', () => {
  it('the root manifest: platform, modules, demo composition, contracts and the CLI', () => {
    const root = manifestAt(planInput(), 'package.json');
    expect(scoped(root)).toEqual({
      [`${SCOPE}cli`]: X,
      [`${SCOPE}contracts`]: X,
      [`${SCOPE}demo-composition`]: X,
      [`${SCOPE}mod-carrier`]: '^0.10.0',
      [`${SCOPE}mod-settings`]: X,
      [`${SCOPE}page-builder-admin`]: X,
      [`${SCOPE}platform`]: X,
    });
    // Third-party ranges are exactly what the resolved manifests declared.
    expect(root.dependencies!['@puckeditor/core']).toBe('^0.21.0');
    expect(root.devDependencies!['fastify']).toBe('^5');
    expect(root.devDependencies!['typescript']).toBe('^5.9.3');
  });

  it('the admin member: the shell, the design system and the CLI', () => {
    expect(scoped(manifestAt(planInput(), 'admin/package.json'))).toEqual({
      [`${SCOPE}admin-kit`]: X,
      [`${SCOPE}admin-shell`]: X,
      [`${SCOPE}cli`]: X,
    });
  });

  it('the docs member: the CLI', () => {
    expect(scoped(manifestAt(planInput(), 'docs/package.json'))).toEqual({ [`${SCOPE}cli`]: X });
  });

  it('no release package anywhere in the tree carries a range', () => {
    const plan = planInstance(planInput());
    for (const file of plan.files.filter((entry) => entry.path.endsWith('package.json'))) {
      const manifest = JSON.parse(file.content) as Manifest;
      for (const [name, range] of Object.entries(scoped(manifest))) {
        if (name === `${SCOPE}mod-carrier`) continue;
        expect(range, `${file.path}: ${name}`).toBe(X);
      }
    }
  });
});

describe('the storefront — every release package at exactly the member version (M8)', () => {
  it('rewrites every `workspace:` range of the reference to the exact version', () => {
    const reference = resolveReference(REPO_ROOT);
    const { text, ranges } = rewriteManifest(reference, memberDirectories(reference.repoRoot));
    const manifest = JSON.parse(text) as Manifest;
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      const member = JSON.parse(
        readFileSync(
          join(
            REPO_ROOT,
            'packages',
            range.name === `${SCOPE}contracts` ? 'contracts' : range.name.slice(SCOPE.length),
            'package.json',
          ),
          'utf8',
        ),
      ) as { version: string };
      expect(range.to, range.name).toBe(member.version);
      const written = { ...manifest.dependencies, ...manifest.devDependencies }[range.name];
      expect(written, range.name).toBe(member.version);
    }
  });
});
