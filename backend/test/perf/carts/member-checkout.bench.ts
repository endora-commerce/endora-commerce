// perf-weight: fast — about 40 s on a loaded 16-core dev box (170 WP-13, 2026-11-04).
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CartItem } from '../../helpers/package-entities.js';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * A signed-in member's cart, checkout and placement — the paths SC-004 of
 * `specs/170-organization-roles/` bounds (FR-080: p95 within 5 % of the release
 * before).
 *
 * `cart-routes.bench.ts` beside it measures an **anonymous** basket, which no
 * organization permission is ever judged for (a guest's cart lines pass, PR-4),
 * so it cannot see what 170 adds to these paths. This file drives the same
 * routes as a member of a company Organization, with a session the real login
 * issued, so every request crosses the session resolution and — from 170 on —
 * the permission guard the route declares:
 *
 *   - `GET  /api/v1/cart`                 the cart page, on a 20-line cart
 *   - `POST /api/v1/cart/items`           adding to the cart
 *   - `POST /api/v1/orders/preview-total` the checkout page's total
 *   - `POST /api/v1/orders`               placement, one fresh one-line cart each
 *
 * It uses nothing but the public routes, so the same file runs unchanged on the
 * release before 170 — which is how SC-004 is measured: this file, on both
 * trees, alternately.
 *
 * ## The budgets
 *
 * A regression detector, as in `cart-routes.bench.ts` (issue #143, D-65): three
 * times the p95 measured on a 16-core dev box at load average 4–6, rounded up.
 * They are not SC-004's 5 % bound — that is a comparison between two trees, which
 * a single run cannot make.
 *
 * Env knobs:
 *   PERF_RUN                     — 'true' to enable
 *   PERF_ITERATIONS              — requests per scenario (default 100)
 *   PERF_MEMBER_CART_LINES       — lines on the measured cart (default 20)
 *   PERF_MEMBER_CART_P95_MS      — GET /api/v1/cart budget (default 60)
 *   PERF_MEMBER_ADD_P95_MS       — POST /api/v1/cart/items budget (default 90)
 *   PERF_MEMBER_PREVIEW_P95_MS   — POST /api/v1/orders/preview-total budget (default 90)
 *   PERF_MEMBER_PLACE_P95_MS     — POST /api/v1/orders budget (default 400)
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const cartLines = Number(process.env['PERF_MEMBER_CART_LINES'] ?? '20');
const cartBudget = Number(process.env['PERF_MEMBER_CART_P95_MS'] ?? '60');
const addBudget = Number(process.env['PERF_MEMBER_ADD_P95_MS'] ?? '90');
const previewBudget = Number(process.env['PERF_MEMBER_PREVIEW_P95_MS'] ?? '90');
const placeBudget = Number(process.env['PERF_MEMBER_PLACE_P95_MS'] ?? '400');
const WARM_UP = 10;
const PASSWORD = 'perf-member-password-1234!';

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function summary(label: string, samples: number[], budget: number): void {
  // eslint-disable-next-line no-console
  console.log(
    `[perf/${label}] iterations=${samples.length} ` +
      `p50=${percentile(samples, 0.5).toFixed(1)}ms p95=${percentile(samples, 0.95).toFixed(1)}ms ` +
      `p99=${percentile(samples, 0.99).toFixed(1)}ms budget=${budget}ms`,
  );
}

function sessionCookieOf(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie)
    ? setCookie.find((c) => c.includes('b2b_session='))
    : setCookie;
  return /b2b_session=([^;]+)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(!shouldRun)(
  "a member's cart, checkout and placement — storefront perf (SC-004)",
  () => {
    let h: BackendServerHandle;
    let session = '';
    let addressId = '';

    const inject = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      h.app.inject({
        method,
        url,
        cookies: { b2b_session: session },
        ...(payload ? { payload } : {}),
      });

    const placement = (): Record<string, unknown> => ({
      deliveryAddressId: addressId,
      billingAddressId: addressId,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    });

    type Timed = { statusCode: number; body: string; elapsed?: number };

    /**
     * Times `count` calls of `call` after {@link WARM_UP} unmeasured ones; every call
     * must answer `status`. A call that reports its own `elapsed` is timed by it, so
     * its unmeasured preparation stays out of the sample.
     */
    async function measure(
      count: number,
      status: number,
      call: () => Promise<Timed>,
    ): Promise<number[]> {
      for (let i = 0; i < WARM_UP; i += 1) {
        const res = await call();
        expect(res.statusCode, res.body).toBe(status);
      }
      const samples: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const t0 = performance.now();
        const res = await call();
        samples.push(res.elapsed ?? performance.now() - t0);
        expect(res.statusCode, res.body).toBe(status);
      }
      return samples;
    }

    beforeAll(async () => {
      h = await setupBackendServer();
      const connection = h.em().getConnection();
      // Placement draws stock on every order; only this product's lines are placed.
      await connection.execute(
        `update "stock_levels" set "on_hand" = 1000000 where "product_id" = ?`,
        [SEED_PRODUCT_101_ID],
      );

      const register = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/register',
        payload: {
          organization: {
            name: 'Perf Member Sp. z o.o.',
            taxId: 'PL1700000170',
            registeredAddress: {
              street: 'ul. Wydajna 1',
              city: 'Warszawa',
              postalCode: '00-170',
              country: 'PL',
            },
          },
          firstUser: {
            email: 'perf-member@example.com',
            password: PASSWORD,
            firstName: 'Perf',
            lastName: 'Member',
          },
          acceptedTermsVersion: '1.0.0',
        },
      });
      expect(register.statusCode, register.body).toBe(201);
      const { token } = (
        await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-verification-token' })
      ).json() as {
        token: string;
      };
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/api/v1/auth/email-verification/verify',
            payload: { token },
          })
        ).statusCode,
      ).toBe(200);
      const login = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: { email: 'perf-member@example.com', password: PASSWORD },
      });
      expect(login.statusCode, login.body).toBe(200);
      session = sessionCookieOf(login.headers['set-cookie']);
      expect(session).not.toBe('');

      const address = await inject('POST', '/api/v1/organizations/mine/addresses', {
        kind: 'delivery',
        recipientName: 'Perf Member',
        street: 'ul. Odbioru 3',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
        isDefault: true,
      });
      expect(address.statusCode, address.body).toBe(201);
      addressId = (address.json() as { data: { id: string } }).data.id;
    }, 5 * 60_000);

    afterAll(async () => {
      if (h) await teardownBackendServer(h);
    });

    it(
      'GET /api/v1/cart — the cart page p95',
      async () => {
        const add = await inject('POST', '/api/v1/cart/items', {
          productId: SEED_PRODUCT_101_ID,
          quantity: 1,
        });
        expect(add.statusCode, add.body).toBe(200);
        // The other lines as `cart-routes.bench.ts` seeds them: the fixture catalogue
        // has three products, and a line per variant is what makes a cart long.
        const cartId = (add.json() as { data: { id: string } }).data.id;
        const em = h.em();
        for (let i = 1; i < cartLines; i += 1) {
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
        const lines = (
          (await inject('GET', '/api/v1/cart')).json() as { data: { items: unknown[] } }
        ).data.items.length;
        const samples = await measure(iterations, 200, () => inject('GET', '/api/v1/cart'));
        summary(`member-cart lines=${lines}`, samples, cartBudget);
        // The seeded lines name no real variant, so they leave before checkout and placement.
        await h
          .em()
          .getConnection()
          .execute(`delete from "cart_items" where "cart_id" = ? and "variant_id" is not null`, [
            cartId,
          ]);
        expect(lines).toBe(cartLines);
        expect(percentile(samples, 0.95)).toBeLessThan(cartBudget);
      },
      10 * 60_000,
    );

    it(
      'POST /api/v1/cart/items — adding to the cart p95',
      async () => {
        const samples = await measure(iterations, 200, () =>
          inject('POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 }),
        );
        summary('member-add', samples, addBudget);
        expect(percentile(samples, 0.95)).toBeLessThan(addBudget);
      },
      10 * 60_000,
    );

    it(
      'POST /api/v1/orders/preview-total — the checkout total p95',
      async () => {
        const samples = await measure(iterations, 200, () =>
          inject('POST', '/api/v1/orders/preview-total', {
            deliveryMethodId: SEED_DELIVERY_METHOD_ID,
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
            billingAddressId: addressId,
          }),
        );
        summary('member-preview', samples, previewBudget);
        expect(percentile(samples, 0.95)).toBeLessThan(previewBudget);
      },
      10 * 60_000,
    );

    it(
      'POST /api/v1/orders — placement p95, one fresh one-line cart each',
      async () => {
        const samples = await measure(iterations, 201, async () => {
          // Not measured: the basket the placement consumes.
          const add = await inject('POST', '/api/v1/cart/items', {
            productId: SEED_PRODUCT_101_ID,
            quantity: 1,
          });
          expect(add.statusCode, add.body).toBe(200);
          const t0 = performance.now();
          const place = await inject('POST', '/api/v1/orders', placement());
          return {
            statusCode: place.statusCode,
            body: place.body,
            elapsed: performance.now() - t0,
          };
        });
        summary('member-place', samples, placeBudget);
        expect(percentile(samples, 0.95)).toBeLessThan(placeBudget);
      },
      15 * 60_000,
    );
  },
);
