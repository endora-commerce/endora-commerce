/**
 * A setup file may not reach a value-carrying subpath of `@endora-commerce/platform`.
 *
 * `setupFiles` run **before every test file's module graph is built**, so a
 * module a setup file imports is evaluated — and has its own imports bound —
 * before that file's `vi.mock` registrations can intercept anything. The
 * composition barrel eagerly evaluates `composition/compose-app.ts`, which binds
 * `loadModulePresence` from `lifecycle/index.ts`; once that binding is taken
 * from the real module, no `vi.mock('@endora-commerce/platform/lifecycle')` in
 * any test file can reach it, because `composeApp` is already holding the
 * function it will call.
 *
 * That is not a hypothetical. `specs/110-instance-repository/` T119b re-pointed
 * one import in `test/tenancy-setup.ts` — `systemTenantContext`, from a backend
 * tenancy shim to `@endora-commerce/platform/composition` — and the presence
 * override in `test/integration/kernel/required-module-absent.test.ts` and
 * `deactivated-boot.test.ts` **silently stopped applying**. The mock factory
 * still ran, the seeded absence was still written into the registry cache, and
 * `composeApp` went on loading the real presence over the top of it: a
 * composition missing a module its own manifest declares required *started*,
 * which is the refusal issue #258 exists to make. Seven cases went red, none of
 * them naming the import that caused it, and no merge-request pipeline creates
 * an integration job (D-198), so it was found by the nightly.
 *
 * The rule is therefore about the **setup path**, not about that one symbol: a
 * test file may name any platform subpath freely — it is imported after the
 * mocks are registered — and many do. The population is derived from
 * `backendTestOptions().setupFiles`, never a list, so a setup file added later
 * is judged by existing.
 *
 * **The judged set is derived too** (issue #106). It was one barrel,
 * `./composition`, written down; the defect was not that barrel but the shape
 * "a setup file binds a platform module before the mocks exist", and every
 * other subpath has it. So every subpath the platform's `exports` map declares
 * is judged, in each spelling the tree can write — the bare specifier and the
 * package's build and source directories, the second being what the backend's
 * re-export shims name. What a setup file legitimately needs is an explicit
 * allow-list of single **files**, never subpaths, each with its reason, and
 * the allow-list is held to being used: an entry no setup path reaches is
 * stale and fails.
 *
 * Type-only imports and exports are not judged and not followed: they are
 * erased before anything is evaluated, so they bind nothing.
 *
 * **What it cannot see**, stated rather than discovered later: it follows
 * relative specifiers inside `backend/` only, so a reach that leaves the
 * application tree and comes back is invisible — what it judges is the
 * specifier that leaves — and it reads specifiers as literal text rather than
 * resolving them, so a computed one is not judged.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { systemTenantContext } from '@endora-commerce/platform/composition';

import { backendTestOptions } from '../../../vitest.shared.js';
import {
  HARNESS_DEFAULT_SCOPE,
  HARNESS_DEFAULT_SCOPE_REASON,
} from '../../harness-tenant-scope.js';

const BACKEND_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..');

const PLATFORM_ROOT = resolve(BACKEND_ROOT, '..', 'packages', 'platform');
const PLATFORM_NAME = '@endora-commerce/platform';

/** One subpath of the platform package, and every spelling that reaches it. */
interface JudgedSubpath {
  /** `lifecycle`, for the `./lifecycle` entry. */
  readonly name: string;
  /** Does `specifier` reach this subpath? */
  readonly reaches: (specifier: string) => boolean;
}

/**
 * Every subpath the platform's `exports` map declares, `./package.json` aside:
 * it is metadata, read with `import … with { type: 'json' }` or `readFileSync`,
 * and evaluates no platform module.
 */
function judgedSubpaths(exportsMap: Readonly<Record<string, unknown>>): readonly JudgedSubpath[] {
  return Object.keys(exportsMap)
    .filter((key) => key !== './package.json')
    .map((key) => {
      const name = key === '.' ? '' : key.replace(/^\.\//, '');
      const bare = name === '' ? PLATFORM_NAME : `${PLATFORM_NAME}/${name}`;
      const directories = name === '' ? [] : [`packages/platform/dist/${name}/`, `packages/platform/src/${name}/`];
      return {
        name: name === '' ? '.' : name,
        reaches: (specifier: string) =>
          specifier === bare ||
          specifier.startsWith(`${bare}/`) ||
          directories.some((directory) => specifier.includes(directory)),
      };
    });
}

function platformExports(): Readonly<Record<string, unknown>> {
  const manifest = JSON.parse(readFileSync(join(PLATFORM_ROOT, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  return manifest.exports ?? {};
}

/**
 * The platform files a setup file may reach, each with the reason it is safe.
 *
 * A **file**, never a subpath: allowing `./tenancy` would allow its barrel,
 * whose other modules are exactly what a test file may want to mock.
 */
const ALLOWED: readonly { readonly file: string; readonly reason: string }[] = [
  {
    file: 'packages/platform/dist/tenancy/tenant-context.js',
    reason:
      '`test/tenancy-setup.ts` enters the harness default tenant scope before every test, and ' +
      'that is the whole of what a setup file is for here. The module holds the ' +
      '`AsyncLocalStorage` every tenant-scoped read consults, and it must be the same module ' +
      'record the code under test reads — a mock of it would be a second store nothing reads. ' +
      'It imports `async_hooks` alone, so it binds no platform module a test file could mock. ' +
      'Reached through the shim `src/tenancy/tenant-context.ts`.',
  },
];

function isAllowed(specifier: string): boolean {
  return ALLOWED.some((entry) => specifier.endsWith(entry.file));
}

function setupFiles(): readonly string[] {
  const configured = backendTestOptions().setupFiles ?? [];
  const list = Array.isArray(configured) ? configured : [configured];
  return list.map((entry) => resolve(BACKEND_ROOT, entry));
}

function specifiersOf(source: string): readonly string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*(import|export)(\s+type\b)?[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    // `import type` / `export type` are erased before evaluation and bind nothing.
    if (match[2] !== undefined) continue;
    found.push(match[3] as string);
  }
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(bare)) found.push(match[1] as string);
  return found;
}

/** Every file the setup path reaches, following relative specifiers inside `backend/`. */
function reachedFrom(entries: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const specifiers = specifiersOf(source);
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const target = join(dirname(file), specifier.replace(/\.js$/, '.ts'));
      if (!target.startsWith(BACKEND_ROOT)) continue;
      queue.push(target);
    }
  }
  return seen;
}

