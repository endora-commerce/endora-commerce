import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Address, AdminRole, AdminUser, Organization } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/** `specs/182-related-payers/` — fixtures shared by the related_payers integration files. */

export const ADMIN = { b2b_session: 'stub-admin-session' } as const;

/** A fresh company (or personal) Organization, bound to the fixture channels. */
export async function makeOrganization(
  em: EntityManager,
  label: string,
  options: { isPersonal?: boolean; status?: 'active' | 'blocked' | 'pending_verification'; taxId?: string } = {},
): Promise<string> {
  return withSystemScope('test seed: related payers organization', async () => {
    const id = randomUUID();
    const org = em.create(Organization, {
      id,
      name: `${label} ${id.slice(0, 8)}`,
      taxId: options.isPersonal ? null : (options.taxId ?? `PL18${id.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`),
      status: options.status ?? 'active',
      vatStatus: 'vat_payer',
      isPersonal: options.isPersonal ?? false,
      registeredAddress: { street: 'S182-STREET', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    } as never);
    await em.persistAndFlush(org);
    await bindOrganizationsToFixtureChannelsSql(em, [id]);
    (org as { path: string }).path = `/${id}/`;
    await em.flush();
    return id;
  });
}

/** An address of `organizationId`, billing unless told otherwise. */
export async function makeAddress(
  em: EntityManager,
  organizationId: string,
  kind: 'billing' | 'delivery' = 'billing',
): Promise<string> {
  return withSystemScope('test seed: related payers address', async () => {
    const address = em.create(Address, {
      organizationId,
      kind,
      recipientName: 'S182 Recipient',
      street: 'S182-STREET 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      isDefault: false,
    } as never);
    await em.persistAndFlush(address);
    return (address as { id: string }).id;
  });
}

/**
 * An administrator whose role holds exactly `permissions`, signed in through a stub
 * cookie for the rest of the file (`undo` removes the cookie).
 */
export async function makeAdmin(
  em: EntityManager,
  slug: string,
  permissions: readonly string[],
): Promise<{ cookies: { b2b_session: string }; adminUserId: string; undo: () => void }> {
  return withSystemScope('test seed: related payers admin', async () => {
    const role = em.create(AdminRole, {
      code: `rp_${slug}_${randomUUID().slice(0, 8)}`.replace(/-/g, '_'),
      name: `Related payers ${slug}`,
      permissions: [...permissions],
    } as never);
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `rp-${slug}-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: (role as { id: string }).id,
      firstName: 'Related',
      lastName: slug,
      status: 'active',
    } as never);
    await em.persistAndFlush(admin);
    const cookie = `stub-related-payers-${slug}-${randomUUID().slice(0, 8)}`;
    const adminUserId = (admin as { id: string }).id;
    ADMIN_COOKIES[cookie] = { adminUserId };
    return { cookies: { b2b_session: cookie }, adminUserId, undo: () => delete ADMIN_COOKIES[cookie] };
  });
}

/**
 * A placed order of the stub customer's Organization (X) billed to a fresh payer Y: the
 * channel setting on, Y with one billing address, the X → Y link, and the placement.
 */
export async function placePaidOrder(
  h: {
    app: { inject: (opts: Record<string, unknown>) => Promise<{ statusCode: number; body: string; json(): unknown }> };
    em: () => EntityManager;
  },
  options: { notifyPayerOnOrders?: boolean; beforePlacement?: (payerId: string) => Promise<void> } = {},
): Promise<{ payerId: string; billingAddressId: string; orderId: string; linkId: string }> {
  const { seedCartForStubCustomer, SEED_ADDRESS_DELIVERY_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } =
    await import('../../helpers/seed-commerce.js');
  const { TEST_ORGANIZATION_ID } = await import('../../helpers/test-actors.js');
  const setting = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/settings/related_payers.enabled/value',
    cookies: ADMIN,
    payload: { scope: 'all', value: true },
  });
  if (setting.statusCode !== 200) throw new Error(`setting: ${setting.body}`);
  const payerId = await makeOrganization(h.em(), 'Payer Y');
  const billingAddressId = await makeAddress(h.em(), payerId, 'billing');
  const link = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`,
    cookies: ADMIN,
    payload: { payerOrganizationId: payerId, notifyPayerOnOrders: options.notifyPayerOnOrders ?? false },
  });
  if (link.statusCode !== 201) throw new Error(`link: ${link.body}`);
  await options.beforePlacement?.(payerId);
  await seedCartForStubCustomer(h.em());
  const placed = await h.app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    cookies: { b2b_session: 'stub-customer-session' },
    payload: {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      payerOrganizationId: payerId,
    },
  });
  if (placed.statusCode !== 201) throw new Error(`placement: ${placed.body}`);
  const idOf = (res: { json(): unknown }) => (res.json() as { data: { id: string } }).data.id;
  return { payerId, billingAddressId, orderId: idOf(placed), linkId: idOf(link) };
}

