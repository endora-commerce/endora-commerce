import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';
import type {
  AddressBookRetirementResult,
  AddressBookRetirementService,
} from '../services/address-book-retirement-service.js';

/**
 * The release-1 job that retires the personal address book
 * (`specs/173-b2c-address-book-merge/` plan R-1, OD-2, OD-9, OD-13).
 *
 * A thin BullMQ shell over {@link AddressBookRetirementService} (Principle X):
 * one job under a fixed id, enqueued at every boot of a process that consumes
 * queues. BullMQ keeps one job per id, so several worker processes booting at
 * once produce one run; the job is removed once it settles, so the next boot
 * enqueues it again, finds nothing left and exits. A failed run is retried by
 * BullMQ, and the next boot retries it in any case.
 *
 * The consumer is attached through `ctx.worker` — `defineModuleWorker` — so it
 * runs only while `customers` is present, and a job enqueued while the module
 * is off waits until it is back on (`module-activation.md` item 2). Release 2
 * deletes this file with the table.
 *
 * It is not an install hook (which does not run on upgrade) and not a boot
 * reconciler (which runs in two processes with no lock, where a failure would
 * stop the platform from starting) — plan R-1 sets out why.
 */

export const ADDRESS_BOOK_RETIREMENT_QUEUE = 'customers.address-book-retirement';
/**
 * The fixed job id. It is not the plan's `customers:address-book-retirement`:
 * BullMQ refuses a custom id containing one `:` ("Custom Id cannot contain :"),
 * because it reserves that shape for its repeatable jobs.
 */
export const ADDRESS_BOOK_RETIREMENT_JOB_ID = 'customers.address-book-retirement';

export const ADDRESS_BOOK_RETIREMENT_SCOPE_REASON =
  'customers: retiring the personal address book — moving B2C rows into their personal organizations and erasing the rest (#762)';

export type AddressBookRetirementJobData = Record<string, never>;

export interface AddressBookRetirementJobDeps {
  readonly retirement: Pick<AddressBookRetirementService, 'hasWork' | 'runInScope'>;
  readonly log: PlatformLogger;
}

/**
 * One run. It asks first, with no tenant context, whether any row is left —
 * one boolean over this module's own table — and enters the system scope only
 * when one is, so a boot with nothing to do writes no `tenant.escape_hatch`
 * audit row. A failure is not swallowed: it fails the job, which BullMQ retries.
 */
export async function runAddressBookRetirementJob(
  deps: AddressBookRetirementJobDeps,
): Promise<AddressBookRetirementResult | null> {
  if (!(await deps.retirement.hasWork())) return null;
  const result = await enterSystemScope(ADDRESS_BOOK_RETIREMENT_SCOPE_REASON, () => deps.retirement.runInScope());
  deps.log.info(result, 'customers: personal address book retirement finished');
  if (result.erasedWithoutOrganization > 0) {
    // Principle XI says every account has an Organization; these did not, and
    // their rows were erased rather than moved. Worth an operator's look.
    deps.log.warn(
      { erasedWithoutOrganization: result.erasedWithoutOrganization },
      'customers: personal address book rows of accounts with no Organization were erased',
    );
  }
  return result;
}

export function createAddressBookRetirementQueue(
  redis: Redis,
  prefix?: string,
): Queue<AddressBookRetirementJobData> {
  return new Queue<AddressBookRetirementJobData>(ADDRESS_BOOK_RETIREMENT_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
  });
}

export function buildAddressBookRetirementWorker(
  deps: AddressBookRetirementJobDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<AddressBookRetirementJobData> {
  return new Worker<AddressBookRetirementJobData>(
    ADDRESS_BOOK_RETIREMENT_QUEUE,
    async () => {
      await runAddressBookRetirementJob(deps);
    },
    {
      connection: deps.redis,
      concurrency: 1,
      ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
    },
  );
}

/**
 * Build the consumer and enqueue the one job — where the host says this process
 * consumes queues and offers a connection to build one on. The shared test
 * server says neither and drives the service directly. Answers whether a
 * consumer was started.
 */
export async function startAddressBookRetirement(
  input: AddressBookRetirementJobDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<AddressBookRetirementJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createAddressBookRetirementQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildAddressBookRetirementWorker({
      redis: moduleQueueRedis,
      retirement: input.retirement,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await queue.add(
    'retire',
    {},
    {
      jobId: ADDRESS_BOOK_RETIREMENT_JOB_ID,
      // Removed once settled either way: a kept job would hold the id, and the
      // next boot's add would then be a silent no-op that never retries.
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );
  return true;
}
