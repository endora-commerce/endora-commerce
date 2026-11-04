import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Cart, CartItem, QuoteRequest } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';
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
    en: 'Your role lets you place orders without approval, so this cart does not need to be sent for approval. Place the order directly.',
    pl: 'Twoja rola pozwala składać zamówienia bez akceptacji, więc tego koszyka nie trzeba wysyłać do akceptacji. Złóż zamówienie bezpośrednio.',
  },
  CART_APPROVAL_ALREADY_SUBMITTED: {
    en: 'This cart has already been sent for approval.',
    pl: 'Ten koszyk został już wysłany do akceptacji.',
  },
  // `specs/170-organization-roles/` R-36 — an approver deciding on their own
  // pending cart; it replaces `CART_APPROVAL_SELF_SUBMIT`, no longer raised.
  CART_APPROVAL_SELF_APPROVE: {
    en: 'You cannot approve or reject your own cart. Another person in your organization who approves carts has to decide on it.',
    pl: 'Nie możesz zaakceptować ani odrzucić własnego koszyka. Decyzję musi podjąć inna osoba w Twojej organizacji, która akceptuje koszyki.',
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
  // `specs/170-organization-roles/` WP-04 — approval is judged by the role
  // (`carts.order_without_approval`, `carts.approve`), so the fixture is an
  // Organization of its own whose *Member* role was mapped as M2 maps an
  // approval-requiring one, and an approver who needs approval themself.
  let org: CartFixtureOrganization;
  let MEMBER_ID: string;
  let MEMBER_COOKIE: string;
  let OTHER_MEMBER_COOKIE: string;
  let ORG_ADMIN_COOKIE: string;
  let APPROVER_COOKIE: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    org = await seedCartOrganization(h, {
      label: 'Issue 86 approval',
      approvalRequired: true,
      members: {
        MEMBER: 'member',
        OTHER_MEMBER: 'member',
        ORG_ADMIN: 'administrator',
        APPROVER: { permissions: ['carts.create', 'carts.approve'] },
      },
    });
    MEMBER_ID = org.actors['MEMBER']!.id;
    MEMBER_COOKIE = org.actors['MEMBER']!.cookie;
    OTHER_MEMBER_COOKIE = org.actors['OTHER_MEMBER']!.cookie;
    ORG_ADMIN_COOKIE = org.actors['ORG_ADMIN']!.cookie;
    APPROVER_COOKIE = org.actors['APPROVER']!.cookie;
  }, 60_000);

  afterAll(async () => {
    org?.release();
    await teardownBackendServer(h);
  });

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
      organizationId: org.organizationId,
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
      'CART_APPROVAL_NOT_REQUIRED (%s) — the buyer holds carts.order_without_approval (an administrator)',
      async (language) => {
        // Was `CART_APPROVAL_SELF_SUBMIT` before 170 (expected difference F3,
        // `contracts/migration-and-replay.md` §6.1 row 22).
        await addLine(ORG_ADMIN_COOKIE);
        expectRefusal(await submit(ORG_ADMIN_COOKIE, language), 'CART_APPROVAL_NOT_REQUIRED', language);
      },
    );

    it('CART_APPROVAL_ALREADY_SUBMITTED — a cart already sent, in both languages, with its state in details', async () => {
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

    it.each([
      ['approve', 'en'],
      ['approve', 'pl'],
      ['reject', 'en'],
      ['reject', 'pl'],
    ] as const)('CART_APPROVAL_SELF_APPROVE — an approver may not %s their own pending cart (%s)', async (action, language) => {
      // The approver's role holds `carts.approve` and not
      // `carts.order_without_approval`, so their own basket goes for approval.
      await addLine(APPROVER_COOKIE);
      const cartId = await cartIdOf(APPROVER_COOKIE);
      const sent = await submit(APPROVER_COOKIE, 'en');
      if (sent.statusCode !== 200) {
        // A previous case left this basket pending already.
        expect((sent.json() as ErrorBody).error.code, sent.body).toBe(ERROR_CODES.CART_APPROVAL_ALREADY_SUBMITTED);
      }
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/organization/carts/${cartId}/${action}`,
        cookies: { b2b_session: APPROVER_COOKIE },
        headers: { ...CHANNEL, 'accept-language': language, 'content-type': 'application/json' },
        payload: action === 'reject' ? { reason: 'My own' } : {},
      });
      const error = expectRefusal(res, 'CART_APPROVAL_SELF_APPROVE', language);
      expect(error.details).toEqual({ cartId });
      const [row] = (await h
        .em()
        .getConnection()
        .execute(`select "approval_status" from "carts" where "id" = ?`, [cartId])) as Array<{ approval_status: string }>;
      expect(row?.approval_status).toBe('pending');
    });

    it("CART_APPROVAL_NOT_PENDING is judged before self-approval: an approver's own cart that is not pending (R-36)", async () => {
      const em = h.em();
      const cart = em.create(Cart, {
        customerAccountId: org.actors['APPROVER']!.id,
        organizationId: org.organizationId,
        salesChannelId: channelId,
        status: 'completed',
      });
      await em.persistAndFlush(cart);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/organization/carts/${cart.id}/approve`,
        cookies: { b2b_session: APPROVER_COOKIE },
        headers: { ...CHANNEL, 'accept-language': 'en', 'content-type': 'application/json' },
        payload: {},
      });
      expectRefusal(res, 'CART_APPROVAL_NOT_PENDING', 'en');
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
        organizationId: org.organizationId,
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
      ERROR_CODES.CART_APPROVAL_SELF_APPROVE,
      ERROR_CODES.CART_APPROVAL_NOT_PENDING,
      ERROR_CODES.CART_ALREADY_TERMINAL,
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('carts');
    }
  });
});
