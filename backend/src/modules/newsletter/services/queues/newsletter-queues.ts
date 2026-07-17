import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type Redis from 'ioredis';

import { withSystemScope } from '../../../../tenancy/escape-hatch.js';
/**
 * BullMQ queues for newsletter dispatch (feature 048, Principle X). Durable,
 * Redis-backed, atomic-claim + idempotent handlers (the unique send-record row),
 * producer-only-enqueue, and consumed by the separable `worker.ts` entrypoint.
 *
 *  - `newsletter.campaign.plan` — one job per send/scheduled-fire; resolves the
 *    audience and claims + enqueues per-recipient send jobs.
 *  - `newsletter.send` — one job per claimed recipient; renders + dispatches.
 *  - `newsletter.automation.step` — one job per (run, step); send or delayed wait.
 */
export const CAMPAIGN_PLAN_QUEUE = 'newsletter.campaign.plan';
export const SEND_QUEUE = 'newsletter.send';
export const AUTOMATION_STEP_QUEUE = 'newsletter.automation.step';

export interface CampaignPlanJobData {
  campaignId: string;
}
export interface SendJobData {
  recordId: string;
}
export interface AutomationStepJobData {
  runId: string;
  stepIndex: number;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 5_000 },
};

function makeQueue<T>(name: string, redis: Redis, overrides?: Partial<QueueOptions>): Queue<T> {
  return new Queue<T>(name, { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS, ...overrides });
}

export function createCampaignPlanQueue(redis: Redis, o?: Partial<QueueOptions>): Queue<CampaignPlanJobData> {
  return makeQueue<CampaignPlanJobData>(CAMPAIGN_PLAN_QUEUE, redis, o);
}
export function createSendQueue(redis: Redis, o?: Partial<QueueOptions>): Queue<SendJobData> {
  return makeQueue<SendJobData>(SEND_QUEUE, redis, o);
}
export function createAutomationStepQueue(
  redis: Redis,
  o?: Partial<QueueOptions>,
): Queue<AutomationStepJobData> {
  return makeQueue<AutomationStepJobData>(AUTOMATION_STEP_QUEUE, redis, o);
}

export function createCampaignPlanWorker(
  redis: Redis,
  processor: Processor<CampaignPlanJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<CampaignPlanJobData> {
  return new Worker<CampaignPlanJobData>(CAMPAIGN_PLAN_QUEUE, (job) => withSystemScope('newsletter campaign-plan', () => processor(job)), {
    connection: redis,
    concurrency: 4,
    ...overrides,
  });
}

export function createSendWorker(
  redis: Redis,
  processor: Processor<SendJobData>,
  /** Per-second throughput cap (provider throttle, FR-033). */
  ratePerSecond: number,
  overrides?: Partial<WorkerOptions>,
): Worker<SendJobData> {
  return new Worker<SendJobData>(SEND_QUEUE, (job) => withSystemScope('newsletter send', () => processor(job)), {
    connection: redis,
    concurrency: 8,
    limiter: { max: Math.max(1, ratePerSecond), duration: 1_000 },
    ...overrides,
  });
}

export function createAutomationStepWorker(
  redis: Redis,
  processor: Processor<AutomationStepJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<AutomationStepJobData> {
  return new Worker<AutomationStepJobData>(AUTOMATION_STEP_QUEUE, (job) => withSystemScope('newsletter automation-step', () => processor(job)), {
    connection: redis,
    concurrency: 4,
    ...overrides,
  });
}