describe('the backend suite declares setup files at all', () => {
  it('has at least one, or this whole file is vacuous', () => {
    expect(setupFiles().length).toBeGreaterThan(0);
  });

  it('reads every one of them', () => {
    const reached = reachedFrom(setupFiles());
    for (const entry of setupFiles()) {
      expect(reached.has(entry), `${entry} was declared as a setup file and could not be read`).toBe(
        true,
      );
    }
  });
});

/** Every judged, unallowed reach in `reached`, as `file -> specifier`. */
function findingsOf(
  reached: ReadonlyMap<string, readonly string[]>,
  judged: readonly JudgedSubpath[] = judgedSubpaths(platformExports()),
): readonly string[] {
  const findings: string[] = [];
  for (const [file, specifiers] of reached) {
    for (const specifier of specifiers) {
      if (judged.some((subpath) => subpath.reaches(specifier)) && !isAllowed(specifier)) {
        findings.push(`${file.startsWith(BACKEND_ROOT) ? file.slice(BACKEND_ROOT.length + 1) : file} -> ${specifier}`);
      }
    }
  }
  return findings;
}

describe('the judgement, over synthetic setup paths (issue #106)', () => {
  const SETUP = join(BACKEND_ROOT, 'test', 'fixture-setup.ts');

  it.each([
    '@endora-commerce/platform/composition',
    '@endora-commerce/platform/lifecycle',
    '@endora-commerce/platform/kernel',
    '../../packages/platform/dist/lifecycle/index.js',
    '../../packages/platform/dist/http/request-pipeline.js',
  ])('refuses a setup file that reaches %s', (specifier) => {
    expect(findingsOf(new Map([[SETUP, [specifier]]]))).toEqual([
      `test/fixture-setup.ts -> ${specifier}`,
    ]);
  });

  it.each(['vitest', 'node:fs', './harness-tenant-scope.js', '@endora-commerce/contracts'])(
    'does not judge %s, which is not the platform package',
    (specifier) => {
      expect(findingsOf(new Map([[SETUP, [specifier]]]))).toEqual([]);
    },
  );
});

describe('the judged set is the platform package\'s own exports map', () => {
  it('judges every subpath it declares, which is more than the one barrel it used to name', () => {
    const names = judgedSubpaths(platformExports()).map((subpath) => subpath.name);
    expect(names).toContain('composition');
    expect(names).toContain('lifecycle');
    expect(names).toContain('tenancy');
    expect(names).not.toContain('package.json');
    expect(names.length).toBe(Object.keys(platformExports()).length - 1);
  });

  it('has a reason for every allowed file, and every allowed file sits in a judged subpath', () => {
    const judged = judgedSubpaths(platformExports());
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length, `${entry.file} is allowed with no reason`).toBeGreaterThan(0);
      expect(
        judged.some((subpath) => subpath.reaches(entry.file)),
        `${entry.file} is in no subpath the platform exports, so allowing it allows nothing`,
      ).toBe(true);
    }
  });

  it('allows nothing no setup file reaches — a stale entry is an exemption waiting for a new use', () => {
    const specifiers = [...reachedFrom(setupFiles()).values()].flat();
    for (const entry of ALLOWED) {
      expect(
        specifiers.some((specifier) => specifier.endsWith(entry.file)),
        `${entry.file} is allowed and no setup file reaches it; delete the entry`,
      ).toBe(true);
    }
  });
});

describe('no setup file reaches a value-carrying platform subpath', () => {
  it('names none of them, directly or through the application tree, beyond the allow-list', () => {
    const findings = findingsOf(reachedFrom(setupFiles()));

    expect(
      findings,
      'A setup file runs before every test file\'s module graph, so a platform module it ' +
        'pulls in is bound before any `vi.mock` can intercept it — the composition barrel ' +
        'binding `loadModulePresence` made a composition missing a required module start ' +
        'instead of refusing (issue #258). Construct the value here, or, if the setup file ' +
        'genuinely needs that one file, add it to ALLOWED with the reason it binds nothing ' +
        `a test would mock (issue #106). Findings: ${findings.join(', ')}`,
    ).toEqual([]);
  });
});

describe('the harness default scope is the platform\'s own system context', () => {
  it('matches `systemTenantContext`, so the literal cannot drift from it', () => {
    expect(HARNESS_DEFAULT_SCOPE).toEqual(systemTenantContext(HARNESS_DEFAULT_SCOPE_REASON));
  });
});
