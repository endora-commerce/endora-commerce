import { randomUUID } from 'node:crypto';
import type {
  EmailMailerPort,
  EmailMailerSendInput,
  EmailMailerSendOutcome,
} from '@endora-commerce/contracts';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from './package-entities.js';
import { predefinedRoleIdOf } from './seed-organization-roles.js';
import { bindOrganizationToDefaultChannel } from './sales-channel-access.js';
import { ADMIN_COOKIES, CUSTOMER_COOKIES } from './test-actors.js';
import type { BackendServerHandle } from './test-server.js';
import { withSystemScope } from '../../src/tenancy/escape-hatch.js';

/**
 * The Organization `specs/179-rfq-and-customer-notifications/` WP-12 walks its
 * notification matrix against (T110, T111): one of each kind of person the
 * recipient rule (FR-004, FR-005) has to tell apart, created fresh by the file
 * that asks for it, so the sides it asserts are this Organization's alone and
 * never what another file happened to seed.
 *
 *  - **requester** — the buyer who raises the requests (*Member* role, so only
 *    the requester rule names them);
 *  - **administrator** — an *Administrator* member, who may open every request
 *    of the Organization and so is on the customer side of each (R-3);
 *  - **member** — a plain *Member* who did not raise the request: never told;
 *  - **rep** — an assigned sales representative holding `rfqs:handle`, the
 *    whole operator side;
 *  - **noHandle** — a second assigned representative whose role lacks
 *    `rfqs:handle`: a candidate the operator rule must drop (FR-005).
 *
 * Every account and administrator carries a per-call stamp in its e-mail and
 * a stub cookie of its own, so nothing here collides with a neighbour's rows.
 * {@link retireNotificationOrganization} takes them out of every later
 * recipient set (a scoped update, never a wipe).
 */
export interface NotificationOrganization {
  organizationId: string;
  requester: { id: string; cookies: Record<string, string> };
  administrator: { id: string; cookies: Record<string, string> };
  member: { id: string; cookies: Record<string, string> };
  rep: { id: string; cookies: Record<string, string> };
  noHandle: { id: string };
}

export async function seedNotificationOrganization(
  h: BackendServerHandle,
  label: string,
): Promise<NotificationOrganization> {
  const stamp = `${label}-${randomUUID().slice(0, 8)}`;
  const seeded = await withSystemScope(`179 WP-12: seed the notification Organization (${label})`, async () => {
    const em = h.orm.em.fork();
    const handlerRole = em.create(AdminRole, {
      code: `rfq_179_rep_${stamp.replace(/-/g, '_')}`,
      name: `179 representative ${stamp}`,
      permissions: ['rfqs:handle'],
    });
    const readerRole = em.create(AdminRole, {
      code: `rfq_179_reader_${stamp.replace(/-/g, '_')}`,
      name: `179 reader ${stamp}`,
      permissions: ['orders:read'],
    });
    await em.persistAndFlush([handlerRole, readerRole]);
    const organization = em.create(Organization, {
      name: `179 matrix ${stamp}`,
      taxId: `PL179${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
    });
    await em.persistAndFlush(organization);
    const administratorRoleId = await predefinedRoleIdOf(em, organization.id, 'administrator');
    const memberRoleId = await predefinedRoleIdOf(em, organization.id, 'member');
    const account = (who: string, firstName: string, organizationRoleId: string) =>
      em.create(CustomerAccount, {
        organizationId: organization.id,
        email: `179-${who}-${stamp}@matrix.local`,
        passwordHash: 'x'.repeat(60),
        firstName,
        lastName: '179',
        organizationRoleId,
      });
    const requester = account('requester', 'Rita', memberRoleId);
    const administrator = account('administrator', 'Adam', administratorRoleId);
    const member = account('member', 'Mona', memberRoleId);
    const admin = (who: string, adminRoleId: string) =>
      em.create(AdminUser, {
        email: `179-${who}-${stamp}@matrix.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId,
        firstName: '179',
        lastName: who,
      });
    const rep = admin('rep', handlerRole.id);
    const noHandle = admin('reader', readerRole.id);
    await em.persistAndFlush([requester, administrator, member, rep, noHandle]);
    await em.persistAndFlush([
      em.create(OrganizationSalesRepAssignment, { organizationId: organization.id, adminUserId: rep.id }),
      em.create(OrganizationSalesRepAssignment, { organizationId: organization.id, adminUserId: noHandle.id }),
    ]);
    return {
      organizationId: organization.id,
      requester: requester.id,
      administrator: administrator.id,
      member: member.id,
      rep: rep.id,
      noHandle: noHandle.id,
    };
  });
  await bindOrganizationToDefaultChannel(h, seeded.organizationId);

  const customerCookie = (who: string, customerAccountId: string): Record<string, string> => {
    const token = `stub-179-${who}-${stamp}`;
    CUSTOMER_COOKIES[token] = { customerAccountId, organizationId: seeded.organizationId };
    return { b2b_session: token };
  };
  const repToken = `stub-179-rep-${stamp}`;
  ADMIN_COOKIES[repToken] = { adminUserId: seeded.rep };
  return {
    organizationId: seeded.organizationId,
    requester: { id: seeded.requester, cookies: customerCookie('requester', seeded.requester) },
    administrator: { id: seeded.administrator, cookies: customerCookie('administrator', seeded.administrator) },
    member: { id: seeded.member, cookies: customerCookie('member', seeded.member) },
    rep: { id: seeded.rep, cookies: { b2b_session: repToken } },
    noHandle: { id: seeded.noHandle },
  };
}

/**
 * Takes the Organization's people out of every later file's recipient sets:
 * the accounts are marked deleted, the administrators inactive. Rows other
 * tables name stay; nothing outside this Organization is touched.
 */
export async function retireNotificationOrganization(
  h: BackendServerHandle,
  org: NotificationOrganization,
): Promise<void> {
  const sql = h.em().getConnection();
  await sql.execute(`update "customer_accounts" set "deleted_at" = now() where "organization_id" = ?`, [
    org.organizationId,
  ]);
  await sql.execute(`update "admin_users" set "status" = 'inactive' where "id" in (?, ?)`, [org.rep.id, org.noHandle.id]);
}

/** A mail transport that accepts every message, recording what it was handed. */
export class RecordingMailer implements EmailMailerPort {
  readonly accepted: EmailMailerSendInput[] = [];
  async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
    this.accepted.push(input);
    return { status: 'sent' };
  }
}
