import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T100 — End-to-end smoke covering the manual scenario from
 * `specs/014-cms/quickstart.md` § "End-to-end smoke":
 *
 *   1. Admin creates a Page with the Default channel + en-US, drops
 *      Row (with columns) + Heading + Text + Button, saves, publishes.
 *   2. Storefront sees the rendered page at the slug.
 *   3. Admin creates a Block "homepage-hero" and attaches it to
 *      `homepage.top` (a seeded Hook).
 *   4. Storefront homepage Hook resolution returns the Block.
 *   5. Admin creates a Template and embeds it in the Page; storefront
 *      resolves it inline via `embeds.templates`.
 *   6. Admin tries to delete the Block while Hook + Page reference it —
 *      refused with 409 CMS_REFERENCED.
 *   7. After detaching the Hook attachment and removing the Block from
 *      the Page, deletion succeeds.
 */
describe('CMS quickstart smoke (T100)', () => {
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

  it('walks the full editor → storefront → reference-protection flow', async () => {
    // ── 1. Create + publish a Page. ───────────────────────────────────
    const stamp = Date.now();
    const slug = `smoke-page-${stamp}`;
    const blockCode = `homepage-hero-${stamp}`;
    const templateCode = `cta-free-shipping-${stamp}`;

    const pageCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Smoke page',
        slug,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(pageCreated.statusCode).toBe(201);
    const page = (pageCreated.json() as { data: { id: string; version: number } }).data;

    const richTree = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Row',
          props: {
            id: 'r1',
            gap: 24,
            rowGap: 24,
            sectionLayout: 'in_flow',
            contentMaxWidth: 'none',
            contentPosition: 'top',
            minHeight: 0,
            verticalAlign: 'stretch',
            columnDivider: false,
            reverseOnMobile: false,
            margin: { mode: 'uniform', value: 0 },
            padding: { mode: 'uniform', value: 0 },
            border: { mode: 'none' },
            background: 'transparent',
            cornerRadius: 'none',
            shadow: 'none',
            overflow: false,
            content: [
              {
                type: 'cms.Column',
                props: {
                  id: 'col-1',
                  span: 6,
                  margin: { mode: 'uniform', value: 0 },
                  padding: { mode: 'uniform', value: 0 },
                  border: { mode: 'none' },
                  background: 'transparent',
                  cornerRadius: 'none',
                  shadow: 'none',
                  content: [
                    {
                      type: 'cms.Heading',
                      props: {
                        id: 'h1',
                        level: 'h1',
                        text: 'Welcome',
                        textAlign: 'left',
                        margin: { mode: 'uniform', value: 0 },
                        padding: { mode: 'uniform', value: 0 },
                        border: { mode: 'none' },
                      },
                    },
                  ],
                },
              },
              {
                type: 'cms.Column',
                props: {
                  id: 'col-2',
                  span: 6,
                  margin: { mode: 'uniform', value: 0 },
                  padding: { mode: 'uniform', value: 0 },
                  border: { mode: 'none' },
                  background: 'transparent',
                  cornerRadius: 'none',
                  shadow: 'none',
                  content: [
                    {
                      type: 'cms.Text',
                      props: {
                        id: 't1',
                        text: 'Hello world',
                        fontFamily: 'sans',
                        fontStyle: 'normal',
                        color: '#243447',
                        fontSize: 16,
                        fontWeight: 400,
                        textAlign: 'left',
                        lineHeight: 1.65,
                        margin: { mode: 'uniform', value: 0 },
                        padding: { mode: 'uniform', value: 0 },
                        border: { mode: 'none' },
                      },
                    },
                    {
                      type: 'cms.Button',
                      props: {
                        id: 'b1',
                        label: 'Shop',
                        linkType: 'url',
                        linkSlug: '',
                        href: '/catalog',
                        target: '_self',
                        variant: 'primary',
                        margin: { mode: 'uniform', value: 0 },
                        padding: { mode: 'uniform', value: 0 },
                        border: { mode: 'none' },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const setContent = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data: richTree, version: page.version }),
    });
    expect(setContent.statusCode).toBe(200);

    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: adminCookie,
    });
    expect(publish.statusCode).toBe(200);
    const afterPublish = (publish.json() as { data: { version: number } }).data;

    // ── 2. Storefront resolves the page at the slug. ──────────────────
    const resolvedPage = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(resolvedPage.statusCode).toBe(200);
    const resolvedBody = resolvedPage.json() as {
      data: {
        slug: string;
        content: { data: typeof richTree };
        embeds: { blocks: Record<string, unknown>; templates: Record<string, unknown> };
      };
    };
    expect(resolvedBody.data.slug).toBe(slug);
    expect(resolvedBody.data.content.data.content[0]?.type).toBe('cms.Row');

    // ── 3. Create a Block + attach to `homepage.top`. ─────────────────
    const blockCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Homepage Hero',
        code: blockCode,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(blockCreated.statusCode).toBe(201);
    const block = (blockCreated.json() as { data: { id: string; version: number } }).data;
    const blockContent = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: 'cms.Heading', props: { id: 'bh', level: 'h2', text: 'Hero' } }],
        },
        version: block.version,
      }),
    });
    expect(blockContent.statusCode).toBe(200);

    // Look up the seeded `homepage.top` hook id.
    const hookList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/hooks',
      cookies: adminCookie,
    });
    expect(hookList.statusCode).toBe(200);
    const hooks = (hookList.json() as {
      data: Array<{ id: string; code: string }>;
    }).data;
    const homepageTop = hooks.find((hk) => hk.code === 'homepage.top');
    expect(homepageTop, 'seeded homepage.top hook should exist').toBeDefined();

    const attached = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${homepageTop!.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId: block.id, position: 0 }),
    });
    expect(attached.statusCode).toBe(201);

    // ── 4. Storefront resolves the hook with the block included. ──────
    const resolvedHook = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/hooks/by-code?code=homepage.top&language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(resolvedHook.statusCode).toBe(200);
    const hookBody = resolvedHook.json() as {
      data: { hookCode: string; blocks: Array<{ code: string }> };
    };
    expect(hookBody.data.blocks.map((b) => b.code)).toContain(blockCode);

    // ── 5. Create a Template and embed it in the Page. ────────────────
    const templateCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/templates',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'CTA — Free shipping',
        code: templateCode,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(templateCreated.statusCode).toBe(201);
    const template = (templateCreated.json() as { data: { id: string; version: number } }).data;
    const templateContent = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/templates/${template.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{
            type: 'cms.Text',
            props: {
              id: 'tt',
              text: 'Free shipping over 200 EUR',
              fontFamily: 'sans',
              fontStyle: 'normal',
              color: '#243447',
              fontSize: 16,
              fontWeight: 400,
              textAlign: 'left',
              lineHeight: 1.65,
            },
          }],
        },
        version: template.version,
      }),
    });
    expect(templateContent.statusCode).toBe(200);

    const pageWithEmbeds = {
      root: { props: {} },
      content: [
        { type: 'cms.InsertBlock', props: { id: 'ib', code: blockCode } },
        { type: 'cms.InsertTemplate', props: { id: 'it', code: templateCode } },
      ],
    };
    const repaintPage = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data: pageWithEmbeds, version: afterPublish.version }),
    });
    expect(repaintPage.statusCode).toBe(200);

    const reResolved = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(reResolved.statusCode).toBe(200);
    const reBody = reResolved.json() as {
      data: {
        embeds: {
          blocks: Record<string, { code: string }>;
          templates: Record<string, { code: string }>;
        };
      };
    };
    expect(reBody.data.embeds.blocks[blockCode]?.code).toBe(blockCode);
    expect(reBody.data.embeds.templates[templateCode]?.code).toBe(templateCode);

    // ── 6. Block delete refused while Page + Hook reference it. ──────
    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_REFERENCED } });

    // ── 7. Detach + remove → deletion succeeds. ──────────────────────
    const detached = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/hooks/${homepageTop!.id}/attachments/${block.id}`,
      cookies: adminCookie,
    });
    expect(detached.statusCode).toBe(204);

    // Refused — page still embeds it.
    const stillBlocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(stillBlocked.statusCode).toBe(409);

    const cleanedPage = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: 'cms.InsertTemplate', props: { id: 'it', code: templateCode } }],
        },
        version: (repaintPage.json() as { data: { version: number } }).data.version,
      }),
    });
    expect(cleanedPage.statusCode).toBe(200);

    const finallyDeleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      cookies: adminCookie,
    });
    expect(finallyDeleted.statusCode).toBe(204);
  });
});
