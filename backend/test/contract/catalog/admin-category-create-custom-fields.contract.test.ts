import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` US4, FR-015, FR-016,
 * FR-021, contracts/registration-and-admin-create.md §5) — the admin category
 * create accepts the category's custom-field values: validated with the
 * administrator's rules inside the creating Command, stored on the new row,
 * carried by its audit row, and a refused value creates nothing.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';
const CATEGORIES_URL = '/api/v1/admin/catalog/categories';

describe('POST /api/v1/admin/catalog/categories — custom-field values (feature 175)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  let seq = 0;
  const slug = (): string => `cf175-cat-${stamp}-${seq++}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    await define({ key: 'cf175c_note', labelDefault: 'Merchandising note', audience: 'internal' });
    await define({ key: 'cf175c_rank', labelDefault: 'Rank', valueType: 'number' });
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
        entityType: 'category',
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

  function createCategory(extra: Record<string, unknown>, categorySlug = slug()) {
    return h.app.inject({
      method: 'POST',
      url: CATEGORIES_URL,
      ...ADMIN,
      payload: { name: { en: `CF175 ${categorySlug}` }, slug: categorySlug, ...extra },
    });
  }

  const knex = () => h.em().getKnex();

  it('stores the values, answers them and carries them in the audit row', async () => {
    const res = await createCategory({ customFieldValues: { cf175c_note: 'Seasonal' } });
    expect(res.statusCode, res.body).toBe(201);
    const category = res.json().data as { id: string; customFieldValues: Record<string, unknown> };
    expect(category.customFieldValues).toEqual({ cf175c_note: 'Seasonal' });

    const row = await knex()('categories').where({ id: category.id }).first('custom_field_values');
    expect(row.custom_field_values).toEqual({ cf175c_note: 'Seasonal' });

    h.em().clear();
    const [entry] = await h.em().find(AuditLogEntry, { action: 'category.create', objectId: category.id });
    expect(entry?.stateAfter).toMatchObject({ customFieldValues: { cf175c_note: 'Seasonal' } });
  });

  it('refuses an invalid value with the per-field 422 and creates nothing', async () => {
    const categorySlug = slug();
    const res = await createCategory({ customFieldValues: { cf175c_rank: 'not a number' } }, categorySlug);
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(body.error.details.map((d) => d.path)).toContain('cf175c_rank');
    expect(await knex()('categories').where({ slug: categorySlug }).count({ n: '*' })).toEqual([{ n: '0' }]);
  });

  it('refuses a missing required field — also when no values are sent — and creates nothing', async () => {
    const id = await define({ key: 'cf175c_required', labelDefault: 'Buyer group', required: true, audience: 'internal' });
    try {
      const withValues = slug();
      const res = await createCategory({ customFieldValues: { cf175c_note: 'x' } }, withValues);
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
      expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
      expect(body.error.details.map((d) => d.path)).toContain('cf175c_required');

      const withoutValues = slug();
      const bare = await createCategory({}, withoutValues);
      expect(bare.statusCode, bare.body).toBe(422);

      expect(
        await knex()('categories').whereIn('slug', [withValues, withoutValues]).count({ n: '*' }),
      ).toEqual([{ n: '0' }]);
    } finally {
      await undefine(id);
    }
  });
});
