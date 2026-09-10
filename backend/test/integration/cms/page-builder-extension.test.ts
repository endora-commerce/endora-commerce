import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  registerTestExtension,
  TEST_EXTENSION_COMPONENT_NAME,
  TEST_EXTENSION_MODULE_CODE,
} from '../../fixtures/cms/test-extension-module.js';

/**
 * T086 — Page Builder component-extension SPI end-to-end.
 *
 *   1. Without the fixture: the admin's GET /page-builder/config does not
 *      list `TestCallout`.
 *   2. After registerTestExtension: the same endpoint lists it with the
 *      declared field shape and the contributing module's name.
 *   3. A page authored with a TestCallout node round-trips through the
 *      storefront resolver — the data tree is preserved, and the storefront
 *      is the layer that picks the renderer (or the
 *      MissingComponentPlaceholder fallback).
 */
describe('CMS Page Builder extension SPI (T086)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('does not list TestCallout before the fixture is registered', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { components: Array<{ name: string }> };
    };
    expect(body.data.components.map((c) => c.name)).not.toContain(TEST_EXTENSION_COMPONENT_NAME);
  });

  it('exposes the registered component via GET /page-builder/config', async () => {
    registerTestExtension(h.cms.pageBuilderRegistry);
    // Feature 096, FR-010 — the descriptor is filtered on each name's own owner
    // segment, and `test_ext` is a **synthetic** module the lifecycle registry
    // has never heard of, so without this the SPI's own fixture is correctly
    // absent from its own assertion. Seeding the id into the registry cache is
    // the established shape for a module a test builds for itself (it is what
    // `check:off-state-coverage` recognises for `fixture_gated` and
    // `demo_carrier`), and it makes the presence filter part of what this test
    // exercises rather than something it has to work around.
    registryCache.__setEnabledForTesting([
      ...registryCache.enabledIds(),
      TEST_EXTENSION_MODULE_CODE,
    ]);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        schemaVersion: number;
        components: Array<{
          name: string;
          ownerModule: string;
          fields: Record<string, { type: string }>;
          previewIcon?: string;
        }>;
      };
    };
    const callout = body.data.components.find((c) => c.name === TEST_EXTENSION_COMPONENT_NAME);
    expect(callout).toBeDefined();
    expect(callout!.ownerModule).toBe(TEST_EXTENSION_MODULE_CODE);
    expect(callout!.fields['title']?.type).toBe('text');
    expect(callout!.fields['tone']?.type).toBe('select');
    expect(callout!.previewIcon).toBe('callout');
  });

  it('preserves an extension component in the storefront-resolved data tree', async () => {
    registerTestExtension(h.cms.pageBuilderRegistry);

    const slug = `extension-page-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Extension page',
        slug,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;

    const calloutTree = {
      root: { props: {} },
      content: [
        {
          type: TEST_EXTENSION_COMPONENT_NAME,
          props: { title: 'Heads up', tone: 'warning' },
        },
      ],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data: calloutTree, version: page.version }),
    });
    expect(put.statusCode).toBe(200);

    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: adminCookie,
    });
    expect(publish.statusCode).toBe(200);

    const resolved = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json() as {
      data: { content: { data: typeof calloutTree } };
    };
    expect(body.data.content.data).toEqual(calloutTree);
  });
});
