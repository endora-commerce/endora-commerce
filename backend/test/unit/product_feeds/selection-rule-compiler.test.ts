import { describe, expect, it } from 'vitest';
import type { CatalogProductFilter, ProductSelectionRule } from '@endora-commerce/contracts';
import {
  collectSelectionCategoryIds,
  compileSelectionRule,
  UnknownSelectionFieldError,
  type SelectionCandidate,
  type SelectionCompileContext,
} from '../../../../packages/modules/product_feeds/src/backend/services/selection-rule-compiler.js';

/**
 * Feature 067 / T061 — the selection-rule compiler (FR-025, FR-029).
 *
 * The compiler is deliberately a pure function so the one property that
 * matters can be asserted without a database: **a criterion the compiler does
 * not understand never becomes a no-op**. A rule naming a deleted attribute
 * must fail loudly; a rule the query layer cannot express on its own must carry
 * an in-memory evaluator with it, so the query-stage superset can never be
 * mistaken for the answer (FR-029).
 *
 * **Feature 075 changed what it emits and not what it means.** Every assertion
 * below used to name a MikroORM `where` object; the compiler emits
 * `CatalogProductFilter` now — `catalog`'s published grammar — and this module
 * no longer knows how a filter becomes SQL. The last case in this file is the
 * one that is new rather than transcribed: it walks the whole output and
 * refuses any node the published grammar does not name, so a future edit
 * cannot smuggle a query object back across the boundary.
 */

const CAT_TOOLS = '00000000-0000-4000-8000-00000000c001';
const CAT_PAINT = '00000000-0000-4000-8000-00000000c002';

function context(over: Partial<SelectionCompileContext> = {}): SelectionCompileContext {
  return {
    knownFieldKeys: new Set(['colour', 'warranty_months']),
    categoryProductIds: new Map([
      [CAT_TOOLS, new Set(['p-1', 'p-2'])],
      [CAT_PAINT, new Set(['p-3'])],
    ]),
    ...over,
  };
}

/** One published condition on a product column. */
function column(
  name: 'id' | 'sku' | 'type' | 'status' | 'createdAt' | 'updatedAt',
  op: string,
  values: unknown[],
): unknown {
  return { kind: 'condition', field: { kind: 'column', column: name }, op, values };
}

/** One published condition on a key of the attribute bag. */
function attribute(key: string, op: string, values: unknown[]): unknown {
  return { kind: 'condition', field: { kind: 'attribute', key }, op, values };
}

