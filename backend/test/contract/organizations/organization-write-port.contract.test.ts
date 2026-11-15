import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ORGANIZATION_WRITE_PORT,
  type OrganizationWriteCreateInput,
  type OrganizationWritePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import {
  MissingTenantContextError,
  withSystemScope,
  withSystemScopeActingFor,
} from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * Issue #1029 — `organizationWritePort`, resolved from the composed container as
 * a connector module would resolve it through `lazyPort`, against the database:
 *
 * - `findByTaxId` answers the live Organization with that tax id, or `null`;
 * - `create` runs `organization.create` (one audit entry, the channels bound in
 *   the same transaction) and `update` runs `organization.update`, each audited
 *   with the **caller's** actor — a null one in a worker's system scope, the
 *   administrator a worker acts for in `withSystemScopeActingFor`;
 * - the refusals are typed: a taken tax id, an unknown channel, an unknown or
 *   deleted Organization, a stale version; and with no tenant context the bus
 *   refuses before writing.
 *
 * Not tested here: the port failing closed with `MODULE_DISABLED`. The owner
 * declares itself `nonDeactivatable` in its manifest's `activation`, so there is
 * no off state to drive; the gate is the same `providePort` registration as
 * every other.
 */
describe('organizationWritePort [contract]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  let channelA: string;
  let channelB: string;

  const port = (): OrganizationWritePort => h.container.resolve<OrganizationWritePort>(ORGANIZATION_WRITE_PORT);
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: an ERP connector sync', fn);
  const taxId = (): string => `PL1029W${stamp}${(seq++).toString().padStart(2, '0')}`;

  function input(overrides: Partial<OrganizationWriteCreateInput> = {}): OrganizationWriteCreateInput {
    return {
      name: `ERP Customer ${stamp}`,
      legalName: `ERP Customer ${stamp} sp. z o.o.`,
      taxId: taxId(),
      registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
      salesChannelIds: [channelA],
      status: 'active',
      ...overrides,
    };
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
    }
    throw new Error('expected a refusal');
  }

  async function entries(action: string, objectId: string): Promise<AuditLogEntry[]> {
    const em = h.em().fork();
    return em.find(AuditLogEntry, { action, objectId });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    const make = (code: string): SalesChannel =>
      em.create(SalesChannel, {
        code,
        name: { en: code },
        defaultLanguage: 'en',
        languages: ['en'],
        defaultCurrency: 'PLN',
        currencies: ['PLN'],
      });
    const a = make(`orgwrite-a-${stamp}`);
    const b = make(`orgwrite-b-${stamp}`);
    await em.persistAndFlush([a, b]);
    channelA = a.id;
    channelB = b.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates through organization.create, audited with the worker actor, and finds it by tax id', async () => {
    const payload = input({ salesChannelIds: [channelA, channelB] });
    expect(await asWorker(() => port().findByTaxId(payload.taxId))).toEqual([]);

    // Written as an operator might type it; stored normalised, as everywhere.
    const typed = `${payload.taxId.slice(0, 2).toLowerCase()} ${payload.taxId.slice(2, 6)}-${payload.taxId.slice(6)}`;
    const created = await asWorker(() => port().create({ ...payload, taxId: typed }));
    expect(created).toMatchObject({
      name: payload.name,
      legalName: payload.legalName,
      taxId: payload.taxId,
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: false,
      registeredAddress: payload.registeredAddress,
      deletedAt: null,
    });

    const membership = h.container.resolve<SalesChannelMembershipPort>('salesChannelMembershipPort');
    const channels = await membership.listChannelsForEntity('organization', created.id);
    expect(channels.map((c) => c.id).sort()).toEqual([channelA, channelB].sort());

    const audit = await entries('organization.create', created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorAdminUserId ?? null).toBeNull();
    // Names, not values (`specs/conventions/audit-state.md`).
    expect(audit[0]?.stateAfter).toMatchObject({
      changedFields: ['legalName', 'name', 'registeredAddress', 'taxId'],
    });
    expect(JSON.stringify(audit[0]?.stateAfter)).not.toContain(payload.taxId);

    // The read model's lookup: a list, the input normalised.
    expect((await asWorker(() => port().findByTaxId(typed))).map((o) => o.id)).toEqual([created.id]);
  });

  it('refuses a taken tax id — a soft-deleted holder included — and an unknown channel, writing nothing', async () => {
    const first = await asWorker(() => port().create(input()));
    const taken = first.taxId!;
    expect(await refusal(asWorker(() => port().create(input({ taxId: taken }))))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    });

    await h.em().getConnection().execute(`update organizations set deleted_at = now() where id = ?`, [first.id]);
    expect(await asWorker(() => port().findByTaxId(taken))).toEqual([]);
    expect(await refusal(asWorker(() => port().create(input({ taxId: taken }))))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    });

    const orphan = input({ salesChannelIds: [channelA, '00000000-0000-4000-8000-00000000dead'] });
    expect(await refusal(asWorker(() => port().create(orphan)))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.UNKNOWN_SALES_CHANNEL,
    });
    expect(await asWorker(() => port().findByTaxId(orphan.taxId))).toEqual([]);
  });

  it('creates a branch under a parent and stores validated custom-field values', async () => {
    const parent = await asWorker(() => port().create(input()));
    const branch = await asWorker(() => port().create(input({ parentId: parent.id, customFieldValues: {} })));
    expect(branch).toMatchObject({ parentId: parent.id, path: `${parent.path}${branch.id}/` });
    expect((await entries('organization.create', branch.id))[0]?.stateAfter).toMatchObject({ parentId: parent.id });

    expect(
      await refusal(asWorker(() => port().create(input({ parentId: '00000000-0000-4000-8000-00000000beef' })))),
    ).toEqual({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  });

  it('updates the identity fields through organization.update, audited with the admin a worker acts for', async () => {
    const created = await asWorker(() => port().create(input()));
    const updated = await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: an ERP sync an operator queued', () =>
      port().update(
        created.id,
        {
          name: `Renamed ${stamp}`,
          legalName: null,
          vatStatus: 'vat_exempt',
          registeredAddress: { street: 'ul. Inna 7', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
          orderConfirmationEmails: ['orders@erp.example'],
        },
        { expectedVersion: created.version },
      ),
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: `Renamed ${stamp}`,
      legalName: null,
      vatStatus: 'vat_exempt',
      registeredAddress: { street: 'ul. Inna 7', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
      orderConfirmationEmails: ['orders@erp.example'],
      taxId: created.taxId,
      status: 'active',
    });
    expect(updated.version).toBeGreaterThan(created.version);

    const audit = await entries('organization.update', created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorAdminUserId).toBe(TEST_ADMIN_ID);
    // Names, not values (issue #470).
    expect(audit[0]?.stateBefore).toEqual({ vatStatus: 'vat_payer' });
    expect(audit[0]?.stateAfter).toEqual({
      vatStatus: 'vat_exempt',
      changedFields: ['legalName', 'name', 'orderConfirmationEmails', 'registeredAddress', 'vatStatus'],
    });

    // The tax ID is not this port's to change.
    expect(
      await refusal(asWorker(() => port().update(created.id, { taxId: 'PL0000000000' } as never))),
    ).toEqual({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });

    // The same record again changes nothing, moves no version and records nothing.
    const again = await asWorker(() => port().update(created.id, { name: `Renamed ${stamp}` }));
    expect(again.version).toBe(updated.version);
    expect(await entries('organization.update', created.id)).toHaveLength(1);
  });

  it('refuses a stale version, and an unknown or soft-deleted Organization', async () => {
    const created = await asWorker(() => port().create(input()));
    await asWorker(() => port().update(created.id, { name: `Moved on ${stamp}` }));
    expect(
      await refusal(asWorker(() => port().update(created.id, { name: 'Stale' }, { expectedVersion: created.version }))),
    ).toEqual({ statusCode: 409, code: ERROR_CODES.VERSION_CONFLICT });

    expect(await refusal(asWorker(() => port().update('00000000-0000-4000-8000-00000000beef', { name: 'X' })))).toEqual({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
    await h.em().getConnection().execute(`update organizations set deleted_at = now() where id = ?`, [created.id]);
    expect(await refusal(asWorker(() => port().update(created.id, { name: 'X' })))).toEqual({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('refuses a write with no tenant context before writing anything', async () => {
    const payload = input();
    // The harness enters a system scope around every test; step out of it.
    await runWithoutTenantContext(async () => {
      await expect(port().create(payload)).rejects.toThrow(MissingTenantContextError);
      await expect(port().update('00000000-0000-4000-8000-00000000beef', { name: 'X' })).rejects.toThrow(
        MissingTenantContextError,
      );
    });
    expect(await asWorker(() => port().findByTaxId(payload.taxId))).toEqual([]);
  });
});
