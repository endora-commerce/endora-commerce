import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ERROR_TRANSLATION_KEYS } from '../../../src/modules/_i18n/services/error-translation.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { RFQ_SHIPPED_ORDER_ID, seedShippedOrder } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #229 / feature 082 — the sentence a refusal renders is the one the
 * module that owns the noun wrote, in the reader's language.
 *
 * Three codes had a finished sentence in a bundle the routing table did not
 * point at, and a machine-shaped placeholder in the bundle it did. The envelope
 * replaces the message wholesale (`src/http/error-envelope.ts`), so the
 * placeholder is what the person saw — for `ORDER_NOT_FOUND` in Polish, that
 * was `Błąd: order not found.`, an English fragment behind the Polish word for
 * "error", on a transacting surface.
 *
 * Every assertion is the **exact wording**, and the Polish half is asserted
 * through the wire rather than through `translate`. Issue #234 (MR !748) is
 * what makes that possible: until it landed, `resolvePreferredLanguage` began
 * `if (actor.kind !== 'admin') return null` and every buyer got English
 * whatever their client asked for, so a Polish sentence could be proven
 * reachable only by calling the translator directly — which proves the bundle
 * parses and nothing about the path.
 *
 * Two audiences state their language two different ways (D-132), so the two
 * halves of this file do too: a buyer sends `Accept-Language`, an admin's
 * language is the stored `preferredLanguage` and the header is not consulted.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };

interface ErrorBody {
  error: { code: string; message: string };
}

