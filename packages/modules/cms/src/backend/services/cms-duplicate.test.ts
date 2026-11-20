import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { CmsPageService } from './cms-page-service.js';
import { CmsBlockService } from './cms-block-service.js';
import { CmsTemplateService } from './cms-template-service.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import type { CmsContentInvalidator } from './cms-content-invalidator.js';

/**
 * Issue #1495 (UX audit CONTENT-13, DEC-17) — Duplicate of a CMS page, block
 * or template, held without a database: one Command per copy, named
 * `cms_<kind>.duplicate`, audited against the **copy's** id with no state
 * before it and no content tree after it, its writes on the Command's manager,
 * and the storefront cache invalidated only once the Command has returned.
 *
 * What the copy holds once it is in Postgres — every copied column, the
 * channel rows, the rollback of a refusal, two duplicates at once — is
 * `backend/test/integration/cms/duplicate.test.ts`'s question.
 */

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

const tree = { root: { props: {} }, content: [{ type: 'cms.Heading', props: { text: 'Hi', id: 'h-1' } }] };

function pageRow(): Record<string, unknown> {
  return {
    id: SOURCE_ID,
    name: 'About us',
    slug: 'about-us',
    status: 'published',
    active: true,
    description: 'Who we are',
    meta_title: { 'en-US': 'About' },
    meta_description: null,
    meta_keywords: null,
    content: { languages: { 'en-US': tree } },
    languages: ['en-US', 'pl-PL'],
    version: 7,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    parent_page_id: null,
    breadcrumbs_visible: true,
    breadcrumbs_scheme: 'light',
    share_image_asset_id: null,
    parent_path_in_url: false,
    breadcrumbs_overlay: false,
    translations: { 'pl-PL': { name: 'O nas', slug: 'o-nas' } },
  };
}

