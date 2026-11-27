/**
 * `catalog`'s four hookable actions (`specs/193-admin-form-extensions/` WP-H3,
 * T008 – T010, FR-112 – FR-114, `contracts/hookable-writers.md` §3; the
 * mechanism is `specs/176-command-hooks-outbox/`, `contracts/command-hooks-api.md` §6).
 *
 * What is held here:
 *  1. each of `product.create`, `product.update`, `product.scoped_values.save`
 *     and `product.scoped_values.import` is a Command its ref may be hooked on
 *     (`expectHookableCommand`), and its hook data is the declared shape — the
 *     scoped two carry one entry per saved scope;
 *  2. none of the four is reversible: the module's one undo restores a bulk
 *     operation, never a product Command's entry (176 §6, research R-22);
 *  3. `product.bulk_update` stays undeclared (FR-113), and a bulk edit writes
 *     each product as `product.bulk_update.item` (D-300.8), which supplies hook
 *     data for the field-rule check but no module hook can attach to (T009);
 *  4. on a real bus, a present hook on `product.update` is handed the hook data
 *     and its own `extensions` key through `catalogProductCommandPort`; an
 *     unclaimed key is `422 COMMAND_EXTENSION_UNCLAIMED` with nothing written;
 *     and with no hook registered nothing changes for a caller that passes no
 *     `extensions` — `hookData` and `outboxData` are not even called.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_HOOKABLE_ACTIONS as PRODUCT,
  hookableAction,
  type HookableActionRef,
  type OutboxData,
  type ProductCreateHookData,
  type ProductScopedValuesHookData,
  type ProductUpdateHookData,
  type SaveScopedValuesRequest,
} from '@endora-commerce/contracts';
import { CommandBus, UndeclaredHookableActionError, type Command, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { Product } from '../entities/product.entity.js';
import { CatalogAdminService } from '../services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../services/catalog-bulk-update.service.js';
import { createCatalogProductCommandPort } from '../services/catalog-command-ports.js';
import { runScopedImport, type ScopedImportDeps } from '../services/scoped-values-import.js';
import type { ScopedSavePlan } from '../services/scoped-values-save.service.js';
import { PRODUCT_BULK_UPDATE_ITEM_ACTION, productUpdateHookData, scopedValuesHookScope } from './product-hook-data.js';
import { scopedValuesSaveCommand, type ScopedValuesCommandDeps, type ScopedValuesSaveResult } from './scoped-values.commands.js';

const P1 = '00000000-0000-4000-8000-000000193001';
const P2 = '00000000-0000-4000-8000-000000193002';
const CHANNEL = '00000000-0000-4000-8000-000000193003';
const CATEGORY = '00000000-0000-4000-8000-000000193004';
const ADMIN_ID = '00000000-0000-4000-8000-000000193005';
const SET_ID = '00000000-0000-4000-8000-000000193006';

/** Every value the outbox keeps out — a name, a description, a scoped text. */
const SENTINEL = 'S193-';
const HOOK_MODULE = 'acme_pim';

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN_ID, 'catalog unit test: hookable actions', fn);

function product(id: string, overrides: Partial<Product> = {}): Product {
  return Object.assign(new Product(), {
    id,
    sku: `SKU-${id.slice(-3)}`,
    slug: `slug-${id.slice(-3)}`,
    type: 'simple',
    status: 'active',
    name: `${SENTINEL}NAME`,
    description: `${SENTINEL}DESCRIPTION`,
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: SET_ID,
    returnable: true,
    createdAt: new Date('2026-11-27T00:00:00Z'),
    updatedAt: new Date('2026-11-27T00:00:00Z'),
    ...overrides,
  });
}

/** A bus stand-in that keeps each Command it is handed and answers `answer` without running it. */
function capturingBus<T>(answer: T) {
  const commands: Array<Command<unknown>> = [];
  const bus = {
    run: async <R>(command: Command<R>): Promise<R> => {
      commands.push(command as Command<unknown>);
      return answer as unknown as R;
    },
  };
  return { commands, bus };
}

