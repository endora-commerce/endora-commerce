import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminUser,
  Cart,
  CartItem,
  CustomerAccount,
  Organization,
  QuoteRequest,
} from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES, TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #86 — the cart-approval, admin-reject and quote-conversion refusals of
 * `carts` that were raised as `VALIDATION_FAILED` with a machine token as the
 * message (`approval_already_initiated`, `approval_not_required`,
 * `org_admin_self_submit`, `approval_not_pending`, `already_terminal`,
 * `quote_request_empty`).
 *
 * `VALIDATION_FAILED` is the one code whose message the error envelope never
 * replaces, so the storefront — which shows the backend's message verbatim —
 * showed the buyer the token, in every language, and a client could not tell
 * any of these from a malformed request. Each now has a code of its own and a
 * sentence in English and Polish.
 *
 * The sentences are written out here rather than read from the bundle — a test
 * that loads the file it is checking asserts only that JSON parses.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

const SENTENCES = {
  CART_APPROVAL_NOT_REQUIRED: {
    en: 'Your organization does not require orders to be approved, so this cart does not need to be sent for approval. Place the order directly.',
    pl: 'Twoja organizacja nie wymaga akceptacji zamówień, więc tego koszyka nie trzeba wysyłać do akceptacji. Złóż zamówienie bezpośrednio.',
  },
  CART_APPROVAL_ALREADY_SUBMITTED: {
    en: 'This cart has already been sent for approval.',
    pl: 'Ten koszyk został już wysłany do akceptacji.',
  },
  CART_APPROVAL_SELF_SUBMIT: {
    en: 'As an organization administrator you place orders directly, so your own cart is not sent for approval.',
    pl: 'Jako administrator organizacji składasz zamówienia bezpośrednio, więc Twój koszyk nie jest wysyłany do akceptacji.',
  },
  CART_APPROVAL_NOT_PENDING: {
    en: 'This cart is not awaiting approval, so it cannot be approved or rejected.',
    pl: 'Ten koszyk nie oczekuje na akceptację, dlatego nie można go zaakceptować ani odrzucić.',
  },
  CART_ALREADY_TERMINAL: {
    en: 'This cart is already completed or rejected, so it cannot be rejected.',
    pl: 'Ten koszyk jest już zrealizowany lub odrzucony, dlatego nie można go odrzucić.',
  },
  // `quote_requests`' own sentence: the noun is the quote request.
  RFQ_EMPTY: {
    en: 'A quote request must contain at least one line.',
    pl: 'Zapytanie ofertowe musi zawierać co najmniej jedną pozycję.',
  },
} as const;