describe('an error code renders the sentence its owning module wrote (issue #229)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedShippedOrder(h.em());
  });

  afterAll(async () => {
    // Leave the seeded admin on the platform default: the preference outlives
    // this file in a single-fork run, and a sibling reading English chrome
    // would otherwise inherit Polish refusals.
    await setAdminLanguage(null);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: ADMIN_COOKIE,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode).toBe(200);
  }

  describe('CART_LINE_CAP_EXCEEDED — the thrower writes a token, the buyer reads a sentence', () => {
    /**
     * The cap is `CART_MAX_LINES` and the throw's own message is the literal
     * `cart_line_cap_exceeded` — so before the family moved to `carts`, an
     * internal identifier was the whole of what a buyer was shown, in both
     * languages.
     */
    let cookies: Record<string, string>;

    beforeAll(async () => {
      cookies = { b2b_cart_anon: `anon-w229-cap-${Date.now()}` };
      const first = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
        cookies,
      });
      expect(first.statusCode).toBe(200);
      const cartId = (first.json() as { data: { id: string } }).data.id;

      // Filled through the EntityManager, as `cart-line-cap.contract.test.ts`
      // does: the cap is a count, and 199 priced round-trips prove nothing the
      // one refusal below does not.
      const em = h.em();
      for (let i = 0; i < 199; i += 1) {
        em.create(CartItem, {
          cartId,
          productId: SEED_PRODUCT_101_ID,
          variantId: randomUUID(),
          quantity: 1,
          unitPrice: '1.00',
          currency: 'PLN',
        });
      }
      await em.flush();
    });

    async function overflow(acceptLanguage: string): Promise<ErrorBody['error']> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        payload: { productId: SEED_PRODUCT_101_ID, variantId: randomUUID(), quantity: 1 },
        cookies,
        headers: { 'accept-language': acceptLanguage },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.CART_LINE_CAP_EXCEEDED);
      return body.error;
    }

    it('en — names the limit instead of the internal token the service threw', async () => {
      const error = await overflow('en');
      expect(error.message).toBe('You have reached the maximum number of lines on this cart.');
      // The load-bearing half: an untranslated path answers with the message
      // the service threw, which is this identifier.
      expect(error.message).not.toBe('cart_line_cap_exceeded');
    });

    it('pl — answers a Polish client in Polish', async () => {
      const error = await overflow('pl');
      expect(error.message).toBe('Osiągnięto maksymalną liczbę pozycji w koszyku.');
    });
  });

  describe('CART_EMPTY — the placeholder it replaced was half English', () => {
    async function couponOnEmptyCart(acceptLanguage: string): Promise<ErrorBody['error']> {
      const cookies = { b2b_cart_anon: `anon-w229-empty-${randomUUID()}` };
      await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/coupon',
        payload: { code: 'W229ANYTHING' },
        cookies,
        headers: { 'accept-language': acceptLanguage },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.CART_EMPTY);
      return body.error;
    }

    it('en — "Your cart is empty.", not "Cart Empty."', async () => {
      expect((await couponOnEmptyCart('en')).message).toBe('Your cart is empty.');
    });

    /**
     * `_i18n` answered `Błąd: cart empty.` here. Issue #231 moved the family;
     * this is the first assertion that a Polish buyer reaches the replacement
     * over HTTP rather than through the translator.
     */
    it('pl — "Twój koszyk jest pusty.", not "Błąd: cart empty."', async () => {
      expect((await couponOnEmptyCart('pl')).message).toBe('Twój koszyk jest pusty.');
    });
  });

  describe('ORDER_NOT_FOUND — the sentence moves out of invoices (D-125)', () => {
    async function missingOrder(acceptLanguage: string): Promise<ErrorBody['error']> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/orders/${randomUUID()}`,
        cookies: CUSTOMER_COOKIE,
        headers: { 'accept-language': acceptLanguage },
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
      return body.error;
    }

    it('routes to orders, the module that owns the noun', () => {
      expect(ERROR_TRANSLATION_KEYS[ERROR_CODES.ORDER_NOT_FOUND].moduleId).toBe('orders');
    });

    it('en — "Order not found.", not the title-cased placeholder', async () => {
      const error = await missingOrder('en');
      expect(error.message).toBe('Order not found.');
      expect(error.message).not.toBe('Order Not Found.');
    });

    it('pl — "Nie znaleziono zamówienia.", not "Błąd: order not found."', async () => {
      expect((await missingOrder('pl')).message).toBe('Nie znaleziono zamówienia.');
    });
  });

  /**
   * `ORDER_NOT_CANCELLABLE` is declared in `ERROR_CODES` and thrown nowhere, so
   * there is no request to send. It is asserted at the key the envelope would
   * build, because moving the family strands it otherwise — which is the whole
   * reason D-125 writes it two lines rather than a ledger entry.
   */
  it('ORDER_NOT_CANCELLABLE has a sentence in the bundle the family moved to', async () => {
    const target = ERROR_TRANSLATION_KEYS[ERROR_CODES.ORDER_NOT_CANCELLABLE];
    expect(target.moduleId).toBe('orders');
    expect(await h.adminI18n.i18nService.translate(target.moduleId, target.key, 'en')).toBe(
      'This order can no longer be cancelled.',
    );
    expect(await h.adminI18n.i18nService.translate(target.moduleId, target.key, 'pl')).toBe(
      'Tego zamówienia nie można już anulować.',
    );
  });

  describe('INVALID_TRANSITION — the shared sentence is promoted, not picked (D-122)', () => {
    /**
     * Four modules run state machines and two throw this code with
     * character-for-character identical sentences, so no module owns the noun
     * and T3 puts it in the platform bundle. The assertion that matters is that
     * the promoted sentence is what renders — the `_i18n` copy used to be
     * `Invalid Transition.` / `Błąd: invalid transition.`, and `orders` and
     * `returns` each held the good one where nothing could read it.
     */
    async function backwardsTransition(): Promise<ErrorBody['error']> {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${RFQ_SHIPPED_ORDER_ID}/status`,
        payload: { to: 'new' },
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode).toBe(409);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.INVALID_TRANSITION);
      return body.error;
    }

    it('stays platform-owned', () => {
      expect(ERROR_TRANSLATION_KEYS[ERROR_CODES.INVALID_TRANSITION].moduleId).toBe('core');
    });

    it('en — "This status change is not allowed."', async () => {
      await setAdminLanguage('en');
      const error = await backwardsTransition();
      expect(error.message).toBe('This status change is not allowed.');
      // The thrower names the two statuses; the bundle sentence does not, so a
      // composition with no translation running fails this.
      expect(error.message).not.toMatch(/shipped/);
    });

    it('pl — "Ta zmiana statusu jest niedozwolona.", not "Błąd: invalid transition."', async () => {
      await setAdminLanguage('pl');
      const error = await backwardsTransition();
      expect(error.message).toBe('Ta zmiana statusu jest niedozwolona.');
    });
  });
});
