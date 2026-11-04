import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { requireCartApprovalForMembers, seedRoleGranting } from '../../helpers/cart-approval-roles.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import type {
  MailerSendInput,
  MailerSendOutcome,
} from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * Issue #651 — the cart-approval e-mails, end to end over HTTP.
 *
 * `CartApprovalService` called an optional `CartEmailDispatch` the composition
 * never supplied, so no administrator learnt a cart was waiting and no buyer
 * learnt it was approved or rejected. This drives the real routes through the
 * composed `transactional_emails` sender into a captured mailer and asserts
 * on what reached it: who, which e-mail, in which language, and that a mail
 * server refusing never fails the approval it announces.
 *
 * The fixture owns its Organization: two administrators (one of them on a
 * mailbox that refuses every message), three members, one blocked administrator
 * who must not be told. `pl_retail`'s default language is Polish.
 *
 * `specs/170-organization-roles/` WP-04 (FR-033) — the "submitted" e-mail goes
 * to every member whose role holds `carts.approve` (`rolesHolding`), so an
 * approver who is not an administrator is told as well. The *Member* role is
 * mapped as M2 maps an approval-requiring Organization.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

/** Captures every message, and refuses the ones addressed to `refuse`. */
class RefusingMailer extends InMemoryMailer {
  constructor(private readonly refuse: () => string) {
    super();
  }

  override async send(input: MailerSendInput): Promise<MailerSendOutcome> {
    if (input.to === this.refuse()) throw new Error('mailbox unavailable');
    return super.send(input);
  }
}

