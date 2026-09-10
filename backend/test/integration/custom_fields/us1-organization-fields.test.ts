import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 055 US1 (T013/T014) — define a custom field on Organization and set a
 * value through the real admin routes + composition [real DB].
 *
 * Covers: definition CRUD via the Command Bus (audited), required enforcement,
 * select-option validation, and value round-trip on the org detail read.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('Custom Fields — Organization US1 [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createDefinition(body: Record<string, unknown>): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      payload: body,
      ...ADMIN,
    });
    return res.statusCode;
  }

  it('creates a definition through the Command Bus (audited) and lists it', async () => {
    const status = await createDefinition({
      entityType: 'organization',
      key: 'po_number',
      label: { en: 'PO Number', pl: 'Numer zamówienia' },
      labelDefault: 'PO Number',
      valueType: 'text',
      required: true,
      sortOrder: 0,
      config: {},
      options: [],
    });
    expect(status).toBe(201);

    // One audit row for the create, written by the bus (Principle XIII).
    const audits = await h.em().count(AuditLogEntry, { action: 'custom_fields.definition.created' });
    expect(audits).toBeGreaterThanOrEqual(1);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=organization',
      ...ADMIN,
    });
    expect(list.statusCode).toBe(200);
    const keys = (list.json().data as { key: string }[]).map((d) => d.key);
    expect(keys).toContain('po_number');
  });

  it('rejects a duplicate (entityType, key) with 409', async () => {
    const status = await createDefinition({
      entityType: 'organization',
      key: 'po_number',
      label: {},
      labelDefault: 'dup',
      valueType: 'text',
      required: false,
      sortOrder: 0,
      config: {},
      options: [],
    });
    expect(status).toBe(409);
  });

  it('persists a valid value on the org and returns it on read', async () => {
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      payload: { customFieldValues: { po_number: 'PO-4471' } },
      ...ADMIN,
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues).toMatchObject({
      po_number: 'PO-4471',
    });

    // Reload — value round-trips.
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      ...ADMIN,
    });
    expect((get.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues.po_number).toBe(
      'PO-4471',
    );
  });

  it('rejects clearing a required field with a per-field 422', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      payload: { customFieldValues: { po_number: '' } },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error?.details as { path: string }[] | undefined;
    expect(details?.some((d) => d.path === 'po_number')).toBe(true);
  });

  it('enforces select options end-to-end', async () => {
    const created = await createDefinition({
      entityType: 'organization',
      key: 'tier',
      label: {},
      labelDefault: 'Tier',
      valueType: 'select',
      required: false,
      sortOrder: 1,
      config: {},
      options: [
        { value: 'gold', label: {}, labelDefault: 'Gold', isDefault: false, sortOrder: 0 },
        { value: 'silver', label: {}, labelDefault: 'Silver', isDefault: false, sortOrder: 1 },
      ],
    });
    expect(created).toBe(201);

    const bad = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      payload: { customFieldValues: { po_number: 'PO-1', tier: 'platinum' } },
      ...ADMIN,
    });
    expect(bad.statusCode).toBe(422);

    const good = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      payload: { customFieldValues: { po_number: 'PO-1', tier: 'gold' } },
      ...ADMIN,
    });
    expect(good.statusCode).toBe(200);
  });
});
