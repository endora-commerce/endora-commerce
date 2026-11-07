import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BlockDefinition } from '@endora-commerce/contracts';
import { resolveTextContent } from '@endora-commerce/cms-components/components/text-content';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, T104 — every seeded CMS row renders
 * (`specs/163-page-builder-marketing-pages/` FR-041, SC-007).
 *
 * The population is the rows of `cms_blocks`, `cms_pages` and
 * `cms_templates` the platform writes by itself. On the harness that is what
 * the boot seeders write: the `cms` migrations seed hooks only, the predefined
 * blocks (`newsletter_consent`, `cookieconsent.message`) are boot-time seeds of
 * `newsletter` and `google_analytics` through `cmsBlockSeedPort`, and the demo
 * composition writes no CMS content.
 *
 * The blocks are read **by those codes**, not as the whole table (issue #678):
 * the database is the invocation's, not the file's, so a block another file
 * created and left behind is in `cms_blocks` too, and judging it here made
 * this file's verdict depend on which files ran before it. A seeder that adds
 * a block adds its code to {@link SEEDED_BLOCK_CODES}. Pages and templates are
 * still read whole: the harness seeds none, so there are no keys to read them
 * by. The same
 * sequence on a real database (`db:reset`: `setup` then `cli demo seed`) is
 * T104's second half, run on a throwaway database and recorded in `tasks.md`.
 *
 * Three properties, per row:
 * - it resolves through the storefront route that serves it — a block by code,
 *   a page by slug — on every channel it is bound to and in every language it
 *   declares; a template, which no storefront route serves by itself, through a
 *   per-run page that embeds it (`cms.InsertTemplate`);
 * - every node in every language tree is a block name some registered manifest
 *   declares, so nothing seeded degrades to the missing-block placeholder;
 * - the two consent blocks render their text: `resolveTextContent` is what
 *   `cms.Text`'s published render prints, and the storefront renders both
 *   blocks through it (`NewsletterConsent`, `CookieConsentMessage`).
 *
 * Postgres-backed; the template probe pages are per-run (`pb163_…`) and removed
 * in `afterAll`.
 */

type Tree = { content?: unknown; zones?: unknown };
type Envelope = { languages?: Record<string, Tree> };
type Row = { id: string; code: string; languages: string[]; content: Envelope };
type Binding = { row_id: string; channel_code: string; address: string };

const CONSENT_BLOCKS: ReadonlyArray<{ code: string; text: Record<string, string> }> = [
  {
    code: 'newsletter_consent',
    text: {
      'en-US': 'I would like to receive the newsletter',
      'pl-PL': 'Tak, chcę otrzymywać newsletter',
    },
  },
  {
    code: 'cookieconsent.message',
    text: {
      'en-US': 'We use cookies for analytics',
      'pl-PL': 'Używamy plików cookie do analityki',
    },
  },
];

/** The codes of every block the boot seeders write — the block half of the population. */
const SEEDED_BLOCK_CODES: readonly string[] = CONSENT_BLOCKS.map((block) => block.code);

/** Every page-builder node in a tree: an object carrying a string `type` and an object `props`. */
function nodesOf(tree: unknown, acc: Array<{ type: string; props: Record<string, unknown> }> = []) {
  if (Array.isArray(tree)) {
    for (const item of tree) nodesOf(item, acc);
    return acc;
  }
  if (tree === null || typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  if (typeof obj['type'] === 'string' && obj['props'] !== null && typeof obj['props'] === 'object') {
    acc.push({ type: obj['type'], props: obj['props'] as Record<string, unknown> });
  }
  for (const value of Object.values(obj)) nodesOf(value, acc);
  return acc;
}

describe('seeded CMS content renders (T104, FR-041, SC-007)', () => {
  let h: BackendServerHandle;
  let blocks: Row[];
  let pages: Row[];
  let templates: Row[];
  let blockBindings: Binding[];
  let pageBindings: Binding[];
  let templateBindings: Binding[];
  const probePageIds: string[] = [];

  const declared = new Set(
    REGISTERED_MANIFESTS.flatMap((entry) =>
      ((entry.manifest.blocks ?? []) as BlockDefinition[]).map((block) => block.name),
    ),
  );

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const connection = h.em().getConnection();
    blocks = await connection.execute<Row[]>(
      `select id, code, languages, content from cms_blocks
       where code in (${SEEDED_BLOCK_CODES.map(() => '?').join(', ')}) order by code`,
      [...SEEDED_BLOCK_CODES],
    );
    pages = await connection.execute<Row[]>(`select id, slug as code, languages, content from cms_pages order by slug`);
    templates = await connection.execute<Row[]>(`select id, code, languages, content from cms_templates order by code`);
    blockBindings = await connection.execute<Binding[]>(
      `select b.block_id as row_id, c.code as channel_code, b.code as address
       from cms_block_sales_channels b join sales_channels c on c.id = b.sales_channel_id`,
    );
    pageBindings = await connection.execute<Binding[]>(
      `select b.page_id as row_id, c.code as channel_code, b.slug as address
       from cms_page_sales_channels b join sales_channels c on c.id = b.sales_channel_id`,
    );
    templateBindings = await connection.execute<Binding[]>(
      `select b.template_id as row_id, c.code as channel_code, b.code as address
       from cms_template_sales_channels b join sales_channels c on c.id = b.sales_channel_id`,
    );
  });

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      for (const id of probePageIds) {
        await connection.execute(`delete from cms_page_sales_channels where page_id = ?`, [id]);
        await connection.execute(`delete from cms_pages where id = ?`, [id]);
      }
      await teardownBackendServer(h);
    }
  });

  it('the population holds the two seeded consent blocks, so the walk below is not over nothing', () => {
    const codes = blocks.map((row) => row.code);
    for (const consent of CONSENT_BLOCKS) expect(codes).toContain(consent.code);
  });

  it('every node of every seeded block, page and template is a declared block name', () => {
    const undeclared: string[] = [];
    for (const [table, rows] of [
      ['cms_blocks', blocks],
      ['cms_pages', pages],
      ['cms_templates', templates],
    ] as const) {
      for (const row of rows) {
        for (const [language, tree] of Object.entries(row.content.languages ?? {})) {
          for (const node of nodesOf(tree)) {
            if (!declared.has(node.type)) undeclared.push(`${table} ${row.code} ${language}: ${node.type}`);
          }
        }
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('every seeded block resolves by code on every channel it is bound to, in every language it declares', async () => {
    const failures: string[] = [];
    for (const row of blocks) {
      const bindings = blockBindings.filter((binding) => binding.row_id === row.id);
      if (bindings.length === 0) failures.push(`${row.code}: bound to no channel`);
      for (const binding of bindings) {
        for (const language of row.languages) {
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(binding.address)}&language=${language}`,
            headers: { 'x-sales-channel': binding.channel_code },
          });
          const data = res.statusCode === 200 ? (res.json() as { data: { id: string; language: string } }).data : null;
          if (data?.id !== row.id || data.language !== language) {
            failures.push(`${row.code} @${binding.channel_code}/${language}: ${res.statusCode}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every seeded page resolves by slug on every channel it is bound to, in every language it declares', async () => {
    const failures: string[] = [];
    for (const row of pages) {
      const bindings = pageBindings.filter((binding) => binding.row_id === row.id);
      if (bindings.length === 0) failures.push(`${row.code}: bound to no channel`);
      for (const binding of bindings) {
        for (const language of row.languages) {
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(binding.address)}&language=${language}`,
            headers: { 'x-sales-channel': binding.channel_code },
          });
          const data = res.statusCode === 200 ? (res.json() as { data: { id: string; language: string } }).data : null;
          if (data?.id !== row.id || data.language !== language) {
            failures.push(`${row.code} @${binding.channel_code}/${language}: ${res.statusCode}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every seeded template resolves as an embed of a page on every channel it is bound to', async () => {
    const failures: string[] = [];
    const connection = h.em().getConnection();
    const channels = await h.em().find(SalesChannel, {});
    for (const row of templates) {
      const bindings = templateBindings.filter((binding) => binding.row_id === row.id);
      if (bindings.length === 0) failures.push(`${row.code}: bound to no channel`);
      for (const binding of bindings) {
        const channel = channels.find((candidate) => candidate.code === binding.channel_code)!;
        for (const language of row.languages) {
          const slug = `pb163_${randomUUID().slice(0, 8)}`;
          const pageId = randomUUID();
          probePageIds.push(pageId);
          const tree = {
            root: { props: {} },
            content: [{ type: 'cms.InsertTemplate', props: { id: 'probe', code: binding.address } }],
          };
          const now = new Date();
          await connection.execute(
            `insert into cms_pages
              (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
               name, slug, active, description, meta_title, meta_description, meta_keywords,
               content, languages, version)
             values (?, ?, 'published', ?::jsonb, ?::jsonb, ?, null, ?, ?, ?, ?, true, null,
               ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
            [
              pageId,
              slug,
              JSON.stringify({ [language]: slug }),
              JSON.stringify({ [language]: '' }),
              now,
              now,
              now,
              slug,
              slug,
              JSON.stringify({ [language]: slug }),
              JSON.stringify({ [language]: '' }),
              JSON.stringify({ [language]: '' }),
              JSON.stringify({ schema_version: 1, languages: { [language]: tree } }),
              JSON.stringify([language]),
            ],
          );
          await connection.execute(
            `insert into cms_page_sales_channels (page_id, sales_channel_id, slug) values (?, ?, ?)`,
            [pageId, channel.id, slug],
          );
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/cms/pages/by-slug?slug=${slug}&language=${language}`,
            headers: { 'x-sales-channel': binding.channel_code },
          });
          const embedded =
            res.statusCode === 200
              ? (res.json() as { data: { embeds: { templates: Record<string, { id: string }> } } }).data.embeds
                  .templates[binding.address]
              : undefined;
          if (embedded?.id !== row.id) {
            failures.push(`${row.code} @${binding.channel_code}/${language}: ${res.statusCode}, embedded ${String(embedded?.id)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('the two consent blocks render their text in both seeded languages', async () => {
    for (const consent of CONSENT_BLOCKS) {
      for (const [language, expected] of Object.entries(consent.text)) {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(consent.code)}&language=${language}`,
        });
        expect(res.statusCode, `${consent.code} ${language}`).toBe(200);
        const data = (res.json() as { data: { language: string; content: { data: unknown } } }).data;
        expect(data.language).toBe(language);
        const nodes = nodesOf(data.content.data);
        expect(nodes.map((node) => node.type)).toEqual(['cms.Text']);
        const rendered = resolveTextContent(nodes[0]!.props);
        expect(rendered, `${consent.code} ${language}`).toContain(expected);
        expect(rendered).not.toMatch(/<[a-z/]/i);
      }
    }
  });
});
