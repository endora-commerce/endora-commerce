import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CmsPage } from '../../../src/modules/cms_pages/entities/cms-page.entity.js';

/**
 * T234 — CMS page admin authoring + public read.
 *
 * Lifecycle: draft → published (via publish endpoint) → unpublished or
 * archived. Public reads only return rows in `published`. Path uniqueness
 * is enforced; collisions return 409.
 */

describe('CMS pages — admin authoring + public read', () => {
  let h: BackendServerHandle;
  let pageId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a draft and the public route returns 404 until published', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        path: 'about-us',
        title: { 'en-US': 'About us', 'pl-PL': 'O nas' },
        body: { 'en-US': 'We make widgets.', 'pl-PL': 'Robimy widzety.' },
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { data: { id: string; status: string } };
    expect(created.data.status).toBe('draft');
    pageId = created.data.id;

    const draftPublic = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/about-us',
    });
    expect(draftPublic.statusCode).toBe(404);

    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${pageId}/publish`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(publish.statusCode).toBe(200);
    const published = publish.json() as { data: { status: string; publishedAt: string } };
    expect(published.data.status).toBe('published');
    expect(new Date(published.data.publishedAt).getTime()).toBeGreaterThan(0);

    const publicRead = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/about-us',
    });
    expect(publicRead.statusCode).toBe(200);
    const body = publicRead.json() as {
      data: { path: string; title: Record<string, string> };
    };
    expect(body.data.path).toBe('about-us');
    expect(body.data.title['en-US']).toBe('About us');
  });

  it('rejects duplicate paths with 409', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        path: 'about-us',
        title: { 'en-US': 'Duplicate' },
        body: { 'en-US': '' },
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('unpublish drops the page out of public reads', async () => {
    const unpub = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${pageId}/unpublish`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(unpub.statusCode).toBe(200);

    const publicRead = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/about-us',
    });
    expect(publicRead.statusCode).toBe(404);
  });

  it('list returns drafts + published for admins', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/pages',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ path: string }> };
    expect(body.data.find((p) => p.path === 'about-us')).toBeTruthy();
  });

  it('rejects invalid paths via the public route', async () => {
    // Multi-segment + uppercase fails the kebab-case regex.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/About-Us',
    });
    expect(res.statusCode).toBe(400);
  });

  it('persists multi-segment paths and renders them via the public route', async () => {
    const em = h.em();
    em.create(CmsPage, {
      path: 'policies/privacy',
      status: 'published',
      title: { 'en-US': 'Privacy policy' },
      body: { 'en-US': 'We respect your privacy.' },
      publishedAt: new Date(),
    });
    await em.flush();

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/policies/privacy',
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { path: string } }).data.path).toBe('policies/privacy');
  });
});
