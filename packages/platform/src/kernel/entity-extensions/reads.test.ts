import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { ERROR_CODES, type EntityExtensionReadOptions } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { EntityExtensionLoaderOutputError } from './errors.js';
import { EntityExtensionLoaderRegistry } from './registry.js';
import { createEntityExtensionReads, lazyEntityExtensionReads } from './reads.js';

/**
 * `specs/187-side-table-extensions/` T035 (FR-054 – FR-057) — semantics 1 – 7 of
 * `contracts/extension-attributes-read-ports.md` §3, in order.
 */

const HOST = 'organizations.Organization';
const em = { marker: 'the port’s em' } as unknown as EntityManager;

interface Call {
  readonly moduleId: string;
  readonly ids: readonly string[];
  readonly em: EntityManager;
}

function setup(options: {
  present?: readonly string[];
  values?: Record<string, Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  const modules = ['acme_links', 'acme_crm', 'acme_ext'];
  const registry = new EntityExtensionLoaderRegistry({
    declarations: modules.map((moduleId) => ({ moduleId, entity: HOST, table: `${moduleId}_refs` })),
  });
  for (const moduleId of modules) {
    registry.register(moduleId, [
      {
        host: HOST,
        schema: z.object({ ref: z.string() }),
        load: async (ids, ctx) => {
          calls.push({ moduleId, ids: [...ids], em: ctx.em });
          const values = options.values?.[moduleId] ?? Object.fromEntries(ids.map((id) => [id, { ref: `${moduleId}:${id}` }]));
          return new Map(Object.entries(values));
        },
      },
    ]);
  }
  registry.seal();
  const present = new Set(options.present ?? modules);
  const reads = createEntityExtensionReads({ registry, state: { isPresent: (id) => present.has(id) } });
  return { reads, calls };
}

const records = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
] as const;

async function refusal(run: Promise<unknown>): Promise<HttpError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('expected a refusal');
}