function candidate(over: Partial<SelectionCandidate> = {}): SelectionCandidate {
  return {
    id: 'p-1',
    type: 'simple',
    status: 'active',
    attributeValues: { colour: 'red', brand: 'Acme' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    inStock: true,
    price: 100,
    ...over,
  };
}

describe('selection rule compiler [unit]', () => {
  describe('the empty rule', () => {
    it('compiles `all` to an empty predicate and no evaluator', () => {
      const compiled = compileSelectionRule({ kind: 'all' }, context());
      expect(compiled.filter).toEqual({ kind: 'all' });
      expect(compiled.evaluate).toBeNull();
      expect(compiled.needsStock).toBe(false);
      expect(compiled.needsPrice).toBe(false);
    });
  });

  describe('each criteria field type (FR-025)', () => {
    it('compiles product status to a column predicate', () => {
      const compiled = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['active'] },
        context(),
      );
      expect(compiled.filter).toEqual(
        column('status', 'eq', ['active']),
      );
    });

    it('compiles product type onto the `type` column, not a `productType` one', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'productType' },
          op: 'in',
          values: ['simple', 'configurable'],
        },
        context(),
      );
      expect(compiled.filter).toEqual(column('type', 'in', ['simple', 'configurable']));
    });

    it('compiles category membership to the pre-resolved descendant id set', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'in',
          values: [CAT_TOOLS],
        },
        context(),
      );
      expect(compiled.filter).toEqual(column('id', 'in', ['p-1', 'p-2']));
    });

    it('compiles `notIn` on a category to an exclusion, never to a no-op', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'notIn',
          values: [CAT_PAINT],
        },
        context(),
      );
      expect(compiled.filter).toEqual(column('id', 'nin', ['p-3']));
    });

    it('compiles an empty category to an unsatisfiable predicate, not to everything', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'category' },
          op: 'in',
          values: ['00000000-0000-4000-8000-00000000c999'],
        },
        context(),
      );
      expect(compiled.filter).toEqual({ kind: 'none' });
    });

    it('compiles brand onto the product attribute bag', () => {
      const compiled = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'brand' }, op: 'eq', values: ['Acme'] },
        context(),
      );
      expect(compiled.filter).toEqual(attribute('brand', 'eq', ['Acme']));
    });

    it('compiles createdAt / updatedAt as dates, not as strings', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'createdAt' },
          op: 'gte',
          values: ['2026-01-01T00:00:00.000Z'],
        },
        context(),
      );
      expect(compiled.filter).toMatchObject({
        kind: 'condition',
        field: { kind: 'column', column: 'createdAt' },
        op: 'gte',
      });
      expect((compiled.filter as unknown as { values: unknown[] }).values[0]).toBeInstanceOf(Date);
    });

    it('compiles an attribute condition against the JSONB bag', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'attribute', attributeKey: 'colour' },
          op: 'in',
          values: ['red', 'blue'],
        },
        context(),
      );
      expect(compiled.filter).toEqual(attribute('colour', 'in', ['red', 'blue']));
    });

    it('compiles a custom field the same way — one registry since feature 061', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'customField', fieldKey: 'warranty_months' },
          op: 'eq',
          values: [24],
        },
        context(),
      );
      expect(compiled.filter).toEqual(attribute('warranty_months', 'eq', [24]));
    });

    it('marks stock availability as needing the inventory port', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'stockState' },
          op: 'eq',
          values: ['in_stock'],
        },
        context(),
      );
      expect(compiled.needsStock).toBe(true);
      expect(compiled.evaluate).not.toBeNull();
      expect(compiled.evaluate!(candidate({ inStock: true }))).toBe(true);
      expect(compiled.evaluate!(candidate({ inStock: false }))).toBe(false);
    });

    it('marks a price range as needing the pricing port', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'price' },
          op: 'between',
          values: [50, 150],
        },
        context(),
      );
      expect(compiled.needsPrice).toBe(true);
      expect(compiled.evaluate!(candidate({ price: 100 }))).toBe(true);
      expect(compiled.evaluate!(candidate({ price: 400 }))).toBe(false);
    });

    it('treats an unresolvable stock or price as a non-match, never as a match', () => {
      const stock = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'stockState' },
          op: 'eq',
          values: ['out_of_stock'],
        },
        context(),
      );
      expect(stock.evaluate!(candidate({ inStock: null }))).toBe(false);

      const price = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'price' }, op: 'lte', values: [10] },
        context(),
      );
      expect(price.evaluate!(candidate({ price: null }))).toBe(false);
    });
  });

  describe('AND / OR nesting', () => {
    it('compiles a nested group to $and / $or', () => {
      const rule: ProductSelectionRule = {
        kind: 'group',
        op: 'OR',
        children: [
          { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['active'] },
          {
            kind: 'group',
            op: 'AND',
            children: [
              {
                kind: 'condition',
                field: { kind: 'builtin', key: 'productType' },
                op: 'eq',
                values: ['simple'],
              },
            ],
          },
        ],
      };
      expect(compileSelectionRule(rule, context()).filter).toEqual({
        kind: 'group',
        op: 'or',
        children: [
          column('status', 'eq', ['active']),
          { kind: 'group', op: 'and', children: [column('type', 'eq', ['simple'])] },
        ],
      });
    });

    it('evaluates an OR of a SQL leaf and a refinement leaf exactly', () => {
      const rule: ProductSelectionRule = {
        kind: 'group',
        op: 'OR',
        children: [
          { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['inactive'] },
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'stockState' },
            op: 'eq',
            values: ['in_stock'],
          },
        ],
      };
      const compiled = compileSelectionRule(rule, context());
      // The query side is a deliberate SUPERSET, and the refinement branch has
      // to say so **explicitly**: an empty predicate inside `$or` collapses the
      // branch in the query builder, which would make the query stage narrower
      // than the rule and drop matching products before the evaluator ever sees
      // them. `all` is the named node that says it, and translating it into a
      // tautology is `catalog`'s job rather than this module's.
      expect(compiled.filter).toEqual({
        kind: 'group',
        op: 'or',
        children: [column('status', 'eq', ['inactive']), { kind: 'all' }],
      });
      expect(compiled.evaluate).not.toBeNull();
      expect(compiled.evaluate!(candidate({ status: 'active', inStock: true }))).toBe(true);
      expect(compiled.evaluate!(candidate({ status: 'active', inStock: false }))).toBe(false);
      expect(compiled.evaluate!(candidate({ status: 'inactive', inStock: false }))).toBe(true);
    });

    it('evaluates category membership in memory from the same id sets', () => {
      const compiled = compileSelectionRule(
        {
          kind: 'group',
          op: 'OR',
          children: [
            {
              kind: 'condition',
              field: { kind: 'builtin', key: 'category' },
              op: 'in',
              values: [CAT_PAINT],
            },
            {
              kind: 'condition',
              field: { kind: 'builtin', key: 'price' },
              op: 'gte',
              values: [1_000],
            },
          ],
        },
        context(),
      );
      expect(compiled.evaluate!(candidate({ id: 'p-3', price: 1 }))).toBe(true);
      expect(compiled.evaluate!(candidate({ id: 'p-1', price: 1 }))).toBe(false);
    });
  });

  describe('fail-closed behaviour (FR-029)', () => {
    it('throws for an attribute that no longer exists, naming it', () => {
      expect(() =>
        compileSelectionRule(
          {
            kind: 'condition',
            field: { kind: 'attribute', attributeKey: 'deleted_attribute' },
            op: 'eq',
            values: ['x'],
          },
          context(),
        ),
      ).toThrowError(UnknownSelectionFieldError);

      try {
        compileSelectionRule(
          {
            kind: 'condition',
            field: { kind: 'customField', fieldKey: 'gone_field' },
            op: 'eq',
            values: ['x'],
          },
          context(),
        );
        expect.unreachable('an unknown custom field must not compile');
      } catch (error) {
        expect((error as UnknownSelectionFieldError).key).toBe('gone_field');
        expect(String(error)).toContain('gone_field');
      }
    });

    it('never widens the predicate when the operator makes no sense for the field', () => {
      // `contains` on a date has no meaning. The compiler must refuse rather
      // than drop the leaf, which would silently match the whole catalogue.
      const compiled = compileSelectionRule(
        {
          kind: 'condition',
          field: { kind: 'builtin', key: 'createdAt' },
          op: 'contains',
          values: ['2026'],
        },
        context(),
      );
      expect(compiled.filter).toEqual({ kind: 'none' });
    });

    it('never compiles a condition with no values to an unconstrained filter', () => {
      const compiled = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: [] },
        context(),
      );
      expect(compiled.filter).not.toEqual({ kind: 'all' });
      expect(compiled.filter).toEqual({ kind: 'none' });
    });
  });

  describe('collectSelectionCategoryIds', () => {
    it('walks the whole tree and de-duplicates', () => {
      const rule: ProductSelectionRule = {
        kind: 'group',
        op: 'AND',
        children: [
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'category' },
            op: 'in',
            values: [CAT_TOOLS, CAT_PAINT],
          },
          {
            kind: 'group',
            op: 'OR',
            children: [
              {
                kind: 'condition',
                field: { kind: 'builtin', key: 'category' },
                op: 'notIn',
                values: [CAT_TOOLS],
              },
              { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['active'] },
            ],
          },
        ],
      };
      expect(collectSelectionCategoryIds(rule).sort()).toEqual([CAT_TOOLS, CAT_PAINT].sort());
    });

    it('returns nothing for a rule with no category criterion', () => {
      expect(collectSelectionCategoryIds({ kind: 'all' })).toEqual([]);
    });
  });

  describe('the published grammar is the only thing that crosses (feature 075)', () => {
    it('emits no node the contract does not name, for a rule using every field type', () => {
      // The property this whole cut exists for: until it, this compiler produced
      // a MikroORM `where` and `product-selection.service.ts` handed it to
      // `em.find(Product, where as never)` — a query object crossing a module
      // boundary. Asserting one expected shape per case cannot catch a *new*
      // leaf that reintroduces one, so this walks the output instead.
      const rule: ProductSelectionRule = {
        kind: 'group',
        op: 'AND',
        children: [
          { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: ['active'] },
          { kind: 'condition', field: { kind: 'builtin', key: 'productType' }, op: 'in', values: ['simple'] },
          { kind: 'condition', field: { kind: 'builtin', key: 'brand' }, op: 'startsWith', values: ['Ac'] },
          { kind: 'condition', field: { kind: 'builtin', key: 'category' }, op: 'in', values: [CAT_TOOLS] },
          {
            kind: 'condition',
            field: { kind: 'builtin', key: 'createdAt' },
            op: 'between',
            values: ['2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'],
          },
          { kind: 'condition', field: { kind: 'attribute', attributeKey: 'colour' }, op: 'isSet', values: [] },
          { kind: 'condition', field: { kind: 'builtin', key: 'stockState' }, op: 'eq', values: ['in_stock'] },
        ],
      };

      const nodes = flatten(compileSelectionRule(rule, context()).filter);
      expect(nodes.length).toBeGreaterThan(7);
      for (const node of nodes) {
        expect(['all', 'none', 'group', 'condition']).toContain(node.kind);
        // No `$and`, no `$or`, no `$in`, no `attributeValues` — the four shapes
        // a MikroORM predicate would have carried across.
        expect(Object.keys(node).every((key) => !key.startsWith('$'))).toBe(true);
      }
    });
  });
});

function flatten(filter: CatalogProductFilter): CatalogProductFilter[] {
  if (filter.kind !== 'group') return [filter];
  return [filter, ...filter.children.flatMap(flatten)];
}