function codeRow(): Record<string, unknown> {
  return {
    id: SOURCE_ID,
    name: 'Footer note',
    code: 'footer-note',
    active: true,
    description: null,
    content: { languages: { 'en-US': tree } },
    languages: ['en-US'],
    version: 4,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * An EntityManager that answers the service's reads and remembers its writes.
 * `taken` is what the one `like` query answers: the slugs or codes the copy's
 * suffix must step over.
 */
function fakeEm(options: { table: string; row: () => Record<string, unknown>; exists: boolean; taken: string[] }) {
  const writes: string[] = [];
  const inserts: unknown[][] = [];
  const em = {
    execute: async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        if (/^\s*insert into cms_(pages|blocks|templates)\b/i.test(sql)) inserts.push(params);
        return [];
      }
      if (new RegExp(`^\\s*select \\* from ${options.table} where id`, 'i').test(sql)) {
        return options.exists && params[0] === SOURCE_ID ? [options.row()] : [];
      }
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      if (/\blike\b/i.test(sql)) return options.taken.map((value) => ({ value }));
      return [];
    },
    find: async (): Promise<unknown[]> => [{ languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' }],
  };
  return { em: em as unknown as EntityManager, writes, inserts };
}

function recordingBus(transactional: EntityManager, events: string[]) {
  const commands: Array<{ action: string; objectType: string; objectId: string }> = [];
  const outcomes: Array<{ before?: unknown; after?: unknown }> = [];
  const commandBus = {
    run: async <T>(command: Command<T>): Promise<T> => {
      commands.push({ action: command.action, objectType: command.objectType, objectId: command.objectId });
      events.push('command:start');
      const outcome = await command.run({
        em: transactional,
        actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
      });
      events.push('command:committed');
      outcomes.push({ before: outcome.before, after: outcome.after });
      return outcome.result;
    },
  } as unknown as CommandBus;
  return { commandBus, commands, outcomes };
}

function recordingInvalidator(events: string[]) {
  const calls: Array<{ kind: string; values: string[] }> = [];
  const record = (kind: string) => async (values: Iterable<string> = []): Promise<void> => {
    events.push(`invalidate:${kind}`);
    calls.push({ kind, values: [...values].sort() });
  };
  const invalidator = {
    pagesChanged: record('pages'),
    blocksChanged: record('blocks'),
    templateChanged: record('templates'),
  } as unknown as CmsContentInvalidator;
  return { invalidator, calls };
}

const references = {
  findBlockReferences: async () => [],
  findTemplateReferences: async () => [],
  findPageReferences: async () => [],
} as unknown as CmsReferenceRegistry;

function pageHarness(options: { exists?: boolean; taken?: string[] } = {}) {
  const events: string[] = [];
  const settings = { table: 'cms_pages', row: pageRow, exists: options.exists ?? true, taken: options.taken ?? [] };
  const ambient = fakeEm(settings);
  const transactional = fakeEm(settings);
  const bus = recordingBus(transactional.em, events);
  const inv = recordingInvalidator(events);
  const service = new CmsPageService(() => ambient.em, bus.commandBus, () => [], inv.invalidator);
  return { service, events, ambient, transactional, ...bus, ...inv };
}

function blockHarness(options: { exists?: boolean; taken?: string[] } = {}) {
  const events: string[] = [];
  const settings = { table: 'cms_blocks', row: codeRow, exists: options.exists ?? true, taken: options.taken ?? [] };
  const ambient = fakeEm(settings);
  const transactional = fakeEm(settings);
  const bus = recordingBus(transactional.em, events);
  const inv = recordingInvalidator(events);
  const service = new CmsBlockService(() => ambient.em, bus.commandBus, () => [], references, inv.invalidator);
  return { service, events, ambient, transactional, ...bus, ...inv };
}

function templateHarness(options: { exists?: boolean; taken?: string[] } = {}) {
  const events: string[] = [];
  const row = (): Record<string, unknown> => {
    const { active: _active, ...rest } = codeRow();
    return { ...rest, name: 'Landing', code: 'landing' };
  };
  const settings = { table: 'cms_templates', row, exists: options.exists ?? true, taken: options.taken ?? [] };
  const ambient = fakeEm(settings);
  const transactional = fakeEm(settings);
  const bus = recordingBus(transactional.em, events);
  const inv = recordingInvalidator(events);
  const service = new CmsTemplateService(() => ambient.em, bus.commandBus, () => [], references, inv.invalidator);
  return { service, events, ambient, transactional, ...bus, ...inv };
}

describe('CmsPageService.duplicate', () => {
  it('runs one `cms_page.duplicate` Command, audited against the copy', async () => {
    const h = pageHarness();

    const copy = await h.service.duplicate(SOURCE_ID, { name: 'About us (kopia)' }).catch(() => null);

    expect(h.commands).toEqual([
      { action: 'cms_page.duplicate', objectType: 'cms_page', objectId: expect.any(String) },
    ]);
    expect(h.commands[0]!.objectId).not.toBe(SOURCE_ID);
    expect(h.transactional.writes).toContain('insert into cms_pages');
    expect(h.transactional.writes).toContain('insert into cms_page_sales_channels');
    expect(h.ambient.writes).toEqual([]);
    // The response is read back after the commit; the fake has no copy row to answer with.
    expect(copy).toBeNull();
  });

  it('records no state before, the copy and its source after, and no content tree', async () => {
    const h = pageHarness();

    await h.service.duplicate(SOURCE_ID, { name: 'About us (kopia)' }).catch(() => null);

    expect(h.outcomes[0]?.before).toBeNull();
    const after = h.outcomes[0]?.after as Record<string, unknown>;
    expect(after).toMatchObject({
      name: 'About us (kopia)',
      slug: 'about-us-copy',
      status: 'draft',
      version: 1,
      sourcePageId: SOURCE_ID,
      salesChannelIds: [CHANNEL_ID],
      translations: { 'pl-PL': { name: 'O nas', slug: 'o-nas-copy' } },
    });
    expect(after).not.toHaveProperty('content');
  });

  it('steps every slug of the copy past the taken ones with one number', async () => {
    const h = pageHarness({ taken: ['about-us-copy', 'o-nas-copy-2'] });

    await h.service.duplicate(SOURCE_ID, {}).catch(() => null);

    expect(h.outcomes[0]?.after).toMatchObject({
      name: 'About us (copy)',
      slug: 'about-us-copy-3',
      translations: { 'pl-PL': { slug: 'o-nas-copy-3' } },
    });
  });

  it('invalidates the copy\'s addresses once the Command has returned', async () => {
    const h = pageHarness();

    await h.service.duplicate(SOURCE_ID, {}).catch(() => null);

    expect(h.events).toEqual(['command:start', 'command:committed', 'invalidate:pages']);
    expect(h.calls).toEqual([{ kind: 'pages', values: ['about-us-copy', 'o-nas-copy'] }]);
  });

  it('invalidates nothing and writes nothing when the source is not there', async () => {
    const h = pageHarness({ exists: false });

    await expect(h.service.duplicate(SOURCE_ID, {})).rejects.toMatchObject({ statusCode: 404 });

    expect(h.transactional.writes).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('refuses a malformed id as not found, before any Command runs', async () => {
    const h = pageHarness();

    await expect(h.service.duplicate('not-a-uuid', {})).rejects.toMatchObject({ statusCode: 404 });

    expect(h.commands).toEqual([]);
  });

  it('refuses a copy whose slug starts with a reserved segment, and invalidates nothing', async () => {
    const h = pageHarness();
    h.service.setReservedSegmentsResolver(async () => ['about-us-copy']);

    await expect(h.service.duplicate(SOURCE_ID, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'CMS_SLUG_RESERVED',
    });

    expect(h.calls).toEqual([]);
  });

  it('refuses as a slug conflict once the suffix range is used up', async () => {
    const taken = Array.from({ length: 1000 }, (_, i) => (i === 0 ? 'about-us-copy' : `about-us-copy-${i + 1}`));
    const h = pageHarness({ taken });

    await expect(h.service.duplicate(SOURCE_ID, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'CMS_SLUG_CONFLICT',
    });

    expect(h.transactional.writes).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});

describe('CmsBlockService.duplicate', () => {
  it('runs one `cms_block.duplicate` Command with the copy\'s state and its source', async () => {
    const h = blockHarness({ taken: ['footer-note-copy'] });

    await h.service.duplicate(SOURCE_ID, { name: 'Footer note (kopia)' }).catch(() => null);

    expect(h.commands).toEqual([
      { action: 'cms_block.duplicate', objectType: 'cms_block', objectId: expect.any(String) },
    ]);
    expect(h.commands[0]!.objectId).not.toBe(SOURCE_ID);
    expect(h.transactional.writes).toContain('insert into cms_blocks');
    expect(h.transactional.writes).not.toContain('insert into cms_hook_block_attachments');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    const after = h.outcomes[0]?.after as Record<string, unknown>;
    expect(after).toMatchObject({
      name: 'Footer note (kopia)',
      code: 'footer-note-copy-2',
      version: 1,
      sourceBlockId: SOURCE_ID,
      salesChannelIds: [CHANNEL_ID],
    });
    expect(after).not.toHaveProperty('content');
  });

  it('copies the content of every language as it is stored', async () => {
    const h = blockHarness();

    await h.service.duplicate(SOURCE_ID, {}).catch(() => null);

    const insert = h.transactional.inserts[0]!;
    expect(insert).toContain(JSON.stringify({ languages: { 'en-US': tree } }));
  });

  it('invalidates the copy\'s code once the Command has returned', async () => {
    const h = blockHarness();

    await h.service.duplicate(SOURCE_ID, {}).catch(() => null);

    expect(h.events).toEqual(['command:start', 'command:committed', 'invalidate:blocks']);
    expect(h.calls).toEqual([{ kind: 'blocks', values: ['footer-note-copy'] }]);
  });

  it('invalidates nothing when the source is not there', async () => {
    const h = blockHarness({ exists: false });

    await expect(h.service.duplicate(SOURCE_ID, {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'CMS_BLOCK_NOT_FOUND',
    });

    expect(h.calls).toEqual([]);
  });
});

describe('CmsTemplateService.duplicate', () => {
  it('runs one `cms_template.duplicate` Command with the copy\'s state and its source', async () => {
    const h = templateHarness();

    await h.service.duplicate(SOURCE_ID, {}).catch(() => null);

    expect(h.commands).toEqual([
      { action: 'cms_template.duplicate', objectType: 'cms_template', objectId: expect.any(String) },
    ]);
    expect(h.commands[0]!.objectId).not.toBe(SOURCE_ID);
    expect(h.transactional.writes).toContain('insert into cms_templates');
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toBeNull();
    const after = h.outcomes[0]?.after as Record<string, unknown>;
    expect(after).toMatchObject({
      name: 'Landing (copy)',
      code: 'landing-copy',
      version: 1,
      sourceTemplateId: SOURCE_ID,
    });
    expect(after).not.toHaveProperty('content');
    expect(h.events).toEqual(['command:start', 'command:committed', 'invalidate:templates']);
  });

  it('refuses as a code conflict once the suffix range is used up, and invalidates nothing', async () => {
    const taken = Array.from({ length: 1000 }, (_, i) => (i === 0 ? 'landing-copy' : `landing-copy-${i + 1}`));
    const h = templateHarness({ taken });

    await expect(h.service.duplicate(SOURCE_ID, {})).rejects.toMatchObject({
      statusCode: 409,
      code: 'CMS_CODE_CONFLICT',
    });

    expect(h.transactional.writes).toEqual([]);
    expect(h.calls).toEqual([]);
  });
});
