import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { QuoteRequest } from '../../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../../entities/quote-request-event.entity.js';
import { QuoteRequestNotification } from '../../entities/quote-request-notification.entity.js';
import {
  RFQ_NOTIFICATION_BATCH_SIZE,
  RFQ_NOTIFICATION_FRESHNESS_MS,
  RFQ_NOTIFICATION_MAX_ATTEMPTS,
  RFQ_NOTIFICATION_RETRY_LADDER_MS,
  RfqNotificationDeliveryService,
  type ChannelAdapter,
  type DeliveryOutcome,
} from './delivery-service.js';

/**
 * `specs/179-rfq-and-customer-notifications/` FR-010 – FR-016 (T040): what one
 * pass does with one record — stale, owner absent, owner refusing, a failed
 * attempt and its backoff, the fifth failure, and a record that is already
 * closed. The database is stood in for by a table of records the fake
 * EntityManager answers from; the claim's locking is the integration test's.
 */

const NOW = new Date('2026-11-13T12:00:00.000Z');
const MINUTE = 60_000;

type Row = QuoteRequestNotification;

function record(overrides: Partial<Row> = {}): Row {
  const row = Object.assign(new QuoteRequestNotification(), {
    id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    organizationId: '10000000-0000-4000-8000-000000000001',
    quoteRequestId: '20000000-0000-4000-8000-000000000001',
    sourceEventId: '30000000-0000-4000-8000-000000000001',
    change: 'submitted',
    recipientKind: 'admin',
    recipientId: '40000000-0000-4000-8000-000000000001',
    channel: 'admin_in_app',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(NOW.getTime() - MINUTE),
    lastError: null,
    sourceOccurredAt: new Date(NOW.getTime() - 5 * MINUTE),
    createdAt: new Date(NOW.getTime() - 5 * MINUTE),
    closedAt: null,
  } satisfies Partial<Row>);
  return Object.assign(row, overrides);
}

/** An EntityManager over `rows`: the claim lists and locks the due pending ones, reads answer by id. */
function fakeEm(rows: Row[]) {
  const rfq = Object.assign(new QuoteRequest(), { id: '20000000-0000-4000-8000-000000000001' });
  const event = Object.assign(new QuoteRequestEvent(), { id: '30000000-0000-4000-8000-000000000001' });
  const due = (now: Date) =>
    rows
      .filter((row) => row.status === 'pending' && row.nextAttemptAt.getTime() <= now.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const em = {
    flushes: 0,
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      const now = params[0] as Date;
      if (sql.startsWith('select (exists')) return [{ has_work: due(now).length > 0 }];
      if (sql.includes('for update skip locked')) {
        const id = params[params.length - 1];
        return due(now).filter((row) => row.id === id).map((row) => ({ id: row.id }));
      }
      const limit = params[params.length - 1] as number;
      return due(now)
        .slice(0, limit)
        .map((row) => ({ id: row.id }));
    }),
    transactional: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(em),
    findOne: vi.fn(async (entity: unknown, where: { id: string } | string) => {
      const id = typeof where === 'string' ? where : where.id;
      if (entity === QuoteRequestNotification) return rows.find((row) => row.id === id) ?? null;
      if (entity === QuoteRequest) return rfq;
      if (entity === QuoteRequestEvent) return event;
      return null;
    }),
    flush: vi.fn(async () => {
      em.flushes += 1;
    }),
  };
  return em;
}

function adapter(deliver: ChannelAdapter['deliver'], owner = 'admin_notifications'): ChannelAdapter & {
  deliver: ReturnType<typeof vi.fn>;
} {
  return { owner, deliver: vi.fn(deliver) };
}

function service(rows: Row[], options: { adapter?: ChannelAdapter; present?: (moduleId: string) => boolean } = {}) {
  const em = fakeEm(rows);
  const bell = options.adapter ?? adapter(async () => ({ status: 'sent' }));
  const log = vi.fn();
  const delivery = new RfqNotificationDeliveryService({
    emFactory: () => em as never,
    adapters: { admin_in_app: bell },
    isPresent: options.present ?? (() => true),
    log,
  });
  return { delivery, em, bell: bell as ChannelAdapter & { deliver: ReturnType<typeof vi.fn> }, log };
}