/**
 * A fresh company Organization with its Administrator signed in through a stub cookie, for the
 * request files (`specs/182-related-payers/` Phase 5). `taxId` is the Organization's own.
 */
export async function makeOrganizationWithAdmin(
  em: EntityManager,
  label: string,
  options: { status?: 'active' | 'pending_verification'; taxId?: string } = {},
): Promise<{ organizationId: string; taxId: string; customerAccountId: string; cookie: { b2b_session: string }; email: string }> {
  const { CustomerAccount } = await import('../../helpers/package-entities.js');
  const { CUSTOMER_COOKIES } = await import('../../helpers/test-actors.js');
  const { predefinedRoleIdOf } = await import('../../helpers/seed-organization-roles.js');
  const organizationId = await makeOrganization(em, label, options);
  const customerAccountId = randomUUID();
  const email = `rp182-${customerAccountId.slice(0, 8)}@example.com`;
  await withSystemScope('test seed: related payers organization administrator', async () => {
    em.create(CustomerAccount, {
      id: customerAccountId,
      organizationId,
      email,
      passwordHash: 'not-a-real-hash',
      firstName: 'Admin',
      lastName: label,
      organizationRoleId: await predefinedRoleIdOf(em, organizationId, 'administrator'),
      emailVerifiedAt: new Date(),
      blockedAt: null,
    } as never);
    await em.flush();
  });
  const session = `stub-rp182-${customerAccountId.slice(0, 8)}`;
  CUSTOMER_COOKIES[session] = { customerAccountId, organizationId };
  const [row] = (await em.getConnection().execute('select tax_id from organizations where id = ?', [organizationId])) as Array<{ tax_id: string }>;
  return { organizationId, taxId: row!.tax_id, customerAccountId, cookie: { b2b_session: session }, email };
}

/**
 * `specs/182-related-payers/` Phase 5 — delivers every due `command_outbox` row through the
 * composition's `afterCommit` handlers: the harness runs no drain worker, so a test that waits on
 * a request's e-mails and notifications drives the drain itself.
 */
export async function drainOutbox(h: {
  orm: { em: { fork: () => EntityManager } };
  commandHookRegistry: Parameters<typeof import('@endora-commerce/platform/composition').runCommandOutboxDrainTick>[0]['handlers'];
}): Promise<void> {
  const { PostgresOutboxStore, runCommandOutboxDrainTick } = await import('@endora-commerce/platform/composition');
  // A handler that throws is retried later, not raised: print what failed so a test reads why.
  const say = (context: unknown, message?: string) => console.warn('[drainOutbox]', message ?? '', JSON.stringify(context));
  const log = { info: () => undefined, warn: say, error: say, debug: () => undefined } as never;
  await runCommandOutboxDrainTick({ store: new PostgresOutboxStore(() => h.orm.em.fork()), handlers: h.commandHookRegistry, log });
}

/** Sets a `related_payers.*` setting for every channel (`scope: all`). */
export async function setSetting(
  h: { app: { inject: (opts: never) => Promise<{ statusCode: number; body: string }> } },
  code: string,
  value: unknown,
): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${code}/value`,
    cookies: ADMIN,
    payload: { scope: 'all', value },
  } as never);
  if (res.statusCode !== 200) throw new Error(`setting ${code} → ${res.statusCode}: ${res.body}`);
}

/** The storefront notification-centre entries of `customerAccountId` this module wrote. */
export async function customerNotificationsOf(
  em: EntityManager,
  customerAccountId: string,
): Promise<Array<{ kind: string; subject_id: string | null; link_path: string | null }>> {
  return withSystemScope('test read: related payers customer notifications', () =>
    em
      .getConnection()
      .execute(
        `select kind, subject_id, link_path from customer_notifications
          where customer_account_id = ? and source_module = 'related_payers' order by created_at`,
        [customerAccountId],
      ),
  );
}

/** The admin bell entries this module wrote about `subjectId`. */
export async function adminNotificationsAbout(
  em: EntityManager,
  subjectId: string,
): Promise<Array<{ kind: string; audience: string; link_path: string | null }>> {
  return em
    .getConnection()
    .execute(`select kind, audience, link_path from admin_notifications where subject_id = ? order by created_at`, [subjectId]);
}

/**
 * A tax ID no Organization holds yet, of the fixture shape — for the payer without an account
 * (`specs/182-related-payers/` US5).
 */
export function unusedTaxId(): string {
  return `PL19${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
}

/** The registration token an invitation e-mail carries in its link (`?payerInvitation=`). */
export function invitationTokenIn(text: string): string | null {
  return /payerInvitation=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
}

/** Waits for `probe` to answer truthy — an in-process subscriber runs after the write that emitted. */
export async function eventually<T>(probe: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
