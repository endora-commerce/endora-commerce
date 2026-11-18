import { Setting } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from '../../helpers/test-server.js';

/**
 * The `returns-notifications` queue as a returns test sees it
 * (`specs/180-off-platform-complaints/` research R-2): the shared test server has no
 * queue connection, so a file swaps the producer for one that keeps what it was
 * asked to enqueue, and drives the processor — the worker's body, in the system
 * scope — itself.
 */
export type CapturedReturnsJob =
  | { kind: 'case_submitted'; returnCaseId: string }
  | { kind: 'comment_notify'; returnCaseCommentId: string }
  | { kind: 'status_entered'; returnCaseId: string; statusCode: string; eventId: string }
  // `specs/181-guest-complaints/` (contracts/settings-emails-events.md §7).
  | { kind: 'guest_verification'; verificationId: string }
  | { kind: 'guest_link_reissued'; caseId: string; trackingVersion: number };

/** `setupBackendServer({ moduleOverrides })`'s entry: a producer that records each job in `into`. */
export function captureReturnsNotificationJobs(into: CapturedReturnsJob[]): Record<string, unknown> {
  return {
    returnsNotificationProducer: {
      enqueue: async (job: CapturedReturnsJob) => {
        into.push(job);
        return true;
      },
      close: async () => undefined,
    },
  };
}

/** Run one job through the container's processor, as the worker would, with no recorded progress. */
export async function processReturnsNotification(h: BackendServerHandle, job: CapturedReturnsJob): Promise<unknown> {
  const processor = h.container.resolve<(job: unknown) => Promise<unknown>>('returnsNotificationProcessor');
  return processor({ name: job.kind, data: job, progress: undefined, updateProgress: async () => undefined });
}

/**
 * Give a returns setting a platform-wide value for the duration of a test, the way
 * the Admin Settings screen stores it, with the settings cache dropped. Returns the
 * function that puts back what was there.
 */
export async function overrideReturnsSetting(
  h: BackendServerHandle,
  code: string,
  value: unknown,
): Promise<() => Promise<void>> {
  const em = h.em();
  const setting = await em.findOneOrFail(Setting, { code });
  const before: unknown = setting.globalValue ?? null;
  setting.globalValue = value;
  await em.flush();
  await h.settings.cache.invalidate(code);
  return async () => {
    const restore = h.em();
    const row = await restore.findOneOrFail(Setting, { code });
    row.globalValue = before;
    await restore.flush();
    await h.settings.cache.invalidate(code);
  };
}
