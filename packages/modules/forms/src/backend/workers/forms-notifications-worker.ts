import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { FormEntrySubmittedEventV1 } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type { DispatchReport, NotificationDispatch, NotificationJob } from '../services/notification-dispatch.js';

/**
 * The shop notification and the confirmation e-mail, sent from a queue (`specs/170-forms-module/`
 * research R-13, data-model §10, Constitution X; CRM's `value-recalculation-worker.ts` is the model).
 *
 * **A job carries an id and a language, nothing else** (FR-055): `{ entryId, shopLanguage }`. What
 * the e-mails say is read from the entry when the job runs, so the answers never enter Redis and an
 * entry deleted in between is simply not mailed. One job per accepted entry, up to eleven sends,
 * retried {@link JOB_ATTEMPTS} times with exponential backoff; the shopper's request answered before
 * the job was even taken (FR-059).
 *
 * Runs in the existing worker process like every module consumer: the volume is one job per entry,
 * and it stays a separable `ctx.worker` entrypoint. A composition without queues
 * (`moduleQueueRedis` undefined — the shared test server) enqueues nothing and builds no consumer;
 * its tests drive {@link formsNotificationProcessor} directly.
 */

export const FORMS_NOTIFICATIONS_QUEUE = 'forms-notifications';
export const FORMS_NOTIFICATIONS_JOB = 'notify';

export type FormsNotificationJobData = NotificationJob;

const SCOPE_REASON = 'forms: send the notification and the confirmation of an entry';

/** How often a job is run before BullMQ records it as failed, and how long it waits in between. */
const JOB_ATTEMPTS = 5;
const JOB_BACKOFF = { type: 'exponential', delay: 10_000 } as const;

export interface FormsNotificationProducer {
  /** Ask for the e-mails of one entry. Answers whether a job was enqueued. */
  enqueue(data: FormsNotificationJobData): Promise<boolean>;
  close(): Promise<void>;
}

/** The producing side; the queue is built on first use, so a process that never submits opens nothing. */
export function createFormsNotificationProducer(redis: Redis | undefined): FormsNotificationProducer {
  let queue: Queue<FormsNotificationJobData> | undefined;
  const open = (connection: Redis): Queue<FormsNotificationJobData> =>
    (queue ??= new Queue<FormsNotificationJobData>(FORMS_NOTIFICATIONS_QUEUE, {
      connection,
      // A sent job is worth nothing; a failed one is kept a while for whoever looks at the queue.
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
        attempts: JOB_ATTEMPTS,
        backoff: JOB_BACKOFF,
      },
    }));
  return {
    async enqueue(data) {
      if (redis === undefined) return false;
      // One job per entry: the entry's id is the job's, so a redelivered event adds nothing.
      await open(redis).add(FORMS_NOTIFICATIONS_JOB, { entryId: data.entryId, shopLanguage: data.shopLanguage }, { jobId: `entry-${data.entryId}` });
      return true;
    },
    async close() {
      await queue?.close();
      queue = undefined;
    },
  };
}

/**
 * The `forms.entry.submitted.v1` subscriber's body: the job of the entry, its shop language the
 * channel's default (A-3) — the submission's own when the channel is no longer known.
 */
export async function enqueueEntryNotification(
  deps: {
    readonly producer: FormsNotificationProducer;
    readonly channelDefaultLanguage: (salesChannelId: string) => Promise<string | null>;
  },
  event: Pick<FormEntrySubmittedEventV1, 'entryId' | 'salesChannelId' | 'language'>,
): Promise<void> {
  const shopLanguage = (await deps.channelDefaultLanguage(event.salesChannelId)) ?? event.language;
  await deps.producer.enqueue({ entryId: event.entryId, shopLanguage });
}

/** The part of a BullMQ job the processor reads and writes. */
export interface FormsNotificationJobLike {
  readonly data: FormsNotificationJobData;
  readonly progress: unknown;
  updateProgress(progress: object): Promise<void>;
}

/** The shop messages an earlier attempt of this job already sent, off its progress. */
function sentOf(progress: unknown): string[] {
  if (typeof progress !== 'object' || progress === null) return [];
  const sent = (progress as { shopSent?: unknown }).shopSent;
  return Array.isArray(sent) ? sent.filter((key): key is string => typeof key === 'string') : [];
}

/** One job, unscoped: the caller has entered the system scope. */
function runNotificationJob(dispatch: Pick<NotificationDispatch, 'dispatch'>, job: FormsNotificationJobLike): Promise<DispatchReport> {
  return dispatch.dispatch(
    { entryId: job.data.entryId, shopLanguage: job.data.shopLanguage },
    { sent: sentOf(job.progress), record: (sent) => job.updateProgress({ shopSent: [...sent] }) },
  );
}

/**
 * What the worker runs for one job, inside the system scope — there is no request behind a job,
 * and the entry is read by id whoever owns it. Registered in the container as
 * `formsNotificationProcessor`, which is how a test drives the job the harness never consumes.
 */
export function formsNotificationProcessor(
  dispatch: Pick<NotificationDispatch, 'dispatch'>,
): (job: FormsNotificationJobLike) => Promise<DispatchReport> {
  return (job) => enterSystemScope(SCOPE_REASON, () => runNotificationJob(dispatch, job));
}

/**
 * Build and attach the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection. `attach` is the platform's worker seam,
 * `ctx.worker`, which stops it with the module and puts a job taken while the module is off back
 * on the queue. Answers whether a consumer was started.
 */
export function startFormsNotifications(input: {
  readonly dispatch: Pick<NotificationDispatch, 'dispatch'>;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<FormsNotificationJobData>) => void;
}): boolean {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  input.attach(
    new Worker<FormsNotificationJobData>(
      FORMS_NOTIFICATIONS_QUEUE,
      // The scope is entered at the site BullMQ invokes.
      (job) => enterSystemScope(SCOPE_REASON, () => runNotificationJob(input.dispatch, job)),
      // A few entries at a time: each job is a handful of SMTP calls, mostly waiting.
      { connection: moduleQueueRedis, concurrency: 4 },
    ),
  );
  return true;
}
