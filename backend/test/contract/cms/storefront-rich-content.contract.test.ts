import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

const richDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Published rich content body' }],
    },
  ],
};

describe('storefront CMS rich content contract', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    defaultChannel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('returns RichContent props with non-empty tiptap content after publish', async () => {
    const id = randomUUID();
    const slug = `rich-content-${Date.now()}`;
    const now = new Date();
    const tree = {
      root: { props: {} },
      content: [
        {
          type: 'RichContent',
          props: {
            id: 'rich-1',
            content: richDoc,
            html: '<p>Published rich content body</p>',
          },
        },
      ],
    };

    await h.em().getConnection().execute(
      `insert into cms_pages
        (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
         name, slug, active, description, meta_title, meta_description, meta_keywords,
         content, languages, version)
       values (?, ?, 'published', ?::jsonb, ?::jsonb, ?, null, ?, ?, ?, ?, true, null,
         ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
      [
        id,
        `${slug}-${id.slice(0, 8)}`,
        JSON.stringify({ 'en-US': `Title ${slug}` }),
        JSON.stringify({ 'en-US': '<p>Legacy body</p>' }),
        now,
        now,
        now,
        `Page ${slug}`,
        slug,
        JSON.stringify({ 'en-US': `Meta ${slug}` }),
        JSON.stringify({ 'en-US': `Description ${slug}` }),
        JSON.stringify({ 'en-US': 'cms,rich' }),
        JSON.stringify({ schema_version: 1, languages: { 'en-US': tree } }),
        JSON.stringify(['en-US']),
      ],
    );

    await h.em().getConnection().execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, defaultChannel.id, slug],
    );

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: {
        'x-sales-channel': defaultChannel.code,
        'accept-language': 'en-US',
      },
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json() as {
      data: { content: { data: { content: Array<{ type: string; props: Record<string, unknown> }> } } };
    };
    const rich = payload.data.content.data.content.find((item) => item.type === 'RichContent');
    expect(rich).toBeTruthy();
    expect(rich?.props.content).toBeTruthy();
    expect(rich?.props.html).toBeTruthy();
  });
});
