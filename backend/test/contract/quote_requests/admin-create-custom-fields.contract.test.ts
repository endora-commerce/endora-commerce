import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` US4, FR-015, FR-019,
 * FR-021, contracts/registration-and-admin-create.md §5) — the admin create on
 * behalf accepts the quote request's custom-field values: validated with the
 * administrator's rules before anything is written, stored on the new request,
 * named (never valued) by its audit row, and a refused value creates nothing. With
 * `quote_requests` switched off the create — values or not — answers as absent
 * (US4 scenario 4, Principle XVII).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';
const CREATE_URL = '/api/v1/admin/quote-requests';

describe('POST /api/v1/admin/quote-requests — custom-field values (feature 175)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  const stamp = randomUUID().replace(/-/g, '').slice(0, 6);
  const key = (name: string): string => `cf175q_${name}_${stamp}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    await define({ key: key('project'), labelDefault: 'Project', audience: 'internal' });
    await define({ key: key('budget'), labelDefault: 'Budget', valueType: 'number' });
  });

  afterAll(async () => {
    for (const id of created) {
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
        entityType: 'quote_request',
        label: {},
        valueType: 'text',
        required: false,
        audience: 'customer',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
        ...payload,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as { id: string }).id;
    created.push(id);
    return id;
  }

  async function undefine(id: string): Promise<void> {
    await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    created.splice(created.indexOf(id), 1);
  }

  function createOnBehalf(extra: Record<string, unknown> = {}) {
    return h.app.inject({
      method: 'POST',
      url: CREATE_URL,
      ...ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 5 }],
        ...extra,
      },
    });
  }

  const requestCount = async (): Promise<number> => {
    const [row] = await h.em().getKnex()('quote_requests').where({ organization_id: TEST_ORGANIZATION_ID }).count({ n: '*' });
    return Number(row?.n);
  };

  it('stores the values, answers them and names them — never their values — in the audit row', async () => {
    const values = { [key('project')]: 'S470-CF', [key('budget')]: 470470 };
    const res = await createOnBehalf({ customFieldValues: values });
    expect(res.statusCode, res.body).toBe(201);
    const rfq = res.json().data as { id: string; customFieldValues: Record<string, unknown> };
    expect(rfq.customFieldValues).toEqual(values);

    const row = await h.em().getKnex()('quote_requests').where({ id: rfq.id }).first('custom_field_values');
    expect(row.custom_field_values).toEqual(values);

    h.em().clear();
    const entries = await h.em().find(AuditLogEntry, { action: 'quote_request.create_on_behalf', objectId: rfq.id });
    // `specs/conventions/audit-state.md` (D-288): the keys, never the values.
    expectNoAuditValues(entries, ['S470-CF', 470470]);
    expect(entries[0]?.stateAfter).not.toHaveProperty('customFieldValues');
    expect(entries[0]?.stateAfter).toMatchObject({ changedCustomFields: [key('budget'), key('project')].sort() });
  });

  it('refuses an invalid value with the per-field 422 and creates nothing', async () => {
    const before = await requestCount();
    const res = await createOnBehalf({ customFieldValues: { [key('budget')]: 'a lot' } });
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(body.error.details.map((d) => d.path)).toContain(key('budget'));
    expect(await requestCount()).toBe(before);
  });

  it('refuses a missing required field — also when no values are sent — and creates nothing', async () => {
    const id = await define({ key: key('required'), labelDefault: 'Tender number', required: true, audience: 'internal' });
    try {
      const before = await requestCount();
      const res = await createOnBehalf({ customFieldValues: { [key('project')]: 'x' } });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
      expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
      expect(body.error.details.map((d) => d.path)).toContain(key('required'));

      const bare = await createOnBehalf();
      expect(bare.statusCode, bare.body).toBe(422);
      expect(await requestCount()).toBe(before);
    } finally {
      await undefine(id);
    }
  });

  it('answers as absent while quote_requests is switched off, and creates nothing', async () => {
    const before = await requestCount();
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const res = await createOnBehalf({ customFieldValues: { [key('project')]: 'while off' } });
      expect(res.statusCode, res.body).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });
    expect(await requestCount()).toBe(before);
  });
});
