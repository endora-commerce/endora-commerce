import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CmsPage } from '../../../src/modules/cms_pages/entities/cms-page.entity.js';

/**
 * T234 — CMS pages plug into the SEO meta resolver and the public sitemap.
 *
 * - The meta resolver returns rule-derived title/description for a CMS
 *   page, derived from its multilingual `title`/`body` JSONB.
 * - The sitemap regenerator includes published CMS paths so crawlers
 *   discover them.
 */

describe('CMS pages — SEO + sitemap integration', () => {
  let h: BackendServerHandle;
  let pageId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const page = em.create(CmsPage, {
      path: 'help/contact',
      status: 'published',
      title: { 'en-US': 'Contact us', 'pl-PL': 'Kontakt' },
      body: {
        'en-US': '# Contact\nReach us at hello@example.com any time.',
        'pl-PL': '# Kontakt\nNapisz na hello@example.com.',
      },
      publishedAt: new Date(),
    });
    await em.flush();
    pageId = page.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('SEO resolver returns rule-derived meta for cms_page', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/cms_page/${pageId}?locale=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolved: { title: string; description: string; source: string } };
    };
    expect(body.data.resolved.source).toBe('rule');
    expect(body.data.resolved.title).toBe('Contact us');
    // Description is derived from the body, with markdown punctuation stripped.
    expect(body.data.resolved.description).toContain('Reach us at hello@example.com');
    expect(body.data.resolved.description).not.toContain('#');
  });

  it('admin SEO override on a CMS page round-trips and flips source=override', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/seo/meta/cms_page/${pageId}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        locale: 'en-US',
        title: 'Hand-crafted contact title',
      },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/cms_page/${pageId}?locale=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = get.json() as { data: { resolved: { title: string; source: string } } };
    expect(body.data.resolved.source).toBe('override');
    expect(body.data.resolved.title).toBe('Hand-crafted contact title');
  });

  it('sitemap.xml includes the published CMS path', async () => {
    // Force a fresh build — staleAfterMs is 0 in tests.
    const regen = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/seo/sitemap/regenerate',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(regen.statusCode).toBe(200);

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http://test.local/help/contact');
  });
});