describe('catalog lists its hookable actions in its manifest (FR-114)', () => {
  it('lists the four refs, for both phases', () => {
    expect(manifest.hookableActions).toEqual([
      { action: 'product.create', objectType: 'product', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'product.update', objectType: 'product', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'product.scoped_values.save', objectType: 'product', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'product.scoped_values.import', objectType: 'product', phases: ['beforeCommit', 'afterCommit'] },
    ]);
  });
});

describe('none of the four is reversible (176 §6, research R-22, T008)', () => {
  const backend = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
    });

  it('the module’s only undo is the bulk edit’s, and it restores a bulk operation', () => {
    const undoers = sources(backend)
      .filter((path) => readFileSync(path, 'utf8').includes('applyUndo('))
      .map((path) => relative(backend, path));
    expect(undoers).toEqual(['services/bulk-operation.service.ts']);
    const source = readFileSync(join(backend, 'services/bulk-operation.service.ts'), 'utf8');
    expect(source).toMatch(/action: 'product\.bulk_update\.undo',\s*objectType: 'bulk_operation',/);
  });

  it('no declared action is the bulk edit, its undo, or a Command on anything but a product', () => {
    for (const ref of Object.values(PRODUCT)) {
      expect(ref.action).not.toMatch(/^product\.bulk_update/);
      expect(ref.objectType).toBe('product');
    }
  });
});

describe('product.create (FR-112)', () => {
  it('supplies hook data — the new product and its categories — and an outbox of ids and field names', async () => {
    const created = product(P1);
    const { commands, bus } = capturingBus(created);
    const admin = new CatalogAdminService(
      () => ({}) as EntityManager,
      { emit: () => undefined } as never,
      undefined,
      undefined,
      bus as unknown as CommandBus,
    );
    await admin.createProduct({
      sku: 'SKU-001',
      type: 'simple',
      name: `${SENTINEL}NAME`,
      description: `${SENTINEL}DESCRIPTION`,
      visibility: 'public',
      attributeValues: {},
      categoryIds: [CATEGORY, CATEGORY],
    } as never);
    const command = commands.find((candidate) => candidate.action === PRODUCT.create.action)!;
    expectHookableCommand(command, PRODUCT.create as HookableActionRef<unknown, OutboxData>, {
      result: created,
      sentinels: [SENTINEL],
    });
    const data = command.hookData!(created) as ProductCreateHookData;
    expect(data.product).toMatchObject({ id: P1, name: `${SENTINEL}NAME`, attributeSetId: SET_ID });
    expect(data.categoryIds).toEqual([CATEGORY]);
    expect(command.outboxData!(created)).toEqual({ productId: P1, changedFields: [] });
  });
});

describe('product.scoped_values.save (FR-112)', () => {
  const body: SaveScopedValuesRequest = { scope: { channelId: CHANNEL }, changes: { name: `${SENTINEL}SCOPED` } } as never;
  const result: ScopedValuesSaveResult = {
    state: {} as never,
    scope: { level: 'channel', channelId: CHANNEL },
    changedFields: ['name'],
    warnings: [],
  };

  it('is a Command its ref may be hooked on', () => {
    const command = scopedValuesSaveCommand({} as ScopedValuesCommandDeps, P1, body, undefined);
    expectHookableCommand(command, PRODUCT.scopedValuesSave as HookableActionRef<unknown, OutboxData>, {
      result,
      sentinels: [SENTINEL],
    });
    expect(command.outboxData!(result)).toEqual({ productId: P1, changedFields: ['name'] });
    expect((command.hookData!(result) as ProductScopedValuesHookData).productId).toBe(P1);
  });

  it('one hook-data entry per saved scope: the values written there and the fields they changed', () => {
    const plan = {
      scope: { level: 'channel', channelId: CHANNEL },
      cells: [
        { path: 'name', family: 'value', field: 'name', op: { op: 'set', value: `${SENTINEL}SCOPED` }, bodyPath: ['name'] },
        { path: 'description', family: 'value', field: 'description', op: { op: 'empty' }, bodyPath: ['description'] },
        { path: 'attribute:colour', family: 'value', field: 'colour', op: { op: 'inherit' }, bodyPath: ['attributes', 'colour'] },
      ],
      changedFields: ['name', 'description', 'attributeValues'],
    } as unknown as ScopedSavePlan;
    expect(scopedValuesHookScope(plan)).toEqual({
      scope: { level: 'channel', channelId: CHANNEL },
      after: { name: `${SENTINEL}SCOPED`, description: null, 'attribute:colour': { inherit: true } },
      changedFields: ['name', 'description', 'attributeValues'],
    });
    expect(
      scopedValuesHookScope(plan, { after: { 'seo:metaTitle': `${SENTINEL}SEO` }, changedFields: ['name', 'seo'] }),
    ).toEqual({
      scope: { level: 'channel', channelId: CHANNEL },
      after: {
        name: `${SENTINEL}SCOPED`,
        description: null,
        'attribute:colour': { inherit: true },
        'seo:metaTitle': `${SENTINEL}SEO`,
      },
      changedFields: ['name', 'seo'],
    });
  });
});

