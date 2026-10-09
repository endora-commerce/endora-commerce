import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { CmsHookService } from './cms-hook-service.js';

/**
 * Constitution XIII, held without a database: every Hook write — the hook's own
 * row and the blocks attached to it — is issued as a named Command, and its
 * write statements run on the Command's EntityManager — the one the audit entry
 * is recorded on — and never on one the service opened for itself. That second
 * half is the property an audit entry depends on: a statement on any other
 * manager commits apart from the entry beside it.
 *
 * What the entry *contains* once it reaches the audit table is the contract
 * suite's question (`backend/test/contract/cms/admin-hooks.contract.test.ts`),
 * which needs a live Postgres. This file is the half that runs wherever the
 * package's own tests run.
 */

const HOOK_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const BLOCK_ID = '33333333-3333-4333-8333-333333333333';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

interface FakeOptions {
  hookExists: boolean;
  isSystem: boolean;
  attached: boolean;
}

function hookRow(isSystem: boolean): Record<string, unknown> {
  return {
    id: HOOK_ID,
    name: 'Homepage top',
    code: 'homepage.top',
    active: true,
    description: null,
    is_system: isSystem,
    version: 3,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    attachment_count: 0,
  };
}

/** An EntityManager that answers the service's reads and remembers its writes. */
function fakeEm(options: FakeOptions): { em: EntityManager; writes: string[] } {
  const writes: string[] = [];
  const em = {
    execute: async (sql: string): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        return [];
      }
      if (/^\s*select h\.\*/i.test(sql)) return options.hookExists ? [hookRow(options.isSystem)] : [];
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      if (/^\s*select id from cms_blocks/i.test(sql)) return [{ id: BLOCK_ID }];
      if (/^\s*select position from cms_hook_block_attachments/i.test(sql)) {
        return options.attached ? [{ position: 10 }] : [];
      }
      return [];
    },
  };
  return { em: em as unknown as EntityManager, writes };
}

function harness(overrides: Partial<FakeOptions> = {}) {
  const options: FakeOptions = { hookExists: true, isSystem: false, attached: true, ...overrides };
  const ambient = fakeEm(options);
  const transactional = fakeEm(options);
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

  const service = new CmsHookService(() => ambient.em, commandBus);
  return { service, commands, outcomes, ambient, transactional };
}

describe('CmsHookService — every write is a Command', () => {
  it('creates a hook as `cms_hook.create`, on the Command manager', async () => {
    const h = harness();

    const hook = await h.service.create({
      name: 'Homepage top',
      code: 'homepage.top',
      salesChannelIds: [CHANNEL_ID],
    });

    expect(h.commands).toEqual([
      { action: 'cms_hook.create', objectType: 'cms_hook', objectId: expect.any(String) },
    ]);
    expect(h.transactional.writes).toContain('insert into cms_hooks');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    expect(h.outcomes[0]?.after).toMatchObject({ code: 'homepage.top', salesChannelIds: [CHANNEL_ID] });
    expect(hook.code).toBe('homepage.top');
  });

  it('updates a hook as `cms_hook.update`, with the state on both sides', async () => {
    const h = harness();

    await h.service.patch(HOOK_ID, { name: 'Top of the homepage', version: 3 });

    expect(h.commands).toEqual([
      { action: 'cms_hook.update', objectType: 'cms_hook', objectId: HOOK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_hooks set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ name: 'Homepage top', version: 3 });
    expect(h.outcomes[0]?.after).not.toBeNull();
  });

  it('asks for no audit entry when a patch names no field', async () => {
    const h = harness();

    await h.service.patch(HOOK_ID, { version: 3 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });

  it('deletes a hook as `cms_hook.delete`, keeping what the hook was', async () => {
    const h = harness();

    await h.service.delete(HOOK_ID);

    expect(h.commands).toEqual([
      { action: 'cms_hook.delete', objectType: 'cms_hook', objectId: HOOK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['delete from cms_hooks']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ code: 'homepage.top', isSystem: false });
    expect(h.outcomes[0]?.after).toBeNull();
  });

  it('refuses to delete a system hook and writes nothing', async () => {
    const h = harness({ isSystem: true });

    await expect(h.service.delete(HOOK_ID)).rejects.toMatchObject({ statusCode: 409 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes).toEqual([]);
  });

  it('attaches a block as `cms_hook.attach_block`, naming the block and its position', async () => {
    const h = harness({ attached: false });

    await h.service.addAttachment(HOOK_ID, BLOCK_ID, 20);

    expect(h.commands).toEqual([
      { action: 'cms_hook.attach_block', objectType: 'cms_hook', objectId: HOOK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['insert into cms_hook_block_attachments']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    expect(h.outcomes[0]?.after).toEqual({ blockId: BLOCK_ID, position: 20 });
  });

  it('reorders a block as `cms_hook.reorder_block`, with the position on both sides', async () => {
    const h = harness();

    await h.service.reorderAttachment(HOOK_ID, BLOCK_ID, 20);

    expect(h.commands).toEqual([
      { action: 'cms_hook.reorder_block', objectType: 'cms_hook', objectId: HOOK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_hook_block_attachments set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ blockId: BLOCK_ID, position: 10 });
    expect(h.outcomes[0]?.after).toEqual({ blockId: BLOCK_ID, position: 20 });
  });

  it('detaches a block as `cms_hook.detach_block`, keeping where it was', async () => {
    const h = harness();

    await h.service.removeAttachment(HOOK_ID, BLOCK_ID);

    expect(h.commands).toEqual([
      { action: 'cms_hook.detach_block', objectType: 'cms_hook', objectId: HOOK_ID },
    ]);
    expect(h.transactional.writes).toEqual(['delete from cms_hook_block_attachments']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ blockId: BLOCK_ID, position: 10 });
    expect(h.outcomes[0]?.after).toBeNull();
  });

  it('asks for no audit entry when the block to detach was not attached', async () => {
    const h = harness({ attached: false });

    await expect(h.service.removeAttachment(HOOK_ID, BLOCK_ID)).resolves.toBeUndefined();

    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });
});
