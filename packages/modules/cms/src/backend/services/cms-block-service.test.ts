import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { CmsBlockService } from './cms-block-service.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';

/**
 * Constitution XIII, held without a database: every Block write is issued as a
 * named Command, and its write statements run on the Command's EntityManager —
 * the one the audit entry is recorded on — and never on one the service opened
 * for itself. That second half is the property an audit entry depends on: a
 * statement on any other manager commits apart from the entry beside it.
 *
 * What the entry *contains* once it reaches the audit table is the contract
 * suite's question (`backend/test/contract/cms/admin-blocks.contract.test.ts`),
 * which needs a live Postgres. This file is the half that runs wherever the
 * package's own tests run.
 */

const BLOCK_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

function blockRow(): Record<string, unknown> {
  return {
    id: BLOCK_ID,
    name: 'Footer note',
    code: 'footer-note',
    active: true,
    description: null,
    content: { languages: {} },
    languages: ['en-US'],
    version: 3,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** An EntityManager that answers the service's reads and remembers its writes. */
function fakeEm(options: { blockExists: boolean }): { em: EntityManager; writes: string[] } {
  const writes: string[] = [];
  const em = {
    execute: async (sql: string): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        return [];
      }
      if (/^\s*select \* from cms_blocks/i.test(sql)) return options.blockExists ? [blockRow()] : [];
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      return [];
    },
  };
  return { em: em as unknown as EntityManager, writes };
}

function harness(options: { blockExists?: boolean } = {}) {
  const blockExists = options.blockExists ?? true;
  const ambient = fakeEm({ blockExists });
  const transactional = fakeEm({ blockExists });
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

  const references = {
    findBlockReferences: async () => [],
  } as unknown as CmsReferenceRegistry;

  const service = new CmsBlockService(() => ambient.em, commandBus, () => [], references);
  return { service, commands, outcomes, ambient, transactional };
}

describe('CmsBlockService — every write is a Command', () => {
  it('creates a block as `cms_block.create`, on the Command manager', async () => {
    const h = harness();

    const block = await h.service.create({
      name: 'Footer note',
      code: 'footer-note',
      salesChannelIds: [CHANNEL_ID],
      languages: ['en-US'],
    });

    expect(h.commands).toEqual([
      { action: 'cms_block.create', objectType: 'cms_block', objectId: expect.any(String) },
    ]);
    expect(h.transactional.writes).toContain('insert into cms_blocks');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    expect(h.outcomes[0]?.after).toMatchObject({ code: 'footer-note', salesChannelIds: [CHANNEL_ID] });
    expect(block.code).toBe('footer-note');
  });

  it('updates a block as `cms_block.update`, with the state on both sides', async () => {
    const h = harness();

    await h.service.patch(BLOCK_ID, { name: 'Footer', version: 3 });

    expect(h.commands).toEqual([
      { action: 'cms_block.update', objectType: 'cms_block', objectId: BLOCK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_blocks set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ name: 'Footer note', version: 3 });
    expect(h.outcomes[0]?.after).not.toBeNull();
  });

  it('asks for no audit entry when a patch names no field', async () => {
    const h = harness();

    await h.service.patch(BLOCK_ID, { version: 3 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });

  it('saves content as `cms_block.set_content`, recording the language and not the tree', async () => {
    const h = harness();
    const tree = { root: { props: {} }, content: [{ type: 'cms.Heading', props: { text: 'Hi' } }] };

    await h.service.setContent(BLOCK_ID, 'en-US', tree, 3);

    expect(h.commands).toEqual([
      { action: 'cms_block.set_content', objectType: 'cms_block', objectId: BLOCK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_blocks set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ language: 'en-US', version: 3 });
    expect(h.outcomes[0]?.after).toEqual({ language: 'en-US', version: 4 });
  });

  it('deletes a block as `cms_block.delete`, keeping what the block was', async () => {
    const h = harness();

    await h.service.delete(BLOCK_ID);

    expect(h.commands).toEqual([
      { action: 'cms_block.delete', objectType: 'cms_block', objectId: BLOCK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['delete from cms_blocks']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ code: 'footer-note', version: 3 });
    expect(h.outcomes[0]?.after).toBeNull();
  });

  it('refuses to delete a block that is not there, before any Command runs', async () => {
    const h = harness({ blockExists: false });

    await expect(h.service.delete(BLOCK_ID)).rejects.toMatchObject({ statusCode: 404 });

    expect(h.commands).toEqual([]);
    expect(h.transactional.writes).toEqual([]);
    expect(h.ambient.writes).toEqual([]);
  });
});