describe('product.scoped_values.import (FR-112)', () => {
  it('is a Command its ref may be hooked on, and forwards the caller’s extensions', async () => {
    const { commands, bus } = capturingBus({ applied: 1, refused: [], urlKeys: [], changedFields: ['name'] });
    await runScopedImport(
      bus as unknown as Pick<CommandBus, 'run'>,
      {} as ScopedImportDeps,
      P1,
      [{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: `${SENTINEL}NAME` } }] as never,
      { source: 'pim_akeneo', extensions: { [HOOK_MODULE]: { a: 1 } } },
    );
    const [command] = commands;
    const answer = { applied: 1, refused: [], urlKeys: [], changedFields: ['name'] };
    expectHookableCommand(command!, PRODUCT.scopedValuesImport as HookableActionRef<unknown, OutboxData>, {
      result: answer,
      sentinels: [SENTINEL],
    });
    expect(command!.extensions).toEqual({ [HOOK_MODULE]: { a: 1 } });
    expect(command!.outboxData!(answer)).toEqual({ productId: P1, changedFields: ['name'] });
    expect(command!.hookData!(answer)).toEqual({ productId: P1, scopes: [] });
  });
});

/**
 * `product.update` on a real `CommandBus` with a sealed hook registry, over a
 * one-table in-memory world whose `transactional` keeps a write only when the
 * Command resolves.
 */
function harness(
  hooks: ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }>,
  wrap: (command: Command<unknown>) => Command<unknown> = (command) => command,
) {
  const rows = new Map<string, Product>([
    [P1, product(P1)],
    [P2, product(P2)],
  ]);
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  let pendingAudits: Array<Record<string, unknown>> = [];
  let pendingOutbox: Array<Record<string, unknown>> = [];
  const em: Record<string, unknown> = {
    findOne: async (entity: unknown, where: { id?: string }) => (entity === Product ? (rows.get(where.id ?? '') ?? null) : null),
    execute: async (sql: string, params: unknown[] = []) =>
      sql.startsWith('update products set scope_version') && rows.has(params[0] as string) ? [{ v: '2' }] : [],
    persist: (row: Record<string, unknown>) => {
      pendingOutbox.push(row);
      return em;
    },
    flush: async () => undefined,
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => {
    const snapshot = new Map([...rows].map(([id, row]) => [id, { ...row }]));
    pendingAudits = [];
    pendingOutbox = [];
    try {
      const value = await fn(em as unknown as EntityManager);
      audits.push(...pendingAudits);
      outbox.push(...pendingOutbox);
      return value;
    } catch (error) {
      for (const [id, row] of snapshot) Object.assign(rows.get(id)!, row);
      throw error;
    }
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      pendingAudits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'catalog', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['catalog'] },
    hooks,
  });
  const events = new EventBus<Record<string, EventBase>>();
  const bus = new CommandBus(orm, audit, events, { hooks: registry });
  const commands: Array<Command<unknown>> = [];
  const spied = {
    run: <T>(command: Command<T>) => {
      commands.push(command as Command<unknown>);
      return bus.run(wrap(command as Command<unknown>) as Command<T>);
    },
  } as unknown as CommandBus;
  const admin = new CatalogAdminService(
    () => em as unknown as EntityManager,
    { emit: () => undefined } as never,
    undefined,
    undefined,
    spied,
  );
  const port = createCatalogProductCommandPort({
    admin: () => admin,
    commandBus: () => spied,
    importDeps: () => ({}) as ScopedImportDeps,
  });
  const bulk = new CatalogBulkUpdateService(() => em as unknown as EntityManager, admin);
  return { rows, audits, outbox, commands, admin, port, bulk, events };
}

