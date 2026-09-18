/**
 * Red proofs for Phase 3's package-scope hosts
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §7).
 *
 * Tier B's characteristic verdict is `unreadable`-with-a-remedy rather than
 * `repository-only`, so the proofs come in pairs: one that the rule finds what
 * it is for, and one that it **refuses** rather than reports clean when the
 * input it needs is not there. A host that printed `violations=0` because it
 * read nothing is the defect the whole estate exists against, and for an
 * artefact-reading rule the commonest way to reach it is a package that was
 * never built.
 *
 * **Every proof enters at a fixture package tree on disk**, never at a
 * pre-classified record (issue #130). For the artefact-reading rules that means
 * a fixture that writes emitted JavaScript in the shape `tsc` actually writes —
 * a class-level `__decorate([...], Class)` call — because the whole claim of the
 * emitted reader is that it reads what the platform loads.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCheck, type RuleResult } from '../src/check/index.js';
import {
  createPackageFixture,
  touchIntoTheFuture,
  type FixtureFile,
  type PackageFixtureOptions,
} from './check-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function fixture(options: PackageFixtureOptions = {}): string {
  const built = createPackageFixture(options);
  cleanups.push(built.cleanup);
  return built.dir;
}

/** One rule's result over a fixture package. Never `undefined`, never a skip. */
function only(dir: string, rule: string): RuleResult {
  const run = runCheck({ cwd: dir, rules: [rule] });
  const result = run.report.results[0];
  if (result === undefined) throw new Error(`no result for ${rule}`);
  return result;
}

const TENANT_RULE = 'check-entity-tenant-classification';

const MANIFEST: FixtureFile = { path: 'src/manifest.ts', content: 'export const manifest = {};\n' };

/**
 * One emitted entity class, in the shape `tsc` writes with `experimentalDecorators`.
 *
 * The class-level `__decorate` call is the whole reason this rule has an
 * artefact reader at all: `@Entity(` does not survive compilation, and a text
 * probe for it over a `dist` finds nothing and reports clean — the silence
 * Principle XI's out-of-tree hole is made of. `Entity({ … })` and
 * `OrgScoped()` do survive, as calls inside `__decorate`.
 */
function emittedEntity(className: string, decorators: readonly string[]): string {
  return [
    "import { Entity, PrimaryKey } from '@mikro-orm/core';",
    `let ${className} = class ${className} {`,
    '    id;',
    '};',
    '__decorate([',
    "    PrimaryKey({ type: 'uuid' }),",
    `], ${className}.prototype, "id", void 0);`,
    `${className} = __decorate([`,
    ...decorators.map((decorator) => `    ${decorator},`),
    `], ${className});`,
    `export { ${className} };`,
  ].join('\n');
}

/** A package that publishes `./backend` with one emitted entity class. */
function packageWithEntity(className: string, decorators: readonly string[]): string {
  return fixture({
    files: [
      MANIFEST,
      { path: 'src/backend/index.ts', content: 'export const entities = [];\n' },
      { path: `src/backend/entities/${className}.entity.ts`, content: '// source half\n' },
    ],
    emitted: [
      { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
      {
        path: 'dist/backend/index.js',
        content: [
          `import { ${className} } from './entities/${className}.entity.js';`,
          'export const entities = [',
          `    ${className},`,
          '];',
        ].join('\n'),
      },
      {
        path: `dist/backend/entities/${className}.entity.js`,
        content: emittedEntity(className, decorators),
      },
    ],
  });
}

/* --------------------------------------- check-entity-tenant-classification */

describe('check-entity-tenant-classification over a package', () => {
  it('reports a persisted entity carrying no tenant-scope classification', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('Loyalty');
    expect(result.findings[0]?.message).toContain('OrgScoped');
  });

  it('says nothing about the same entity once it is classified', () => {
    const dir = packageWithEntity('Loyalty', [
      'OrgScoped()',
      "Entity({ tableName: 'loyalties' })",
    ]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
  });

  it('reports an entity carrying more than one classification', () => {
    const dir = packageWithEntity('Loyalty', [
      'OrgScoped()',
      'GlobalEntity()',
      "Entity({ tableName: 'loyalties' })",
    ]);

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('OrgScoped');
    expect(result.findings[0]?.message).toContain('GlobalEntity');
  });

  it('is not-applicable for a package that publishes no backend subpath', () => {
    const dir = fixture({
      exports: { '.': './dist/manifest.js', './admin': './dist/admin/index.js' },
      files: [MANIFEST, { path: 'src/admin/index.tsx', content: 'export const screens = [];\n' }],
      emitted: [
        { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
        { path: 'dist/admin/index.js', content: 'export const screens = [];\n' },
      ],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('entity classes');
    expect(result.readSize).toBeNull();
  });

  it('refuses, rather than passes, a package that was never built', () => {
    const dir = fixture({
      files: [MANIFEST, { path: 'src/backend/index.ts', content: 'export const entities = [];\n' }],
      emitted: [{ path: 'dist/manifest.js', content: 'export const manifest = {};\n' }],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
    expect(result.explanation).toContain('build');
  });

  it('refuses an artefact its own source is newer than', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);
    touchIntoTheFuture(join(dir, 'src', 'backend', 'index.ts'));

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
    expect(result.explanation).toContain('newer');
  });

  it('refuses a short walk: a declared entity class the walk never reached', () => {
    const dir = packageWithEntity('Loyalty', ["Entity({ tableName: 'loyalties' })"]);
    // The composition hands the ORM a second class whose emitted file is not
    // there. The walk therefore reads one of two declared classes, and the
    // package's own `entities` export is the independent second author that
    // says so — the whole of `package-scope-layout.md` §3.
    writeFileSync(
      join(dir, 'dist', 'backend', 'index.js'),
      [
        "import { Loyalty } from './entities/Loyalty.entity.js';",
        "import { Tier } from './entities/Tier.entity.js';",
        'export const entities = [',
        '    Loyalty,',
        '    Tier,',
        '];',
      ].join('\n'),
    );
    touchIntoTheFuture(join(dir, 'dist', 'backend', 'index.js'));

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('unreadable');
    expect(result.findings).toEqual([]);
  });

  it('is not-applicable for a backend that hands the ORM nothing', () => {
    const dir = fixture({
      files: [MANIFEST, { path: 'src/backend/index.ts', content: 'export function r() {}\n' }],
      emitted: [
        { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
        { path: 'dist/backend/index.js', content: 'export function r() {}\n' },
      ],
    });

    const result = only(dir, TENANT_RULE);

    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('entity classes');
  });

  it('never reports pending: the host is built in this build', () => {
    const dir = packageWithEntity('Loyalty', ['OrgScoped()', "Entity({ tableName: 'l' })"]);
    expect(only(dir, TENANT_RULE).verdict).not.toBe('pending');
  });
});
