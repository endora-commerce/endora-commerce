import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AutomationDetail,
  type AutomationStep,
  type AutomationSummary,
  type CreateAutomationRequest,
  type NewsletterSendProvider,
  type UpdateAutomationRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { NewsletterAutomation } from '../entities/newsletter-automation.entity.js';
import { NewsletterAutomationRun } from '../entities/newsletter-automation-run.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSendRecord } from '../entities/newsletter-send-record.entity.js';
import type { NewsletterContentService, EmailBrandingResolver } from './content.service.js';
import { withEmailBranding } from './content.service.js';
import type { NewsletterOptInService } from './opt-in.service.js';
import type { NewsletterLinkBuilder } from './subscriber.service.js';

const DAY_MS = 86_400_000;

export interface AutomationServiceDeps {
  emFactory: () => EntityManager;
  content: NewsletterContentService;
  optIn: NewsletterOptInService;
  links: NewsletterLinkBuilder;
  resolveProvider: () => Promise<NewsletterSendProvider>;
  resolveSender: () => Promise<{ fromEmail: string; fromName: string }>;
  /** Enqueue the next step (production: BullMQ delayed job). */
  enqueueStep: (runId: string, stepIndex: number, delayMs: number) => Promise<void>;
  /** Feature 054 — audits automation lifecycle writes co-transactionally when provided. */
  auditLog?: AuditPort;
  resolveEmailBranding?: EmailBrandingResolver;
}

/**
 * Newsletter automations (feature 048, US4). Linear send/wait sequences with a
 * step engine driven by BullMQ delayed jobs. The model is extensible to future
 * conditional/branching node types (research R9).
 */
export class NewsletterAutomationService {
  constructor(private readonly deps: AutomationServiceDeps) {}

  #audit(em: EntityManager, action: string, objectId: string, stateAfter: Record<string, unknown> | null): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'newsletter_automation',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  /** Validation issues that block activation (FR-022). Empty ⇒ valid. */
  static validate(triggerType: string, triggerTagIds: string[], steps: AutomationStep[]): string[] {
    const issues: string[] = [];
    if ((triggerType === 'tag' || triggerType === 'tag_list') && triggerTagIds.length === 0) {
      issues.push('Trigger requires at least one tag.');
    }
    if (steps.length === 0) issues.push('Automation has no steps.');
    if (!steps.some((s) => s.type === 'send')) issues.push('Automation must contain at least one send step.');
    if (steps.length > 0 && steps[steps.length - 1]?.type !== 'send') {
      issues.push('The last step must be a send (no trailing wait).');
    }
    for (const [i, s] of steps.entries()) {
      if (s.type === 'send' && (!s.subject || s.subject.trim().length === 0)) {
        issues.push(`Send step ${i + 1} has an empty subject.`);
      }
    }
    return issues;
  }

  async create(input: CreateAutomationRequest): Promise<AutomationDetail> {
    const em = this.deps.emFactory();
    const automation = em.create(NewsletterAutomation, {
      name: input.name,
      triggerType: input.triggerType,
      triggerTagIds: input.triggerTagIds ?? [],
      salesChannelId: input.salesChannelId ?? null,
      language: input.language,
      reentryPolicy: input.reentryPolicy,
      steps: input.steps as unknown as Array<Record<string, unknown>>,
    });
    em.persist(automation);
    this.#audit(em, 'newsletter_automation.create', automation.id, { name: automation.name });
    await em.flush();
    return this.toDetail(automation);
  }

