import { describe, expect, it } from 'vitest';
import {
  ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE,
  isProductVisibleTo,
  productVisibilitySchema,
} from '@endora-commerce/contracts';
import { previewBelowMinimums, previewLineAvailability } from './preview-line-availability.js';

/**
 * Steps 1–3 of the order preview's per-line decision (feature 145, FR-027):
 * missing > not visible to the customer > not in the order's channel. The
 * visibility expectation is derived from `isProductVisibleTo` itself, never a
 * hand-written table, so this test cannot drift from the buyer-facing rule.
 */
const [NOT_FOUND, NOT_VISIBLE, NOT_IN_CHANNEL] = ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE;

const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';

const allowLists: Array<{ name: string; ids: string[] }> = [
  { name: 'empty allow-list', ids: [] },
  { name: 'allow-list naming the org', ids: [ORG] },
  { name: 'allow-list naming another org', ids: [OTHER_ORG] },
];

describe('previewLineAvailability', () => {
  it.each([true, false])('reports a missing product as not found (inChannel %s)', (inChannel) => {
    expect(previewLineAvailability({ product: null, organizationId: ORG, inChannel })).toEqual({
      available: false,
      code: NOT_FOUND,
    });
  });

  for (const visibility of productVisibilitySchema.options) {
    for (const allowList of allowLists) {
      const product = { visibility, allowedOrganizationIds: allowList.ids };
      const visible = isProductVisibleTo(product, { organizationId: ORG, authenticated: true });

      for (const inChannel of [true, false]) {
        const expected = !visible
          ? { available: false, code: NOT_VISIBLE }
          : !inChannel
            ? { available: false, code: NOT_IN_CHANNEL }
            : { available: true };

        it(`${visibility}, ${allowList.name}, inChannel ${inChannel} → ${
          'code' in expected ? expected.code : 'available'
        }`, () => {
          expect(previewLineAvailability({ product, organizationId: ORG, inChannel })).toEqual(
            expected,
          );
        });
      }
    }
  }

  it('covers both outcomes of the visibility rule, so the table is not vacuous', () => {
    const outcomes = new Set<boolean>();
    for (const visibility of productVisibilitySchema.options) {
      for (const allowList of allowLists) {
        outcomes.add(
          isProductVisibleTo(
            { visibility, allowedOrganizationIds: allowList.ids },
            { organizationId: ORG, authenticated: true },
          ),
        );
      }
    }
    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

/**
 * Step 5 (feature 155, FR-009, FR-035): the pieces minimum, over the lines that
 * passed steps 1–4 only, the product's total across its lines (D1).
 */
describe('previewBelowMinimums', () => {
  const A = { id: '00000000-0000-4000-8000-00000000b001', type: 'simple' as const, minOrderQuantity: 10 };
  const B = { id: '00000000-0000-4000-8000-00000000b002', type: 'simple' as const, minOrderQuantity: null };
  const BUNDLE = { id: '00000000-0000-4000-8000-00000000b003', type: 'bundle' as const, minOrderQuantity: 10 };

  it('marks every line of a product whose total is below its minimum, with the minimum', () => {
    const below = previewBelowMinimums([
      { product: A, quantity: 3 },
      { product: B, quantity: 1 },
      { product: A, quantity: 4 },
    ]);
    expect([...below]).toEqual([
      [0, 10],
      [2, 10],
    ]);
  });

  it('D1 — the product total across lines meets the minimum: nothing marked', () => {
    expect(previewBelowMinimums([{ product: A, quantity: 5 }, { product: A, quantity: 5 }]).size).toBe(0);
  });

  it('a line that failed an earlier step counts toward no total and is never marked', () => {
    const below = previewBelowMinimums([null, { product: A, quantity: 5 }]);
    expect([...below]).toEqual([[1, 10]]);
  });

  it('an ineligible product type carries no minimum', () => {
    expect(previewBelowMinimums([{ product: BUNDLE, quantity: 1 }]).size).toBe(0);
  });
});
