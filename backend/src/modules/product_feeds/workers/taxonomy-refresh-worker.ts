import type { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { DEFAULT_TAXONOMY_FETCH_CRON } from '../manifest.js';
import { defineModuleWorker } from '../../_lifecycle/plugin-helpers.js';
import type { TaxonomyProviderCode } from '@b2b/contracts';
import type { TaxonomyRefreshService } from '../services/taxonomy-refresh.service.js';
import {
  createTaxonomyRefreshWorker,
  type TaxonomyRefreshJobData,
} from '../services/queues/taxonomy-refresh-queue.js';

/**
 * The taxonomy check consumer — feature 067 / FR-087, FR-089, FR-093,
 * research §§R21, R22.
 *
 * One module-wide Job Scheduler, `product_feeds:taxonomy-refresh`, on exactly
 * the shape `feed-run-reaper-worker.ts` already established: a scheduler rather
 * than a `setInterval` because Principle X prohibits timers inside the API
 * process and a Redis-held schedule survives a deploy.
 *
 * **Off deletes the scheduler.** The desired state asserted by
 * `FeedScheduleReconciler` is "this scheduler exists **iff**
 * `product_feeds.taxonomy_fetch_enabled` is true", so turning the switch off
 * removes the job rather than leaving one that fires weekly and returns early.
 * That is what makes FR-087's "no outbound request whatsoever" a structural
 * claim instead of a code-review claim.
 *
 * **Boot is never involved.** The boot path asserts the *schedule*; it does not
 * fetch. A brand-new installation with the switch on and no network boots
 * identically to one with no network and the switch off.
 *
 * The handler never throws: `runCheck` records every outcome as a row and
 * returns, so the job always completes and no check can fail a boot, a
 * generation run, or itself into a retry storm.
 */

export const TAXONOMY_REFRESH_SCHEDULER_ID = 'product_feeds:taxonomy-refresh';

const PROVIDERS: readonly TaxonomyProviderCode[] = ['google_merchant', 'meta'];

export interface TaxonomyRefreshWorkerDeps {
  redis: Redis;
  refresh: Pick<TaxonomyRefreshService, 'runCheck' | 'isCheckInFlight'>;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

export function registerTaxonomyRefreshWorker(
  deps: TaxonomyRefreshWorkerDeps,
): Worker<TaxonomyRefreshJobData> {
  return defineModuleWorker(
    'product_feeds',
    createTaxonomyRefreshWorker(deps.redis, async (job) => {
      const requested = job.data.providerCode;
      const providers = requested ? [requested] : PROVIDERS;
      for (const providerCode of providers) {
        try {
          // A scheduled tick that collides with a manual check is skipped
          // rather than queued behind it — the same "one at a time, and the
          // next tick is the retry" rule the generation claim uses.
          if (!requested && (await deps.refresh.isCheckInFlight(providerCode))) continue;
          await deps.refresh.runCheck({
            providerCode,
            trigger: requested ? 'manual' : 'scheduled',
            ...(job.data.checkId !== undefined ? { checkId: job.data.checkId } : {}),
          });
        } catch (err) {
          // `runCheck` already swallows its own failures; reaching here means a
          // defect, and it still must not fail the job (FR-093).
          deps.logWarn?.('product_feeds: taxonomy check failed', {
            providerCode,
            error: String(err),
          });
        }
      }
    }),
  );
}

/**
 * Installs the module-wide check schedule. Idempotent by scheduler id, so it is
 * safe on every boot of every worker process — which is how it is called.
 */
export async function ensureTaxonomyRefreshSchedule(
  queue: Queue<TaxonomyRefreshJobData>,
  cron: string = DEFAULT_TAXONOMY_FETCH_CRON,
): Promise<void> {
  await queue.upsertJobScheduler(
    TAXONOMY_REFRESH_SCHEDULER_ID,
    // No `tz`: per-feed schedules carry an IANA zone because an operator
    // reasons about "before the shop opens"; nobody reasons about when a
    // taxonomy check runs, and fixing it to UTC removes a DST question with no
    // user-visible payoff (research §R21).
    { pattern: cron },
    { name: 'check', data: {} },
  );
}

/** The other half of the switch: off means the job does not exist. */
export async function removeTaxonomyRefreshSchedule(
  queue: Queue<TaxonomyRefreshJobData>,
): Promise<void> {
  // command-coverage-ignore: Redis-only. Removing the Job Scheduler projects
  // the already-committed `product_feeds.taxonomy_fetch_enabled` setting, whose
  // own write the Settings module audits.
  await queue.removeJobScheduler(TAXONOMY_REFRESH_SCHEDULER_ID).catch(() => undefined);
}
