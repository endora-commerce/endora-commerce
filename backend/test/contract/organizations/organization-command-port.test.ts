import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  type OrganizationCommandPort,
  type OrganizationCustomFieldWritePort,
  type OrganizationWritePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { DeliveryMethod, Organization, PaymentMethod } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * `specs/186-aggregate-ports/` T023 (issue #1821, US1a; research R-16) —
 * `organizationCommandPort` runs the Command the admin route for the same
 * operation runs. Each case performs the operation twice, once through the
 * route and once through the port under the same administrator, on two
 * Organizations in the same state, and holds what each wrote to the other
 * (`expectPortParity`): the audit entries, the command hooks fired, the outbox
 * rows, and a side-effect probe — the customer notices sent, for the
 * moderation methods.
 *
 * `update` and `setCustomFieldValues` have no admin route of their own (the
 * admin `PATCH` runs `organization.admin_patch`, which the port does not
 * offer, R-16.2): they are measured against the deprecated narrow ports that
 * ran them until now. `setSalesChannels` (US1b) also compares what the
 * kernel's membership writer recorded beside the Command's entry (R-16.1), and
 * that the access cache was dropped.
 *
 * Then the port's own additions: `source` recorded beside the actor, a
 * malformed `source` and an unclaimed extension refused with nothing written,
 * the version the moderation and restriction methods honour, and the refusals
 * the routes answer.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const ORGS = '/api/v1/admin/organizations';

describe('organizationCommandPort — the admin routes’ Commands (#1821)', () => {
  let h: BackendServerHandle;
  let port: OrganizationCommandPort;
  let channel: string;
  let paymentMethodId: string;
  let deliveryMethodId: string;
  const mailer = new InMemoryMailer();
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL186P${stamp}${(seq++).toString().padStart(3, '0')}`;

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: organization command port', fn);

  const address = { street: 'ul. Portowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' };

  /** The customer notices sent for an Organization, by kind (`approved`, `rejected`). */
  const notices = (organizationId: string): string[] =>
    mailer.sent
      .map((message) => message.messageId ?? '')
      .filter((id) => id.startsWith('organization.') && id.includes(`.${organizationId}.`))
      .map((id) => id.split('.')[1]!);

  async function route(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  /** What one path wrote for an Organization: its entries, and the probe's answer. */
  function observe<T>(
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'organization', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  async function fresh(status: Organization['status'] = 'active', parent?: Organization): Promise<Organization> {
    const em = h.em().fork();
    const org = await seedAdHocOrganization(em, `Port parity ${stamp} ${seq++}`, parent ? { parent } : {});
    if (status !== 'active') {
      org.status = status;
      await em.flush();
    }
    return org;
  }

  const reread = (id: string) => h.em().fork().findOneOrFail(Organization, { id });

  /** A pending Organization with an Administrator member, as self-registration leaves it. */
  async function registered(): Promise<Organization> {
    seq += 1;
    const name = `Port parity registered ${stamp} ${seq}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: { name, taxId: taxId(), registeredAddress: address },
        firstUser: {
          email: `port-parity-${stamp}-${seq}@example.test`,
          password: 'a-very-strong-password-123!',
          firstName: 'Ada',
          lastName: 'Port',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    const org = await h.em().fork().findOneOrFail(Organization, { name });
    expect(org.status).toBe('pending_verification');
    return org;
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details: unknown }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; details?: unknown };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error), details: e.details };
    }
    throw new Error('expected a refusal');
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'organization', objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    port = h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
    const em = h.em().fork();
    const sales = em.create(SalesChannel, {
      code: `port-parity-${stamp}`,
      name: { en: 'port parity' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;
    paymentMethodId = (await em.findOneOrFail(PaymentMethod, { status: 'active' })).id;
    deliveryMethodId = (await em.findOneOrFail(DeliveryMethod, { status: 'active' })).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('create — organization.create, as the admin create', async () => {
    const body = () => ({
      name: `Created ${stamp} ${seq++}`,
      taxId: taxId(),
      registeredAddress: address,
      salesChannelIds: [channel] as [string],
    });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          (res) => res!.data['id'] as string,
          () => route('POST', ORGS, body(), 201),
        ),
      viaPort: () => observe((record) => record.id, () => asAdmin(() => port.create({ ...body(), status: 'active' }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['organization.create']);
  });

  it('update — organization.update, as the deprecated organizationWritePort.update', async () => {
    const writePort = h.container.resolve<OrganizationWritePort>('organizationWritePort');
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => asAdmin(() => writePort.update(a.id, { name: `Renamed A ${stamp}` }))),
      viaPort: () => observe(b.id, () => asAdmin(() => port.update(b.id, { name: `Renamed B ${stamp}` }))),
    });
  });

  it('setParent — set_parent for a first parent, move for a new one, set_parent to detach', async () => {
    const [parentA, parentB, other] = [await fresh(), await fresh(), await fresh()];
    const [a, b] = [await fresh(), await fresh()];
    const place = (id: string, parentId: string | null) => route('POST', `${ORGS}/${id}/parent`, { parentId });

    for (const [step, parentId, action] of [
      ['assign', parentA.id, 'organization.set_parent'],
      ['move', other.id, 'organization.move'],
      ['detach', null, 'organization.set_parent'],
    ] as const) {
      const portParent = step === 'assign' ? parentB.id : parentId;
      const { port: viaPort } = await expectPortParity({
        viaRoute: () => observe(a.id, () => place(a.id, parentId)),
        viaPort: () => observe(b.id, () => asAdmin(() => port.setParent(b.id, { parentId: portParent }))),
      });
      expect(viaPort.audit.map((e) => e.action), step).toEqual([action]);
    }
    expect((await reread(b.id)).parentId ?? null).toBeNull();
  });

  it('approve — organization.approved, and the approval notice once', async () => {
    const [a, b] = [await registered(), await registered()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('POST', `${ORGS}/${a.id}/approve`, { expectedVersion: a.version }), () => notices(a.id)),
      viaPort: () =>
        observe(b.id, () => asAdmin(() => port.approve(b.id, { expectedVersion: b.version })), () => notices(b.id)),
    });
    expect(viaPort.sideEffects).toEqual(['approved']);
  });

  it('reject — organization.rejected, the notice unless notifyCustomerEmail is false', async () => {
    for (const notifyCustomerEmail of [true, false]) {
      const [a, b] = [await registered(), await registered()];
      const { port: viaPort } = await expectPortParity({
        viaRoute: () =>
          observe(
            a.id,
            () => route('POST', `${ORGS}/${a.id}/reject`, { expectedVersion: a.version, reason: 'No documents', notifyCustomerEmail }),
            () => notices(a.id),
          ),
        viaPort: () =>
          observe(
            b.id,
            () => asAdmin(() => port.reject(b.id, { reason: 'No documents', notifyCustomerEmail })),
            () => notices(b.id),
          ),
      });
      expect(viaPort.sideEffects).toEqual(notifyCustomerEmail ? ['rejected'] : []);
      expect((await reread(b.id)).rejectedReason).toBe('No documents');
    }
  });

  it('block and unblock — organization.blocked / organization.unblocked, no notice', async () => {
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('POST', `${ORGS}/${a.id}/block`, { expectedVersion: a.version, reason: 'Overdue' }), () => notices(a.id)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.block(b.id, { reason: 'Overdue' })), () => notices(b.id)),
    });
    const [blockedA, blockedB] = [await reread(a.id), await reread(b.id)];
    await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('POST', `${ORGS}/${a.id}/unblock`, { expectedVersion: blockedA.version }), () => notices(a.id)),
      viaPort: () =>
        observe(b.id, () => asAdmin(() => port.unblock(b.id, { expectedVersion: blockedB.version })), () => notices(b.id)),
    });
    expect(notices(b.id)).toEqual([]);
  });

  it('delete — organization.delete', async () => {
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `${ORGS}/${a.id}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.delete(b.id))),
    });
  });

  it('setCustomFieldValues — organization.set_custom_field_values, as the deprecated custom-field port (R-16.2)', async () => {
    const narrow = h.container.resolve<OrganizationCustomFieldWritePort>('organizationCustomFieldWritePort');
    const [a, b] = [await fresh(), await fresh()];
    const merge = async (current: Record<string, unknown>) => ({ ...current, port_parity_note: 'kept' });
    await expectPortParity({
      viaRoute: () => observe(a.id, () => asAdmin(() => narrow.setCustomFieldValues(a.id, merge))),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setCustomFieldValues(b.id, merge))),
    });
  });

  it('convertToCompany and changeTaxId — the routes’ Commands', async () => {
    const personal = async (): Promise<string> => {
      const id = randomUUID();
      const accountId = randomUUID();
      await h.em().execute(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
         values (?, 'Port Personal', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
        [id, accountId, `/${id}/`],
      );
      await h.em().execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, 'x', 'Port', 'Personal', now(), now())`,
        [accountId, id, `${accountId.slice(0, 8)}@port-parity.example`],
      );
      return id;
    };
    const company = () => ({ name: `Converted ${stamp} ${seq++}`, taxId: taxId(), registeredAddress: address, vatStatus: 'vat_payer' as const });
    const [pa, pb] = [await personal(), await personal()];
    await expectPortParity({
      viaRoute: () => observe(pa, () => route('POST', `${ORGS}/${pa}/convert-to-company`, company())),
      viaPort: () => observe(pb, () => asAdmin(() => port.convertToCompany(pb, company()))),
    });

    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `${ORGS}/${a.id}/change-tax-id`, { taxId: taxId() })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.changeTaxId(b.id, { taxId: taxId() }))),
    });
  });

  it('setRestrictions and patchRestriction — the allow-list Commands, answered as the routes answer them', async () => {
    const [a, b] = [await fresh(), await fresh()];
    // Seeded methods: the link tables hold foreign keys.
    const lists = { paymentMethodIds: [paymentMethodId], deliveryMethodIds: [], warehouseIds: [] };
    let answered: unknown;
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `${ORGS}/${a.id}/restrictions`, { ...lists, expectedVersion: a.version })),
      viaPort: () =>
        observe(b.id, async () => {
          answered = await asAdmin(() => port.setRestrictions(b.id, lists, { expectedVersion: b.version }));
        }),
    });
    expect(answered).toMatchObject({ organizationId: b.id, ...lists, version: b.version + 1 });

    const added = deliveryMethodId;
    await expectPortParity({
      viaRoute: () => observe(a.id, async () => {
        const current = await reread(a.id);
        return route('PATCH', `${ORGS}/${a.id}/restrictions/delivery-methods`, { add: [added], expectedVersion: current.version });
      }),
      viaPort: () => observe(b.id, () => asAdmin(() => port.patchRestriction(b.id, 'deliveryMethodIds', { add: [added] }))),
    });
    expect((await entries(b.id)).at(-1)).toMatchObject({
      action: 'organization.allow_list_patch',
      stateAfter: { kind: 'delivery_method', add: [added], remove: [] },
    });
  });

  it('setCreditInheritanceMode — organization.set_credit_mode', async () => {
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `${ORGS}/${a.id}/credit-inheritance-mode`, { mode: 'independent_default' })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setCreditInheritanceMode(b.id, { mode: 'independent_default' }))),
    });
  });

  it('assignSalesRep and unassignSalesRep — the sales-rep Commands; a repeat records nothing', async () => {
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `${ORGS}/${a.id}/sales-reps`, { adminUserId: TEST_ADMIN_ID }, 201)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.assignSalesRep(b.id, { adminUserId: TEST_ADMIN_ID }))),
    });
    const repeat = await observe(b.id, () => asAdmin(() => port.assignSalesRep(b.id, { adminUserId: TEST_ADMIN_ID })));
    expect(repeat.audit).toEqual([]);

    await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `${ORGS}/${a.id}/sales-reps/${TEST_ADMIN_ID}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.unassignSalesRep(b.id, { adminUserId: TEST_ADMIN_ID }))),
    });
    // The route's answer for an assignment that is not there, and nothing recorded.
    expect(await refusal(asAdmin(() => port.unassignSalesRep(b.id, { adminUserId: TEST_ADMIN_ID })))).toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('setSalesChannels — organization.sales_channels.set, the membership entries beside it, the cache dropped (US1b)', async () => {
    const [a, b] = [await fresh(), await fresh()];
    /** The membership writer's entries for the Organization, and the set the access rule now reads. */
    const membershipProbe = async (organizationId: string) => {
      const rows = await h
        .em()
        .fork()
        .find(AuditLogEntry, {
          action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
          objectType: 'sales_channel_membership',
          objectId: { $like: `%:organization:${organizationId}` },
        });
      const ops = rows.map((row) => {
        const after = row.stateAfter as { op: string; channelId: string };
        return `${after.op}:${after.channelId}`;
      });
      return {
        ops: ops.sort(),
        actors: [...new Set(rows.map((row) => row.actorAdminUserId))],
        permitted: [...(await h.salesChannels.accessPolicy.permittedChannelIds(organizationId))].sort(),
      };
    };
    // Warm the access cache first: a write that did not drop it would leave the old set.
    const warmed = async <T>(id: string, write: () => Promise<T>): Promise<T> => {
      await h.salesChannels.accessPolicy.permittedChannelIds(id);
      return write();
    };
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(
          a.id,
          () => warmed(a.id, () => route('PUT', `${ORGS}/${a.id}/sales-channels`, { salesChannelIds: [channel] })),
          () => membershipProbe(a.id),
        ),
      viaPort: () =>
        observe(
          b.id,
          () => warmed(b.id, () => asAdmin(() => port.setSalesChannels(b.id, { salesChannelIds: [channel] }))),
          () => membershipProbe(b.id),
        ),
    });
    expect(viaPort.audit).toEqual([
      expect.objectContaining({
        action: 'organization.sales_channels.set',
        actorAdminUserId: TEST_ADMIN_ID,
        stateAfter: { salesChannelIds: [channel] },
      }),
    ]);
    expect(viaPort.sideEffects).toMatchObject({ permitted: [channel], actors: [TEST_ADMIN_ID] });
    expect((viaPort.sideEffects as { ops: string[] }).ops).toContain(`add:${channel}`);

    // The same set again: nothing recorded on either side of the bridge.
    const repeat = await observe(b.id, () => asAdmin(() => port.setSalesChannels(b.id, { salesChannelIds: [channel] })), () =>
      membershipProbe(b.id),
    );
    expect(repeat.audit).toEqual([]);
    expect(repeat.sideEffects).toEqual(viaPort.sideEffects);
  });

  describe('the port’s own options and refusals', () => {
    it('records source beside the actor', async () => {
      const org = await fresh();
      await asAdmin(() => port.block(org.id, { reason: null }, { source: 'erp.sync' }));
      expect((await entries(org.id)).at(-1)).toMatchObject({
        action: 'organization.blocked',
        actorAdminUserId: TEST_ADMIN_ID,
        stateAfter: expect.objectContaining({ source: 'erp.sync' }),
      });
    });

    it('refuses a malformed source and an unclaimed extension before anything is written', async () => {
      const org = await registered();
      const recorded = (await entries(org.id)).length;
      expect(await refusal(asAdmin(() => port.approve(org.id, { source: 'Not A Code' })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(
        await refusal(asAdmin(() => port.approve(org.id, { extensions: { nobody_claims_this: { x: 1 } } }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
      // A method whose Command is preceded by a read (the tree placement) refuses as early.
      const parent = await fresh();
      expect(
        await refusal(asAdmin(() => port.setParent(org.id, { parentId: parent.id }, { extensions: { nobody: {} } }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
      const after = await reread(org.id);
      expect(after.status).toBe('pending_verification');
      expect(after.parentId ?? null).toBeNull();
      expect(await entries(org.id)).toHaveLength(recorded);
      expect(notices(org.id)).toEqual([]);
    });

    it('honours expectedVersion on the moderation and restriction methods, with the route’s 409', async () => {
      const org = await fresh();
      const stale = org.version + 5;
      for (const write of <Array<() => Promise<unknown>>>[
        () => port.block(org.id, { reason: null }, { expectedVersion: stale }),
        () => port.setRestrictions(org.id, { paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [] }, { expectedVersion: stale }),
        () => port.patchRestriction(org.id, 'warehouseIds', { add: [randomUUID()] }, { expectedVersion: stale }),
      ]) {
        expect(await refusal(asAdmin(write))).toMatchObject({
          statusCode: 409,
          code: ERROR_CODES.VERSION_CONFLICT,
          details: { currentVersion: org.version },
        });
      }
      expect(await entries(org.id)).toEqual([]);
    });

    it('refuses a reject reason that is empty or too long, and a status the transition does not apply to', async () => {
      const org = await registered();
      const recorded = (await entries(org.id)).length;
      for (const reason of ['', 'x'.repeat(2001)]) {
        expect(await refusal(asAdmin(() => port.reject(org.id, { reason })))).toMatchObject({
          statusCode: 422,
          code: ERROR_CODES.VALIDATION_FAILED,
        });
      }
      expect(await refusal(asAdmin(() => port.unblock(org.id)))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.ORGANIZATION_STATUS_INVALID,
      });
      expect(await entries(org.id)).toHaveLength(recorded);
    });

    it('answers an unknown sales channel on create with UNKNOWN_SALES_CHANNEL (R-16.5)', async () => {
      const unknown = randomUUID();
      expect(
        await refusal(
          asAdmin(() =>
            port.create({ name: `Unknown channel ${stamp}`, taxId: taxId(), registeredAddress: address, salesChannelIds: [unknown], status: 'active' }),
          ),
        ),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.UNKNOWN_SALES_CHANNEL, details: [{ path: 'salesChannelIds.0', issue: unknown }] });
    });

    it('setSalesChannels: records source, ignores expectedVersion, refuses an unknown channel UNKNOWN_SALES_CHANNEL (R-16.5) and an empty set', async () => {
      const org = await fresh();
      await asAdmin(() =>
        port.setSalesChannels(org.id, { salesChannelIds: [channel] }, { source: 'erp.sync', expectedVersion: org.version + 7 }),
      );
      expect((await entries(org.id)).at(-1)).toMatchObject({
        action: 'organization.sales_channels.set',
        stateAfter: { salesChannelIds: [channel], source: 'erp.sync' },
      });
      const recorded = (await entries(org.id)).length;
      const unknown = randomUUID();
      expect(
        await refusal(asAdmin(() => port.setSalesChannels(org.id, { salesChannelIds: [channel, unknown] }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.UNKNOWN_SALES_CHANNEL, details: [{ path: 'salesChannelIds.1', issue: unknown }] });
      // The admin route answers the same refusal with its own code, the paths unchanged.
      const res = await h.app.inject({
        method: 'PUT',
        url: `${ORGS}/${org.id}/sales-channels`,
        cookies: ADMIN,
        payload: { salesChannelIds: [channel, unknown] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, details: [{ path: 'salesChannelIds.1', issue: unknown }] });
      expect(
        await refusal(asAdmin(() => port.setSalesChannels(org.id, { salesChannelIds: [] }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
      expect(
        await refusal(asAdmin(() => port.setSalesChannels(org.id, { salesChannelIds: [channel] }, { source: 'Not A Code' }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
      expect(await entries(org.id)).toHaveLength(recorded);
    });

    it('answers an unknown Organization with NOT_FOUND', async () => {
      const unknown = randomUUID();
      for (const write of <Array<() => Promise<unknown>>>[
        () => port.approve(unknown),
        () => port.setParent(unknown, { parentId: null }),
        () => port.setRestrictions(unknown, { paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [] }),
        () => port.assignSalesRep(unknown, { adminUserId: TEST_ADMIN_ID }),
        () => port.setSalesChannels(unknown, { salesChannelIds: [channel] }),
      ]) {
        expect(await refusal(asAdmin(write))).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
      }
    });
  });
});
