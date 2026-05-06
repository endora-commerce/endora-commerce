import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dictionaryTranslationSchema, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary admin translation routes (feature 017 / US3)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts, lists, and deletes a translation', async () => {
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/translations/country/DE/pl-PL',
      payload: { label: 'Niemcy' },
      cookies: adminCookie,
    });
    expect(upsert.statusCode).toBe(200);
    expect(dictionaryTranslationSchema.parse(upsert.json().data)).toMatchObject({
      entryType: 'country',
      entryCode: 'DE',
      languageCode: 'pl-PL',
      label: 'Niemcy',
    });

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/translations/country/DE',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((row: { languageCode: string }) => row.languageCode === 'pl-PL')).toBe(true);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/dictionary/translations/country/DE/pl-PL',
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('returns DICTIONARY_ENTRY_NOT_FOUND for a missing parent', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/dictionary/translations/country/XX/pl-PL',
      payload: { label: 'Nie istnieje' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND);
  });
});