describe('cart approval, reject and conversion refusals carry their own code (issue #86)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const MEMBER_ID = randomUUID();
  const ORG_ADMIN_ID = randomUUID();
  const MEMBER_COOKIE = `stub-i86-approval-member-${RUN}`;
  const OTHER_MEMBER_ID = randomUUID();
  const OTHER_MEMBER_COOKIE = `stub-i86-approval-other-member-${RUN}`;
  const ORG_ADMIN_COOKIE = `stub-i86-approval-admin-${RUN}`;
  let policyBefore = false;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    em.create(CustomerAccount, {
      id: MEMBER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: `i86-approval-member-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Approval',
      lastName: 'Member',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
    });
    em.create(CustomerAccount, {
      id: OTHER_MEMBER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: `i86-approval-other-member-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Approval',
      lastName: 'Other member',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
    });
    em.create(CustomerAccount, {
      id: ORG_ADMIN_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: `i86-approval-admin-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Approval',
      lastName: 'Admin',
      role: 'organization_admin',
      emailVerifiedAt: new Date(),
    });
    await em.flush();
    CUSTOMER_COOKIES[MEMBER_COOKIE] = { customerAccountId: MEMBER_ID, organizationId: TEST_ORGANIZATION_ID };
    CUSTOMER_COOKIES[OTHER_MEMBER_COOKIE] = { customerAccountId: OTHER_MEMBER_ID, organizationId: TEST_ORGANIZATION_ID };
    CUSTOMER_COOKIES[ORG_ADMIN_COOKIE] = { customerAccountId: ORG_ADMIN_ID, organizationId: TEST_ORGANIZATION_ID };
    const org = await em.findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    policyBefore = org.requiresCartApproval;
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[MEMBER_COOKIE];
    delete CUSTOMER_COOKIES[OTHER_MEMBER_COOKIE];
    delete CUSTOMER_COOKIES[ORG_ADMIN_COOKIE];
    await setPolicy(policyBefore);
    await teardownBackendServer(h);
  });

  async function setPolicy(requiresCartApproval: boolean): Promise<void> {
    const em = h.em();
    const org = await em.findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    org.requiresCartApproval = requiresCartApproval;
    await em.flush();
  }

  async function addLine(cookie: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: { b2b_session: cookie },
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  function submit(cookie: string, language: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/submit-for-approval',
      cookies: { b2b_session: cookie },
      headers: { ...CHANNEL, 'accept-language': language },
    });
  }

  async function cartIdOf(cookie: string): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: cookie },
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  }

  /** A cart of the Organization in the given state, written directly. */
  async function cartIn(state: { status: 'completed' | 'rejected' }): Promise<string> {
    const em = h.em();
    const cart = em.create(Cart, {
      customerAccountId: randomUUID(),
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: channelId,
      status: state.status,
    });
    await em.persistAndFlush(cart);
    em.create(CartItem, {
      cartId: cart.id,
      productId: SEED_PRODUCT_101_ID,
      quantity: 1,
      unitPrice: '25.00',
      currency: 'PLN',
    });
    await em.flush();
    return cart.id;
  }

  function expectRefusal(
    res: { statusCode: number; body: string; json: () => unknown },
    code: keyof typeof SENTENCES,
    language: 'en' | 'pl',
  ): ErrorBody['error'] {
    // The status every one of these refusals has always had.
    expect(res.statusCode, res.body).toBe(422);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(ERROR_CODES[code]);
    expect(error.message).toBe(SENTENCES[code][language]);
    if (language === 'pl') expect(error.message).not.toBe(SENTENCES[code].en);
    return error;
  }

  describe('submit for approval', () => {
    it.each(['en', 'pl'] as const)(
      'CART_APPROVAL_NOT_REQUIRED (%s) — the Organization requires no approval',
      async (language) => {
        await setPolicy(false);
        await addLine(MEMBER_COOKIE);
        expectRefusal(await submit(MEMBER_COOKIE, language), 'CART_APPROVAL_NOT_REQUIRED', language);
      },
    );

    it.each(['en', 'pl'] as const)(
      'CART_APPROVAL_SELF_SUBMIT (%s) — an Organization administrator submits their own cart',
      async (language) => {
        await setPolicy(true);
        await addLine(ORG_ADMIN_COOKIE);
        expectRefusal(await submit(ORG_ADMIN_COOKIE, language), 'CART_APPROVAL_SELF_SUBMIT', language);
      },
    );

    it('CART_APPROVAL_ALREADY_SUBMITTED — a cart already sent, in both languages, with its state in details', async () => {
      await setPolicy(true);
      await addLine(MEMBER_COOKIE);
      const cartId = await cartIdOf(MEMBER_COOKIE);
      // A real first submit: since issue #619 it is stored, so the second is refused.
      const first = await submit(MEMBER_COOKIE, 'en');
      expect(first.statusCode, first.body).toBe(200);
      const en = expectRefusal(await submit(MEMBER_COOKIE, 'en'), 'CART_APPROVAL_ALREADY_SUBMITTED', 'en');
      expect(en.details).toEqual({ cartId, approvalStatus: 'pending' });
      expectRefusal(await submit(MEMBER_COOKIE, 'pl'), 'CART_APPROVAL_ALREADY_SUBMITTED', 'pl');
    });
  });

  describe('approve and reject by the Organization administrator', () => {
    it.each([
      ['approve', 'en'],
      ['approve', 'pl'],
      ['reject', 'en'],
      ['reject', 'pl'],
    ] as const)('CART_APPROVAL_NOT_PENDING — %s a cart not awaiting approval (%s)', async (action, language) => {
      // A member's basket, not yet sent — the cart the screen is for, which
      // the administrator reaches since issue #619.
      await addLine(OTHER_MEMBER_COOKIE);
      const cartId = await cartIdOf(OTHER_MEMBER_COOKIE);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/organization/carts/${cartId}/${action}`,
        cookies: { b2b_session: ORG_ADMIN_COOKIE },
        headers: { ...CHANNEL, 'accept-language': language, 'content-type': 'application/json' },
        payload: action === 'reject' ? { reason: 'Not this quarter' } : {},
      });
      const error = expectRefusal(res, 'CART_APPROVAL_NOT_PENDING', language);
      expect(error.details).toEqual({ cartId, approvalStatus: 'not_required' });
    });
  });

  /**
   * An operator is answered in their stored preference, never in what the
   * browser asks for (D-132), so the language is set on the admin account.
   */
  describe('reject in the admin', () => {
    let languageBefore: string | null = null;

    beforeAll(async () => {
      languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    });

    afterAll(async () => {
      await setAdminLanguage(languageBefore);
    });

    async function setAdminLanguage(value: string | null): Promise<void> {
      const em = h.em();
      const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
      admin.preferredLanguage = value;
      await em.flush();
    }

    it.each(['en', 'pl'] as const)('CART_ALREADY_TERMINAL (%s) — a completed cart', async (language) => {
      await setAdminLanguage(language);
      const cartId = await cartIn({ status: 'completed' });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/carts/${cartId}/reject`,
        cookies: ADMIN_COOKIE,
        headers: { 'content-type': 'application/json' },
        payload: { reason: 'too late' },
      });
      const error = expectRefusal(res, 'CART_ALREADY_TERMINAL', language);
      expect(error.details).toEqual({ cartId, status: 'completed' });
    });
  });

  describe('a cart from a quote request', () => {
    it.each(['en', 'pl'] as const)('RFQ_EMPTY (%s) — the quote request has no lines', async (language) => {
      const em = h.em();
      const qr = em.create(QuoteRequest, {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: MEMBER_ID,
      });
      await em.persistAndFlush(qr);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/cart/from-quote-request/${qr.id}`,
        cookies: { b2b_session: MEMBER_COOKIE },
        headers: { ...CHANNEL, 'accept-language': language },
      });
      const error = expectRefusal(res, 'RFQ_EMPTY', language);
      expect(error.details).toEqual({ quoteRequestId: qr.id });
    });
  });

  it('routes every minted code to carts, the module that raises it', () => {
    for (const code of [
      ERROR_CODES.CART_APPROVAL_NOT_REQUIRED,
      ERROR_CODES.CART_APPROVAL_ALREADY_SUBMITTED,
      ERROR_CODES.CART_APPROVAL_SELF_SUBMIT,
      ERROR_CODES.CART_APPROVAL_NOT_PENDING,
      ERROR_CODES.CART_ALREADY_TERMINAL,
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('carts');
    }
  });
});
