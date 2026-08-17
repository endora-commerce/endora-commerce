import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T092 — Legacy `cms_pages` migration verification.
 *
 *   Pre-014, `cms_pages` carried `path` + `body` (per-language HTML strings)
 *   and a `status` enum. Migration `035_cms_init.ts` adds the new column set
 *   (slug, name, active, content envelope, languages) and backfills every
 *   row from the legacy data. This test simulates the pre-migration shape
 *   by inserting rows with default values for the new columns, then runs
 *   the same backfill SQL the migration uses, and asserts:
 *
 *     - every row is reachable via the new storefront endpoint at the same
 *       slug as its legacy `path`;
 *     - an archived row is `active=false` and 404s on the storefront;
 *     - re-running the backfill SQL is a no-op (idempotency).
 */
describe('legacy cms_pages migration (T092)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;

  const cases: Array<{
    id: string;
    path: string;
    status: 'draft' | 'published' | 'archived';
    body: Record<string, string>;
  }> = [
    {
      id: randomUUID(),
      path: 'about-us-legacy',
      status: 'published',
      body: { 'en-US': '<p>About us</p>', 'pl-PL': '<p>O nas</p>' },
    },
    {
      id: randomUUID(),
      path: 'policies/privacy-legacy',
      status: 'published',
      body: { 'en-US': '<p>Privacy</p>' },
    },
    {
      id: randomUUID(),
      path: 'contact-legacy',
      status: 'archived',
      body: { 'en-US': '<p>Contact</p>' },
    },
  ];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;

    const conn = h.em().getConnection();
    await conn.execute('truncate table cms_pages cascade');

    // Insert each row in its pre-migration shape: only the legacy
    // columns carry meaningful data; the new columns get their defaults
    // (slug='', name='', active=true, content empty envelope).
    for (const row of cases) {
      const now = new Date();
      await conn.execute(
        `insert into cms_pages
          (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
           name, slug, active, description, meta_title, meta_description, meta_keywords,
           content, languages, version)
         values (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?,
           '', '', true, null, null, null, null,
           '{"schema_version":1,"languages":{}}'::jsonb, '[]'::jsonb, 1)`,
        [
          row.id,
          row.path,
          row.status,
          JSON.stringify({ 'en-US': `Title for ${row.path}` }),
          JSON.stringify(row.body),
          row.status === 'published' ? now : null,
          row.status === 'archived' ? now : null,
          now,
          now,
        ],
      );
    }

    await runBackfill(conn);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('backfills slug, name, active and content for every legacy row', async () => {
    const rows = (await h.em().getConnection().execute(
      `select id::text, path, slug, name, active, languages, content
       from cms_pages
       order by path`,
    )) as Array<{
      id: string;
      path: string;
      slug: string;
      name: string;
      active: boolean;
      languages: string[];
      content: { schema_version: number; languages: Record<string, unknown> };
    }>;

    expect(rows.map((r) => r.slug).sort()).toEqual([
      'about-us-legacy',
      'contact-legacy',
      'policies/privacy-legacy',
    ]);
    for (const row of rows) {
      expect(row.slug, `slug for ${row.path}`).toBe(row.path);
      expect(row.name.length, `name for ${row.path}`).toBeGreaterThan(0);
      expect(row.content.schema_version).toBe(1);
      const expectedCase = cases.find((c) => c.path === row.path)!;
      expect(row.languages.sort()).toEqual(Object.keys(expectedCase.body).sort());
      expect(row.active).toBe(expectedCase.status === 'published');
    }
  });

  it('binds every backfilled row to the default sales channel via the join', async () => {
    const rows = (await h.em().getConnection().execute(
      `select cpsc.slug
       from cms_page_sales_channels cpsc
       where cpsc.sales_channel_id = ?
       order by cpsc.slug`,
      [defaultChannelId],
    )) as Array<{ slug: string }>;
    expect(rows.map((r) => r.slug)).toEqual([
      'about-us-legacy',
      'contact-legacy',
      'policies/privacy-legacy',
    ]);
  });

  it('serves a backfilled published row through the storefront by-slug endpoint', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-slug?slug=about-us-legacy&language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        slug: string;
        language: string;
        content: { data: { content: Array<{ type: string; props: Record<string, unknown> }> } };
      };
    };
    expect(body.data.slug).toBe('about-us-legacy');
    expect(body.data.language).toBe('en-US');
    const node = body.data.content.data.content[0];
    expect(node?.type).toBe('Text');
    expect(node?.props['tiptapHtml']).toBe('<p>About us</p>');
  });

  it('archived legacy row is active=false and 404s on the storefront', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-slug?slug=contact-legacy&language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    // Archived rows have status='archived' and active=false; either
    // condition rules them out of the storefront resolver.
    expect(res.statusCode).toBe(404);
  });

  it('re-running the backfill is a no-op (idempotent)', async () => {
    const conn = h.em().getConnection();
    const before = (await conn.execute(
      `select id::text, slug, name, active, content, languages
       from cms_pages
       order by slug`,
    )) as unknown[];

    // Run the backfill again; the WHERE clauses must guard against any
    // change. Run the channel-binding step too.
    await runBackfill(conn);
    await runBackfill(conn);

    const after = (await conn.execute(
      `select id::text, slug, name, active, content, languages
       from cms_pages
       order by slug`,
    )) as unknown[];
    expect(after).toEqual(before);

    // Channel bindings did not duplicate.
    const bindings = (await conn.execute(
      `select page_id::text, sales_channel_id::text, slug
       from cms_page_sales_channels
       order by slug`,
    )) as Array<{ page_id: string; sales_channel_id: string; slug: string }>;
    expect(bindings).toHaveLength(cases.length);
  });
});

