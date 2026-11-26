import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  analyzeSource,
  collectSourceFiles,
  DECORATOR_NAMES,
  SANCTIONED_SPECIFIER,
} from '../../../scripts/check-entity-decorators.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * `check:entity-decorators` (issue #1866) — MikroORM's decorators come only
 * from `@mikro-orm/decorators/legacy`.
 *
 * Most of this file proves the analysis can go **red**, one case per shape it
 * claims to refuse, each asserting the finding's kind. The last case is the
 * opposite assertion — the real tree is clean — so the gate is inside the suite
 * a developer runs as well as in CI (issue #93's lesson).
 */

const FILE = '/repo/packages/modules/blog/src/backend/entities/post.entity.ts';

describe('analyzeSource — what is refused', () => {
  it('refuses a decorator imported from @mikro-orm/core, the MikroORM 6 spelling', () => {
    const findings = analyzeSource("import { Entity, PrimaryKey } from '@mikro-orm/core';\n", FILE);
    expect(findings.map((f) => [f.kind, f.name, f.specifier])).toEqual([
      ['decorator-from-elsewhere', 'Entity', '@mikro-orm/core'],
      ['decorator-from-elsewhere', 'PrimaryKey', '@mikro-orm/core'],
    ]);
  });

  it('refuses the ES decorators, which record nothing under experimentalDecorators', () => {
    const findings = analyzeSource("import { Property } from '@mikro-orm/decorators/es';\n", FILE);
    expect(findings).toMatchObject([{ kind: 'decorator-from-elsewhere', name: 'Property', line: 1 }]);
  });

  it('refuses a decorator from a driver package, and through an alias', () => {
    const findings = analyzeSource("import { ManyToOne as Ref } from '@mikro-orm/postgresql';\n", FILE);
    expect(findings).toMatchObject([{ kind: 'decorator-from-elsewhere', name: 'ManyToOne' }]);
  });

  it('refuses a re-export of a decorator from elsewhere', () => {
    const findings = analyzeSource("export { Index } from '@mikro-orm/core';\n", FILE);
    expect(findings).toMatchObject([{ kind: 'decorator-from-elsewhere', name: 'Index' }]);
  });

  it('refuses a decorator applied through a namespace import', () => {
    const source = [
      "import * as orm from '@mikro-orm/decorators/es';",
      '@orm.Entity()',
      'export class Post {}',
    ].join('\n');
    expect(analyzeSource(source, FILE)).toMatchObject([
      { kind: 'namespace-decorator', name: 'Entity', specifier: '@mikro-orm/decorators/es', line: 2 },
    ]);
  });
});

describe('analyzeSource — what is allowed', () => {
  it('allows the sanctioned specifier', () => {
    const source = `import { Entity, PrimaryKey, Property } from '${SANCTIONED_SPECIFIER}';\n`;
    expect(analyzeSource(source, FILE)).toEqual([]);
  });

  it('allows what is not a decorator from core, and a type-only import', () => {
    const source = [
      "import { OptionalProps, raw } from '@mikro-orm/core';",
      "import type { Entity } from '@mikro-orm/core';",
      "import { type Property } from '@mikro-orm/core';",
    ].join('\n');
    expect(analyzeSource(source, FILE)).toEqual([]);
  });

  it('ignores a mention in a comment or a string — this is a parse, not a grep', () => {
    const source = [
      "// import { Entity } from '@mikro-orm/core';",
      "const note = \"import { Entity } from '@mikro-orm/core'\";",
    ].join('\n');
    expect(analyzeSource(source, FILE)).toEqual([]);
  });

  it('knows the decorators a MikroORM 6 entity imported from core', () => {
    for (const name of ['Entity', 'Property', 'PrimaryKey', 'ManyToOne', 'OneToMany', 'Index', 'Unique', 'Enum', 'Filter']) {
      expect(DECORATOR_NAMES.has(name), name).toBe(true);
    }
  });
});

describe('the real tree', () => {
  it('imports every MikroORM decorator from the sanctioned specifier', async () => {
    const layout = await resolveModuleLayout();
    const files = collectSourceFiles(layout.sourceRoots);
    expect(files.length).toBeGreaterThan(0);
    const findings = files.flatMap((file) => analyzeSource(readFileSync(file, 'utf8'), file));
    expect(findings.map((f) => `${layout.displayOf(f.file)}:${f.line} ${f.name} from ${f.specifier}`)).toEqual([]);
  });

  /**
   * `specs/190-overlay-full-modules/` T063 (FR-022): overlay code is held to the
   * same specifier. This repository's overlays sit under `backend/src/apps/`,
   * which the application's `src` root reaches — pinned here so a narrowed walk
   * cannot drop them without a red.
   */
  it('reads the overlay modules under backend/src/apps', async () => {
    const layout = await resolveModuleLayout();
    const files = collectSourceFiles(layout.sourceRoots).map((file) => layout.displayOf(file));
    expect(files.some((file) => /(^|\/)src\/apps\/[^/]+\/modules\//.test(file))).toBe(true);
  });
});