describe('entityExtensionReads.attach (§3)', () => {
  it('1 — no include, or an empty one: the records as given, no extensions key, no loader', async () => {
    const { reads, calls } = setup();
    for (const options of [undefined, {}, { include: [] }] as (EntityExtensionReadOptions | undefined)[]) {
      const out = await reads.attach(HOST, records, options, em);
      expect(out).toHaveLength(3);
      out.forEach((record, index) => {
        expect(record).toBe(records[index]);
        expect(Object.keys(record)).toEqual(['id', 'name']);
      });
    }
    expect(calls).toEqual([]);
  });

  it('2 — deduplicates; more than eight distinct includes is a 422 VALIDATION_FAILED', async () => {
    const { reads, calls } = setup();
    await reads.attach(HOST, records, { include: ['extensions.acme_links', 'extensions.acme_links'] }, em);
    expect(calls.map((call) => call.moduleId)).toEqual(['acme_links']);

    const nine = Array.from({ length: 9 }, (_, index) => `extensions.m${index}` as const);
    const tooMany = await refusal(reads.attach(HOST, records, { include: nine }, em));
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // Eight duplicates of one are one.
    await reads.attach(HOST, records, { include: Array(9).fill('extensions.acme_links') }, em);
  });

  it('2 — refuses an include outside the extensions family with 422 VALIDATION_FAILED', async () => {
    const { reads, calls } = setup();
    const error = await refusal(reads.attach(HOST, records, { include: ['customFields.x' as never] }, em));
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(calls).toEqual([]);
  });

  it('3 — an unclaimed module is a 422 ENTITY_EXTENSION_UNCLAIMED with details, before any loader runs', async () => {
    const { reads, calls } = setup();
    const error = await refusal(
      reads.attach(HOST, records, { include: ['extensions.acme_links', 'extensions.nobody', 'extensions.ghost'] }, em),
    );
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED);
    expect(error.details).toEqual([
      { path: 'extensions.nobody', issue: 'unclaimed' },
      { path: 'extensions.ghost', issue: 'unclaimed' },
    ]);
    expect(calls).toEqual([]);
    // A loader on another host does not claim this one.
    const other = await refusal(reads.attach('orders.Order', records, { include: ['extensions.acme_links'] }, em));
    expect(other.code).toBe(ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED);
  });

  it('3 — claim is a build fact: an absent module still claims, so its include is not a 422', async () => {
    const { reads } = setup({ present: [] });
    const out = await reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em);
    expect(out.map((record) => Object.keys(record))).toEqual([['id', 'name'], ['id', 'name'], ['id', 'name']]);
  });

  it('4 — no records: nothing is called', async () => {
    const { reads, calls } = setup();
    expect(await reads.attach(HOST, [], { include: ['extensions.acme_links'] }, em)).toEqual([]);
    expect(calls).toEqual([]);
    // …but an unclaimed include is still refused (3 precedes 4).
    expect((await refusal(reads.attach(HOST, [], { include: ['extensions.nobody'] }, em))).code).toBe(
      ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
    );
  });

  it('5 — an absent module is skipped: no call, no key, no error', async () => {
    const { reads, calls } = setup({ present: ['acme_crm'] });
    const out = await reads.attach(HOST, records, { include: ['extensions.acme_links', 'extensions.acme_crm'] }, em);
    expect(calls.map((call) => call.moduleId)).toEqual(['acme_crm']);
    expect(out[0]!.extensions).toEqual({ acme_crm: { ref: 'acme_crm:a' } });
  });

  it('6 — one call per module, sequential in include order, with the ids in record order and the given em', async () => {
    const { reads, calls } = setup();
    await reads.attach(HOST, records, { include: ['extensions.acme_ext', 'extensions.acme_links'] }, em);
    expect(calls).toEqual([
      { moduleId: 'acme_ext', ids: ['a', 'b', 'c'], em },
      { moduleId: 'acme_links', ids: ['a', 'b', 'c'], em },
    ]);
  });

  it('6 — a value the schema refuses throws EntityExtensionLoaderOutputError (500) naming module, host and id', async () => {
    const { reads } = setup({ values: { acme_links: { b: { ref: 42 } } } });
    let error: unknown;
    try {
      await reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EntityExtensionLoaderOutputError);
    const output = error as EntityExtensionLoaderOutputError;
    expect(output.statusCode).toBe(500);
    expect(output.moduleId).toBe('acme_links');
    expect(output.host).toBe(HOST);
    expect(output.message).toContain('"b"');
  });

  it('6 — an id the loader was not asked for is dropped, unparsed', async () => {
    const { reads } = setup({ values: { acme_links: { a: { ref: 'x' }, zzz: { ref: 99 } } } });
    const out = await reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em);
    expect(out.map((record) => record.extensions)).toEqual([
      { acme_links: { ref: 'x' } },
      { acme_links: null },
      { acme_links: null },
    ]);
  });

  it('7 — each record gains extensions for the present modules, null where the loader had no value', async () => {
    const { reads } = setup({ values: { acme_links: { c: { ref: 'only-c' } } } });
    const out = await reads.attach(HOST, records, { include: ['extensions.acme_links', 'extensions.acme_crm'] }, em);
    expect(out).toEqual([
      { id: 'a', name: 'A', extensions: { acme_links: null, acme_crm: { ref: 'acme_crm:a' } } },
      { id: 'b', name: 'B', extensions: { acme_links: null, acme_crm: { ref: 'acme_crm:b' } } },
      { id: 'c', name: 'C', extensions: { acme_links: { ref: 'only-c' }, acme_crm: { ref: 'acme_crm:c' } } },
    ]);
    // The given records are not mutated.
    expect(Object.keys(records[0])).toEqual(['id', 'name']);
  });

  it('does not catch a loader’s error: it is the read’s error', async () => {
    const registry = new EntityExtensionLoaderRegistry({
      declarations: [{ moduleId: 'acme_links', entity: HOST, table: 'acme_links_refs' }],
    });
    const boom = new Error('side table unavailable');
    registry.register('acme_links', [{ host: HOST, schema: z.unknown(), load: async () => Promise.reject(boom) }]);
    const reads = createEntityExtensionReads({ registry, state: { isPresent: () => true } });
    await expect(reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em)).rejects.toBe(boom);
  });
});

describe('lazyEntityExtensionReads', () => {
  it('resolves nothing for a read without include', async () => {
    let resolved = 0;
    const reads = lazyEntityExtensionReads(() => {
      resolved += 1;
      throw new Error('must not resolve');
    });
    expect(await reads.attach(HOST, records, undefined, em)).toEqual(records);
    expect(await reads.attach(HOST, records, { include: [] }, em)).toEqual(records);
    expect(resolved).toBe(0);
  });

  it('delegates an include to the resolved service', async () => {
    const { reads: inner } = setup();
    const reads = lazyEntityExtensionReads(() => inner);
    const out = await reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em);
    expect(out[0]!.extensions).toEqual({ acme_links: { ref: 'acme_links:a' } });
  });

  it('without a service, answers as a composition with no loader: every include is unclaimed', async () => {
    const reads = lazyEntityExtensionReads(() => undefined);
    const error = await refusal(reads.attach(HOST, records, { include: ['extensions.acme_links'] }, em));
    expect(error.code).toBe(ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED);
  });
});
