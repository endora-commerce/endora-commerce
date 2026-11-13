import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * The prompt start of quote request notification delivery —
 * `specs/179-rfq-and-customer-notifications/` FR-010, research R-8,
 * `contracts/delivery-and-ports.md` §3.
 *
 * A writer that committed delivery records kicks the delivery queue, so the
 * worker reaches them in seconds rather than on its next scheduled tick. The
 * kick is the **only** step a transition takes after its commit for
 * notifications, and it carries nothing: the records are in the table, which
 * is the queue; the job is a wake-up call. One fixed job id, so a burst of
 * transitions leaves one waiting job, not one per transition. Losing a kick
 * (Redis down or flushed) loses nothing but latency: the scheduled tick finds
 * the records.
 *
 * **It never fails a transition, and never makes one wait.** The add is
 * started and not awaited — a BullMQ connection retries a command for as long
 * as Redis is away, so awaiting it would hold the buyer's answer hostage to
 * Redis — and a failure, at once or later, is logged at `warn`.
 */

export const RFQ_NOTIFICATION_DELIVERY_QUEUE = 'quote_requests.notifications.deliver';
export const RFQ_NOTIFICATION_KICK_JOB = 'kick';
export const RFQ_NOTIFICATION_KICK_JOB_ID = 'quote_requests.notifications.kick';

/** Wake the delivery worker. Returns at once; never throws. */
export type NotificationKick = () => void;

/** The part of a BullMQ queue the kick uses. */
export interface KickQueue {
  add(
    name: string,
    data: Record<string, never>,
    options: { jobId: string; removeOnComplete: boolean; removeOnFail: boolean },
  ): Promise<unknown>;
}

export interface NotificationKickDeps {
  /** The delivery queue, or `undefined` where the composition offers none (the shared test server). */
  queue: () => KickQueue | undefined;
  log: Pick<PlatformLogger, 'warn'>;
}

export function createNotificationKick(deps: NotificationKickDeps): NotificationKick {
  const warn = (error: unknown): void => {
    deps.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'quote_requests: the notification delivery kick was not queued; the scheduled tick delivers instead',
    );
  };
  return () => {
    let adding: Promise<unknown>;
    try {
      const queue = deps.queue();
      if (queue === undefined) return;
      // A finished job is removed, or its id would refuse the next kick.
      adding = queue.add(
        RFQ_NOTIFICATION_KICK_JOB,
        {},
        { jobId: RFQ_NOTIFICATION_KICK_JOB_ID, removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      warn(error);
      return;
    }
    void adding.catch(warn);
  };
}

/**
 * The composed kick: the delivery queue built on the host's module queue
 * connection on first use, so a process that never commits a transition opens
 * nothing. No connection (the shared test server) — no queue, and the kick
 * does nothing.
 */
export function createNotificationKickProducer(
  redis: Redis | undefined,
  log: Pick<PlatformLogger, 'warn'>,
): { kick: NotificationKick; close(): Promise<void> } {
  let queue: Queue | undefined;
  return {
    kick: createNotificationKick({
      queue: () =>
        redis === undefined ? undefined : (queue ??= new Queue(RFQ_NOTIFICATION_DELIVERY_QUEUE, { connection: redis })),
      log,
    }),
    async close() {
      await queue?.close();
      queue = undefined;
    },
  };
}
