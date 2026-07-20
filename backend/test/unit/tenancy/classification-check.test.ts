import { describe, it, expect } from 'vitest';
import { analyzeSource } from '../../../scripts/check-entity-tenant-classification.js';

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
});
