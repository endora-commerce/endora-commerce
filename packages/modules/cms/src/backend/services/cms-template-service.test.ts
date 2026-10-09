import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { CmsTemplateService } from './cms-template-service.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';

/**
 * Constitution XIII, held without a database: every Template write is issued as a
 * named Command, and its write statements run on the Command's EntityManager —
 * the one the audit entry is recorded on — and never on one the service opened
 * for itself. That second half is the property an audit entry depends on: a
 * statement on any other manager commits apart from the entry beside it.
 *
 * What the entry *contains* once it reaches the audit table is the contract
 * suite's question (`backend/test/contract/cms/admin-templates.contract.test.ts`),
 * which needs a live Postgres. This file is the half that runs wherever the
 * package's own tests run.
 */

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

function templateRow(): Record<string, unknown> {
  return {
    id: TEMPLATE_ID,
    name: 'Two columns',
    code: 'two-columns',
    description: null,
    content: { languages: {} },
    languages: ['en-US'],
    version: 3,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** An EntityManager that answers the service's reads and remembers its writes. */
function fakeEm(options: { templateExists: boolean }): { em: EntityManager; writes: string[] } {
  const writes: string[] = [];
  const em = {
    execute: async (sql: string): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        return [];
      }
      if (/^\s*select \* from cms_templates/i.test(sql)) return options.templateExists ? [templateRow()] : [];
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      return [];
    },
  };
  return { em: em as unknown as EntityManager, writes };
}

function harness(options: { templateExists?: boolean } = {}) {
  const templateExists = options.templateExists ?? true;
  const ambient = fakeEm({ templateExists });
  const transactional = fakeEm({ templateExists });
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
    findTemplateReferences: async () => [],
  } as unknown as CmsReferenceRegistry;

  const service = new CmsTemplateService(() => ambient.em, commandBus, () => [], references);
  return { service, commands, outcomes, ambient, transactional };
}

describe('CmsTemplateService — every write is a Command', () => {
  it('creates a template as `cms_template.create`, on the Command manager', async () => {
    const h = harness();

    const template = await h.service.create({
      name: 'Two columns',
      code: 'two-columns',
      salesChannelIds: [CHANNEL_ID],
      languages: ['en-US'],
    });

    expect(h.commands).toEqual([
      { action: 'cms_template.create', objectType: 'cms_template', objectId: expect.any(String) },
    ]);
    expect(h.transactional.writes).toContain('insert into cms_templates');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    expect(h.outcomes[0]?.after).toMatchObject({ code: 'two-columns', salesChannelIds: [CHANNEL_ID] });
    expect(template.code).toBe('two-columns');
  });

  it('updates a template as `cms_template.update`, with the state on both sides', async () => {
    const h = harness();

    await h.service.patch(TEMPLATE_ID, { name: 'Columns', version: 3 });

    expect(h.commands).toEqual([
      { action: 'cms_template.update', objectType: 'cms_template', objectId: TEMPLATE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_templates set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ name: 'Two columns', version: 3 });
    expect(h.outcomes[0]?.after).not.toBeNull();
  });

  it('asks for no audit entry when a patch names no field', async () => {
    const h = harness();

    await h.service.patch(TEMPLATE_ID, { version: 3 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.outcomes[0]?.skipAudit).toBe(true);
  });

  it('saves content as `cms_template.set_content`, recording the language and not the tree', async () => {
    const h = harness();
    const tree = { root: { props: {} }, content: [{ type: 'cms.Heading', props: { text: 'Hi' } }] };

    await h.service.setContent(TEMPLATE_ID, 'en-US', tree, 3);

    expect(h.commands).toEqual([
      { action: 'cms_template.set_content', objectType: 'cms_template', objectId: TEMPLATE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_templates set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toEqual({ language: 'en-US', version: 3 });
    expect(h.outcomes[0]?.after).toEqual({ language: 'en-US', version: 4 });
  });

  it('deletes a template as `cms_template.delete`, keeping what the template was', async () => {
    const h = harness();

    await h.service.delete(TEMPLATE_ID);

    expect(h.commands).toEqual([
      { action: 'cms_template.delete', objectType: 'cms_template', objectId: TEMPLATE_ID },
    ]);
    expect(h.transactional.writes).toEqual(['delete from cms_templates']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ code: 'two-columns', version: 3 });
    expect(h.outcomes[0]?.after).toBeNull();
  });

  it('refuses to delete a template that is not there, before any Command runs', async () => {
    const h = harness({ templateExists: false });

    await expect(h.service.delete(TEMPLATE_ID)).rejects.toMatchObject({ statusCode: 404 });

    expect(h.commands).toEqual([]);
    expect(h.transactional.writes).toEqual([]);
    expect(h.ambient.writes).toEqual([]);
  });
});
