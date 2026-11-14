import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #640 (#86) — the megamenu save refused a free-URL asset item as
 * `400 VALIDATION_FAILED` with an English sentence. The item is well-formed;
 * the capability (importing an asset from a URL into the Assets Library) is
 * missing. `VALIDATION_FAILED` is the one code whose message the error envelope
 * never replaces, so an operator working in Polish read English. It now has a
 * code of its own, a sentence in both languages, and the item's id in
 * `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const ADMIN = { b2b_session: 'stub-admin-session' };

const ASSET_URL_UNSUPPORTED = {
  en: 'An asset cannot be added to a megamenu item by its URL yet. Upload the file to the Assets Library first and choose it there.',
  pl: 'Nie można jeszcze dodać zasobu do pozycji megamenu przez jego adres URL. Najpierw prześlij plik do biblioteki zasobów i wybierz go stamtąd.',
};

describe('megamenu refusals carry their own code and sentence (issue #640)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  async function newMenu(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      cookies: ADMIN,
      payload: { name: `Refusals ${randomUUID()}` },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it.each(['en', 'pl'] as const)('refuses a free-URL asset item (%s)', async (language) => {
    await setAdminLanguage(language);
    const menu = await newMenu();
    const tabId = randomUUID();
    const assetItemId = randomUUID();

    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      cookies: ADMIN,
      payload: {
        version: menu.version,
        items: [
          {
            id: tabId,
            parentId: null,
            position: 0,
            presentation: 'mega',
            alignment: 'start',
            kind: 'group',
            labels: { 'en-US': 'Tab' },
            target: {},
          },
          {
            id: assetItemId,
            parentId: tabId,
            position: 0,
            kind: 'asset',
            labels: {},
            target: { url: 'https://example.com/banner.png', kind: 'image' },
          },
        ],
      },
    });

    expect(res.statusCode, res.body).toBe(400);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe('MEGAMENU_ASSET_URL_UNSUPPORTED');
    expect(error.details).toEqual({ itemId: assetItemId });
    expect(error.message).toBe(ASSET_URL_UNSUPPORTED[language]);
    if (language === 'pl') expect(error.message).not.toBe(ASSET_URL_UNSUPPORTED.en);
  });

  it('routes the code to megamenu, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS.MEGAMENU_ASSET_URL_UNSUPPORTED?.moduleId).toBe('megamenu');
  });
});