describe('RfqNotificationDeliveryService — one pass', () => {
  it('states the contract’s numbers: 200 a pass, 24 hours fresh, five attempts, 1 m / 5 m / 30 m / 2 h', () => {
    expect(RFQ_NOTIFICATION_BATCH_SIZE).toBe(200);
    expect(RFQ_NOTIFICATION_FRESHNESS_MS).toBe(24 * 60 * MINUTE);
    expect(RFQ_NOTIFICATION_MAX_ATTEMPTS).toBe(5);
    expect(RFQ_NOTIFICATION_RETRY_LADDER_MS).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE]);
  });

  it('delivers a due record through its channel’s adapter and closes it sent', async () => {
    const row = record();
    const { delivery, bell } = service([row]);
    const result = await delivery.deliverInScope(NOW);
    expect(bell.deliver).toHaveBeenCalledTimes(1);
    expect(bell.deliver.mock.calls[0]?.[0]).toMatchObject({ record: row });
    expect(row).toMatchObject({ status: 'sent', attempts: 1, lastError: null, closedAt: NOW });
    expect(result).toMatchObject({ claimed: 1, closed: 1, retried: 0, reachedBatchLimit: false });
  });

  it('a record whose change is more than 24 hours old closes skipped_stale without calling an adapter (FR-011)', async () => {
    const row = record({ sourceOccurredAt: new Date(NOW.getTime() - RFQ_NOTIFICATION_FRESHNESS_MS - 1) });
    const { delivery, bell } = service([row]);
    await delivery.deliverInScope(NOW);
    expect(bell.deliver).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'skipped_stale', closedAt: NOW });
  });

  it('exactly 24 hours is still fresh', async () => {
    const row = record({ sourceOccurredAt: new Date(NOW.getTime() - RFQ_NOTIFICATION_FRESHNESS_MS) });
    const { delivery } = service([row]);
    await delivery.deliverInScope(NOW);
    expect(row.status).toBe('sent');
  });

  it('the channel’s owner absent closes skipped_module_off without calling the adapter (FR-012)', async () => {
    const row = record();
    const present = vi.fn((moduleId: string) => moduleId !== 'admin_notifications');
    const { delivery, bell } = service([row], { present });
    await delivery.deliverInScope(NOW);
    expect(present).toHaveBeenCalledWith('admin_notifications');
    expect(bell.deliver).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'skipped_module_off', closedAt: NOW });
  });

  it('a ModuleDisabledError from the owner’s port (the flip landed after the check) closes skipped_module_off', async () => {
    const row = record();
    const { delivery } = service([row], {
      adapter: adapter(async () => {
        throw new ModuleDisabledError('admin_notifications');
      }),
    });
    await delivery.deliverInScope(NOW);
    expect(row).toMatchObject({ status: 'skipped_module_off', attempts: 1, closedAt: NOW });
  });

  it('a ModuleDisabledError for quote_requests itself is re-thrown and fails the pass', async () => {
    const row = record();
    const { delivery } = service([row], {
      adapter: adapter(async () => {
        throw new ModuleDisabledError('quote_requests');
      }),
    });
    await expect(delivery.deliverInScope(NOW)).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(row.status).toBe('pending');
  });

  it.each([
    [1, MINUTE],
    [2, 5 * MINUTE],
    [3, 30 * MINUTE],
    [4, 120 * MINUTE],
  ])('failed attempt %i stays pending and is due again %i ms later', async (attempt, delay) => {
    const row = record({ attempts: attempt - 1 });
    const { delivery } = service([row], {
      adapter: adapter(async () => {
        throw new Error('smtp: connection refused');
      }),
    });
    const result = await delivery.deliverInScope(NOW);
    expect(row).toMatchObject({
      status: 'pending',
      attempts: attempt,
      lastError: 'smtp: connection refused',
      closedAt: null,
    });
    expect(row.nextAttemptAt.getTime()).toBe(NOW.getTime() + delay);
    expect(result).toMatchObject({ claimed: 1, closed: 0, retried: 1 });
  });

  it('the fifth failure closes the record failed, with its error truncated to 2000 characters (FR-015)', async () => {
    const row = record({ attempts: RFQ_NOTIFICATION_MAX_ATTEMPTS - 1 });
    const { delivery } = service([row], {
      adapter: adapter(async () => {
        throw new Error('x'.repeat(5000));
      }),
    });
    await delivery.deliverInScope(NOW);
    expect(row).toMatchObject({ status: 'failed', attempts: 5, closedAt: NOW });
    expect(row.lastError).toHaveLength(2000);
  });

  it('an adapter’s own closing with an error (no_definition) is stored as it is', async () => {
    const row = record();
    const outcome: DeliveryOutcome = { status: 'failed', lastError: 'no_definition' };
    const { delivery } = service([row], { adapter: adapter(async () => outcome) });
    await delivery.deliverInScope(NOW);
    expect(row).toMatchObject({ status: 'failed', lastError: 'no_definition', attempts: 1, closedAt: NOW });
  });

  it('a closed record is not claimed and never touched again', async () => {
    const closedAt = new Date(NOW.getTime() - MINUTE);
    const row = record({ status: 'sent', attempts: 1, closedAt });
    const { delivery, bell } = service([row]);
    const result = await delivery.deliverInScope(NOW);
    expect(bell.deliver).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'sent', attempts: 1, closedAt });
    expect(result.claimed).toBe(0);
  });

  it('a record waiting out its backoff is not due yet', async () => {
    const row = record({ attempts: 1, nextAttemptAt: new Date(NOW.getTime() + MINUTE) });
    const { delivery, bell } = service([row]);
    expect(await delivery.hasDeliverable(NOW)).toBe(false);
    await delivery.deliverInScope(NOW);
    expect(bell.deliver).not.toHaveBeenCalled();
    expect(row.status).toBe('pending');
  });

  it('claims only the channels it has an adapter for — the others are left as they are', async () => {
    const { delivery, em } = service([record()]);
    await delivery.hasDeliverable(NOW);
    const [sql, params] = em.execute.mock.calls[0]!;
    expect(sql).toContain('"channel" in (?)');
    expect(params).toEqual([NOW, 'admin_in_app']);
  });

  it('one failing record costs that record alone', async () => {
    const failing = record({ recipientId: '40000000-0000-4000-8000-00000000000f' });
    const fine = record({ createdAt: new Date(NOW.getTime() - MINUTE) });
    const { delivery } = service([failing, fine], {
      adapter: adapter(async ({ record: r }) => {
        if (r.id === failing.id) throw new Error('boom');
        return { status: 'sent' };
      }),
    });
    await delivery.deliverInScope(NOW);
    expect(failing.status).toBe('pending');
    expect(fine.status).toBe('sent');
  });
});
