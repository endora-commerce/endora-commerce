import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  analyzeSource,
  walk,
  ENTITY_DECORATOR_HINT,
} from '../../../scripts/check-entity-tenant-classification.js';

/**
 * Feature 050 (FR-012 / SC-001) — the CI classification check must flag entities
 * that carry no (or multiple) tenant-scope classification, and ignore non-entity
 * classes. This protects the build gate that keeps the classification total.
 */
describe('check-entity-tenant-classification / analyzeSource', () => {
  it('reports a classified entity with exactly one decorator', () => {
    const src = `
      @OrgScoped()
      @Entity({ tableName: 'orders' })
      export class Order {}
    `;
    const [f] = analyzeSource(src, 'order.entity.ts');
    expect(f).toMatchObject({ className: 'Order', classifications: ['OrgScoped'] });
  });

  it('flags an entity with NO classification (would fail CI)', () => {
    const src = `
      @Entity({ tableName: 'widgets' })
      export class Widget {}
    `;
    const [f] = analyzeSource(src, 'widget.entity.ts');
    expect(f?.classifications).toEqual([]);
  });

  it('flags an entity with MULTIPLE classifications', () => {
    const src = `
      @OrgScoped()
      @GlobalEntity()
      @Entity({ tableName: 'x' })
      export class X {}
    `;
    const [f] = analyzeSource(src, 'x.entity.ts');
    expect(f?.classifications.length).toBe(2);
  });

  it('ignores classes that are not MikroORM entities', () => {
    const src = `export class NotAnEntity {}`;
    expect(analyzeSource(src, 'plain.ts')).toEqual([]);
  });

  it('recognizes all five classification decorators', () => {
    for (const dec of ['OrgScoped', 'CustomerScoped', 'GlobalEntity', 'TransitivelyScoped', 'RuleScoped']) {
      const src = `@${dec}()\n@Entity({ tableName: 't' })\nexport class T {}`;
      expect(analyzeSource(src, 't.entity.ts')[0]?.classifications).toEqual([dec]);
    }
  });

  it('reads an entity out of a file with no entity suffix', () => {
    // The walk was scoped to `*.entity.ts`, so an entity declared anywhere else
    // was not unclassified as far as this check went — it was unread (#113).
    const src = `@Entity({ tableName: 'widgets' })\nexport class Widget {}`;
    expect(analyzeSource(src, 'src/modules/catalog/entities/index.ts')[0]?.className).toBe('Widget');
  });
});

/**
 * The scan scope, which is what decides whether the check is total. A green run
 * over a file list that no longer contains the entities is the failure this
 * whole issue is about, so the list and the pre-filter are asserted directly.
 */
describe('the scan scope', () => {
  const srcRoot = fileURLToPath(new URL('../../../src', import.meta.url));

  it('walks the whole tree, not one filename convention', () => {
    const files = walk(srcRoot);
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => !f.endsWith('.entity.ts'))).toBe(true);
    expect(files.every((f) => !f.endsWith('.test.ts'))).toBe(true);
  });

  it('keeps every file that declares an entity, and finds hundreds of them', () => {
    const entityFiles = walk(srcRoot).filter((f) =>
      ENTITY_DECORATOR_HINT.test(readFileSync(f, 'utf8')),
    );
    expect(entityFiles.length).toBeGreaterThan(100);
    const entities = entityFiles.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
    expect(entities.length).toBeGreaterThan(100);
    expect(entities.filter((e) => e.classifications.length !== 1)).toEqual([]);
  });
});
