import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { CartAuditEntry } from '../../../src/modules/carts/entities/cart-audit-entry.entity.js';
import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';

/**
 * Feature 037-cart-merge-on-login — service-level unit tests for
 * `CartService.mergeAnonymousIntoCustomer`. The tests drive the merge
 * function directly (via the test handle's `cartService()` getter), then
 * assert against the returned `CartMergeOutcome` plus the resulting
 * database state. The HTTP-shape side of the contract is covered by the
 * companion contract test under test/contract/auth/.
 *
 * Test customers used (one per `it()` to avoid cross-pollution):
 *   - TEST_CUSTOMER_EMPTY_ID — never has a seeded cart; used for the
 *     adoption (no-prior-cart) path.
 *   - TEST_CUSTOMER_RFQ_ID   — used for the merge (existing-cart) path;
 *     each test seeds the customer's prior cart in `beforeEach`-style.
 */

describe('CartService.mergeAnonymousIntoCustomer', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('adoption — no prior customer cart (US1)', () => {
    it('moves anon lines onto a fresh customer cart, marks source completed, clears token, audits', async () => {
      const cartService = h.cartService();
      expect(cartService).not.toBeNull();
      const anonToken = `anon-adopt-${Date.now()}-${Math.random()}`;

      // Build an anon cart with two distinct lines through the HTTP route so
      // the line-creation path (pricing resolution + audit) matches production.
      const add1 = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
        cookies: { b2b_cart_anon: anonToken },
      });
      expect(add1.statusCode).toBe(200);
      const add2 = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_102_ID, quantity: 3 },
        cookies: { b2b_cart_anon: anonToken },
      });
      expect(add2.statusCode).toBe(200);

      // Sanity — capture the source cart id before the merge so we can verify
      // the same row is the one flipped to `completed` (no new row created).
      const sourceBefore = await h
        .em()
        .findOne(Cart, { anonymousCartToken: anonToken, status: 'active' });
      expect(sourceBefore).not.toBeNull();
      const sourceCartId = sourceBefore!.id;

      // Ensure the customer-empty actor has no prior cart left over from a
      // previous test (test isolation): there is no SEEDED cart for this id,
      // but be defensive against accidental shared state.
      const prior = await h.em().findOne(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });
      expect(prior).toBeNull();

      // Invoke the service directly.
      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });

      expect(outcome.outcome).toBe('adopted');
      expect(outcome.movedLineCount).toBe(2);
      expect(outcome.summedLineCount).toBe(0);
      expect(outcome.destinationCartId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // Source cart: status flipped, token cleared, no items remain on it.
      h.em().clear();
      const sourceAfter = await h.em().findOne(Cart, { id: sourceCartId });
      expect(sourceAfter).not.toBeNull();
      expect(sourceAfter!.status).toBe('completed');
      expect(sourceAfter!.anonymousCartToken ?? null).toBeNull();
      const sourceItemsAfter = await h.em().find(CartItem, { cartId: sourceCartId });
      expect(sourceItemsAfter).toHaveLength(0);

      // Destination cart: holds the two lines with the original quantities.
      const destItems = await h.em().find(CartItem, { cartId: outcome.destinationCartId });
      const byProduct = new Map(destItems.map((i) => [i.productId, i.quantity]));
      expect(byProduct.get(SEED_PRODUCT_101_ID)).toBe(2);
      expect(byProduct.get(SEED_PRODUCT_102_ID)).toBe(3);

      // Audit row written on the destination cart with the right shape.
      const audit = await h.em().findOne(CartAuditEntry, {
        cartId: outcome.destinationCartId,
        action: 'cart_merged_from_anon',
      });
      expect(audit).not.toBeNull();
      const md = audit!.metadata as Record<string, unknown>;
      expect(md['outcome']).toBe('adopted');
      expect(md['movedLineCount']).toBe(2);
      expect(md['summedLineCount']).toBe(0);
      expect(md['sourceAnonTokenHash']).toBe(
        createHash('sha256').update(anonToken).digest('hex'),
      );
    });
  });

  describe('merge — existing customer cart (US2)', () => {
    it('sums quantities on matching (product, variant); leaves variant-differing lines distinct', async () => {
      const cartService = h.cartService();
      expect(cartService).not.toBeNull();
      const anonToken = `anon-merge-${Date.now()}-${Math.random()}`;

      // Seed the customer cart directly via the EM so we control its line set.
      const em = h.em();
      // Defensive clean for the actor we're about to use.
      await em.nativeDelete(CartItem, {
        cartId: {
          $in: (
            await em.find(Cart, {
              customerAccountId: TEST_CUSTOMER_RFQ_ID,
              status: 'active',
            })
          ).map((c) => c.id),
        },
      });
      await em.nativeDelete(Cart, {
        customerAccountId: TEST_CUSTOMER_RFQ_ID,
        status: 'active',
      });

      const custCart = em.create(Cart, {
        customerAccountId: TEST_CUSTOMER_RFQ_ID,
        organizationId: TEST_ORGANIZATION_ID,
        status: 'active',
      });
      await em.persistAndFlush(custCart);
      em.persist(
        em.create(CartItem, {
          cartId: custCart.id,
          productId: SEED_PRODUCT_101_ID,
          quantity: 3,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      em.persist(
        em.create(CartItem, {
          cartId: custCart.id,
          productId: SEED_PRODUCT_102_ID,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      // Build an anon cart with overlapping line A×2, B×4, and a new C×1.
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
        cookies: { b2b_cart_anon: anonToken },
      });
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_102_ID, quantity: 4 },
        cookies: { b2b_cart_anon: anonToken },
      });
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_103_ID, quantity: 1 },
        cookies: { b2b_cart_anon: anonToken },
      });

      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_RFQ_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });

      expect(outcome.outcome).toBe('merged');
      expect(outcome.destinationCartId).toBe(custCart.id);
      expect(outcome.movedLineCount).toBe(1); // product C
      expect(outcome.summedLineCount).toBe(2); // products A, B

      h.em().clear();
      const items = await h.em().find(CartItem, { cartId: custCart.id });
      const byProduct = new Map(items.map((i) => [i.productId, i.quantity]));
      expect(byProduct.get(SEED_PRODUCT_101_ID)).toBe(5); // 3 + 2
      expect(byProduct.get(SEED_PRODUCT_102_ID)).toBe(5); // 1 + 4
      expect(byProduct.get(SEED_PRODUCT_103_ID)).toBe(1);

      const audit = await h.em().findOne(CartAuditEntry, {
        cartId: custCart.id,
        action: 'cart_merged_from_anon',
      });
      expect(audit).not.toBeNull();
      expect((audit!.metadata as Record<string, unknown>)['outcome']).toBe('merged');
    });
  });

  describe('noop branches', () => {
    it('noop_no_anon when the token does not resolve to any active cart; no NEW audit row added', async () => {
      const cartService = h.cartService();
      const em = h.em();

      // Snapshot the existing `cart_merged_from_anon` audit-row count for
      // this actor's cart so we can detect that the noop did not append
      // anything new. (Earlier tests in this file may have legitimately
      // left rows behind.)
      const priorActive = await em.findOne(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });
      const auditCountBefore = priorActive
        ? await em.count(CartAuditEntry, {
            cartId: priorActive.id,
            action: 'cart_merged_from_anon',
          })
        : 0;

      const outcome = await cartService!.mergeAnonymousIntoCustomer(
        `anon-noop-missing-${Date.now()}-${Math.random()}`,
        {
          customerAccountId: TEST_CUSTOMER_EMPTY_ID,
          organizationId: TEST_ORGANIZATION_ID,
        },
      );
      expect(outcome.outcome).toBe('noop_no_anon');
      expect(outcome.movedLineCount).toBe(0);
      expect(outcome.summedLineCount).toBe(0);
      expect(outcome.destinationCartId).toMatch(/^[0-9a-f-]{36}$/i);

      const auditCountAfter = await em.count(CartAuditEntry, {
        cartId: outcome.destinationCartId,
        action: 'cart_merged_from_anon',
      });
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('noop_empty when the anon cart exists but has zero items; flips status + clears token; no audit', async () => {
      const cartService = h.cartService();
      const em = h.em();
      const anonToken = `anon-noop-empty-${Date.now()}-${Math.random()}`;
      const anon = em.create(Cart, {
        anonymousCartToken: anonToken,
        status: 'active',
      });
      await em.persistAndFlush(anon);
      const anonId = anon.id;

      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });

      expect(outcome.outcome).toBe('noop_empty');
      expect(outcome.movedLineCount).toBe(0);
      expect(outcome.summedLineCount).toBe(0);

      const auditBefore = await em.count(CartAuditEntry, {
        cartId: outcome.destinationCartId,
        action: 'cart_merged_from_anon',
      });

      em.clear();
      const after = await em.findOne(Cart, { id: anonId });
      expect(after?.status).toBe('completed');
      // The entity declares the column as `?: string | null`, so MikroORM
      // can hand back either `null` or `undefined` after a clear+reload.
      // Both satisfy "the token has been detached".
      expect(after?.anonymousCartToken ?? null).toBeNull();

      const auditAfter = await em.count(CartAuditEntry, {
        cartId: outcome.destinationCartId,
        action: 'cart_merged_from_anon',
      });
      expect(auditAfter).toBe(auditBefore);
    });
  });

  describe('variant equality (R-12)', () => {
    it('sums only lines with the same productId AND variantId; keeps differing-variant lines distinct', async () => {
      const cartService = h.cartService();
      const em = h.em();
      const anonToken = `anon-variant-${Date.now()}-${Math.random()}`;

      // Clear the actor's cart state.
      const priorCarts = await em.find(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });
      for (const c of priorCarts) await em.nativeDelete(CartItem, { cartId: c.id });
      await em.nativeDelete(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });

      // Seed customer cart with line (P=101, variant='var-A') × 2 and
      // line (P=101, variant=null) × 1.
      const VARIANT_A = '11111111-2222-4333-8444-555555555555';
      const destCart = em.create(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
        status: 'active',
      });
      await em.persistAndFlush(destCart);
      em.persist(
        em.create(CartItem, {
          cartId: destCart.id,
          productId: SEED_PRODUCT_101_ID,
          variantId: VARIANT_A,
          quantity: 2,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      em.persist(
        em.create(CartItem, {
          cartId: destCart.id,
          productId: SEED_PRODUCT_101_ID,
          variantId: null,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      // Anon cart with three lines:
      //   - (P=101, variant='var-A') × 5  → should SUM with VARIANT_A line
      //   - (P=101, variant='var-B') × 3  → should be a NEW line
      //   - (P=101, variant=null)   × 4  → should SUM with the null line
      const VARIANT_B = '99999999-8888-4777-8666-555555555555';
      const anonCart = em.create(Cart, {
        anonymousCartToken: anonToken,
        status: 'active',
      });
      await em.persistAndFlush(anonCart);
      em.persist(
        em.create(CartItem, {
          cartId: anonCart.id,
          productId: SEED_PRODUCT_101_ID,
          variantId: VARIANT_A,
          quantity: 5,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      em.persist(
        em.create(CartItem, {
          cartId: anonCart.id,
          productId: SEED_PRODUCT_101_ID,
          variantId: VARIANT_B,
          quantity: 3,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      em.persist(
        em.create(CartItem, {
          cartId: anonCart.id,
          productId: SEED_PRODUCT_101_ID,
          variantId: null,
          quantity: 4,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });
      expect(outcome.outcome).toBe('merged');
      expect(outcome.summedLineCount).toBe(2); // VARIANT_A and null both summed
      expect(outcome.movedLineCount).toBe(1); // VARIANT_B is new

      em.clear();
      const items = await em.find(CartItem, { cartId: destCart.id });
      const byVariant = new Map(items.map((i) => [String(i.variantId ?? '__null__'), i.quantity]));
      expect(byVariant.get(VARIANT_A)).toBe(7); // 2 + 5
      expect(byVariant.get(VARIANT_B)).toBe(3); // moved as new
      expect(byVariant.get('__null__')).toBe(5); // 1 + 4
      // Three distinct lines all present.
      expect(items).toHaveLength(3);
    });
  });

  describe('coupon does NOT transfer on merge (R-05 / FR-010)', () => {
    it('preserves the destination cart coupon and drops the anon coupon', async () => {
      const cartService = h.cartService();
      const em = h.em();
      const anonToken = `anon-coupon-${Date.now()}-${Math.random()}`;

      // Wipe any prior cart for the empty actor.
      const priorCarts = await em.find(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });
      for (const c of priorCarts) {
        await em.nativeDelete(CartItem, { cartId: c.id });
      }
      await em.nativeDelete(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });

      const destCart = em.create(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
        status: 'active',
        appliedPromotionCode: 'CUSTOMER_KEEPS_THIS',
      });
      await em.persistAndFlush(destCart);
      em.persist(
        em.create(CartItem, {
          cartId: destCart.id,
          productId: SEED_PRODUCT_101_ID,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      const anonCart = em.create(Cart, {
        anonymousCartToken: anonToken,
        status: 'active',
        appliedPromotionCode: 'ANON_SHOULD_DROP',
      });
      await em.persistAndFlush(anonCart);
      em.persist(
        em.create(CartItem, {
          cartId: anonCart.id,
          productId: SEED_PRODUCT_102_ID,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });
      expect(outcome.outcome).toBe('merged');

      em.clear();
      const after = await em.findOne(Cart, { id: destCart.id });
      expect(after?.appliedPromotionCode).toBe('CUSTOMER_KEEPS_THIS');
    });

    it("preserves the destination's coupon even when both carts had different codes", async () => {
      const cartService = h.cartService();
      const em = h.em();
      const anonToken = `anon-both-coupons-${Date.now()}-${Math.random()}`;

      const priors = await em.find(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });
      for (const c of priors) await em.nativeDelete(CartItem, { cartId: c.id });
      await em.nativeDelete(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        status: 'active',
      });

      const destCart = em.create(Cart, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
        status: 'active',
        appliedPromotionCode: 'DEST_COUPON',
      });
      await em.persistAndFlush(destCart);
      em.persist(
        em.create(CartItem, {
          cartId: destCart.id,
          productId: SEED_PRODUCT_101_ID,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );

      const anonCart = em.create(Cart, {
        anonymousCartToken: anonToken,
        status: 'active',
        appliedPromotionCode: 'ANON_COUPON',
      });
      await em.persistAndFlush(anonCart);
      em.persist(
        em.create(CartItem, {
          cartId: anonCart.id,
          productId: SEED_PRODUCT_102_ID,
          quantity: 1,
          unitPrice: '19.99',
          currency: 'PLN',
        }),
      );
      await em.flush();

      const outcome = await cartService!.mergeAnonymousIntoCustomer(anonToken, {
        customerAccountId: TEST_CUSTOMER_EMPTY_ID,
        organizationId: TEST_ORGANIZATION_ID,
      });
      expect(outcome.outcome).toBe('merged');

      em.clear();
      const after = await em.findOne(Cart, { id: destCart.id });
      expect(after?.appliedPromotionCode).toBe('DEST_COUPON');
    });
  });
});
