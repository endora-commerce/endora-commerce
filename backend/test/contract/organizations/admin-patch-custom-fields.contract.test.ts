import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `PATCH /api/v1/admin/organizations/:id` runs as one Command,
 * `organization.admin_patch`, whose custom-field step is the one
 * `organizationCustomFieldWritePort` runs (`applyCustomFieldMerge`). What an
 * operator sees is unchanged — the 422 shape, the 409 on a stale
 * `expectedUpdatedAt`, the fields it accepts, one audit entry per PATCH — and
 * what changed is underneath: the write and its entry share one transaction on
 * the Command Bus instead of an audit recorded after the flush.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';

describe('PATCH /api/v1/admin/organizations/:id — custom-field values through the Command Bus', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const definitions: string[] = [];
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  let seq = 0;
  const taxId = (): string => `PL177P${stamp.replace(/[a-f]/g, '7')}${(seq++).toString().padStart(2, '0')}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `cfpatch-${stamp}`,
      name: { en: 'cfpatch' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
    await define({ key: `cfp_note_${stamp}`, labelDefault: 'Sales note' });
    await define({ key: `cfp_tier_${stamp}`, labelDefault: 'Tier' });
  });

  afterAll(async () => {
    for (const id of definitions) {
      await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  async function define(payload: Record<string, unknown>): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS_URL,
      ...ADMIN,
      payload: {
        entityType: 'organization',
        label: {},
        valueType: 'text',
        required: false,
        audience: 'internal',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
        ...payload,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as { id: string }).id;
    definitions.push(id);
    return id;
  }

  async function undefine(id: string): Promise<void> {
    await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    definitions.splice(definitions.indexOf(id), 1);
  }

  async function createOrganization(values: Record<string, unknown>): Promise<{ id: string; updatedAt: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      ...ADMIN,
      payload: {
        name: `CF patch ${stamp}`,
        taxId: taxId(),
        registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
        salesChannelIds: [channelId],
        customFieldValues: values,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; updatedAt: string };
  }

  const patch = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/organizations/${id}`, ...ADMIN, payload });

  const entriesFor = async (id: string) => {
    h.em().clear();
    return h.em().find(AuditLogEntry, { action: 'organization.admin_patch', objectId: id });
  };

  const commandBus = (): CommandBus =>
    (h.container as unknown as { resolve<T>(name: string): T }).resolve<CommandBus>('commandBus');

  it('merges the values, answers them, and records one entry through the Command Bus', async () => {
    const note = `cfp_note_${stamp}`;
    const tier = `cfp_tier_${stamp}`;
    const org = await createOrganization({ [tier]: 'gold' });

    const run = vi.spyOn(commandBus(), 'run');
    const record = vi.spyOn(h.auditLogService, 'record');
    try {
      const res = await patch(org.id, {
        name: `CF patch renamed ${stamp}`,
        customFieldValues: { [note]: 'VIP' },
        expectedUpdatedAt: org.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = res.json().data as { name: string; customFieldValues: Record<string, unknown> };
      expect(data.name).toBe(`CF patch renamed ${stamp}`);
      // An absent key is kept: the panel sends only the keys it shows.
      expect(data.customFieldValues).toEqual({ [tier]: 'gold', [note]: 'VIP' });

      const actions = run.mock.calls.map(([command]) => (command as Command).action);
      expect(actions).toContain('organization.admin_patch');
      expect(
        record.mock.calls.filter(([input]) => input.action === 'organization.admin_patch'),
      ).toEqual([]);
    } finally {
      run.mockRestore();
      record.mockRestore();
    }

    const entries = await entriesFor(org.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorAdminUserId).not.toBeNull();
    expect(entries[0]?.stateBefore).toMatchObject({ name: `CF patch ${stamp}`, customFieldValues: { [tier]: 'gold' } });
    expect(entries[0]?.stateAfter).toMatchObject({
      name: `CF patch renamed ${stamp}`,
      customFieldValues: { [tier]: 'gold', [note]: 'VIP' },
    });
  });

  it('answers the same 422 for an invalid bag and writes nothing — not even the other fields', async () => {
    const tier = `cfp_tier_${stamp}`;
    const org = await createOrganization({ [tier]: 'gold' });
    const required = await define({ key: `cfp_req_${stamp}`, labelDefault: 'Account manager', required: true });
    try {
      const res = await patch(org.id, { name: 'Must not apply', customFieldValues: { [tier]: 'silver' } });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } };
      expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
      expect(body.error.details.map((d) => d.path)).toContain(`cfp_req_${stamp}`);
      expect(typeof body.error.details[0]?.issue).toBe('string');
    } finally {
      await undefine(required);
    }

    const row = await h.em().getKnex()('organizations').where({ id: org.id }).first('name', 'custom_field_values');
    expect(row.name).toBe(`CF patch ${stamp}`);
    expect(row.custom_field_values).toEqual({ [tier]: 'gold' });
    expect(await entriesFor(org.id)).toEqual([]);
  });

  it('keeps the 409 on a stale expectedUpdatedAt, with no write and no entry', async () => {
    const org = await createOrganization({});
    const stale = new Date(new Date(org.updatedAt).getTime() - 60_000).toISOString();
    const res = await patch(org.id, { customFieldValues: { [`cfp_note_${stamp}`]: 'late' }, expectedUpdatedAt: stale });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VERSION_CONFLICT);

    const row = await h.em().getKnex()('organizations').where({ id: org.id }).first('custom_field_values');
    expect(row.custom_field_values).toEqual({});
    expect(await entriesFor(org.id)).toEqual([]);
  });

  it('answers 404 for an unknown organization', async () => {
    const res = await patch(randomUUID(), { name: 'Nobody' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
