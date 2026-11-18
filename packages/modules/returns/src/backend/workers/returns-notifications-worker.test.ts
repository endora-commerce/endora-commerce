import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { ReturnsNotificationDispatch, type DispatchDeps, type ReturnsNotificationJob } from '../services/notifications/dispatch.js';
import {
  RETURNS_NOTIFICATIONS_QUEUE,
  createReturnsNotificationProducer,
  returnsNotificationProcessor,
  startReturnsNotifications,
  type ReturnsNotificationJobLike,
} from './returns-notifications-worker.js';

/**
 * `specs/180-off-platform-complaints/` T020 (research R-2, FR-A50, FR-A51): the
 * `returns-notifications` processor — every job kind in the system scope with a
 * reason, a refusal while `returns` is off, nothing for a row that is gone.
 */
const CASE_ID = '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab';

function job(data: ReturnsNotificationJob, progress: unknown = undefined): ReturnsNotificationJobLike & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    name: data.kind,
    data,
    progress,
    saved,
    updateProgress: async (p: object) => void saved.push(p),
  };
}

function realDispatch(over: Partial<DispatchDeps> = {}): ReturnsNotificationDispatch {
  return new ReturnsNotificationDispatch({
    isPresent: () => true,
    store: {
      loadCase: async () => null,
      loadComment: async () => null,
      loadStatus: async () => null,
      loadGuestVerification: async () => null,
    },
    sender: () => ({ send: vi.fn(async () => ({ status: 'sent' as const })) }),
    customers: { findById: async () => null, findByEmail: async () => null },
    organizations: { findById: async () => null },
    language: async () => 'en-US',
    timeZone: async () => 'Europe/Warsaw',
    newCaseRecipients: async () => ({ recipients: [], invalid: [] }),
    bell: { announceNewCase: vi.fn(async () => ({ status: 'not_present' as const })) },
    guestLinks: { verificationToken: (id: string) => `sealed-${id}`, trackingToken: (id: string, v: number) => `track-${id}-${v}` },
    storefrontBaseUrl: undefined,
    adminBaseUrl: null,
    log: () => undefined,
    ...over,
  });
}

describe('returnsNotificationProcessor', () => {
  it.each<ReturnsNotificationJob>([
    { kind: 'case_submitted', returnCaseId: CASE_ID },
    { kind: 'comment_notify', returnCaseCommentId: CASE_ID },
    { kind: 'status_entered', returnCaseId: CASE_ID, statusCode: 'received', eventId: CASE_ID },
  ])('runs $kind in the system scope with a reason', async (data) => {
    const seen: Array<{ job: ReturnsNotificationJob; mode: string | undefined; reason: string | undefined }> = [];
    const dispatch = {
      dispatch: vi.fn(async (j: ReturnsNotificationJob) => {
        const ctx = getTenantContext() as { mode?: string; reason?: string } | undefined;
        seen.push({ job: j, mode: ctx?.mode, reason: ctx?.reason });
        return { messages: [] };
      }),
    };
    await returnsNotificationProcessor(dispatch)(job(data));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.job).toEqual(data);
    expect(seen[0]!.mode).toBe('system');
    expect(seen[0]!.reason?.trim()).toBeTruthy();
  });

  it('hands the job’s recorded progress to the dispatch and records what it did', async () => {
    const dispatch = {
      dispatch: vi.fn(async (_j: ReturnsNotificationJob, attempt?: { done: readonly string[]; record(d: readonly string[]): Promise<void> }) => {
        expect(attempt?.done).toEqual(['customer']);
        await attempt?.record(['bell:a1', 'customer']);
        return { messages: [] };
      }),
    };
    const j = job({ kind: 'case_submitted', returnCaseId: CASE_ID }, { done: ['customer', 42] });
    await returnsNotificationProcessor(dispatch)(j);
    expect(j.saved).toEqual([{ done: ['bell:a1', 'customer'] }]);
  });

  it('refuses with ModuleDisabledError while returns is off', async () => {
    const processor = returnsNotificationProcessor(realDispatch({ isPresent: () => false }));
    await expect(processor(job({ kind: 'case_submitted', returnCaseId: CASE_ID }))).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('does nothing for a case or a comment that no longer exists', async () => {
    const send = vi.fn();
    const processor = returnsNotificationProcessor(realDispatch({ sender: () => ({ send }) }));
    expect(await processor(job({ kind: 'case_submitted', returnCaseId: CASE_ID }))).toEqual({ skipped: 'gone', messages: [] });
    expect(await processor(job({ kind: 'comment_notify', returnCaseCommentId: CASE_ID }))).toEqual({ skipped: 'gone', messages: [] });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the producer and the consumer', () => {
  it('names the queue in kebab case', () => {
    expect(RETURNS_NOTIFICATIONS_QUEUE).toBe('returns-notifications');
  });

  it('enqueues nothing without a queue connection (the shared test server)', async () => {
    const producer = createReturnsNotificationProducer(undefined);
    expect(await producer.enqueue({ kind: 'case_submitted', returnCaseId: CASE_ID })).toBe(false);
    await producer.close();
  });

  it('starts no consumer where the host runs no workers or offers no connection', () => {
    const attach = vi.fn();
    const dispatch = realDispatch();
    expect(startReturnsNotifications({ dispatch, processRunsWorkers: false, moduleQueueRedis: {} as never, attach })).toBe(false);
    expect(startReturnsNotifications({ dispatch, processRunsWorkers: true, moduleQueueRedis: undefined, attach })).toBe(false);
    expect(attach).not.toHaveBeenCalled();
  });
});
