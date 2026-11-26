/**
 * `check:merge-participation` over one module package (`specs/192-organization-merge/`
 * FR-045): the package host reads the package's own `@Entity()` sources and its
 * emitted manifest's `merge.participates`, and holds the one to the other.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { runCheck, type RuleResult } from '../src/check/index.js';
import { createPackageFixture, type PackageFixtureOptions } from './check-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function only(options: PackageFixtureOptions): RuleResult {
  const built = createPackageFixture(options);
  cleanups.push(built.cleanup);
  const result = runCheck({ cwd: built.dir, rules: ['check:merge-participation'] }).report.results[0];
  if (result === undefined) throw new Error('no result');
  return result;
}

const ENTITY = {
  path: 'src/backend/entities/widget.entity.ts',
  content: [
    "import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';",
    '@Entity()',
    'export class Widget {',
    '  @PrimaryKey() id!: string;',
    '  @Property() organizationId!: string;',
    '}',
  ].join('\n'),
};

const manifest = (merge: string): { path: string; content: string } => ({
  path: 'dist/manifest.js',
  content: `export const manifest = { id: 'widgets', ${merge} };\n`,
});

describe('check:merge-participation over a package', () => {
  it('reports an Organization reference its manifest does not declare', () => {
    const result = only({
      moduleId: 'widgets',
      files: [{ path: 'src/manifest.ts', content: 'export const manifest = {};\n' }, ENTITY],
      emitted: [manifest('')],
    });
    expect(result.verdict).toBe('ran');
    expect(result.findings.map((finding) => finding.key)).toEqual(['undeclared-reference:Widget.organizationId']);
  });

  it('is clean when the manifest declares it', () => {
    const result = only({
      moduleId: 'widgets',
      files: [{ path: 'src/manifest.ts', content: 'export const manifest = {};\n' }, ENTITY],
      emitted: [
        manifest(
          "merge: { participates: [{ host: 'organization', key: 'widgets', phase: 'records', references: [" +
            "{ entity: 'Widget', property: 'organizationId', disposition: 're_point' }] }] }",
        ),
      ],
    });
    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
  });

  it('has no subject in a package that persists nothing', () => {
    const result = only({
      moduleId: 'widgets',
      files: [{ path: 'src/manifest.ts', content: 'export const manifest = {};\n' }],
      emitted: [manifest('')],
    });
    expect(result.verdict).toBe('not-applicable');
  });

  it('refuses a declaration it cannot read as literals', () => {
    const result = only({
      moduleId: 'widgets',
      files: [{ path: 'src/manifest.ts', content: 'export const manifest = {};\n' }, ENTITY],
      emitted: [manifest('merge: { participates: computed() }')],
    });
    expect(result.verdict).toBe('unreadable');
  });
});
