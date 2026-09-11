/**
 * A setup file may not reach `@endora-commerce/platform/composition`.
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
 * test file may name `./composition` freely — it is imported after the mocks are
 * registered — and many do. The population is derived from
 * `backendTestOptions().setupFiles`, never a list, so a setup file added later
 * is judged by existing.
 *
 * **What it cannot see**, stated rather than discovered later: it follows
 * relative specifiers inside `backend/` only, so a reach that leaves the
 * application tree and comes back is invisible, and it reads specifiers as
 * literal text rather than resolving them, so a computed one is not judged.
 * The direct reach is the one that has happened twice.
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

/** The barrel a setup file may not reach, in both spellings the tree can write. */
const FORBIDDEN = [
  '@endora-commerce/platform/composition',
  'packages/platform/dist/composition/',
] as const;

function setupFiles(): readonly string[] {
  const configured = backendTestOptions().setupFiles ?? [];
  const list = Array.isArray(configured) ? configured : [configured];
  return list.map((entry) => resolve(BACKEND_ROOT, entry));
}

function specifiersOf(source: string): readonly string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) found.push(match[1] as string);
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

describe('no setup file reaches the platform composition barrel', () => {
  it('names none of it, directly or through the application tree', () => {
    const reached = reachedFrom(setupFiles());
    const findings: string[] = [];
    for (const [file, specifiers] of reached) {
      for (const specifier of specifiers) {
        if (FORBIDDEN.some((forbidden) => specifier.includes(forbidden))) {
          findings.push(`${file.slice(BACKEND_ROOT.length + 1)} -> ${specifier}`);
        }
      }
    }

    expect(
      findings,
      'A setup file runs before every test file\'s module graph, so the composition barrel it ' +
        'pulls in binds `loadModulePresence` from the real lifecycle module before any ' +
        '`vi.mock` can intercept it. `composeApp` then loads the real presence over a seeded ' +
        'absence and a composition missing a required module starts instead of refusing ' +
        '(issue #258). Import the symbol from the application tree, or construct the value ' +
        `here. Findings: ${findings.join(', ')}`,
    ).toEqual([]);
  });
});

describe('the harness default scope is the platform\'s own system context', () => {
  it('matches `systemTenantContext`, so the literal cannot drift from it', () => {
    expect(HARNESS_DEFAULT_SCOPE).toEqual(systemTenantContext(HARNESS_DEFAULT_SCOPE_REASON));
  });
});