describe('cart approval e-mails (issue #651)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ORG = randomUUID();
  const email = (label: string): string => `i651-${label}-${RUN}@example.com`;
  const MEMBER = { id: randomUUID(), cookie: `stub-i651-member-${RUN}`, label: 'member' };
  const SECOND_MEMBER = { id: randomUUID(), cookie: `stub-i651-second-${RUN}`, label: 'second-member' };
  const THIRD_MEMBER = { id: randomUUID(), cookie: `stub-i651-third-${RUN}`, label: 'third-member' };
  const ADMIN = { id: randomUUID(), cookie: `stub-i651-admin-${RUN}`, label: 'admin' };
  const REFUSING_ADMIN = { id: randomUUID(), cookie: `stub-i651-refusing-${RUN}`, label: 'refusing-admin' };
  const BLOCKED_ADMIN = { id: randomUUID(), cookie: `stub-i651-blocked-${RUN}`, label: 'blocked-admin' };
  const APPROVER = { id: randomUUID(), cookie: `stub-i651-approver-${RUN}`, label: 'approver' };
  let refuse = email('refusing-admin');
  const mailer = new RefusingMailer(() => refuse);

  const ofCart = (cartId: string, kind: string): MailerSendInput[] =>
    mailer.sent.filter((m) => m.meta?.['cartId'] === cartId && m.meta?.['kind'] === kind);

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const em = h.em();
    em.create(Organization, {
      id: ORG,
      name: `Issue 651 Org ${RUN}`,
      taxId: `PL651${ORG.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Akceptacji 7', city: 'Warszawa', postalCode: '00-651', country: 'PL' },
    });
    await em.flush();
    await requireCartApprovalForMembers(em, ORG);
    const accounts = [
      { ...MEMBER, role: 'member' as const, blockedAt: null },
      { ...SECOND_MEMBER, role: 'member' as const, blockedAt: null },
      { ...THIRD_MEMBER, role: 'member' as const, blockedAt: null },
      { ...ADMIN, role: 'administrator' as const, blockedAt: null },
      { ...REFUSING_ADMIN, role: 'administrator' as const, blockedAt: null },
      { ...BLOCKED_ADMIN, role: 'administrator' as const, blockedAt: new Date() },
      { ...APPROVER, role: 'member' as const, blockedAt: null },
    ];
    for (const account of accounts) {
      em.create(CustomerAccount, {
        id: account.id,
        organizationId: ORG,
        email: email(account.label),
        passwordHash: 'not-a-real-hash',
        firstName: 'Issue651',
        lastName: account.label,
        organizationRoleId: await predefinedRoleIdOf(em, ORG, account.role),
        emailVerifiedAt: new Date(),
        blockedAt: account.blockedAt,
      });
    }
    await em.flush();
    await assignOrganizationRole(em, APPROVER.id, await seedRoleGranting(em, ORG, ['carts.create', 'carts.approve']));
    await addOrganizationChannels(h, ORG, ['pl_retail']);
    for (const account of accounts) {
      CUSTOMER_COOKIES[account.cookie] = { customerAccountId: account.id, organizationId: ORG };
    }
  }, 60_000);

  afterAll(async () => {
    for (const actor of [MEMBER, SECOND_MEMBER, THIRD_MEMBER, ADMIN, REFUSING_ADMIN, BLOCKED_ADMIN, APPROVER]) {
      delete CUSTOMER_COOKIES[actor.cookie];
    }
    await teardownBackendServer(h);
  });

  function call(actor: { cookie: string }, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor.cookie },
      headers: { ...CHANNEL, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  async function submittedCart(actor: { cookie: string }): Promise<string> {
    const add = await call(actor, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
    const cart = (await call(actor, 'GET', '/api/v1/cart')).json() as { data: { id: string } };
    const submit = await call(actor, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    return cart.data.id;
  }

  async function approvalStatus(cartId: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select "approval_status" from "carts" where "id" = ?`, [cartId])) as Array<{
      approval_status: string;
    }>;
    return rows[0]!.approval_status;
  }

  it('a submit tells each reachable holder of carts.approve once, in the store’s language; a refusing mailbox fails nothing', async () => {
    const cartId = await submittedCart(MEMBER);
    expect(await approvalStatus(cartId)).toBe('pending');

    const messages = ofCart(cartId, 'cart_approval_requested');
    // The refusing administrator's message raised and was contained; the
    // blocked administrator and the submitter are never addressed; the approver
    // who is not an administrator is (FR-033).
    expect(messages.map((m) => m.to).sort()).toEqual([email('admin'), email('approver')].sort());
    const message = messages.find((m) => m.to === email('admin'));
    expect(message!.subject).toContain('Issue651 member');
    expect(message!.subject).toContain('przekazuje koszyk do Twojej akceptacji');
    expect(message!.text).toContain(email('member'));
    expect(message!.text).toContain(`Issue 651 Org ${RUN}`);
  });

  it('an approve tells the buyer, in Polish, who approved it', async () => {
    const cartId = await submittedCart(SECOND_MEMBER);
    const approve = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/approve`);
    expect(approve.statusCode, approve.body).toBe(200);
    expect(await approvalStatus(cartId)).toBe('approved');

    const messages = ofCart(cartId, 'cart_approved');
    expect(messages.map((m) => m.to)).toEqual([email('second-member')]);
    expect(messages[0]!.subject).toBe('Twój koszyk został zaakceptowany');
    expect(messages[0]!.text).toContain('Issue651 admin');
  });

  it('a reject tells the buyer the reason', async () => {
    const cartId = (
      (await call(MEMBER, 'GET', '/api/v1/cart')).json() as { data: { id: string } }
    ).data.id;
    const reject = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/reject`, {
      reason: 'Ponad miesięczny budżet',
    });
    expect(reject.statusCode, reject.body).toBe(200);
    expect(await approvalStatus(cartId)).toBe('rejected_by_org_admin');

    const messages = ofCart(cartId, 'cart_rejected');
    expect(messages.map((m) => m.to)).toEqual([email('member')]);
    expect(messages[0]!.subject).toBe('Twój koszyk został odrzucony');
    expect(messages[0]!.text).toContain('Powód: Ponad miesięczny budżet');
  });

  it("a buyer's mail server refusing never fails the approval it announces", async () => {
    const cartId = await submittedCart(THIRD_MEMBER);
    refuse = email('third-member');
    try {
      const approve = await call(ADMIN, 'POST', `/api/v1/organization/carts/${cartId}/approve`);
      expect(approve.statusCode, approve.body).toBe(200);
      expect(await approvalStatus(cartId)).toBe('approved');
      expect(ofCart(cartId, 'cart_approved')).toEqual([]);
    } finally {
      refuse = email('refusing-admin');
    }
  });
});
