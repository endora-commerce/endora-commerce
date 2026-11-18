import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { randomUUID } from 'node:crypto';
import { SalesChannel, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';

const simpleContent = (text: string) => ({
  root: { props: {} },
  content: [{ type: 'transactional_emails.EmailText', props: { id: 't1', text, align: 'left' } }],
  zones: {},
});

describe('transactional emails — per-channel + branding (US2)', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const channels = await h.em().find(SalesChannel, {}, { limit: 1 });
    channelId = channels[0]!.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves a per-channel override independently of global', async () => {
    // Global override.
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'GLOBAL', content: simpleContent('global body') },
    });
    // Channel override.
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US&salesChannelId=${channelId}`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'CHANNEL', content: simpleContent('channel body') },
    });

    const channelDetail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US&salesChannelId=${channelId}`,
      cookies: ADMIN_COOKIE,
    });
    const cd = (channelDetail.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(cd.effective.source).toBe('channel');
    expect(cd.effective.subject).toBe('CHANNEL');

    const globalDetail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    const gd = (globalDetail.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(gd.effective.source).toBe('global');
    expect(gd.effective.subject).toBe('GLOBAL');
  });

  /**
   * The e-mail logo, and the first test this platform has ever had for it
   * (D-223).
   *
   * `transactionalEmailAssetUrl` is a contribution: `transactional_emails` must
   * not reach `assets_library` directly, so a composition supplies the closure.
   * `composition.ts` supplied `resolveUrl` wrapped in `absolutizePublicUrl`; the
   * harness supplied `async () => null`, which is also the module's own default,
   * so contributing it changed nothing and **the production closure ran in no
   * test**. Both roots compose the same closure now.
   *
   * What is asserted is what an e-mail client receives: an absolute URL. A
   * recipient's mail client has never heard of this API host, so a
   * host-relative `/assets/file/<id>` is a broken image in every one of them —
   * which is the whole of why D-223 puts the origin inside the module rather
   * than in whichever consumer remembers to add it.
   */
  it('resolves the branding logo to an absolute asset URL', async () => {
    const assetId = randomUUID();
    await h.em().getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
         storage_locator, storage_backend, label, visibility, created_at, updated_at)
       values (?, 'image', 'logo.png', 'image/png', 128, ?, ?, 'local', 'Logo', 'public',
         now(), now())`,
      [assetId, `/assets/file/${assetId}`, `aa/bb/${assetId}.png`],
    );

    const put = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/branding`,
      cookies: ADMIN_COOKIE,
      payload: { logoAssetId: assetId },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({ method: 'GET', url: `${BASE}/branding`, cookies: ADMIN_COOKIE });
    const b = (get.json() as { data: { logoAssetId: string; logoUrl: string } }).data;
    expect(b.logoAssetId).toBe(assetId);
    // specs/156-asset-stable-url/ T063 (deliberate, R-20): the logo is embedded
    // in e-mails, so it carries the content version of the file it shows.
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ content_version: string }>>('select content_version from assets where id = ?', [assetId]);
    expect(b.logoUrl).toBe(`${resolvePublicApiBaseUrl()}/assets/file/${assetId}?v=${row!.content_version}`);
  });

  it('persists and reads back branding accent color', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/branding`,
      cookies: ADMIN_COOKIE,
      payload: { accentColor: '#abcdef' },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({ method: 'GET', url: `${BASE}/branding`, cookies: ADMIN_COOKIE });
    const b = (get.json() as { data: { accentColor: string } }).data;
    expect(b.accentColor).toBe('#abcdef');
  });
  /**
   * Issue #1466 — before the branding screen was mounted in the admin, the
   * stored values were proven to be *read back* (the two tests above) but not to
   * reach a message. This one follows them all the way: what the branding API
   * stores is what the rendered e-mail carries — the logo in the shared default
   * header, the accent on a button that sets no colour of its own — and a
   * channel inherits whatever it does not override.
   *
   * The preview is the assertion surface because it shares `renderWith` and
   * `BrandingService.resolve` with the send path; only the variables differ.
   */
  it('renders the stored logo and accent into the e-mail, per channel with inheritance', async () => {
    const assetId = randomUUID();
    await h.em().getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
         storage_locator, storage_backend, label, visibility, created_at, updated_at)
       values (?, 'image', 'brand.png', 'image/png', 128, ?, ?, 'local', 'Brand', 'public',
         now(), now())`,
      [assetId, `/assets/file/${assetId}`, `cc/dd/${assetId}.png`],
    );

    const putGlobal = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/branding`,
      cookies: ADMIN_COOKIE,
      payload: { logoAssetId: assetId, accentColor: '#0a7e5c' },
    });
    expect(putGlobal.statusCode).toBe(200);
    const putChannel = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/branding?salesChannelId=${channelId}`,
      cookies: ADMIN_COOKIE,
      payload: { accentColor: '#c2410c' },
    });
    expect(putChannel.statusCode).toBe(200);

    const draftContent = {
      root: { props: {} },
      content: [
        {
          type: 'transactional_emails.EmailInsertBlock',
          props: { id: 'hdr', code: 'default_email_header' },
        },
        {
          type: 'transactional_emails.EmailButton',
          props: { id: 'btn', label: 'View order', href: 'https://shop.example/o/1', align: 'left' },
        },
      ],
      zones: {},
    };
    const preview = async (salesChannelId?: string): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: `${BASE}/order_confirmation/preview`,
        cookies: ADMIN_COOKIE,
        payload: { language: 'en-US', draftContent, ...(salesChannelId ? { salesChannelId } : {}) },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: { html: string } }).data.html;
    };

    const logoUrlPrefix = `${resolvePublicApiBaseUrl()}/assets/file/${assetId}?v=`;

    const globalHtml = await preview();
    expect(globalHtml).toContain(`src="${logoUrlPrefix}`);
    expect(globalHtml).toContain('background-color:#0a7e5c');

    const channelHtml = await preview(channelId);
    // The channel overrides the accent and inherits the logo.
    expect(channelHtml).toContain('background-color:#c2410c');
    expect(channelHtml).not.toContain('background-color:#0a7e5c');
    expect(channelHtml).toContain(`src="${logoUrlPrefix}`);
  });
});
