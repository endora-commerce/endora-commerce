import { readFileSync } from 'node:fs';

import type { EntityManager } from '@mikro-orm/postgresql';
import type { BulkOperationLogEntry } from '@endora-commerce/contracts';
import { describe, expect, it, vi } from 'vitest';

import { BULK_OPERATION_LOG_ENGLISH, BulkOperationService } from './bulk-operation.service.js';
import type { CatalogBulkUpdateService } from './catalog-bulk-update.service.js';

/**
 * Issue #95 (`catalog`) — a bulk operation's log trail is stored and read
 * later by whichever administrators open it, each in a language of their own,
 * so the backend cannot write it in its reader's language. Every entry stores
 * the key and params its reader translates, beside an English sentence for a
 * reader that cannot. The entries used to be Polish sentences.
 *
 * Rendered through this module's bundles, the Polish reader sees exactly the
 * sentences the trail carried before.
 */

const OP = '00000000-0000-4000-8000-0000000000bb';
const REQUESTER = '00000000-0000-4000-8000-0000000000aa';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

/** What the bulk-operations screen draws for an entry, in `language`. */
function render(entry: BulkOperationLogEntry, language: 'en' | 'pl'): string {
  if (!entry.messageKey) return entry.message;
  const template = bundle(language)[entry.messageKey.key];
  if (template === undefined) return entry.message;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    entry.messageKey?.params?.[name] != null ? String(entry.messageKey.params[name]) : match,
  );
}

function harness(options: { type?: string; failed?: number; throws?: Error } = {}) {
  const op: Record<string, unknown> = {
    id: OP,
    type: options.type ?? 'product_bulk_update',
    status: 'pending',
    requestedByAdminUserId: REQUESTER,
    total: 4,
    payload: { productIds: ['p-1', 'p-2', 'p-3', 'p-4'], fields: { archived: true } },
    logs: [],
  };
  const updates: Array<Record<string, unknown>> = [];
  const em = {
    nativeUpdate: vi.fn(async (_e: unknown, _w: unknown, data: Record<string, unknown>) => {
      updates.push(data);
      return 1;
    }),
    findOne: vi.fn(async () => op),
    persistAndFlush: vi.fn(async () => undefined),
  };
  const failed = options.failed ?? 0;
  const bulkUpdate = vi.fn(async () => {
    if (options.throws) throw options.throws;
    return {
      summary: { total: 4, succeeded: 4 - failed - 1, skipped: 1, failed },
      results: [],
    };
  });
  const service = new BulkOperationService(
    () => em as unknown as EntityManager,
    { bulkUpdate } as unknown as CatalogBulkUpdateService,
    {
      permissionChecker: {
        isActiveAdministrator: async () => true,
        hasPermission: async () => true,
      },
      reindexRunner: async () => ({ documentCount: 120 }),
    },
  );
  const logs = (): BulkOperationLogEntry[] =>
    ([...updates].reverse().find((u) => u['logs'] !== undefined)?.['logs'] ?? []) as BulkOperationLogEntry[];
  return { service, logs };
}

describe('bulk operation log — a key for its reader, English beside it (issue #95)', () => {
  it("keeps the stored English equal to the bundle's, and ships every key in Polish", () => {
    const en = bundle('en');
    const pl = bundle('pl');
    for (const [key, english] of Object.entries(BULK_OPERATION_LOG_ENGLISH)) {
      expect(en[key], key).toBe(english);
      expect(pl[key], key).toBeTypeOf('string');
    }
  });

  it('stores English sentences and keys for a completed product bulk edit', async () => {
    const h = harness({ failed: 2 });
    await h.service.processById(OP);

    expect(h.logs().map((entry) => entry.message)).toEqual([
      'Started processing the operation (4 items).',
      'Finished: 1 succeeded, 1 skipped, 2 failed (4 in total).',
      '2 items failed — see the status of each item for details.',
    ]);
    expect(h.logs().map((entry) => entry.messageKey)).toEqual([
      { key: 'bulkOperations.log.started', params: { total: 4 } },
      {
        key: 'bulkOperations.log.finished',
        params: { succeeded: 1, skipped: 1, failed: 2, total: 4 },
      },
      { key: 'bulkOperations.log.itemsFailed', params: { failed: 2 } },
    ]);
  });

  it('renders for a Polish reader exactly what the trail said before', async () => {
    const h = harness({ failed: 2 });
    await h.service.processById(OP);

    expect(h.logs().map((entry) => render(entry, 'pl'))).toEqual([
      'Rozpoczęto przetwarzanie operacji (4 elementów).',
      'Zakończono: 1 z powodzeniem, 1 pominięto, 2 z błędem (łącznie 4).',
      '2 elementów zakończyło się błędem — szczegóły w statusie pojedynczych elementów.',
    ]);
    expect(h.logs().map((entry) => render(entry, 'en'))).toEqual(h.logs().map((entry) => entry.message));
  });

  it('records a queued operation in both languages', async () => {
    const h = harness();
    const created = await h.service.create({
      requestedByAdminUserId: REQUESTER,
      payload: { productIds: ['p-1', 'p-2', 'p-3'], fields: { archived: true } },
    } as never);
    expect(created.logs?.map((entry) => entry.message)).toEqual(['Operation created and queued (3 items).']);
    expect(created.logs?.map((entry) => render(entry, 'pl'))).toEqual([
      'Operacja utworzona i dodana do kolejki (3 elementów).',
    ]);

    const reindex = await h.service.create({
      type: 'search_reindex',
      requestedByAdminUserId: null,
      payload: { productIds: [] },
    } as never);
    expect(reindex.logs?.map((entry) => entry.message)).toEqual(['Search reindex operation created and queued.']);
    expect(reindex.logs?.map((entry) => render(entry, 'pl'))).toEqual([
      'Operacja przeindeksowania wyszukiwarki utworzona i dodana do kolejki.',
    ]);
  });

  it('records a failure in both languages', async () => {
    const h = harness({ throws: new Error('database unavailable') });
    await h.service.processById(OP);

    const last = h.logs().at(-1)!;
    expect(last.message).toBe('The operation failed: database unavailable');
    expect(render(last, 'pl')).toBe('Operacja nie powiodła się: database unavailable');
  });

  it('records a search reindex in both languages', async () => {
    const h = harness({ type: 'search_reindex' });
    await h.service.processById(OP);

    const last = h.logs().at(-1)!;
    expect(last.message).toBe('Reindexed 120 documents across all indexes.');
    expect(render(last, 'pl')).toBe('Przeindeksowano 120 dokumentów we wszystkich indeksach.');
  });
});
