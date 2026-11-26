import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type AuthSessionPort,
  type CustomerAccountCommandPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountMemberWritePort,
  type CustomerAccountPreferencePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, hashPassword } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { CustomerAccount, CustomerGroup, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';

/**
 * `specs/186-aggregate-ports/` T048 (issue #1822) — `customerAccountCommandPort`
 * runs the Command the admin route for the same operation runs. Each case
 * performs the operation twice, once through the route and once through the
 * port under the same administrator, on two accounts in the same state, and
 * holds what each wrote to the other (`expectPortParity`): the audit entries,
 * the command hooks fired, the outbox rows, and a side-effect probe — whether
 * the account's session survived, for a block and a deletion.
 *
 * The admin routes are two other modules': `customers` (`/api/v1/admin/customers/…`)
 * and `organizations` (`/api/v1/admin/organizations/:id/members/…`). The member
 * routes also write an entry of their own, `customer_account.admin_*` — the
 * host's fact that an operator edited the panel, which the port does not write
 * (`contracts/customer-account-command-port.md` § *Inventory*); those are left
 * out of the comparison, by action.
 *
 * Operations with no admin route of their own are measured against the
 * deprecated port that ran them until now: `promoteToOrganizationAdmin`,
 * `markEmailVerified` (the member write port), `anonymize` (the lifecycle
 * port), `setPreferredLanguage` (the preference port, which the buyer's own
 * page runs, R-17.4), and `createStandalone` against the public registration.
 *
 * Then the port's own additions: `source` recorded beside the actor, a
 * malformed `source` and an unclaimed extension refused with nothing written,
 * and the refusals the routes answer.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMERS = '/api/v1/admin/customers';
const ORGS = '/api/v1/admin/organizations';
const PASSWORD = 'a-very-strong-password-1822';

describe('customerAccountCommandPort — the admin routes’ Commands (#1822)', () => {
  let h: BackendServerHandle;
  let port: CustomerAccountCommandPort;
  let sessions: AuthSessionPort;
  let passwordHash: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: customer account command port', fn);

  async function route(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  /** What one path wrote for an object, the host's `admin_*` entries left out. */
  function observe<T>(
    objectType: 'customer_account' | 'organization',
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType, objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => ({
      ...observation,
      audit: observation.audit.filter((entry) => !entry.action.startsWith('customer_account.admin_')),
    }));
  }

  /** A company Organization and one live member of it, holding its Member role. */
  async function member(overrides: Partial<CustomerAccount> = {}): Promise<{ account: CustomerAccount; org: Organization }> {
    const em = h.em().fork();
    const org = await seedAdHocOrganization(em, `Account port ${stamp} ${seq++}`);
    const account = em.create(CustomerAccount, {
      organizationId: org.id,
      organizationRoleId: await predefinedRoleIdOf(em, org.id, 'member'),
      email: `account-port-${stamp}-${seq++}@example.test`,
      passwordHash,
      firstName: 'Ada',
      lastName: 'Port',
      ...overrides,
    });
    await em.persist(account).flush();
    return { account, org };
  }

  const reread = (id: string) => h.em().fork().findOneOrFail(CustomerAccount, { id });

  /** A live session of the account; the probe answers whether it still loads. */
  async function sessionOf(customerAccountId: string): Promise<() => Promise<boolean>> {
    const { cookieValue } = await sessions.createSession({ kind: 'customer', customerAccountId });
    return async () => (await sessions.loadSession(cookieValue)) !== null;
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'customer_account', objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CustomerAccountCommandPort>('customerAccountCommandPort');
    sessions = h.container.resolve<AuthSessionPort>('authSessionPort');
    passwordHash = await hashPassword(PASSWORD);
    await new ManifestReconciler(h.em()).apply([customersManifest.settings!]);
    await route('PUT', '/api/v1/admin/settings/customers.allow_registration_without_organization/value', {
      scope: 'all',
      value: true,
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('block — customer_account.blocked, then the sessions end, as POST …/block', async () => {
    const [a, b] = [await member(), await member()];
    const [aLive, bLive] = [await sessionOf(a.account.id), await sessionOf(b.account.id)];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe('customer_account', a.account.id, () => route('POST', `${CUSTOMERS}/${a.account.id}/block`, { reason: 'abuse' }), aLive),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.block(b.account.id, { reason: 'abuse' })), bLive),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['customer_account.blocked']);
    expect(viaPort.sideEffects).toBe(false);
    expect((await reread(b.account.id)).blockedByAdminUserId).toBe(TEST_ADMIN_ID);
  });

  it('unblock — customer_account.unblocked, as POST …/unblock', async () => {
    const blocked = { blockedAt: new Date(), blockSource: 'staff' as const };
    const [a, b] = [await member(blocked), await member(blocked)];
    await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => route('POST', `${CUSTOMERS}/${a.account.id}/unblock`)),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.unblock(b.account.id))),
    });
  });

  it('softDelete / restore — customer_account.deleted, sessions ended, and .restored, as DELETE and POST …/restore', async () => {
    const [a, b] = [await member(), await member()];
    const [aLive, bLive] = [await sessionOf(a.account.id), await sessionOf(b.account.id)];
    const { port: deleted } = await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => route('DELETE', `${CUSTOMERS}/${a.account.id}`), aLive),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.softDelete(b.account.id)), bLive),
    });
    expect(deleted.sideEffects).toBe(false);
    await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => route('POST', `${CUSTOMERS}/${a.account.id}/restore`)),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.restore(b.account.id))),
    });
    expect((await reread(b.account.id)).deletedAt ?? null).toBeNull();
  });

  it('setCustomerGroup — customer_account.group_assigned, as PUT …/customer-group', async () => {
    const em = h.em().fork();
    const group = em.create(CustomerGroup, { code: `port-${stamp}`, name: 'Port parity' });
    await em.persist(group).flush();
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () =>
        observe('customer_account', a.account.id, () =>
          route('PUT', `${CUSTOMERS}/${a.account.id}/customer-group`, { customerGroupId: group.id }),
        ),
      viaPort: () =>
        observe('customer_account', b.account.id, () => asAdmin(() => port.setCustomerGroup(b.account.id, { customerGroupId: group.id }))),
    });
  });

  it('setCustomFieldValues — customer.custom_fields.update, as PATCH …/custom-fields', async () => {
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => route('PATCH', `${CUSTOMERS}/${a.account.id}/custom-fields`, {})),
      viaPort: () =>
        observe('customer_account', b.account.id, () => asAdmin(() => port.setCustomFieldValues(b.account.id, async (current) => current))),
    });
  });

  it('create — customer_account.create, as POST …/organizations/:id/members', async () => {
    const [orgA, orgB] = [(await member()).org, (await member()).org];
    const body = () => ({ email: `created-${stamp}-${seq++}@example.test`, password: PASSWORD, firstName: 'New', lastName: 'Member' });
    const memberRole = await predefinedRoleIdOf(h.em().fork(), orgB.id, 'member');
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          'customer_account',
          (res) => res!.data['id'] as string,
          () => route('POST', `${ORGS}/${orgA.id}/members`, body(), 201),
        ),
      viaPort: () =>
        observe(
          'customer_account',
          (record) => record.id,
          () => asAdmin(() => port.create({ ...body(), organizationId: orgB.id, organizationRoleId: memberRole })),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['customer_account.create']);
  });

  it('updateProfile — customer_account.update_profile, as PATCH …/members/:id', async () => {
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () =>
        observe('customer_account', a.account.id, () =>
          route('PATCH', `${ORGS}/${a.org.id}/members/${a.account.id}`, { firstName: 'Grace' }),
        ),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.updateProfile(b.account.id, { firstName: 'Grace' }))),
    });
  });

  it('setSubtreeRollup — customer_account.set_subtree_rollup, as PATCH …/members/:id/rollup', async () => {
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () =>
        observe('customer_account', a.account.id, () =>
          route('PATCH', `${ORGS}/${a.org.id}/members/${a.account.id}/rollup`, { subtreeRollupEnabled: true }),
        ),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.setSubtreeRollup(b.account.id, { enabled: true }))),
    });
  });

  it('changeRole — customer_account.change_role against the Organization, as PATCH …/members/:id/role', async () => {
    const [a, b] = [await member(), await member()];
    const em = h.em().fork();
    const [adminA, adminB] = [await predefinedRoleIdOf(em, a.org.id, 'administrator'), await predefinedRoleIdOf(em, b.org.id, 'administrator')];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe('organization', a.org.id, () => route('PATCH', `${ORGS}/${a.org.id}/members/${a.account.id}/role`, { roleId: adminA })),
      viaPort: () => observe('organization', b.org.id, () => asAdmin(() => port.changeRole(b.account.id, { organizationRoleId: adminB }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['customer_account.change_role']);
    expect((await reread(b.account.id)).organizationRoleId).toBe(adminB);
  });

  it('removeMember — customer_account.remove_member against the Organization, as DELETE …/members/:id', async () => {
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () => observe('organization', a.org.id, () => route('DELETE', `${ORGS}/${a.org.id}/members/${a.account.id}`, undefined, 204)),
      viaPort: () => observe('organization', b.org.id, () => asAdmin(() => port.removeMember(b.account.id))),
    });
    expect((await reread(b.account.id)).deletedAt).toBeInstanceOf(Date);
  });

  it('promoteToOrganizationAdmin, markEmailVerified — as the deprecated member write port', async () => {
    const members = h.container.resolve<CustomerAccountMemberWritePort>('customerAccountMemberWritePort');
    const [a, b] = [await member(), await member()];
    await expectPortParity({
      viaRoute: () => observe('organization', a.org.id, () => asAdmin(() => members.promoteToOrganizationAdmin(a.account.id))),
      viaPort: () => observe('organization', b.org.id, () => asAdmin(() => port.promoteToOrganizationAdmin(b.account.id))),
    });
    const verifiedAt = new Date();
    await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => asAdmin(() => members.markEmailVerified(a.account.id, verifiedAt))),
      viaPort: () => observe('customer_account', b.account.id, () => asAdmin(() => port.markEmailVerified(b.account.id, { verifiedAt }))),
    });
  });

  it('setPreferredLanguage — customer_account.set_preferred_language, as the buyer’s own preference port', async () => {
    const preferences = h.container.resolve<CustomerAccountPreferencePort>('customerAccountPreferencePort');
    const [a, b] = [await member(), await member()];
    const { route: viaRoute, port: viaPort } = await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => asAdmin(() => preferences.setPreferredLanguage(a.account.id, 'pl'))),
      viaPort: () =>
        observe('customer_account', b.account.id, () => asAdmin(() => port.setPreferredLanguage(b.account.id, { language: 'pl' }))),
    });
    // The buyer's page records its code; a server-side caller records its own, or none.
    expect(viaRoute.audit[0]?.stateAfter).toEqual({ changedFields: ['preferredLanguage'], source: 'self_service' });
    expect(viaPort.audit[0]?.stateAfter).toEqual({ changedFields: ['preferredLanguage'], source: null });
  });

  it('anonymize — customer_account.anonymized, as the deprecated lifecycle port', async () => {
    const lifecycle = h.container.resolve<CustomerAccountLifecycleWritePort>('customerAccountLifecycleWritePort');
    const deleted = { deletedAt: new Date('2026-01-01T00:00:00Z') };
    const [a, b] = [await member(deleted), await member(deleted)];
    const sweep = <T>(fn: () => Promise<T>) => withSystemScope('test: the retention sweep', fn);
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe('customer_account', a.account.id, () => sweep(() => lifecycle.anonymize(a.account.id))),
      viaPort: () => observe('customer_account', b.account.id, () => sweep(() => port.anonymize(b.account.id))),
    });
    expect(viaPort.audit[0]?.actorAdminUserId ?? null).toBeNull();
    expect((await reread(b.account.id)).anonymizedAt).toBeInstanceOf(Date);
  });

  it('createStandalone — customer_account.register_standalone, as the public registration', async () => {
    const email = () => `standalone-port-${stamp}-${seq++}@example.test`;
    const [emailA, emailB] = [email(), email()];
    const idOf = async (address: string) => (await h.em().fork().findOneOrFail(CustomerAccount, { email: address })).id;
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<string>(
          'customer_account',
          (id) => id,
          async () => {
            const res = await h.app.inject({
              method: 'POST',
              url: '/api/v1/customers/register',
              payload: { email: emailA, password: PASSWORD, firstName: 'Solo', lastName: 'Buyer', acceptedTermsVersion: 'v1' },
            });
            expect(res.statusCode, res.body).toBeLessThan(300);
            return idOf(emailA);
          },
        ),
      viaPort: () =>
        observe(
          'customer_account',
          (record) => record.id,
          () => withSystemScope('test: a sign-up connector', () => port.createStandalone({ email: emailB, password: PASSWORD, firstName: 'Solo', lastName: 'Buyer' })),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['customer_account.register_standalone']);
    const created = await reread(await idOf(emailB));
    expect((await h.em().fork().findOneOrFail(Organization, { id: created.organizationId })).isPersonal).toBe(true);
  });

  it('records source beside the actor; refuses a malformed source and an unclaimed extension before writing', async () => {
    const { account } = await member();
    await asAdmin(() => port.block(account.id, { reason: null }, { source: 'erp.credit-hold' }));
    const [blocked] = await entries(account.id);
    expect(blocked).toMatchObject({ action: 'customer_account.blocked', actorAdminUserId: TEST_ADMIN_ID });
    expect(blocked!.stateAfter).toMatchObject({ source: 'erp.credit-hold' });

    const recorded = (await entries(account.id)).length;
    expect(await refusal(asAdmin(() => port.unblock(account.id, { source: 'ERP Sync!' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await refusal(asAdmin(() => port.unblock(account.id, { extensions: { nobody_claims_this: {} } })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
    });
    expect((await reread(account.id)).blockedAt).toBeInstanceOf(Date);
    expect(await entries(account.id)).toHaveLength(recorded);
  });

  it('answers the routes’ refusals: the last company administrator, an unknown account, a second deletion', async () => {
    const { account, org } = await member();
    account.organizationRoleId = await predefinedRoleIdOf(h.em().fork(), org.id, 'administrator');
    await h.em().fork().nativeUpdate(CustomerAccount, { id: account.id }, { organizationRoleId: account.organizationRoleId });

    const viaRoute = await h.app.inject({ method: 'POST', url: `${CUSTOMERS}/${account.id}/block`, cookies: ADMIN, payload: {} });
    expect(viaRoute.statusCode).toBe(409);
    expect((viaRoute.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
    expect(await refusal(asAdmin(() => port.block(account.id, {})))).toEqual({ statusCode: 409, code: ERROR_CODES.ORG_OWNER_DEPLETION });
    expect(await refusal(asAdmin(() => port.softDelete(account.id)))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.ORG_OWNER_DEPLETION,
    });
    expect(await refusal(asAdmin(() => port.block(randomUUID(), {})))).toEqual({ statusCode: 404, code: ERROR_CODES.CUSTOMER_NOT_FOUND });
    expect(await refusal(asAdmin(() => port.changeRole(randomUUID(), { organizationRoleId: randomUUID() })))).toEqual({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });

    const { account: gone } = await member({ deletedAt: new Date() });
    expect(await refusal(asAdmin(() => port.softDelete(gone.id)))).toEqual({ statusCode: 409, code: ERROR_CODES.CUSTOMER_ALREADY_DELETED });
  });
});
