import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { CmsPageService } from './cms-page-service.js';

/**
 * Constitution XIII, held without a database: every Page write is issued as a
 * named Command, and its write statements run on the Command's EntityManager —
 * the one the audit entry is recorded on — and never on one the service opened
 * for itself. That second half is the property an audit entry depends on: a
 * statement on any other manager commits apart from the entry beside it.
 *
 * What the entry *contains* once it reaches the audit table is the contract
 * suite's question (`backend/test/contract/cms/admin-pages.contract.test.ts`),
 * which needs a live Postgres. This file is the half that runs wherever the
 * package's own tests run.
 */

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

function pageRow(): Record<string, unknown> {
  return {
    id: PAGE_ID,
    name: 'About us',
    slug: 'about-us',
    status: 'draft',
    active: true,
    description: null,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    content: { languages: {} },
    languages: ['en-US'],
    version: 3,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** An EntityManager that answers the service's reads and remembers its writes. */
function fakeEm(options: { pageExists: boolean }): { em: EntityManager; writes: string[] } {
  const writes: string[] = [];
  const em = {
    execute: async (sql: string): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        return [];
      }
      if (/^\s*select \* from cms_pages/i.test(sql)) return options.pageExists ? [pageRow()] : [];
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      if (/^\s*select slug from/i.test(sql)) return [{ slug: 'about-us' }];
      return [];
    },
    find: async (): Promise<unknown[]> => [{ languages: ['en-US'], defaultLanguage: 'en-US' }],
  };
  return { em: em as unknown as EntityManager, writes };
}

function harness(options: { pageExists?: boolean } = {}) {
  const pageExists = options.pageExists ?? true;
  const ambient = fakeEm({ pageExists });
  const transactional = fakeEm({ pageExists });
  const commands: Array<{ action: string; objectType: string; objectId: string }> = [];
  const outcomes: Array<{ before?: unknown; after?: unknown; skipAudit?: boolean | undefined }> = [];

  const commandBus = {
    run: async <T>(command: Command<T>): Promise<T> => {
      commands.push({
        action: command.action,
        objectType: command.objectType,
        objectId: command.objectId,
      });
      const outcome = await command.run({
        em: transactional.em,
        actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
      });
      outcomes.push({ before: outcome.before, after: outcome.after, skipAudit: outcome.skipAudit });
      return outcome.result;
    },
  } as unknown as CommandBus;

  const service = new CmsPageService(() => ambient.em, commandBus, () => []);
  return { service, commands, outcomes, ambient, transactional };
}

describe('CmsPageService — every write is a Command', () => {
  it('creates a page as `cms_page.create`, on the Command manager', async () => {
    const h = harness();

    const page = await h.service.create({
      name: 'About us',
      slug: 'about-us',
      salesChannelIds: [CHANNEL_ID],
      languages: ['en-US'],
    });

    expect(h.commands).toEqual([
      { action: 'cms_page.create', objectType: 'cms_page', objectId: expect.any(String) },
    ]);
    expect(h.transactional.writes).toContain('insert into cms_pages');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    expect(h.outcomes[0]?.after).toMatchObject({ slug: 'about-us', salesChannelIds: [CHANNEL_ID] });
    expect(page.slug).toBe('about-us');
  });

  it('updates a page as `cms_page.update`, with the state on both sides', async () => {
    const h = harness();

    await h.service.patch(PAGE_ID, { name: 'About', version: 3 });

    expect(h.commands).toEqual([
      { action: 'cms_page.update', objectType: 'cms_page', objectId: PAGE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_pages set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ name: 'About us', version: 3 });
    expect(h.outcomes[0]?.after).not.toBeNull();
  });

  it('asks for no audit entry when a patch names no field', async () => {
    const h = harness();

    await h.service.patch(PAGE_ID, { version: 3 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });

  it('saves content as `cms_page.set_content`, recording the language and not the tree', async () => {
    const h = harness();
    const tree = { root: { props: {} }, content: [{ type: 'cms.Heading', props: { text: 'Hi' } }] };

    await h.service.setContent(PAGE_ID, 'en-US', tree, 3);

    expect(h.commands).toEqual([
      { action: 'cms_page.set_content', objectType: 'cms_page', objectId: PAGE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_pages set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ language: 'en-US', version: 3 });
    expect(h.outcomes[0]?.after).toEqual({ language: 'en-US', version: 4 });
  });

  it.each([
    ['publish', 'cms_page.publish', 'published'],
    ['archive', 'cms_page.archive', 'archived'],
    ['unarchive', 'cms_page.unarchive', 'draft'],
  ] as const)('runs %s as `%s`', async (method, action, status) => {
    const h = harness();

    await h.service[method](PAGE_ID);

    expect(h.commands).toEqual([{ action, objectType: 'cms_page', objectId: PAGE_ID }]);
    expect(h.transactional.writes).toEqual(['update cms_pages set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ status: 'draft', version: 3 });
    expect(h.outcomes[0]?.after).toEqual({ status, version: 4 });
  });

  it('deletes a page as `cms_page.delete`, keeping what the page was', async () => {
    const h = harness();

    await h.service.delete(PAGE_ID);

    expect(h.commands).toEqual([
      { action: 'cms_page.delete', objectType: 'cms_page', objectId: PAGE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['delete from cms_pages']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ slug: 'about-us', status: 'draft' });
    expect(h.outcomes[0]?.after).toBeNull();
  });

  it('asks for no audit entry when the page to delete is not there', async () => {
    const h = harness({ pageExists: false });

    await expect(h.service.delete(PAGE_ID)).resolves.toBeUndefined();

    expect(h.transactional.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });
});
