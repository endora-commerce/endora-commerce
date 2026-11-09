import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CustomFieldValuePort,
  OrganizationCustomFieldWritePort,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `organizationCustomFieldWritePort` from where it was published to be called:
 * a subscriber on `organization.registered.v1` that sets an `audience:
 * internal` field — an acquisition source — after a buyer registered. Such a
 * field cannot travel through registration's buyer input, by design.
 *
 * The subscriber resolves the two ports from the container, as a module would
 * through `lazyPort`, validates inside the merge with the administrator's rules
 * and writes through the owner. It needs no scope of its own: the event is
 * dispatched in the registration request's context, which the platform scopes
 * as system for an anonymous caller. Held against the database: the value is
 * stored, the one entry is the port's Command with no actor, and the bag a
 * buyer could be shown (`projectForCustomer`) does not carry it.
 */
describe('organizationCustomFieldWritePort — a registration subscriber sets an internal field', () => {
  let h: BackendServerHandle;
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  const key = `acq_source_${stamp}`;
  let definitionId: string;
  let seq = 0;

  const resolve = <T>(name: string): T =>
    (h.container as unknown as { resolve<R>(n: string): R }).resolve<T>(name);

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        entityType: 'organization',
        key,
        label: {},
        labelDefault: 'Acquisition source',
        valueType: 'text',
        required: false,
        audience: 'internal',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    definitionId = (res.json().data as { id: string }).id;
  });

  afterAll(async () => {
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${definitionId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    await teardownBackendServer(h);
  });

  /** Registers a buyer while `write` is subscribed, and answers what the subscriber's write settled to. */
  async function registerWith(
    write: (organizationId: string) => Promise<OrganizationRecord>,
  ): Promise<{ organizationId: string; outcome: PromiseSettledResult<OrganizationRecord> }> {
    let settle!: (outcome: PromiseSettledResult<OrganizationRecord>) => void;
    const settled = new Promise<PromiseSettledResult<OrganizationRecord>>((r) => (settle = r));
    const off = (
      h.eventBus as unknown as { on(e: string, fn: (p: { organizationId: string }) => Promise<void>): () => void }
    ).on('organization.registered.v1', async ({ organizationId }) => {
      try {
        settle({ status: 'fulfilled', value: await write(organizationId) });
      } catch (reason) {
        settle({ status: 'rejected', reason });
      }
    });
    try {
      const suffix = `${stamp.replace(/[a-f]/g, '9')}${(seq++).toString().padStart(2, '0')}`;
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/register',
        payload: {
          organization: {
            name: `Write port ${stamp}`,
            taxId: `PL177W${suffix}`,
            registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
          },
          firstUser: {
            email: `write-port-${suffix}@example.test`,
            password: 'a-very-strong-password-123!',
            firstName: 'Jan',
            lastName: 'Kowalski',
          },
          acceptedTermsVersion: '1.0.0',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const outcome = await settled;
      const organizationId = outcome.status === 'fulfilled' ? outcome.value.id : await idOf(`PL177W${suffix}`);
      return { organizationId, outcome };
    } finally {
      off();
    }
  }

  async function idOf(taxId: string): Promise<string> {
    const row = await h.em().getKnex()('organizations').where({ tax_id: taxId }).first('id');
    return row.id as string;
  }

  it('stores the value, audits it with a null actor, and keeps it out of the buyer projection', async () => {
    const port = resolve<OrganizationCustomFieldWritePort>('organizationCustomFieldWritePort');
    const values = resolve<CustomFieldValuePort>('customFieldValueService');

    // The subscriber calls the port as it is: an event is dispatched in its
    // emitter's async context, and the anonymous registration request runs in
    // the system scope the platform gives a request that identifies nobody.
    const { organizationId, outcome } = await registerWith((id) =>
      port.setCustomFieldValues(id, (current) =>
        values.validateAndMerge('organization', current, { [key]: 'trade_fair' }),
      ),
    );

    expect(outcome.status).toBe('fulfilled');
    if (outcome.status === 'fulfilled') {
      expect(outcome.value.customFieldValues).toEqual({ [key]: 'trade_fair' });
    }

    const row = await h.em().getKnex()('organizations').where({ id: organizationId }).first('custom_field_values');
    expect(row.custom_field_values).toEqual({ [key]: 'trade_fair' });

    h.em().clear();
    const entries = await h.em().find(AuditLogEntry, {
      action: 'organization.set_custom_field_values',
      objectId: organizationId,
    });
    expect(entries).toHaveLength(1);
    // The entity reads an absent actor as `undefined`; the column holds NULL.
    expect(entries[0]?.actorAdminUserId ?? null).toBeNull();
    expect(entries[0]?.actorCustomerAccountId ?? null).toBeNull();
    expect(entries[0]?.impersonatedCustomerAccountId ?? null).toBeNull();
    expect(entries[0]).toMatchObject({
      objectType: 'organization',
      stateBefore: { customFieldValues: {} },
      stateAfter: { customFieldValues: { [key]: 'trade_fair' } },
    });

    expect(await values.projectForCustomer('organization', row.custom_field_values)).toEqual({});
  });
});
