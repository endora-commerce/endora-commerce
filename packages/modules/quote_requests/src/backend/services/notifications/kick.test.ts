import { describe, expect, it, vi } from 'vitest';
import {
  RFQ_NOTIFICATION_KICK_JOB,
  RFQ_NOTIFICATION_KICK_JOB_ID,
  createNotificationKick,
} from './kick.js';

/**
 * `specs/179-rfq-and-customer-notifications/` T031 — the kick a committing
 * writer adds to the delivery queue (`contracts/delivery-and-ports.md` §3).
 * It is the only step after the commit, and it must never fail the transition.
 */
describe('notification kick', () => {
  const quietLog = () => ({ warn: vi.fn() });

  it('adds one deduplicated kick job to the delivery queue', () => {
    const add = vi.fn(async () => undefined);
    const kick = createNotificationKick({ queue: () => ({ add }), log: quietLog() });
    kick();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      RFQ_NOTIFICATION_KICK_JOB,
      {},
      expect.objectContaining({ jobId: RFQ_NOTIFICATION_KICK_JOB_ID, removeOnComplete: true, removeOnFail: true }),
    );
    expect(RFQ_NOTIFICATION_KICK_JOB_ID).toBe('quote_requests.notifications.kick');
  });

  it('a rejected add is logged at warn and never reaches the caller', async () => {
    const log = quietLog();
    const kick = createNotificationKick({
      queue: () => ({ add: async () => Promise.reject(new Error('redis is down')) }),
      log,
    });
    expect(() => kick()).not.toThrow();
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));
    expect(log.warn.mock.calls[0]![0]).toEqual({ error: 'redis is down' });
  });

  it('an add that throws at once is logged and never reaches the caller', () => {
    const log = quietLog();
    const kick = createNotificationKick({
      queue: () => ({
        add: () => {
          throw new Error('queue closed');
        },
      }),
      log,
    });
    expect(() => kick()).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the queue: a hanging add leaves the caller free', () => {
    const add = vi.fn(() => new Promise<never>(() => undefined));
    const kick = createNotificationKick({ queue: () => ({ add }), log: quietLog() });
    expect(kick()).toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('is a no-op where the composition offers no queue (the shared test server)', () => {
    const log = quietLog();
    const kick = createNotificationKick({ queue: () => undefined, log });
    expect(() => kick()).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
