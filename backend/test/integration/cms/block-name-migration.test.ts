import { randomUUID } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FROZEN_BLOCK_RENAMES,
  FROZEN_BLOCK_RENAMES_INVERSE,
  applyRenameFunctionSql,
  createRenameFunctionSql,
  dropRenameFunctionSql,
} from '@endora-commerce/page-builder-core/migration';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 096, T401 — `contracts/block-name-migration.md` §8, against real
 * PostgreSQL.
 *
 * **What is exercised is the SQL the five migrations run**, not a re-implementation
 * of it: the statements come from `createRenameFunctionSql` /
 * `applyRenameFunctionSql` / `dropRenameFunctionSql`, which is what each
 * migration's `up()` and `down()` `addSql`s. The test database is already at
 * head, so the rows are seeded *after* the rename ran and the rewrite is then
 * applied to them — which is also, exactly, the second-run case FR-013 is
 * about.
 *
 * **The eleven columns are read off the migrations rather than listed here**
 * (D-100). A list would be a copy of a derived fact, and the failure it would
 * hide is the one that matters most: a migration naming a column that is not
 * there, or an owner forgetting one of its own.
 */

interface MigrationColumn {
  readonly module: string;
  readonly table: string;
  readonly column: string;
}

function declaredColumns(): MigrationColumn[] {
  const files = globSync('../../../../packages/modules/*/src/migrations/*_namespace_block_names.ts', {
    cwd: import.meta.dirname,
  });
  // `up()` and `down()` name the same columns, so the pairs are deduplicated:
  // the population is columns, not statements.
  const out = new Map<string, MigrationColumn>();
  for (const file of files) {
    const module = /modules\/([^/]+)\//.exec(file)![1]!;
    const source = readFileSync(new URL(file, `file://${import.meta.dirname}/`), 'utf8');
    for (const match of source.matchAll(
      /applyRenameFunctionSql\(FN, '([a-z_]+)', '([a-z_]+)'\)/g,
    )) {
      out.set(`${match[1]}.${match[2]}`, { module, table: match[1]!, column: match[2]! });
    }
  }
  return [...out.values()];
}

/** A pre-migration CMS tree carrying every shape §3 says the walk must handle. */
function preMigrationEnvelope(): unknown {
  return {
    schema_version: 1,
    languages: {
      'pl-PL': {
        root: { props: { title: 'Row of Rows' } },
        content: [
          {
            type: 'Row',
            props: {
              id: 'r1',
              gap: 8,
              // A slotted child two levels down — A7. The walk must not key on
              // `content` and `zones`.
              columns: [
                {
                  type: 'Column',
                  props: { id: 'c1', span: 6, inner: [{ type: 'Text', props: { id: 't1' } }] },
                },
              ],
            },
          },
          // A6 — a prop whose free text contains a renamed name.
          { type: 'RawHtml', props: { id: 'h1', html: '<p>Row Column Text</p>' } },
          // A4 — an unrecognised name.
          { type: 'NotAKnownBlock', props: { id: 'x1', keep: 'me' } },
          // A5 — an already-namespaced name.
          { type: 'cms.Hero', props: { id: 'hero' } },
          { type: 'ContentSlider', props: { id: 's1', slides: [{ type: 'Slide', props: {} }] } },
        ],
        zones: { 'r1:content': [{ type: 'Image', props: { id: 'i1', alt: 'A Row of Buttons' } }] },
      },
    },
  };
}