/**
 * The exact backfill SQL from migration 035_cms_init.ts. Inlined here so
 * the test can simulate a partially-migrated state without re-running
 * migrations from scratch (which would also reset other tables and break
 * test isolation).
 */
async function runBackfill(conn: {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await conn.execute(`
    update "cms_pages"
    set
      "slug" = coalesce(nullif("slug", ''), "path"),
      "name" = coalesce(
        nullif("name", ''),
        coalesce(("title" ->> 'en-US')::text, '')
      ),
      "active" = case when "status" = 'published' then true else false end
    where "slug" = '' or "name" = '';
  `);

  await conn.execute(`
    update "cms_pages"
    set "content" = jsonb_build_object(
      'schema_version', 1,
      'languages', coalesce(
        (
          select jsonb_object_agg(
            k,
            jsonb_build_object(
              'root', '{}'::jsonb,
              'content', jsonb_build_array(
                jsonb_build_object(
                  'type', 'Text',
                  'props', jsonb_build_object(
                    'id', 'text-legacy-' || k,
                    'tiptapHtml', v
                  )
                )
              ),
              'zones', '{}'::jsonb
            )
          )
          from jsonb_each_text("body") as t(k, v)
          where v <> ''
        ),
        '{}'::jsonb
      )
    )
    where "content" = '{"schema_version":1,"languages":{}}'::jsonb
      and "body" <> '{}'::jsonb;
  `);

  await conn.execute(`
    update "cms_pages"
    set "languages" = coalesce(
      (
        select jsonb_agg(k)
        from jsonb_each_text("body") as t(k, v)
        where v <> ''
      ),
      '[]'::jsonb
    )
    where "languages" = '[]'::jsonb and "body" <> '{}'::jsonb;
  `);

  await conn.execute(`
    insert into "cms_page_sales_channels" ("page_id", "sales_channel_id", "slug")
    select p."id", c."id", p."slug"
    from "cms_pages" p
    cross join lateral (
      select "id" from "sales_channels" order by "created_at" asc limit 1
    ) c
    where not exists (
      select 1 from "cms_page_sales_channels" x where x."page_id" = p."id"
    );
  `);
}
