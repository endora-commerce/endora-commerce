import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  cmsBlockDetailSchema,
  cmsPageDetailSchema,
  cmsTemplateDetailSchema,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';

/**
 * Issue #1495 (UX audit CONTENT-13, DEC-17) — the shape of
 * `POST /api/v1/admin/cms/{pages|blocks|templates}/:id/duplicate`: 201 with the
 * kind's detail schema (the create envelope), the `cms.write` gate, the
 * not-found codes for an unknown and a malformed id, and the strict body.
 *
 * What the copy holds and the rollback of a refusal are
 * `test/integration/cms/duplicate.test.ts`'s; the module-off answer is in
 * `test/integration/cms/off-state.test.ts`.
 */

const RUN = `dup1495-${randomUUID().slice(0, 8)}`;
const ADMIN = { b2b_session: 'stub-admin-session' };
const READER_ID = '00000000-0000-4000-8000-000000001495';
const READER_COOKIE = 'stub-cms-reader-1495-session';
const READER = { b2b_session: READER_COOKIE };

const KINDS = [
  { kind: 'pages', schema: cmsPageDetailSchema, notFound: ERROR_CODES.CMS_PAGE_NOT_FOUND },
  { kind: 'blocks', schema: cmsBlockDetailSchema, notFound: ERROR_CODES.CMS_BLOCK_NOT_FOUND },
  { kind: 'templates', schema: cmsTemplateDetailSchema, notFound: ERROR_CODES.CMS_TEMPLATE_NOT_FOUND },
] as const;

describe('admin CMS duplicate contract (issue #1495)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const sources: Record<(typeof KINDS)[number]['kind'], string> = { pages: '', blocks: '', templates: '' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;
    ADMIN_COOKIES[READER_COOKIE] = { adminUserId: READER_ID };
    await ensureAdminWithRole(h, READER_ID, 'cms_reader_1495', ['cms.read']);

    for (const { kind } of KINDS) {
      const identity = kind === 'pages' ? { slug: `${RUN}-page` } : { code: `${RUN}-${kind}` };
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/cms/${kind}`,
        cookies: ADMIN,
        payload: { name: `Source ${kind}`, ...identity, salesChannelIds: [channelId], languages: ['en-US'] },
      });
      expect(res.statusCode, res.body).toBe(201);
      sources[kind] = (res.json() as { data: { id: string } }).data.id;
    }
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[READER_COOKIE];
    await teardownBackendServer(h);
  });

  const duplicate = (kind: string, id: string, options: { cookies?: Record<string, string>; payload?: unknown } = {}) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/${kind}/${id}/duplicate`,
      ...(options.cookies ? { cookies: options.cookies } : {}),
      ...(options.payload !== undefined ? { payload: options.payload as Record<string, unknown> } : {}),
    });

  describe.each(KINDS)('$kind', ({ kind, schema, notFound }) => {
    it('answers 201 with the detail schema, for a named copy and a bodiless POST', async () => {
      const named = await duplicate(kind, sources[kind], { cookies: ADMIN, payload: { name: `Named ${kind}` } });
      expect(named.statusCode, named.body).toBe(201);
      const copy = schema.parse((named.json() as { data: unknown }).data);
      expect(copy.id).not.toBe(sources[kind]);
      expect(copy.name).toBe(`Named ${kind}`);
      expect(copy.version).toBe(1);
      expect(copy.salesChannelIds).toEqual([channelId]);

      const bodiless = await duplicate(kind, sources[kind], { cookies: ADMIN });
      expect(bodiless.statusCode, bodiless.body).toBe(201);
      expect(schema.parse((bodiless.json() as { data: unknown }).data).name).toBe(`Source ${kind} (copy)`);
    });

    it('answers 401 unauthenticated and 403 with cms.read only', async () => {
      expect((await duplicate(kind, sources[kind])).statusCode).toBe(401);
      const reader = await duplicate(kind, sources[kind], { cookies: READER, payload: {} });
      expect(reader.statusCode, reader.body).toBe(403);
    });

    it('answers its not-found code for an unknown and a malformed id', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const res = await duplicate(kind, id, { cookies: ADMIN, payload: {} });
        expect(res.statusCode, `${id}: ${res.body}`).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe(notFound);
      }
    });

    it('answers 400 for a body with an unknown key or an empty name', async () => {
      for (const payload of [{ slug: 'x-copy' }, { code: 'x-copy' }, { name: '   ' }]) {
        const res = await duplicate(kind, sources[kind], { cookies: ADMIN, payload });
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      }
    });
  });

  it('derives the slug of a page copy and keeps it a draft', async () => {
    const res = await duplicate('pages', sources.pages, { cookies: ADMIN, payload: {} });
    const copy = cmsPageDetailSchema.parse((res.json() as { data: unknown }).data);
    expect(copy.slug).toMatch(new RegExp(`^${RUN}-page-copy(-\\d+)?$`));
    expect(copy.status).toBe('draft');
  });
});
