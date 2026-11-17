import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type {
  DispatchAttempt,
  DispatchReport,
  ReturnsNotificationDispatch,
  ReturnsNotificationJob,
} from '../services/notifications/dispatch.js';

/**
 * The return-case notifications, sent from a queue (`specs/180-off-platform-complaints/`
 * research R-2, Constitution X; `forms`' `forms-notifications-worker.ts` is the model).
 *
 * **A job carries ids and nothing else**: `case_submitted { returnCaseId }`,
 * `comment_notify { returnCaseCommentId }`, `status_entered { returnCaseId,
 * statusCode, eventId }`, `guest_verification { verificationId }` and
 * `guest_link_reissued { caseId, trackingVersion }` (`specs/181-guest-complaints/` —
 * every guest link is re-derived when the job runs). What the e-mails say is read when the job runs, so no
 * personal data enters Redis, and a row gone in between is simply not mailed. Five
 * attempts with exponential backoff from 10 s; the request that produced the job
 * was answered before it was taken (FR-A50).
 *
 * Runs in the existing worker process like every module consumer, through
 * `ctx.worker`. A composition without queues (`moduleQueueRedis` undefined — the
 * shared test server) enqueues nothing and builds no consumer; its tests drive
 * {@link returnsNotificationProcessor} directly.
 *
 * **Accepted loss window** (R-2): a process that dies between the commit and the
 * enqueue sends nothing for that event; the failure to enqueue is logged by the
 * producer's caller. This is `forms`' FR-059 trade, stated rather than hidden.
 */

export const RETURNS_NOTIFICATIONS_QUEUE = 'returns-notifications';

const SCOPE_REASON = 'returns: send the e-mails and the bell entries of a return case';

const JOB_ATTEMPTS = 5;
const JOB_BACKOFF = { type: 'exponential', delay: 10_000 } as const;

export interface ReturnsNotificationProducer {
  /** Ask for the notifications of one event. Answers whether a job was enqueued. */
  enqueue(job: ReturnsNotificationJob): Promise<boolean>;
  close(): Promise<void>;
}

/** One job per event: a redelivered event adds nothing. */
function jobIdOf(job: ReturnsNotificationJob): string {
  switch (job.kind) {
    case 'case_submitted':
      return `case-${job.returnCaseId}`;
    case 'comment_notify':
      return `comment-${job.returnCaseCommentId}`;
    case 'status_entered':
      return `status-${job.eventId}`;
    case 'guest_verification':
      return `guest-verification-${job.verificationId}`;
    case 'guest_link_reissued':
      return `guest-link-${job.caseId}-${job.trackingVersion}`;
  }
}

/** The producing side; the queue is built on first use, so a process that never produces opens nothing. */
export function createReturnsNotificationProducer(redis: Redis | undefined): ReturnsNotificationProducer {
  let queue: Queue<ReturnsNotificationJob> | undefined;
  const open = (connection: Redis): Queue<ReturnsNotificationJob> =>
    (queue ??= new Queue<ReturnsNotificationJob>(RETURNS_NOTIFICATIONS_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
        attempts: JOB_ATTEMPTS,
        backoff: JOB_BACKOFF,
      },
    }));
  return {
    async enqueue(job) {
      if (redis === undefined) return false;
      await open(redis).add(job.kind, job, { jobId: jobIdOf(job) });
      return true;
    },
    async close() {
      await queue?.close();
      queue = undefined;
    },
  };
}

/** The part of a BullMQ job the processor reads and writes. */
export interface ReturnsNotificationJobLike {
  readonly name: string;
  readonly data: ReturnsNotificationJob;
  readonly progress: unknown;
  updateProgress(progress: object): Promise<void>;
}

/** What an earlier attempt of this job already did, off its progress — keys only, never an address. */
function doneOf(progress: unknown): string[] {
  if (typeof progress !== 'object' || progress === null) return [];
  const done = (progress as { done?: unknown }).done;
  return Array.isArray(done) ? done.filter((key): key is string => typeof key === 'string') : [];
}

function runJob(
  dispatch: Pick<ReturnsNotificationDispatch, 'dispatch'>,
  job: ReturnsNotificationJobLike,
): Promise<DispatchReport> {
  const attempt: DispatchAttempt = {
    done: doneOf(job.progress),
    record: (done) => job.updateProgress({ done: [...done] }),
  };
  return dispatch.dispatch(job.data, attempt);
}

/**
 * What the worker runs for one job, inside the system scope — there is no request
 * behind a job, and the case is read by id whoever owns it; the reads still pass
 * the tenancy guard, which the scope opens. Registered in the container as
 * `returnsNotificationProcessor`, which is how a test drives the job the harness
 * never consumes.
 */
export function returnsNotificationProcessor(
  dispatch: Pick<ReturnsNotificationDispatch, 'dispatch'>,
): (job: ReturnsNotificationJobLike) => Promise<DispatchReport> {
  return (job) => enterSystemScope(SCOPE_REASON, () => runJob(dispatch, job));
}

/**
 * Build and attach the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection. `attach` is `ctx.worker`,
 * which stops it with the module and puts a job taken while the module is off back
 * on the queue. Answers whether a consumer was started.
 */
export function startReturnsNotifications(input: {
  readonly dispatch: Pick<ReturnsNotificationDispatch, 'dispatch'>;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<ReturnsNotificationJob>) => void;
}): boolean {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  input.attach(
    new Worker<ReturnsNotificationJob>(
      RETURNS_NOTIFICATIONS_QUEUE,
      (job) => enterSystemScope(SCOPE_REASON, () => runJob(input.dispatch, job)),
      // A few cases at a time: each job is a handful of SMTP calls, mostly waiting.
      { connection: moduleQueueRedis, concurrency: 4 },
    ),
  );
  return true;
}