describe('product.update on a real bus (FR-112, FR-114)', () => {
  it('a present hook is handed the after-state and changedFields, and its own extensions key, through the port', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      {
        moduleId: HOOK_MODULE,
        entries: [
          recording.on(PRODUCT.update),
          { id: 'deliver-update', on: PRODUCT.update, phase: 'afterCommit', handler: async () => undefined },
        ],
      },
    ]);
    await asAdmin(() =>
      h.port.update(P1, { name: `${SENTINEL}RENAMED` } as never, { extensions: { [HOOK_MODULE]: { erpId: 'E-1' } } }),
    );
    const command = h.commands.find((candidate) => candidate.action === PRODUCT.update.action)!;
    expectHookableCommand(command, PRODUCT.update as HookableActionRef<unknown, OutboxData>);
    expect(recording.calls).toHaveLength(1);
    const call = recording.calls[0]!;
    expect(call).toMatchObject({ action: 'product.update', objectId: P1, extension: { erpId: 'E-1' } });
    const data = call.data as ProductUpdateHookData;
    expect(data.product).toMatchObject({ id: P1, name: `${SENTINEL}RENAMED` });
    expect(data.changedFields).toEqual(['name']);
    // The write named no category set, so the hook data names none.
    expect(data).not.toHaveProperty('categoryIds');
    expect(h.outbox).toHaveLength(1);
    expect(h.outbox[0]!['data']).toEqual({ productId: P1, changedFields: ['name'] });
    expect(JSON.stringify(h.outbox[0]!['data'])).not.toContain(SENTINEL);
  });

  it('an unclaimed extensions key is 422 COMMAND_EXTENSION_UNCLAIMED, and nothing is written', async () => {
    const h = harness([]);
    await expect(
      asAdmin(() => h.port.update(P1, { name: `${SENTINEL}NOPE` } as never, { extensions: { nobody_claims_this: {} } })),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(h.rows.get(P1)!.name).toBe(`${SENTINEL}NAME`);
    expect(h.audits).toEqual([]);
  });

  it('with no hook registered, a caller with no extensions writes as before: no hook data, no outbox row', async () => {
    const calls: string[] = [];
    const h = harness([], (command) => ({
      ...command,
      hookData: (result) => {
        calls.push('hookData');
        return command.hookData!(result);
      },
      outboxData: (result) => {
        calls.push('outboxData');
        return command.outboxData!(result);
      },
    }));
    await asAdmin(() => h.port.update(P1, { name: `${SENTINEL}PLAIN` } as never));
    expect(h.rows.get(P1)!.name).toBe(`${SENTINEL}PLAIN`);
    expect(h.audits).toHaveLength(1);
    expect(h.outbox).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('product.update hook data names the category set when the write named one', () => {
  it('the stored set, deduplicated; absent when the write left the categories alone', () => {
    const row = product(P1);
    expect(productUpdateHookData(row, ['categoryIds'], [CATEGORY, CATEGORY]).categoryIds).toEqual([CATEGORY]);
    expect(productUpdateHookData(row, ['name'], undefined)).not.toHaveProperty('categoryIds');
  });
});

/**
 * D-300.8 (`contracts/hookable-writers.md` §3.1) — a bulk edit writes each product as
 * `product.bulk_update.item`, never `product.update`: the bulk edit is reversible, so
 * no module hook may see it. The item Command is the same write — the same audit
 * state and `product.updated.v1` — and supplies `ProductUpdateHookData` for the
 * field-rule check alone. The queued path and the undo are held on a real database
 * in `backend/test/contract/catalog/products-bulk-update-audited.test.ts`.
 */
describe('a bulk edit writes product.bulk_update.item, which no hook can attach to (D-300.8, FR-113, T009)', () => {
  const hookable = new Set(Object.values(PRODUCT).map((ref) => ref.action));

  it('runs one product.bulk_update.item per product and no hookable action; a product.update hook does not run', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: HOOK_MODULE, entries: [recording.on(PRODUCT.update)] }]);
    const result = await asAdmin(() => h.bulk.bulkUpdate({ productIds: [P1, P2], fields: { visibility: 'logged_in_only' } }));
    expect(result.summary).toMatchObject({ succeeded: 2, failed: 0 });
    expect(h.commands.map((command) => [command.action, command.objectId])).toEqual([
      [PRODUCT_BULK_UPDATE_ITEM_ACTION, P1],
      [PRODUCT_BULK_UPDATE_ITEM_ACTION, P2],
    ]);
    expect(h.commands.some((command) => hookable.has(command.action))).toBe(false);
    expect(recording.calls).toEqual([]);
    expect(h.outbox).toEqual([]);

    // The same hook runs for a single-product write.
    await asAdmin(() => h.port.update(P1, { name: `${SENTINEL}SINGLE` } as never));
    expect(recording.calls.map((call) => [call.action, call.objectId])).toEqual([['product.update', P1]]);
  });

  it('the item Command is the product.update write: its hook data, its event, its audit state, and no outbox data', async () => {
    const h = harness([]);
    const announced: Array<{ productId: string; changedFields: string[] }> = [];
    h.events.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      announced.push({ productId: p.productId, changedFields: p.changedFields });
    });
    await asAdmin(() => h.bulk.bulkUpdate({ productIds: [P1], fields: { visibility: 'logged_in_only' } }));
    await asAdmin(() => h.port.update(P2, { visibility: 'logged_in_only' } as never));

    const [item, single] = h.commands;
    expect([item!.action, single!.action]).toEqual([PRODUCT_BULK_UPDATE_ITEM_ACTION, 'product.update']);
    expect(item!.objectType).toBe('product');
    expect(item!.outboxData).toBeUndefined();
    const data = item!.hookData!(h.rows.get(P1)!) as ProductUpdateHookData;
    expect(data).toEqual(productUpdateHookData(h.rows.get(P1)!, ['visibility'], undefined));
    expect(announced).toEqual([
      { productId: P1, changedFields: ['visibility'] },
      { productId: P2, changedFields: ['visibility'] },
    ]);

    const [itemEntry, singleEntry] = h.audits;
    expect(itemEntry).toMatchObject({ action: PRODUCT_BULK_UPDATE_ITEM_ACTION, objectType: 'product', objectId: P1 });
    expect(singleEntry).toMatchObject({ action: 'product.update', objectType: 'product', objectId: P2 });
    const keys = (entry: Record<string, unknown> | undefined, side: string) => Object.keys((entry?.[side] ?? {}) as object).sort();
    expect(keys(itemEntry, 'stateBefore')).toEqual(keys(singleEntry, 'stateBefore'));
    expect(keys(itemEntry, 'stateAfter')).toEqual(keys(singleEntry, 'stateAfter'));
    expect((itemEntry!['stateAfter'] as { changedFields: string[] }).changedFields).toEqual(['visibility']);
  });

  it('is not declared: a hook registered on it is refused at composition', () => {
    expect(manifest.hookableActions?.map((declaration) => declaration.action)).not.toContain(PRODUCT_BULK_UPDATE_ITEM_ACTION);
    expect(hookable.has(PRODUCT_BULK_UPDATE_ITEM_ACTION)).toBe(false);
    const undeclared = hookableAction(PRODUCT_BULK_UPDATE_ITEM_ACTION, 'product', ['beforeCommit']);
    expect(() =>
      sealedCommandHookRegistry({
        hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'catalog', ...declaration })),
        moduleDependencies: { [HOOK_MODULE]: ['catalog'] },
        hooks: [{ moduleId: HOOK_MODULE, entries: [recordingCommandHooks().on(undeclared)] }],
      }),
    ).toThrow(UndeclaredHookableActionError);
  });
});