describe('block-name migration (feature 096, T401)', () => {
  let h: BackendServerHandle;
  const pageId = randomUUID();

  const applyUp = async (table: string, column: string): Promise<void> => {
    const em = h.em();
    await em.getConnection().execute(createRenameFunctionSql('t401_up', FROZEN_BLOCK_RENAMES));
    await em.getConnection().execute(applyRenameFunctionSql('t401_up', table, column));
    await em.getConnection().execute(dropRenameFunctionSql('t401_up'));
  };

  const applyDown = async (table: string, column: string): Promise<void> => {
    const em = h.em();
    await em
      .getConnection()
      .execute(createRenameFunctionSql('t401_down', FROZEN_BLOCK_RENAMES_INVERSE));
    await em.getConnection().execute(applyRenameFunctionSql('t401_down', table, column));
    await em.getConnection().execute(dropRenameFunctionSql('t401_down'));
  };

  const readPage = async (): Promise<Record<string, unknown>> => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ content: Record<string, unknown> }>>(
        `select content from cms_pages where id = '${pageId}'`,
      );
    return rows[0]!.content;
  };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    await h
      .em()
      .getConnection()
      .execute(
        `insert into cms_pages (id, path, status, name, slug, active, content, languages, version, created_at, updated_at)
         values ('${pageId}', 't401-${pageId}', 'draft', 'T401', 't401-${pageId}', true,
                 '${JSON.stringify(preMigrationEnvelope())}'::jsonb, '["pl-PL"]'::jsonb, 1, now(), now())`,
      );
  });

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from cms_pages where id = '${pageId}'`);
    await teardownBackendServer(h);
  });

  it('A1/A7 — renames every node type, including a slotted child, and touches no prop', async () => {
    await applyUp('cms_pages', 'content');
    const after = await readPage();
    const language = (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']!;
    const content = language['content'] as Array<Record<string, unknown>>;

    expect(content[0]!['type']).toBe('cms.Row');
    const columns = (content[0]!['props'] as Record<string, unknown>)['columns'] as Array<
      Record<string, unknown>
    >;
    expect(columns[0]!['type']).toBe('cms.Column');
    const inner = (columns[0]!['props'] as Record<string, unknown>)['inner'] as Array<
      Record<string, unknown>
    >;
    expect(inner[0]!['type']).toBe('cms.Text');
    expect(
      ((content[4]!['props'] as Record<string, unknown>)['slides'] as Array<
        Record<string, unknown>
      >)[0]!['type'],
    ).toBe('cms.Slide');
    expect(
      (language['zones'] as Record<string, Array<Record<string, unknown>>>)['r1:content']![0]![
        'type'
      ],
    ).toBe('cms.Image');
    expect(language['root']).toEqual({ props: { title: 'Row of Rows' } });
    expect(after['schema_version']).toBe(1);
  });

  it('A6 — a prop whose text contains a renamed name is byte-identical', async () => {
    const after = await readPage();
    const content = (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']![
      'content'
    ] as Array<Record<string, unknown>>;
    expect(content[1]!['type']).toBe('cms.RawHtml');
    expect(content[1]!['props']).toEqual({ id: 'h1', html: '<p>Row Column Text</p>' });
    const image = (
      (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']![
        'zones'
      ] as Record<string, Array<Record<string, unknown>>>
    )['r1:content']![0]!;
    expect((image['props'] as Record<string, unknown>)['alt']).toBe('A Row of Buttons');
  });

  it('A4 — an unrecognised name is left byte-identical while its siblings are renamed', async () => {
    const after = await readPage();
    const content = (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']![
      'content'
    ] as Array<Record<string, unknown>>;
    expect(content[2]!['type']).toBe('NotAKnownBlock');
    expect(content[2]!['props']).toEqual({ id: 'x1', keep: 'me' });
  });

  it('A5 — an already-namespaced name is untouched', async () => {
    const after = await readPage();
    const content = (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']![
      'content'
    ] as Array<Record<string, unknown>>;
    expect(content[3]!['type']).toBe('cms.Hero');
  });

  it('A3 — a second run renames nothing and leaves the column byte-identical', async () => {
    const before = JSON.stringify(await readPage());
    await applyUp('cms_pages', 'content');
    expect(JSON.stringify(await readPage())).toBe(before);
  });

  it('A8/A9 — down() restores the pre-migration column exactly, and leaves an inverse-less name alone', async () => {
    await applyDown('cms_pages', 'content');
    const after = await readPage();
    const content = (after['languages'] as Record<string, Record<string, unknown>>)['pl-PL']![
      'content'
    ] as Array<Record<string, unknown>>;
    // A8: every name the corresponding up() renamed is back.
    expect(content[0]!['type']).toBe('Row');
    expect(content[1]!['type']).toBe('RawHtml');
    // A9: a name with no inverse — the third party's shape — is left alone and
    // does not fail the run.
    expect(content[2]!['type']).toBe('NotAKnownBlock');
    // `cms.Hero` *does* have an inverse: it is in the codomain, so down() takes
    // it back to the vocabulary the reverted application renders. That is the
    // right answer for a down migration and is not the A9 case.
    expect(content[3]!['type']).toBe('Hero');
    // Restore the column to the migrated state the rest of the suite expects.
    await applyUp('cms_pages', 'content');
  });

  it('A12 — the single-language, envelope-less column is migrated correctly', async () => {
    const em = h.em();
    const emailId = randomUUID();
    const contentId = randomUUID();
    await em
      .getConnection()
      .execute(
        `insert into transactional_emails (id, code, name, owner_module, created_at, updated_at)
         values ('${emailId}', 't401_${emailId.slice(0, 8)}', 'T401', 'cms', now(), now())
         on conflict do nothing`,
      );
    await em.getConnection().execute(
      `insert into transactional_email_contents (id, email_id, language, subject, content, version, created_at, updated_at)
         values ('${contentId}', '${emailId}', 'pl-PL', 'T401',
                 '${JSON.stringify({ content: [{ type: 'EmailHeading', props: { id: 'h' } }] })}'::jsonb,
                 1, now(), now())`,
    );
    try {
      await applyUp('transactional_email_contents', 'content');
      const rows = await em
        .getConnection()
        .execute<Array<{ content: { content: Array<{ type: string }> } }>>(
          `select content from transactional_email_contents where id = '${contentId}'`,
        );
      expect(rows[0]!.content.content[0]!.type).toBe('transactional_emails.EmailHeading');
    } finally {
      await em
        .getConnection()
        .execute(`delete from transactional_email_contents where id = '${contentId}'`);
      await em.getConnection().execute(`delete from transactional_emails where id = '${emailId}'`);
    }
  });

  it('names eleven real jsonb columns across five modules', async () => {
    const columns = declaredColumns();
    expect(columns).toHaveLength(11);
    expect(new Set(columns.map((c) => c.module))).toEqual(
      new Set(['cms', 'blog', 'transactional_emails', 'newsletter', 'invoices']),
    );
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ table_name: string; column_name: string; data_type: string }>>(
        `select table_name, column_name, data_type from information_schema.columns
           where table_schema = 'public'`,
      );
    const jsonb = new Set(
      rows.filter((r) => r.data_type === 'jsonb').map((r) => `${r.table_name}.${r.column_name}`),
    );
    for (const { table, column } of columns) {
      expect(jsonb.has(`${table}.${column}`), `${table}.${column} is a jsonb column`).toBe(true);
    }
  });
});
