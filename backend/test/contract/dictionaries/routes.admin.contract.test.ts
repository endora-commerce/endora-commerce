import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dictionaryCountriesPageResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary admin routes (feature 017 / US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('lists seeded countries using the documented page envelope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/countries?page=1&pageSize=5&sort=code&search=PL',
      cookies: adminCookie,
    });

    expect(res.statusCode).toBe(200);
    const body = dictionaryCountriesPageResponseSchema.parse(res.json());
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(5);
    expect(body.data.some((c) => c.code === 'PL')).toBe(true);
  });

  it('creates, updates, promotes, and deletes a country', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      payload: {
        code: 'AA',
        alpha3Code: 'AAA',
        numericCode: '901',
        label: 'Admin Testland',
        region: 'Europe',
        sortOrder: 999,
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.code).toBe('AA');

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/countries/AA',
      payload: { label: 'Admin Testland Updated', isEuMember: true },
      cookies: adminCookie,
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data.label).toBe('Admin Testland Updated');
    expect(update.json().data.isEuMember).toBe(true);

    const promote = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries/AA/default',
      cookies: adminCookie,
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().data.isDefault).toBe(true);

    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries/PL/default',
      cookies: adminCookie,
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/dictionary/countries/AA',
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('manages currencies and languages through the extended dictionary surface', async () => {
    const currency = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/currencies',
      payload: {
        code: 'XAA',
        label: 'Test currency',
        symbol: 'T',
        symbolPosition: 'prefix',
        decimalPlaces: 3,
      },
      cookies: adminCookie,
    });
    expect(currency.statusCode).toBe(201);
    expect(currency.json().data.decimalPlaces).toBe(3);

    const language = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/languages',
      payload: {
        code: 'aa-AA',
        label: 'Test Language',
        nativeLabel: 'Test Language',
        fallbackCode: 'en-US',
      },
      cookies: adminCookie,
    });
    expect(language.statusCode).toBe(201);
    expect(language.json().data.fallbackCode).toBe('en-US');

    const assoc = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/languages/aa-AA/countries/PL',
      payload: { isPrimary: true },
      cookies: adminCookie,
    });
    expect(assoc.statusCode).toBe(200);
    expect(assoc.json().data).toMatchObject({
      languageCode: 'aa-AA',
      countryCode: 'PL',
      isPrimary: true,
    });

    const languages = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/languages?search=aa-AA',
      cookies: adminCookie,
    });
    expect(languages.statusCode).toBe(200);
    expect(languages.json().data[0].countries).toContain('PL');

    const assocDelete = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/dictionary/languages/aa-AA/countries/PL',
      cookies: adminCookie,
    });
    expect(assocDelete.statusCode).toBe(204);
  });

  it('reports orphan dictionary references without mutating data', async () => {
    const conn = h.em().getConnection();
    const [channel] = (await conn.execute(
      `select id::text as id, languages from sales_channels where system_default = true limit 1`,
    )) as Array<{ id: string; languages: unknown }>;
    expect(channel).toBeDefined();
    await conn.execute(`update sales_channels set languages = '["en-US","zz-ZZ"]'::jsonb where id = ?`, [
      channel!.id,
    ]);
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/dictionary/audit/orphans',
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toContainEqual(
        expect.objectContaining({
          dictionary: 'language',
          consumer: 'sales_channels',
          tableName: 'sales_channels',
          columnName: 'languages[]',
          code: 'zz-ZZ',
          count: 1,
        }),
      );
    } finally {
      await conn.execute(`update sales_channels set languages = ?::jsonb where id = ?`, [
        JSON.stringify(channel!.languages),
        channel!.id,
      ]);
    }
  });

  it('allows operators to invalidate the dictionary registry cache', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/cache/invalidate',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ invalidated: true });
  });
});
