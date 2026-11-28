import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { EventBus } from '../../events/index.js';
import { createRootContainer } from '../container.js';
import { createModuleContext, createModuleRegistrationSink } from '../module-context.js';
import { EntityExtensionInvalidError, EntityExtensionLoaderOutputError } from '../entity-extensions/errors.js';
import type { EntityExtensionLoaderEntry } from '../entity-extensions/loaders.js';
import { EntityExtensionLoaderRegistry } from '../entity-extensions/registry.js';
import { defineColumnExtension } from './define.js';
import { createSchemaExtensionReads } from './reads.js';
import type { ColumnExtension } from './types.js';

/**
 * `specs/193-admin-form-extensions/` T035 (FR-015, D-300.1) — a side-table
 * loader that opts in with `adminReads: true` is served on the host's admin
 * `?extensions=<moduleId>` read beside D2's columns (187 R-17 rules 1 and 2):
 * consulted only when it opts in and its module is present, once per module per
 * response, and refused at registration when the same module also serves D2
 * columns under that key on that host (`loader-and-columns-on-one-host`).
 *
 * The D2 column path itself needs a database and stays in
 * `backend/test/integration/db/schema-extension-reads.test.ts`; nothing here
 * declares an `adminReads` column on a module whose loader is read.
 */

const HOST_TABLE = 'organizations';
const HOST_ENTITY = 'organizations.Organization';
const em = { marker: 'the route’s em' } as unknown as EntityManager;
const log = { info: () => {}, warn: () => {}, error: () => {} };

interface Call {
  readonly moduleId: string;
  readonly ids: readonly string[];
  readonly em: EntityManager;
}

const records = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as const;

function loaderFor(
  moduleId: string,
  calls: Call[],
  options: { adminReads?: boolean; values?: Record<string, unknown>; schema?: z.ZodType } = {},
): EntityExtensionLoaderEntry<unknown> {
  return {
    host: HOST_ENTITY,
    ...(options.adminReads === undefined ? {} : { adminReads: options.adminReads }),
    schema: options.schema ?? z.object({ ref: z.string() }),
    load: async (ids, ctx) => {
      calls.push({ moduleId, ids: [...ids], em: ctx.em });
      // `b` has no side row: a loader resolves only ids that have a value.
      const values = options.values ?? { a: { ref: `${moduleId}:a` }, c: { ref: `${moduleId}:c` } };
      return new Map(Object.entries(values));
    },
  };
}

function registryWith(
  modules: readonly string[],
  options: { columns?: readonly ColumnExtension[] } = {},
): EntityExtensionLoaderRegistry {
  return new EntityExtensionLoaderRegistry({
    declarations: modules.map((moduleId) => ({ moduleId, entity: HOST_ENTITY, table: `${moduleId}_refs` })),
    ...(options.columns === undefined ? {} : { columnExtensions: () => options.columns! }),
  });
}

function setup(
  entries: Record<string, { adminReads?: boolean; values?: Record<string, unknown>; schema?: z.ZodType }>,
  present?: string[],
) {
  const calls: Call[] = [];
  const modules = Object.keys(entries);
  const registry = registryWith(modules);
  for (const moduleId of modules) registry.register(moduleId, [loaderFor(moduleId, calls, entries[moduleId])]);
  registry.seal();
  const on = new Set(present ?? modules);
  const reads = createSchemaExtensionReads({
    declarations: () => [],
    state: { isPresent: (moduleId) => on.has(moduleId) },
    loaders: registry,
  });
  return { reads, calls };
}

function refusal(run: () => void): EntityExtensionInvalidError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EntityExtensionInvalidError);
    return error as EntityExtensionInvalidError;
  }
  throw new Error('expected a refusal');
}

