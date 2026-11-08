import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressServicePort,
  CustomerAccountLifecycleWritePort,
  PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry, hashPassword } from '@endora-commerce/platform/kernel';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart, CartAuditEntry, CustomerAccount, type CartRow } from '../../helpers/package-entities.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import {
  customerAccountPortsFor,
  personalOrganizationProvisionFor,
} from '../../helpers/customer-account-ports.js';
import { twoFactorEnrolmentsFor } from '../../helpers/two-factor-enrolments.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
// `dist`, not `src` (feature 146): see `test/helpers/customer-account-ports.ts`.
import { CustomerAccountReadService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import { CustomerAccountLifecycleWriteService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-lifecycle-ports.js';
import { AddressService } from '../../../../packages/modules/addresses/src/backend/services/address-service.js';
import { createAddressServicePort } from '../../../../packages/modules/addresses/src/backend/services/address-ports.js';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { toOrganizationRecord } from '../../../../packages/modules/organizations/src/backend/services/organization-details-port.js';
import { CartAnonymizationService } from '../../../../packages/modules/carts/src/backend/services/cart-anonymization-service.js';
import { CartAuditService } from '../../../../packages/modules/carts/src/backend/services/cart-audit-service.js';
import { CustomerAuthorityService } from '../../../../packages/modules/customers/src/backend/services/customer-authority-service.js';
import { CustomerDeletionService } from '../../../../packages/modules/customers/src/backend/services/customer-deletion-service.js';
import type { OrganizationDepletionGuard } from '../../../../packages/modules/customers/src/backend/services/organization-depletion-guard.js';

/**
 * Issue #920 — the retention sweep erases the free text operators and
 * approvers wrote about the subject's carts.
 *
 * An operator (`cart-admin-service.ts` `reject`) or an approver
 * (`cart-approval-service.ts` `reject`) writes a reason onto the cart
 * (`Cart.rejectedReason`) and onto the cart's history (`cart_audit_entries.reason`).
 * When the account is anonymised, `carts` sets both to `null` on every cart of
 * the account, through `cartAnonymizationPort`, before the account's
 * `anonymizedAt` is written. The cart keeps its status, the rejection's time and
 * actor, and every other column; the history keeps its actions, actors, states
 * and metadata. One `cart.anonymized` audit entry per cart it changed records
 * only `hadRejectedReason` (the #843 rule).
 *
 * Driven through `sweep()`. A second run changes nothing: no row, no audit
 * entry, no event.
 */
describe('Anonymization sweep — reasons written about the subject’s carts (issue #920)', () => {
  let db: TestDb;
  let em: EntityManager;
  let audit: AuditLogService;
  let cartAudit: CartAuditService;
  let carts: CartAnonymizationService;
  let personalOrgs: PersonalOrganizationService;
  let addresses: AddressServicePort;
  let accountWrites: CustomerAccountLifecycleWritePort;
  let svc: CustomerDeletionService;
  /** `customer_account.anonymized.v1`, as `customer_accounts` announces it. */
  let anonymizedEvents: string[];

  const OPERATOR_ID = '00000000-0000-4000-8000-00000000c920';
  const OPERATOR_REASON = 'Customer Jan Kowalski keeps abusing returns, see ticket 4711';
  const APPROVER_REASON = 'Jan, you know we never buy this brand. Ask Ewa first.';
  /** Every reason seeded on the subject's carts: none may survive in a row or an audit entry. */
  const SEEDED = [OPERATOR_REASON, APPROVER_REASON];

  const DELETED_BY = { actorAdminUserId: '00000000-0000-4000-8000-00000000b920' };
  const after = (ms: number) => new Date(Date.now() + ms);
  const unique = (): string => `${Date.now()}-${Math.floor(performance.now() * 1000)}-${Math.random()}`;

  function personalOrganizationPortOver(orgs: PersonalOrganizationService): PersonalOrganizationPort {
    return {
      ensureForCustomerAccount: async (id) => toOrganizationRecord(await orgs.ensureForCustomerAccountId(id)),
      provisionPersonalOrganization: async (id) => {
        const org = await orgs.provisionPersonalOrganizationFor(id);
        return { ...toOrganizationRecord(org), administratorRoleId: await predefinedRoleIdOf(em, org.id, 'administrator') };
      },
      anonymizeIfOrphaned: async (id) => {
        const org = await orgs.anonymizeIfOrphaned(id);
        return org ? toOrganizationRecord(org) : null;
      },
      // Issue #923 — the sweep's second work-list source.
      listIncompletelyScrubbed: () => orgs.listIncompletelyScrubbed(),
      hasIncompletelyScrubbed: () => orgs.hasIncompletelyScrubbed(),
    };
  }

  function buildService(overrides: { accountWrites?: CustomerAccountLifecycleWritePort } = {}): CustomerDeletionService {
    const organizationRoles = {
      predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') =>
        predefinedRoleIdOf(em, organizationId, kind),
    };
    return new CustomerDeletionService(
      new CustomerAccountReadService(() => em, twoFactorEnrolmentsFor(() => em, 'customer'), organizationRoles),
      overrides.accountWrites ?? accountWrites,
      personalOrganizationPortOver(personalOrgs),
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      { destroyAllForCustomer: async () => undefined },
      // The sweep never asks the last-administrator question.
      {} as OrganizationDepletionGuard,
      addresses,
      async () => 365,
      carts,
    );
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    audit = new AuditLogService(() => em);
    cartAudit = new CartAuditService(() => em, audit);
    carts = new CartAnonymizationService(() => em, audit);
    addresses = createAddressServicePort(() => new AddressService(() => em, undefined, audit));
    personalOrgs = new PersonalOrganizationService(() => em, customerAccountPortsFor(() => em), audit);
    anonymizedEvents = [];
    accountWrites = new CustomerAccountLifecycleWriteService(
      () => em,
      audit,
      twoFactorEnrolmentsFor(() => em, 'customer'),
      personalOrganizationProvisionFor(() => em),
      undefined,
      async (event) => {
        anonymizedEvents.push(event.customerAccountId);
      },
    );
    svc = buildService();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  /** The B2C shape: an account in its own single-member personal Organization. */
  async function personalCustomer(): Promise<CustomerAccount> {
    const id = randomUUID();
    const email = `cart-reasons-b2c-${unique()}@example.test`;
    const org = await personalOrgs.provisionFor(em, { customerAccountId: id, email, firstName: 'Jan', lastName: 'Kowalski' });
    const account = em.create(CustomerAccount, {
      id,
      organizationId: org.id,
      email,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Jan',
      lastName: 'Kowalski',
    });
    await em.persistAndFlush(account);
    return account;
  }

  /** Two members of one company Organization: the subject and a colleague who stays. */
  async function companyMembers(): Promise<{ subject: CustomerAccount; colleague: CustomerAccount }> {
    const organization = await seedAdHocOrganization(em, 'Cart Reasons Company');
    const make = async (firstName: string) => {
      const account = em.create(CustomerAccount, {
        organizationId: organization.id,
        organizationRoleId: await predefinedRoleIdOf(em, organization.id, 'member'),
        email: `cart-reasons-company-${unique()}@example.test`,
        passwordHash: 'x'.repeat(32),
        firstName,
        lastName: 'Firmowy',
      });
      await em.persistAndFlush(account);
      return account;
    };
    return { subject: await make('Jan'), colleague: await make('Ewa') };
  }

  /**
   * A cart of `owner`, rejected as the operator's or the approver's `reject`
   * writes it: the cart's columns, then the history row through `carts`' own
   * audit writer. `reason: null` stages a cart with no reason on it.
   */
  async function rejectedCart(
    owner: CustomerAccount,
    by: { kind: 'operator' } | { kind: 'approver'; approver: CustomerAccount },
    reason: string | null,
  ): Promise<CartRow> {
    const cart = em.create(Cart, {
      customerAccountId: owner.id,
      organizationId: owner.organizationId,
      status: 'rejected',
      approvalStatus: by.kind === 'approver' ? 'rejected_by_org_admin' : 'not_required',
      rejectedAt: new Date('2026-10-01T10:00:00.000Z'),
      rejectedByActor: by.kind === 'approver' ? `org_admin:${by.approver.id}` : `admin:${OPERATOR_ID}`,
      rejectedReason: reason,
    });
    await em.persistAndFlush(cart);
    await cartAudit.record({
      cartId: cart.id,
      actorType: 'customer',
      actorId: owner.id,
      action: 'line_added',
      metadata: { productId: randomUUID(), quantity: 2 },
    });
    await cartAudit.record(
      by.kind === 'approver'
        ? {
            cartId: cart.id,
            actorType: 'org_admin',
            actorId: by.approver.id,
            action: 'approval_rejected',
            fromState: 'pending',
            toState: 'rejected_by_org_admin',
            reason,
          }
        : {
            cartId: cart.id,
            actorType: 'platform_admin',
            actorId: OPERATOR_ID,
            action: 'admin_rejected',
            fromState: 'active',
            toState: 'rejected',
            reason,
          },
    );
    return cart;
  }

  /** The columns the scrub must not move, on the cart and on its history. */
  async function snapshot(cartId: string): Promise<{ cart: Record<string, unknown>; history: Array<Record<string, unknown>> }> {
    em.clear();
    const cart = await em.findOneOrFail(Cart, { id: cartId }, { filters: false });
    const history = await em.find(CartAuditEntry, { cartId }, { orderBy: { occurredAt: 'asc', id: 'asc' } });
    return {
      cart: {
        status: cart.status,
        approvalStatus: cart.approvalStatus,
        rejectedAt: cart.rejectedAt?.toISOString() ?? null,
        rejectedByActor: cart.rejectedByActor ?? null,
        customerAccountId: cart.customerAccountId ?? null,
        organizationId: cart.organizationId ?? null,
      },
      history: history.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorType: row.actorType,
        actorId: row.actorId ?? null,
        action: row.action,
        fromState: row.fromState ?? null,
        toState: row.toState ?? null,
        metadata: row.metadata,
      })),
    };
  }

  async function reasonsOf(cartId: string): Promise<{ cart: string | null; history: Array<string | null> }> {
    em.clear();
    const cart = await em.findOneOrFail(Cart, { id: cartId }, { filters: false });
    const history = await em.find(CartAuditEntry, { cartId }, { orderBy: { occurredAt: 'asc', id: 'asc' } });
    return { cart: cart.rejectedReason ?? null, history: history.map((row) => row.reason ?? null) };
  }

  async function anonymizedRows(cartIds: readonly string[]): Promise<AuditLogEntry[]> {
    return em.find(
      AuditLogEntry,
      { action: 'cart.anonymized', objectId: { $in: [...cartIds] } },
      { orderBy: { id: 'asc' } },
    );
  }

  /** Every carts-side and audit-side place a seeded reason could survive in, as text. */
  async function textOfSubject(customerAccountId: string, cartIds: readonly string[]): Promise<string> {
    // On the test's transaction: `em.execute` carries its context, a bare connection would not.
    const ids = `{${cartIds.join(',')}}`;
    const rows = [
      ...(await em.execute(`select row_to_json(c)::text as t from "carts" c where c."customer_account_id" = ?`, [customerAccountId])),
      ...(await em.execute(`select row_to_json(e)::text as t from "cart_audit_entries" e where e."cart_id" = any(?::uuid[])`, [ids])),
      ...(await em.execute(`select row_to_json(a)::text as t from "audit_log_entries" a where a."object_id" = any(?::text[])`, [ids])),
    ] as Array<{ t: string }>;
    return rows.map((row) => row.t).join('\n');
  }

  it('I-920-1 — the reasons on the subject’s carts are erased; status, actors and history stay', async () => {
    const subject = await personalCustomer();
    const byOperator = await rejectedCart(subject, { kind: 'operator' }, OPERATOR_REASON);
    const other = await personalCustomer();
    const othersCart = await rejectedCart(other, { kind: 'operator' }, OPERATOR_REASON);
    const before = await snapshot(byOperator.id);
    const othersBefore = await reasonsOf(othersCart.id);

    await accountWrites.softDelete(subject.id, DELETED_BY);
    expect(await svc.sweep(0, after(60_000))).toBe(1);

    expect(await reasonsOf(byOperator.id)).toEqual({ cart: null, history: [null, null] });
    expect(await snapshot(byOperator.id)).toEqual(before);
    expect(await textOfSubject(subject.id, [byOperator.id])).not.toContain(OPERATOR_REASON);

    const [row, ...more] = await anonymizedRows([byOperator.id]);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      action: 'cart.anonymized',
      objectType: 'cart',
      objectId: byOperator.id,
      stateBefore: { hadRejectedReason: true },
    });
    // The sweep runs on a timer: no actor of any kind.
    expect(row!.actorAdminUserId ?? null).toBeNull();
    expect(row!.impersonatedCustomerAccountId ?? null).toBeNull();
    expect(row!.actorCustomerAccountId ?? null).toBeNull();
    expect(row!.stateAfter ?? null).toBeNull();
    expect(Object.keys(row!.stateBefore ?? {})).toEqual(['hadRejectedReason']);

    // Another customer's cart is not the subject's.
    expect(await reasonsOf(othersCart.id)).toEqual(othersBefore);
    expect(await anonymizedRows([othersCart.id])).toEqual([]);
  });

  it('I-920-2 — a reason only in the history is erased too, and a cart with none is not touched', async () => {
    const subject = await personalCustomer();
    // The cart's column was cleared, the history row still holds the text.
    const historyOnly = await rejectedCart(subject, { kind: 'operator' }, OPERATOR_REASON);
    em.clear();
    const row = await em.findOneOrFail(Cart, { id: historyOnly.id }, { filters: false });
    row.rejectedReason = null;
    await em.flush();
    const clean = await rejectedCart(subject, { kind: 'operator' }, null);
    em.clear();
    const cleanUpdatedAt = (await em.findOneOrFail(Cart, { id: clean.id }, { filters: false })).updatedAt.toISOString();

    await accountWrites.softDelete(subject.id, DELETED_BY);
    expect(await svc.sweep(0, after(60_000))).toBe(1);

    expect(await reasonsOf(historyOnly.id)).toEqual({ cart: null, history: [null, null] });
    expect((await anonymizedRows([historyOnly.id])).map((r) => r.stateBefore)).toEqual([{ hadRejectedReason: false }]);

    em.clear();
    expect((await em.findOneOrFail(Cart, { id: clean.id }, { filters: false })).updatedAt.toISOString()).toBe(cleanUpdatedAt);
    expect(await anonymizedRows([clean.id])).toEqual([]);
  });

  it('I-920-3 — a run interrupted after the carts step is finished once; a second pass changes nothing', async () => {
    const subject = await personalCustomer();
    const cart = await rejectedCart(subject, { kind: 'operator' }, OPERATOR_REASON);
    await accountWrites.softDelete(subject.id, DELETED_BY);

    let crashed = false;
    const crashing = buildService({
      accountWrites: new Proxy(accountWrites, {
        get(target, key) {
          if (key === 'anonymize') {
            return async (id: string) => {
              if (!crashed) {
                crashed = true;
                throw new Error('simulated crash');
              }
              return target.anonymize(id);
            };
          }
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }),
    });
    await expect(crashing.sweep(0, after(60_000))).rejects.toThrow();
    // The carts step ran, the account is still due.
    expect(await reasonsOf(cart.id)).toEqual({ cart: null, history: [null, null] });

    em.clear();
    const updatedAt = (await em.findOneOrFail(Cart, { id: cart.id }, { filters: false })).updatedAt.toISOString();
    expect(await svc.sweep(0, after(120_000))).toBe(1);

    em.clear();
    expect((await em.findOneOrFail(Cart, { id: cart.id }, { filters: false })).updatedAt.toISOString()).toBe(updatedAt);
    expect(await anonymizedRows([cart.id])).toHaveLength(1);
    expect(anonymizedEvents).toEqual([subject.id]);

    // And the step itself, called again, finds nothing left.
    const auditCount = await em.count(AuditLogEntry, {});
    expect(await carts.anonymizeForCustomerAccount(subject.id)).toBe(0);
    expect(await em.count(AuditLogEntry, {})).toBe(auditCount);
    expect(await textOfSubject(subject.id, [cart.id])).not.toContain(OPERATOR_REASON);
  });

  it('I-920-4 — a company member’s own carts are erased; a colleague’s cart the subject rejected keeps its reason', async () => {
    const { subject, colleague } = await companyMembers();
    const ownCart = await rejectedCart(subject, { kind: 'approver', approver: colleague }, APPROVER_REASON);
    // The subject was the approver here: the cart, and its reason, are the colleague's.
    const colleaguesCart = await rejectedCart(colleague, { kind: 'approver', approver: subject }, APPROVER_REASON);
    const colleagueBefore = await reasonsOf(colleaguesCart.id);

    await accountWrites.softDelete(subject.id, DELETED_BY);
    expect(await svc.sweep(0, after(60_000))).toBe(1);

    expect(await reasonsOf(ownCart.id)).toEqual({ cart: null, history: [null, null] });
    em.clear();
    expect(await em.findOneOrFail(Cart, { id: ownCart.id }, { filters: false })).toMatchObject({
      status: 'rejected',
      approvalStatus: 'rejected_by_org_admin',
      rejectedByActor: `org_admin:${colleague.id}`,
    });
    expect(await anonymizedRows([ownCart.id])).toHaveLength(1);
    for (const text of SEEDED) {
      expect(await textOfSubject(subject.id, [ownCart.id])).not.toContain(text);
    }

    expect(await reasonsOf(colleaguesCart.id)).toEqual(colleagueBefore);
    expect(colleagueBefore.cart).toBe(APPROVER_REASON);
    expect(await anonymizedRows([colleaguesCart.id])).toEqual([]);
  });
});