  async update(id: string, input: UpdateAutomationRequest): Promise<AutomationDetail> {
    const em = this.deps.emFactory();
    const a = await this.load(em, id);
    if (a.version !== input.expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Automation was modified.');
    }
    if (a.status === 'active') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Pause the automation before editing.');
    }
    if (input.name !== undefined) a.name = input.name;
    if (input.triggerType !== undefined) a.triggerType = input.triggerType;
    if (input.triggerTagIds !== undefined) a.triggerTagIds = input.triggerTagIds;
    if (input.salesChannelId !== undefined) a.salesChannelId = input.salesChannelId ?? null;
    if (input.language !== undefined) a.language = input.language;
    if (input.reentryPolicy !== undefined) a.reentryPolicy = input.reentryPolicy;
    if (input.steps !== undefined) a.steps = input.steps as unknown as Array<Record<string, unknown>>;
    a.version += 1;
    this.#audit(em, 'newsletter_automation.update', a.id, { name: a.name });
    await em.persistAndFlush(a);
    return this.toDetail(a);
  }

  async get(id: string): Promise<AutomationDetail> {
    return this.toDetail(await this.load(this.deps.emFactory(), id));
  }

  async list(): Promise<{ items: AutomationSummary[] }> {
    const em = this.deps.emFactory();
    const rows = await em.find(NewsletterAutomation, {}, { orderBy: { createdAt: 'desc' } });
    return { items: rows.map((a) => this.toSummary(a)) };
  }

  async activate(id: string, expectedVersion: number): Promise<AutomationDetail> {
    const em = this.deps.emFactory();
    const a = await this.load(em, id);
    if (a.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Automation was modified.');
    }
    const issues = NewsletterAutomationService.validate(
      a.triggerType,
      a.triggerTagIds,
      a.steps as unknown as AutomationStep[],
    );
    if (issues.length > 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Automation is invalid.', {
        code: 'automation_invalid',
        issues,
      });
    }
    a.status = 'active';
    a.version += 1;
    this.#audit(em, 'newsletter_automation.activate', a.id, { status: 'active' });
    await em.persistAndFlush(a);
    return this.toDetail(a);
  }

  async pause(id: string, expectedVersion: number): Promise<AutomationDetail> {
    const em = this.deps.emFactory();
    const a = await this.load(em, id);
    if (a.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Automation was modified.');
    }
    a.status = 'paused';
    a.version += 1;
    this.#audit(em, 'newsletter_automation.pause', a.id, { status: 'paused' });
    await em.persistAndFlush(a);
    return this.toDetail(a);
  }

  /**
   * Enrol a subscriber into an active automation: create the run (the partial
   * unique index enforces the `once` re-entry policy) and enqueue step 0.
   * Returns the run id, or null when already enrolled / not active.
   */
  async enrol(automationId: string, subscriberId: string): Promise<string | null> {
    const em = this.deps.emFactory();
    const a = await em.findOne(NewsletterAutomation, { id: automationId });
    if (!a || a.status !== 'active') return null;
    const id = randomUUID();
    const rows = (await em.getConnection().execute(
      `insert into newsletter_automation_runs (id, automation_id, subscriber_id, current_step, status, created_at, updated_at)
       values (?, ?, ?, 0, 'active', now(), now())
       on conflict (automation_id, subscriber_id) where status <> 'cancelled'
       do nothing
       returning id`,
      [id, automationId, subscriberId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;
    if (rows.length === 0) return null;
    await this.deps.enqueueStep(id, 0, 0);
    return id;
  }

  /** Execute one automation step for a run. Idempotent on (run, stepIndex). */
  async processStep(runId: string, stepIndex: number): Promise<void> {
    // command-coverage-ignore: automation run execution — advances a run to its
    // next step; background workflow execution, not an operator write.
    const em = this.deps.emFactory();
    const run = await em.findOne(NewsletterAutomationRun, { id: runId });
    if (!run || run.status !== 'active') return;
    if (run.currentStep !== stepIndex) return; // already advanced — idempotent

    // A subscriber who unsubscribed / was deactivated mid-sequence stops here
    // (FR-021): the run self-cancels and no further steps are scheduled.
    const subscriber = await em.findOne(NewsletterSubscriber, { id: run.subscriberId });
    if (!subscriber || subscriber.status !== 'active') {
      run.status = 'cancelled';
      run.nextStepAt = null;
      run.nextStepJobId = null;
      await em.persistAndFlush(run);
      return;
    }

    const automation = await em.findOneOrFail(NewsletterAutomation, { id: run.automationId });
    const steps = automation.steps as unknown as AutomationStep[];
    const step = steps[stepIndex];
    if (!step) {
      run.status = 'completed';
      await em.persistAndFlush(run);
      return;
    }

    if (step.type === 'send') {
      const recordId = await this.claimStep(em, runId, stepIndex, run.subscriberId);
      if (recordId) await this.sendStep(em, automation, step, run.subscriberId, recordId);
    }

    const nextIndex = stepIndex + 1;
    run.currentStep = nextIndex;
    if (nextIndex >= steps.length) {
      run.status = 'completed';
      run.nextStepAt = null;
      run.nextStepJobId = null;
      await em.persistAndFlush(run);
      return;
    }
    const delayMs = step.type === 'wait' ? step.days * DAY_MS : 0;
    run.nextStepAt = new Date(Date.now() + delayMs);
    await em.persistAndFlush(run);
    await this.deps.enqueueStep(runId, nextIndex, delayMs);
  }

  /** Cancel all active runs for a subscriber (on unsubscribe/delete — FR-021). */
  async cancelRunsForSubscriber(subscriberId: string): Promise<void> {
    // command-coverage-ignore: automation run execution — cancels in-flight runs
    // on unsubscribe; background lifecycle bookkeeping.
    const em = this.deps.emFactory();
    const runs = await em.find(NewsletterAutomationRun, { subscriberId, status: 'active' });
    for (const run of runs) {
      run.status = 'cancelled';
      run.nextStepAt = null;
      run.nextStepJobId = null;
    }
    if (runs.length > 0) await em.flush();
  }

  private async claimStep(
    em: EntityManager,
    runId: string,
    stepIndex: number,
    subscriberId: string,
  ): Promise<string | null> {
    const id = randomUUID();
    const rows = (await em.getConnection().execute(
      `insert into newsletter_send_records (id, automation_run_id, step_index, subscriber_id, status, click_count, created_at)
       values (?, ?, ?, ?, 'queued', 0, now())
       on conflict (automation_run_id, step_index, subscriber_id) where automation_run_id is not null
       do nothing
       returning id`,
      [id, runId, stepIndex, subscriberId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;
    return rows.length > 0 ? (rows[0]?.id ?? null) : null;
  }

  private async sendStep(
    em: EntityManager,
    automation: NewsletterAutomation,
    step: Extract<AutomationStep, { type: 'send' }>,
    // command-coverage-ignore: automation run execution — dispatches a step
    // email + stamps the send record; delivery bookkeeping.
    subscriberId: string,
    recordId: string,
  ): Promise<void> {
    const record = await em.findOneOrFail(NewsletterSendRecord, { id: recordId });
    if (record.status === 'sent') return;
    const subscriber = await em.findOneOrFail(NewsletterSubscriber, { id: subscriberId });
    const provider = await this.deps.resolveProvider();
    const sender = await this.deps.resolveSender();
    const unsubscribeUrl = this.deps.links.unsubscribe(this.deps.optIn.mintUnsubscribeToken(subscriberId));
    const branded = await withEmailBranding(
      {
        subscriber: { email: subscriber.email },
        customFields: subscriber.customFields,
        channel: { id: automation.salesChannelId },
      },
      automation.salesChannelId,
      this.deps.resolveEmailBranding,
    );
    const rendered = this.deps.content.render({
      subject: step.subject,
      content: step.content,
      ...(branded.accentColor !== undefined ? { accentColor: branded.accentColor } : {}),
      context: {
        variables: branded.variables,
        unsubscribeUrl,
      },
    });
    try {
      const res = await provider.send({
        to: subscriber.email,
        fromEmail: sender.fromEmail || 'noreply@localhost',
        ...(sender.fromName ? { fromName: sender.fromName } : {}),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        messageId: record.id,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
      record.status = 'sent';
      record.sentAt = new Date();
      record.providerMessageId = res.providerMessageId ?? null;
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
    }
    await em.persistAndFlush(record);
  }

  private async load(em: EntityManager, id: string): Promise<NewsletterAutomation> {
    const a = await em.findOne(NewsletterAutomation, { id });
    if (!a) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Automation not found.');
    return a;
  }

  private toSummary(a: NewsletterAutomation): AutomationSummary {
    return {
      id: a.id,
      name: a.name,
      status: a.status,
      triggerType: a.triggerType,
      stepCount: (a.steps as unknown[]).length,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private toDetail(a: NewsletterAutomation): AutomationDetail {
    return {
      ...this.toSummary(a),
      triggerTagIds: a.triggerTagIds,
      salesChannelId: a.salesChannelId,
      language: a.language,
      reentryPolicy: a.reentryPolicy,
      steps: a.steps as unknown as AutomationStep[],
      version: a.version,
      updatedAt: a.updatedAt.toISOString(),
    };
  }
}