describe('schemaExtensionReads over adminReads loaders (FR-015)', () => {
  it('consults an adminReads loader and answers its value under the module key, null where none', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true } });
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_links']);
    expect(Object.fromEntries(out)).toEqual({
      a: { acme_links: { ref: 'acme_links:a' } },
      b: { acme_links: null },
      c: { acme_links: { ref: 'acme_links:c' } },
    });
    expect(calls).toEqual([{ moduleId: 'acme_links', ids: ['a', 'b', 'c'], em }]);
  });

  it('omits a loader without adminReads, and never calls it', async () => {
    const { reads, calls } = setup({ acme_links: {}, acme_crm: { adminReads: false } });
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_links', 'acme_crm']);
    expect(out.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('omits a switched-off module, and never calls its loader', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true }, acme_crm: { adminReads: true } }, ['acme_crm']);
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_links', 'acme_crm']);
    expect(Object.keys(out.get('a')!)).toEqual(['acme_crm']);
    expect(calls.map((call) => call.moduleId)).toEqual(['acme_crm']);
  });

  it('omits a module no loader and no column serves — no error, as D2 does', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true } });
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_unknown']);
    expect(out.size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('calls each loader once per response, whatever the number of records or repeats of the module', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true }, acme_crm: { adminReads: true } });
    await reads.attach(em, HOST_TABLE, records, ['acme_links', 'acme_crm', 'acme_links']);
    expect(calls.map((call) => call.moduleId)).toEqual(['acme_links', 'acme_crm']);
    expect(calls.every((call) => call.ids.length === 3)).toBe(true);
  });

  it('does not call a loader for no records or no request', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true } });
    expect((await reads.attach(em, HOST_TABLE, [], ['acme_links'])).size).toBe(0);
    expect((await reads.attach(em, HOST_TABLE, records, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('only reads the loader registered for the requested host', async () => {
    const { reads, calls } = setup({ acme_links: { adminReads: true } });
    expect((await reads.attach(em, 'projects', records, ['acme_links'])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('parses every value with the loader’s schema and refuses one it does not admit, naming the module', async () => {
    const { reads } = setup({ acme_links: { adminReads: true, values: { a: { ref: 42 } } } });
    await expect(reads.attach(em, HOST_TABLE, records, ['acme_links'])).rejects.toBeInstanceOf(
      EntityExtensionLoaderOutputError,
    );
    await expect(reads.attach(em, HOST_TABLE, records, ['acme_links'])).rejects.toThrow(/acme_links/);
  });

  it('refuses a value its schema admits but that is neither an object keyed by field nor null (D-300.24)', async () => {
    for (const value of [['a', 'b'], 'plain', 42, true]) {
      const { reads } = setup({ acme_links: { adminReads: true, schema: z.unknown(), values: { a: value } } });
      const failure = await reads.attach(em, HOST_TABLE, records, ['acme_links']).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(EntityExtensionLoaderOutputError);
      expect((failure as Error).message).toMatch(/object keyed by field, or null/);
      expect((failure as Error).message).toContain('acme_links');
    }
  });

  it('admits a parsed null from the loader as the record’s value (D-300.24)', async () => {
    const { reads } = setup({ acme_links: { adminReads: true, schema: z.object({ ref: z.string() }).nullable(), values: { a: null } } });
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_links']);
    expect(out.get('a')).toEqual({ acme_links: null });
  });

  it('ignores a value for an id the route did not hand it', async () => {
    const { reads } = setup({ acme_links: { adminReads: true, values: { a: { ref: 'x' }, z: { ref: 'y' } } } });
    const out = await reads.attach(em, HOST_TABLE, records, ['acme_links']);
    expect(out.has('z')).toBe(false);
  });

  it('without a loader registry behaves as before: a loader-only module is omitted', async () => {
    const reads = createSchemaExtensionReads({ declarations: () => [], state: { isPresent: () => true } });
    expect((await reads.attach(em, HOST_TABLE, records, ['acme_links'])).size).toBe(0);
  });
});

describe('loader-and-columns-on-one-host (FR-015)', () => {
  const columns = (adminReads: boolean): ColumnExtension =>
    defineColumnExtension({ host: 'organizations', module: 'acme_links', columns: { erpCode: { type: 'text', nullable: true } }, adminReads });

  it('refuses an adminReads loader from a module that serves D2 columns on the same host, naming both', () => {
    const registry = registryWith(['acme_links'], { columns: [columns(true)] });
    const error = refusal(() => registry.register('acme_links', [loaderFor('acme_links', [], { adminReads: true })]));
    expect(error.rule).toBe('loader-and-columns-on-one-host');
    expect(error.moduleId).toBe('acme_links');
    expect(error.entity).toBe(HOST_ENTITY);
    expect(error.message).toContain('extensions.acme_links');
    expect(registry.loaderFor('acme_links', HOST_ENTITY)).toBeUndefined();
  });

  it('accepts the pair when only one of them is on the admin wire', () => {
    const quietColumns = registryWith(['acme_links'], { columns: [columns(false)] });
    quietColumns.register('acme_links', [loaderFor('acme_links', [], { adminReads: true })]);
    expect(quietColumns.loaderFor('acme_links', HOST_ENTITY)?.adminReads).toBe(true);

    const quietLoader = registryWith(['acme_links'], { columns: [columns(true)] });
    quietLoader.register('acme_links', [loaderFor('acme_links', [])]);
    expect(quietLoader.loaderFor('acme_links', HOST_ENTITY)?.adminReads).toBe(false);
  });

  it('accepts columns of one module beside another module’s loader on the same host', () => {
    const registry = registryWith(['acme_crm'], { columns: [columns(true)] });
    registry.register('acme_crm', [loaderFor('acme_crm', [], { adminReads: true })]);
    expect(registry.loaderFor('acme_crm', HOST_ENTITY)?.adminReads).toBe(true);
  });
});

describe('ModuleContext.entityExtensionLoaders carries adminReads (FR-015)', () => {
  it('passes the opt-in through to the registry, and absent reads as false', () => {
    const registry = registryWith(['acme_links', 'acme_crm']);
    const contextFor = (id: string) =>
      createModuleContext({
        module: { id, version: '1.0.0' },
        container: createRootContainer(),
        eventBus: new EventBus(),
        sink: createModuleRegistrationSink(),
        log,
        entityExtensionLoaderRegistry: registry,
      });
    contextFor('acme_links').entityExtensionLoaders([loaderFor('acme_links', [], { adminReads: true })]);
    contextFor('acme_crm').entityExtensionLoaders([loaderFor('acme_crm', [])]);
    expect(registry.loaderFor('acme_links', HOST_ENTITY)?.adminReads).toBe(true);
    expect(registry.loaderFor('acme_crm', HOST_ENTITY)?.adminReads).toBe(false);
  });
});
