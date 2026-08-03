import { describe, expect, it } from 'vitest';
import type { ProductSelectionRule } from '@b2b/contracts';
import {
  collectSelectionCategoryIds,
  compileSelectionRule,
  UnknownSelectionFieldError,
  type SelectionCandidate,
  type SelectionCompileContext,
} from '../../../src/modules/product_feeds/services/selection-rule-compiler.js';

/**
 * Feature 067 / T061 — the selection-rule compiler (FR-025, FR-029).
 *
 * The compiler is deliberately a pure function so the one property that
 * matters can be asserted without a database: **a criterion the compiler does
 * not understand never becomes a no-op**. A rule naming a deleted attribute
 * must fail loudly; a rule the SQL layer cannot express on its own must carry
 * an in-memory evaluator with it, so the SQL superset can never be mistaken
 * for the answer (FR-029).
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
      expect(compiled.predicate).toEqual({});
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
      expect(compiled.predicate).toEqual({ status: 'active' });
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
      expect(compiled.predicate).toEqual({ type: { $in: ['simple', 'configurable'] } });
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
      expect(compiled.predicate).toEqual({ id: { $in: ['p-1', 'p-2'] } });
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
      expect(compiled.predicate).toEqual({ id: { $nin: ['p-3'] } });
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
      expect(compiled.predicate).toEqual({ id: { $in: [] } });
    });

    it('compiles brand onto the product attribute bag', () => {
      const compiled = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'brand' }, op: 'eq', values: ['Acme'] },
        context(),
      );
      expect(compiled.predicate).toEqual({ attributeValues: { brand: 'Acme' } });
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
      const predicate = compiled.predicate as { createdAt: { $gte: unknown } };
      expect(predicate.createdAt.$gte).toBeInstanceOf(Date);
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
      expect(compiled.predicate).toEqual({ attributeValues: { colour: { $in: ['red', 'blue'] } } });
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
      expect(compiled.predicate).toEqual({ attributeValues: { warranty_months: 24 } });
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
      expect(compileSelectionRule(rule, context()).predicate).toEqual({
        $or: [{ status: 'active' }, { $and: [{ type: 'simple' }] }],
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
      // The SQL side is a deliberate SUPERSET, and the refinement branch has to
      // say so **explicitly**: an empty object inside `$or` collapses the branch
      // in the query builder, which would make the SQL stage narrower than the
      // rule and drop matching products before the evaluator ever sees them.
      expect(compiled.predicate).toEqual({
        $or: [{ status: 'inactive' }, { id: { $ne: null } }],
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
      expect(compiled.predicate).toEqual({ id: null });
    });

    it('never compiles a condition with no values to an empty predicate', () => {
      const compiled = compileSelectionRule(
        { kind: 'condition', field: { kind: 'builtin', key: 'status' }, op: 'eq', values: [] },
        context(),
      );
      expect(compiled.predicate).not.toEqual({});
      expect(compiled.predicate).toEqual({ id: null });
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
});
