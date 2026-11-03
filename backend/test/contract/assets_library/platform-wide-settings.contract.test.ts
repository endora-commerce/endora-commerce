import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { Asset } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  multipartBody,
  overrideAssetSetting,
  useTemporaryAssetStore,
} from '../../helpers/crm-attachment-upload.js';
import { forgetAssets } from '../../helpers/asset-replace-fixtures.js';

/**
 * Issue #333 — every `assets.*` setting resolves the way the platform defines a
 * platform-wide read: `settings.global_value ?? default_value`. The Admin
 * Settings screen stores its "Platform-wide global override" in `global_value`,
 * and the module used to read only `setting_values`, so the saved value was
 * ignored and the manifest default applied.
 *
 * Each case also stores a per-channel `setting_values` row that disagrees with
 * the global value: the module used to take whichever such row it found as the
 * answer for a platform-wide setting, and must not any more.
 */
describe('assets settings are read platform-wide (#333)', () => {
  const adminCookie = { b2b_session: 'stub-admin-session' };
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const restores: Array<() => Promise<void>> = [];
  const decoys: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  });

  afterEach(async () => {
    for (const restore of restores.splice(0).reverse()) await restore();
    const em = h.em();
    for (const code of decoys.splice(0)) {
      em.remove(await em.find(SettingValue, { setting: { code } }));
      await em.flush();
      await h.settings.cache.invalidate(code);
    }
    h.assetsLibrary.adapters.invalidate();
  });

  afterAll(async () => {
    await store.undo();
    await teardownBackendServer(h);
  });

  /** Store `value` as the platform-wide override, as Admin Settings does. */
  async function setGlobal(code: string, value: unknown): Promise<void> {
    restores.push(await overrideAssetSetting(h, code, value));
  }

  /** Store a per-channel row the platform-wide read must not answer with. */
  async function setChannelDecoy(code: string, value: unknown): Promise<void> {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code });
    const channel = await em.findOneOrFail(SalesChannel, { code: 'default' });
    em.remove(await em.find(SettingValue, { setting }));
    em.create(SettingValue, { setting, salesChannel: channel, value });
    await em.flush();
    await h.settings.cache.invalidate(code);
    decoys.push(code);
  }

  function upload(filename: string, mime: string, value: Buffer) {
    const { body, contentType } = multipartBody([{ name: 'file', filename, mime, value }]);
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: adminCookie,
      payload: body,
    });
  }

  it('refuses an upload over the platform-wide assets.max_file_size_mb (the issue\'s reproduction)', async () => {
    await setGlobal('assets.max_file_size_mb', 1);
    await setChannelDecoy('assets.max_file_size_mb', 0);
    const res = await upload('issue-333-two-megabytes.bin', 'application/octet-stream', Buffer.alloc(2 * 1024 * 1024, 0x41));
    expect(res.statusCode, res.body).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'ASSET_UPLOAD_TOO_LARGE' } });
    expect(await h.em().count(Asset, { filename: 'issue-333-two-megabytes.bin' })).toBe(0);
  });

  it('refuses a type outside the platform-wide assets.allowed_file_types', async () => {
    await setGlobal('assets.allowed_file_types', ['png']);
    await setChannelDecoy('assets.allowed_file_types', ['*']);
    const res = await upload('issue-333-notes.txt', 'text/plain', Buffer.from('hello'));
    expect(res.statusCode, res.body).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED' } });
  });

  it('builds the adapter assets.storage.adapter names, with the platform-wide assets.s3.* values', async () => {
    await setGlobal('assets.storage.adapter', 's3');
    await setChannelDecoy('assets.storage.adapter', 'local');
    await setGlobal('assets.s3.bucket', 'issue-333-bucket');
    await setGlobal('assets.s3.region', 'eu-central-1');
    await setGlobal('assets.s3.public_base_url', 'https://cdn.issue-333.example.test');
    await setChannelDecoy('assets.s3.public_base_url', 'https://decoy.issue-333.example.test');
    h.assetsLibrary.adapters.invalidate();

    const adapter = await h.assetsLibrary.adapters.getActive();
    expect(adapter.code).toBe('s3');
    // A public URL is built from the configured base without a network call,
    // so it shows which `assets.s3.public_base_url` the adapter was given.
    const { url } = await adapter.resolveUrl({ locator: 'ab/cd/file.png', visibility: 'public' });
    expect(url).toBe('https://cdn.issue-333.example.test/ab/cd/file.png');
  });

  it('keeps a saved S3 secret encrypted in the database and in the settings cache, and reads it as plaintext', async () => {
    const code = 'assets.s3.secret_access_key';
    // The Admin Settings write itself: a `secret` setting is stored as a
    // ciphertext envelope, never as what the operator typed.
    restores.push(await overrideAssetSetting(h, code, null));
    await h.settings.adminService.setValueForAllChannels(code, 'issue-333-plaintext', null, {
      actorAdminUserId: null,
    });

    const stored = await h.em().fork({ clear: true }).findOneOrFail(Setting, { code });
    expect(JSON.stringify(stored.globalValue)).not.toContain('issue-333-plaintext');

    const read = await h.settings.settingsService.getMany([code], null);
    expect(read.get(code)).toEqual({ ok: true, value: 'issue-333-plaintext' });

    // The read above went through the cache; what it holds is the envelope.
    const cached = await h.settings.cache.get(code, null);
    expect(cached.hit).toBe(true);
    expect(JSON.stringify(cached)).not.toContain('issue-333-plaintext');
  });

  it('answers the manifest default once the platform-wide value is cleared', async () => {
    await setGlobal('assets.allowed_file_types', ['png']);
    for (const restore of restores.splice(0).reverse()) await restore();
    const res = await upload('issue-333-after-reset.txt', 'text/plain', Buffer.from('hello'));
    expect(res.statusCode, res.body).toBe(201);
    const { id } = (res.json() as { data: { id: string } }).data;
    await forgetAssets(h, [id]);
  });
});
