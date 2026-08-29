import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  isProductVisibleTo,
  type ProductAudience,
  type ProductVisibility,
} from '@endora-commerce/contracts';

/**
 * The one predicate every read path applies (issue #227).
 *
 * `visibility` and `allowed_organization_ids` have been persisted and
 * operator-editable since the foundation migration, and exactly one read path
 * enforced them — `catalog`'s quick-search, repaired for issue #174. Every
 * other surface answered the question its own way or not at all, so the first
 * thing this repair needs is a single statement of what the two columns mean
 * that a listing, a PDP, a search hit, a cart line and a feed row can all
 * reach.
 *
 * The truth table below is that statement. It is written from the semantics on
 * `Product.allowedOrganizationIds`, which are not obvious in two places and are
 * asserted here precisely because they are not:
 *
 *  - an **empty** allow-list under `organization_restricted` is visible to
 *    nobody, not to everybody;
 *  - a **non-empty** allow-list restricts whatever `visibility` says,
 *    `public` included.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const anonymous = ANONYMOUS_PRODUCT_AUDIENCE;
const buyerOfOrg: ProductAudience = { organizationId: ORG, authenticated: true };
const buyerOfOtherOrg: ProductAudience = { organizationId: OTHER_ORG, authenticated: true };
/** A signed-in account with no Organization — the guest-style customer of feature 026. */
const orglessBuyer: ProductAudience = { organizationId: null, authenticated: true };

function product(
  visibility: ProductVisibility,
  allowedOrganizationIds: string[],
): { visibility: ProductVisibility; allowedOrganizationIds: string[] } {
  return { visibility, allowedOrganizationIds };
}

describe('isProductVisibleTo', () => {
  describe('an empty allow-list — the answer is `visibility`’s alone', () => {
    it('discloses a public product to everybody', () => {
      const row = product('public', []);
      expect(isProductVisibleTo(row, anonymous)).toBe(true);
      expect(isProductVisibleTo(row, orglessBuyer)).toBe(true);
      expect(isProductVisibleTo(row, buyerOfOrg)).toBe(true);
    });

    it('withholds a logged_in_only product from an anonymous caller only', () => {
      const row = product('logged_in_only', []);
      expect(isProductVisibleTo(row, anonymous)).toBe(false);
      expect(isProductVisibleTo(row, orglessBuyer)).toBe(true);
      expect(isProductVisibleTo(row, buyerOfOrg)).toBe(true);
    });

    it('withholds an organization_restricted product from everybody', () => {
      // The restriction was asked for and names no organisation. Reading it
      // permissively would disclose the row to the whole world, which is the
      // opposite of what the operator saved.
      const row = product('organization_restricted', []);
      expect(isProductVisibleTo(row, anonymous)).toBe(false);
      expect(isProductVisibleTo(row, orglessBuyer)).toBe(false);
      expect(isProductVisibleTo(row, buyerOfOrg)).toBe(false);
    });
  });

  describe('a non-empty allow-list restricts whatever `visibility` says', () => {
    it.each<ProductVisibility>(['public', 'logged_in_only', 'organization_restricted'])(
      'discloses a %s product to the named organisation and nobody else',
      (visibility) => {
        const row = product(visibility, [ORG]);
        expect(isProductVisibleTo(row, buyerOfOrg)).toBe(true);
        expect(isProductVisibleTo(row, buyerOfOtherOrg)).toBe(false);
        expect(isProductVisibleTo(row, orglessBuyer)).toBe(false);
        expect(isProductVisibleTo(row, anonymous)).toBe(false);
      },
    );

    it('matches an element of the list, never a substring of the serialised bag', () => {
      // The SQL half of this predicate asks with `@>` containment for the same
      // reason: a prefix of a stored id is not a member of the list.
      const row = product('public', [`${ORG}-suffix`]);
      expect(isProductVisibleTo(row, buyerOfOrg)).toBe(false);
    });

    it('discloses to any one of several named organisations', () => {
      const row = product('organization_restricted', [OTHER_ORG, ORG]);
      expect(isProductVisibleTo(row, buyerOfOrg)).toBe(true);
      expect(isProductVisibleTo(row, buyerOfOtherOrg)).toBe(true);
    });
  });

  it('treats a missing allow-list as an empty one', () => {
    // `allowed_organization_ids` is `not null default '[]'`, so this cannot
    // come out of Postgres — but a record built in a test or by a package can
    // omit it, and omission must not read as "no restriction was asked for"
    // in one direction and crash in the other.
    const row = { visibility: 'public' as ProductVisibility } as {
      visibility: ProductVisibility;
      allowedOrganizationIds: string[];
    };
    expect(isProductVisibleTo(row, anonymous)).toBe(true);
  });

  it('is the most restrictive audience that ANONYMOUS_PRODUCT_AUDIENCE names', () => {
    expect(ANONYMOUS_PRODUCT_AUDIENCE).toEqual({ organizationId: null, authenticated: false });
    // Anything an anonymous caller may see, every other audience may see too.
    for (const visibility of ['public', 'logged_in_only', 'organization_restricted'] as const) {
      for (const allowed of [[], [ORG]]) {
        const row = product(visibility, allowed);
        if (isProductVisibleTo(row, anonymous)) {
          expect(isProductVisibleTo(row, orglessBuyer)).toBe(true);
          expect(isProductVisibleTo(row, buyerOfOrg)).toBe(true);
        }
      }
    }
  });
});
