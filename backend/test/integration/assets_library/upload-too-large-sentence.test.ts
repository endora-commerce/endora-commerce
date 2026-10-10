import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
} from '../../helpers/seed-crm.js';
import {
  overrideAssetSetting,
  uploadCrmAttachment,
  useTemporaryAssetStore,
} from '../../helpers/crm-attachment-upload.js';

/**
 * Issue #86 — `ASSET_UPLOAD_TOO_LARGE` says what the limit is.
 *
 * The upload pipeline wrote "File exceeds the configured maximum of 1 MB." and
 * the bundle answered "Asset Upload Too Large." in English and the same
 * fragment, lower-cased behind the Polish word for "error", in Polish. The one
 * figure that tells an operator what to do next, compress
 * the file or raise the setting, was in the string nobody receives.
 *
 * **Why this goes through the CRM attachment route.** The pipeline refuses on
 * the size a caller *declares*, and the library's own `POST /admin/assets`
 * declares `0` because a multipart part carries no guaranteed length — so that
 * route never raises this code. The CRM upload reads the file first and
 * declares its real size, which makes it the one route in the tree that
 * reaches the refusal.
 *
 * An administrator's language is the stored preference, not a header.
 */

interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('ASSET_UPLOAD_TOO_LARGE carries the limit and both sentences name it (issue #86)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let restoreLimit: () => Promise<void>;
  let opportunityId = '';

  async function setAdminLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: CRM_ADMIN,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode).toBe(200);
  }

  async function refusal(): Promise<Refusal['error']> {
    const res = await uploadCrmAttachment(h, opportunityId, {
      filename: 'i86-two-megabytes.bin',
      value: Buffer.alloc(2 * 1024 * 1024, 0x41),
    });
    // The status the refusal has always had.
    expect(res.statusCode, res.body).toBe(413);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TOO_LARGE);
    return body.error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    store = await useTemporaryAssetStore(h);
    restoreLimit = await overrideAssetSetting(h, 'assets.max_file_size_mb', 1);
    opportunityId = (await createCrmOpportunity(h)).id;
  }, 120_000);

  afterAll(async () => {
    // The preference outlives this file in a single-fork run.
    await setAdminLanguage(null);
    await restoreLimit();
    await store.undo();
    await teardownBackendServer(h);
  });

  it('details carry the limit in megabytes', async () => {
    await setAdminLanguage('en');
    const { details } = await refusal();
    expect(details).toEqual({ maxFileSizeMb: 1 });
  });

  it('en — the sentence names the limit', async () => {
    await setAdminLanguage('en');
    expect((await refusal()).message).toBe(
      'The file is too large: the largest file that can be uploaded is 1 MB.',
    );
  });

  it('pl — the Polish sentence names it too, and is not the English fallback', async () => {
    await setAdminLanguage('pl');
    const { message } = await refusal();
    expect(message).toBe('Plik jest za duży: można przesłać plik o rozmiarze najwyżej 1 MB.');
    // An unfilled placeholder makes the envelope answer with what the thrower
    // wrote, in English.
    expect(message).not.toMatch(/File exceeds|asset upload too large|\{/i);
  });

  it('stores nothing for a refused file', async () => {
    expect(await h.em().count(Asset, { filename: 'i86-two-megabytes.bin' })).toBe(0);
  });
});
