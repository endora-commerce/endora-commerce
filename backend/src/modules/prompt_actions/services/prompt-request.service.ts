import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, PROMPT_ACTION_PLAN_TTL_MINUTES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { PromptActionRequest } from '../entities/prompt-action-request.entity.js';
import type { InterpreterService, StoredConversation } from './interpreter.service.js';
import { PermissionRevoked, type PlanExecutorService } from './plan-executor.service.js';
import type { ToolAuditContext, ToolContext } from './tool-registry.js';

/**
 * PromptRequestService — feature 043 lifecycle (data-model §2).
 *
 * Owns the `prompt_action_requests` state machine: submit (interpretation in
 * the request path), idempotent confirm with lazy 10-minute expiry, cancel,
 * the single clarify round-trip, owner-scoped reads, and the seen-marker
 * queries behind the FR-018 completion notice. All state-changing audit rows
 * (`prompt_action.execute`, `prompt_action.refused`) are recorded here.
 */

export interface OperatorVisibilityFactory {
  (adminUserId: string): {
    hasPermission(permission: string): Promise<boolean>;
    isModuleInstalled(moduleId: string): Promise<boolean>;
  };
}

export interface PromptRequestServiceDeps {
  emFactory: () => EntityManager;
  interpreter: InterpreterService;
  executor: PlanExecutorService;
  auditLogService?: AuditLogService;
  visibilityFor: OperatorVisibilityFactory;
  /** US2: folds live catalog bulk-operation progress into a delegated request. */
  bulkProgressResolver?: (row: PromptActionRequest, em: EntityManager) => Promise<void>;
  ttlMinutes?: number;
  now?: () => Date;
}

export interface OperatorContext {
  adminUserId: string;
  language?: string | null;
  auditCtx: ToolAuditContext;
}

const IN_FLIGHT_STATUSES = ['interpreting', 'executing'] as const;

export class PromptRequestService {
  constructor(private readonly deps: PromptRequestServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private ttlMs(): number {
    return (this.deps.ttlMinutes ?? PROMPT_ACTION_PLAN_TTL_MINUTES) * 60_000;
  }

  expiresAt(row: PromptActionRequest): Date | null {
    if (row.status !== 'awaiting_confirmation') return null;
    return new Date(row.updatedAt.getTime() + this.ttlMs());
  }

  // --------------------------------------------------------------------
  // Submit (interpretation)
  // --------------------------------------------------------------------

  async submit(op: OperatorContext, prompt: string): Promise<PromptActionRequest> {
    // command-coverage-ignore: prompt-action request-queue lifecycle — the executed
    // admin action is audited by its target service; this is queue state.
    const em = this.deps.emFactory();

    const inFlight = await em.count(PromptActionRequest, {
      adminUserId: op.adminUserId,
      status: { $in: [...IN_FLIGHT_STATUSES] },
    });
    if (inFlight > 0) {
      throw new HttpError(
        429,
        ERROR_CODES.PROMPT_REQUEST_IN_FLIGHT,
        'Another prompt is still being processed for this operator.',
      );
    }

    const row = em.create(PromptActionRequest, {
      adminUserId: op.adminUserId,
      prompt,
      language: op.language ?? null,
      status: 'interpreting',
    });
    await em.flush();

    await this.runInterpretation(em, row, op, { resume: false });
    return row;
  }

  // --------------------------------------------------------------------
  // Clarify (single round-trip, US3)
  // --------------------------------------------------------------------

  async clarify(
    op: OperatorContext,
    id: string,
    answer: { selectedCandidateId?: string; text?: string },
  ): Promise<PromptActionRequest> {
    // command-coverage-ignore: prompt-action request-queue lifecycle — the executed
    // admin action is audited by its target service; this is queue state.
    const em = this.deps.emFactory();
    const row = await this.loadOwned(em, id, op.adminUserId);
    if (row.status !== 'needs_clarification') {
      throw new HttpError(
        409,
        ERROR_CODES.PROMPT_REQUEST_INVALID_STATE,
        `Request is "${row.status}", not awaiting clarification.`,
      );
    }

    const candidate = answer.selectedCandidateId
      ? row.clarification?.candidates?.find((c) => c.id === answer.selectedCandidateId)
      : undefined;
    if (answer.selectedCandidateId && !candidate) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'selectedCandidateId does not match any offered candidate.',
      );
    }
    const answerText = candidate
      ? `The operator chose: ${candidate.label} (id: ${candidate.id}).`
      : (answer.text ?? '');

    row.status = 'interpreting';
    row.clarification = null;
    await em.flush();

    await this.runInterpretation(em, row, op, { resume: true, answerText });
    return row;
  }

  private async runInterpretation(
    em: EntityManager,
    row: PromptActionRequest,
    op: OperatorContext,
    opts: { resume: boolean; answerText?: string },
  ): Promise<void> {
    const toolCtx: ToolContext = {
      adminUserId: op.adminUserId,
      requestId: row.id,
      em,
      auditCtx: op.auditCtx,
    };

    const outcome = await this.deps.interpreter.interpret({
      prompt: row.prompt,
      toolCtx,
      visibility: this.deps.visibilityFor(op.adminUserId),
      resumeConversation: opts.resume ? (row.conversation as StoredConversation | null) : null,
      clarificationAnswer: opts.answerText ?? null,
    });

    switch (outcome.kind) {
      case 'plan':
        row.status = 'awaiting_confirmation';
        row.plan = outcome.plan;
        row.conversation = outcome.conversation;
        row.provider = outcome.provider;
        row.model = outcome.model;
        break;
      case 'clarification':
        if (opts.resume) {
          // Second clarification round → unsupported (data-model §2).
          row.status = 'unsupported';
          row.error =
            'The instruction stayed ambiguous after one clarification — please rephrase it.';
          row.finishedAt = this.now();
          break;
        }
        row.status = 'needs_clarification';
        row.clarification = outcome.clarification;
        row.conversation = outcome.conversation;
        row.provider = outcome.provider;
        row.model = outcome.model;
        break;
      case 'unsupported':
        row.status = 'unsupported';
        row.error = outcome.detail;
        row.finishedAt = this.now();
        break;
      case 'refused':
        row.status = 'refused';
        row.error = outcome.detail;
        row.finishedAt = this.now();
        await this.auditRefusal(row, op, 'interpretation');
        break;
      case 'blocked_bulk_limit':
        row.status = 'unsupported';
        row.error = `The prompt would affect ${outcome.affectedCount} records — the configured limit is ${outcome.limit}. Narrow the instruction.`;
        row.finishedAt = this.now();
        break;
      case 'failed':
        row.status = 'failed';
        row.error = outcome.detail;
        row.finishedAt = this.now();
        break;
    }
    await em.flush();
  }

  // --------------------------------------------------------------------
  // Confirm → execute
  // --------------------------------------------------------------------

  async confirm(op: OperatorContext, id: string): Promise<PromptActionRequest> {
    const em = this.deps.emFactory();
    const row = await this.loadOwned(em, id, op.adminUserId);

    // Idempotency (FR-006): a repeat confirm returns the current state.
    if (
      row.status === 'executing' ||
      row.status === 'completed' ||
      row.status === 'completed_with_errors'
    ) {
      return row;
    }
    if (row.status !== 'awaiting_confirmation') {
      throw new HttpError(
        409,
        ERROR_CODES.PROMPT_REQUEST_INVALID_STATE,
        `Request is "${row.status}" and cannot be confirmed.`,
      );
    }

    // Lazy expiry (research §R5): no sweeper — checked exactly here.
    const expiresAt = this.expiresAt(row);
    if (expiresAt && this.now().getTime() > expiresAt.getTime()) {
      row.status = 'expired';
      row.finishedAt = this.now();
      await em.flush();
      throw new HttpError(
        409,
        ERROR_CODES.PROMPT_PLAN_EXPIRED,
        'The plan expired before confirmation — submit the prompt again.',
      );
    }

    // Atomic claim: only one confirm transitions to `executing`.
    const claimed = await em.nativeUpdate(
      PromptActionRequest,
      { id: row.id, status: 'awaiting_confirmation' },
      { status: 'executing', confirmedAt: this.now(), updatedAt: this.now() },
    );
    if (claimed === 0) {
      em.clear();
      return this.loadOwned(this.deps.emFactory(), id, op.adminUserId);
    }
    row.status = 'executing';
    row.confirmedAt = this.now();

    const toolCtx: ToolContext = {
      adminUserId: op.adminUserId,
      requestId: row.id,
      em,
      auditCtx: op.auditCtx,
    };

    try {
      const { result, bulkOperationId } = await this.deps.executor.execute(
        row.plan!,
        toolCtx,
        this.deps.visibilityFor(op.adminUserId),
      );
      row.result = result;
      if (bulkOperationId) {
        // Delegated bulk work: stays `executing`; GET folds live progress in.
        row.bulkOperationId = bulkOperationId;
      } else {
        row.status = result.outcome;
        row.finishedAt = this.now();
      }
      await em.flush();
      await this.auditExecution(row, op);
      return row;
    } catch (err) {
      if (err instanceof PermissionRevoked) {
        row.status = 'refused';
        row.error = err.message;
        row.finishedAt = this.now();
        await em.flush();
        await this.auditRefusal(row, op, 'execution');
        throw new HttpError(403, ERROR_CODES.PROMPT_PERMISSION_REVOKED, err.message);
      }
      row.status = 'failed';
      row.error = (err as Error).message ?? 'Execution failed.';
      row.finishedAt = this.now();
      await em.flush();
      throw err;
    }
  }

  // --------------------------------------------------------------------
  // Cancel / read / seen
  // --------------------------------------------------------------------

  async cancel(op: OperatorContext, id: string): Promise<PromptActionRequest> {
    // command-coverage-ignore: prompt-action request-queue lifecycle — the executed
    // admin action is audited by its target service; this is queue state.
    const em = this.deps.emFactory();
    const row = await this.loadOwned(em, id, op.adminUserId);
    if (row.status !== 'awaiting_confirmation' && row.status !== 'needs_clarification') {
      throw new HttpError(
        409,
        ERROR_CODES.PROMPT_REQUEST_INVALID_STATE,
        `Request is "${row.status}" and cannot be cancelled.`,
      );
    }
    row.status = 'cancelled';
    row.finishedAt = this.now();
    await em.flush();
    return row;
  }

  async get(op: OperatorContext, id: string): Promise<PromptActionRequest> {
    const em = this.deps.emFactory();
    const row = await this.loadOwned(em, id, op.adminUserId);
    if (row.status === 'executing' && row.bulkOperationId && this.deps.bulkProgressResolver) {
      await this.deps.bulkProgressResolver(row, em);
      if (row.status !== 'executing') {
        row.finishedAt = row.finishedAt ?? this.now();
        await em.flush();
        await this.auditExecution(row, op);
      }
    }
    return row;
  }

  async listUnseenFinished(op: OperatorContext, limit: number): Promise<PromptActionRequest[]> {
    const em = this.deps.emFactory();
    return em.find(
      PromptActionRequest,
      {
        adminUserId: op.adminUserId,
        status: { $in: ['completed', 'completed_with_errors', 'failed'] },
        seenAt: null,
      },
      { orderBy: { createdAt: 'desc' }, limit },
    );
  }

  async markSeen(op: OperatorContext, id: string): Promise<void> {
    // command-coverage-ignore: prompt-action request-queue lifecycle — the executed
    // admin action is audited by its target service; this is queue state.
    const em = this.deps.emFactory();
    const row = await this.loadOwned(em, id, op.adminUserId);
    if (!row.seenAt) {
      row.seenAt = this.now();
      await em.flush();
    }
  }

  // --------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------

  private async loadOwned(
    em: EntityManager,
    id: string,
    adminUserId: string,
  ): Promise<PromptActionRequest> {
    const row = await em.findOne(PromptActionRequest, { id });
    // Foreign requests 404 (not 403) to avoid existence leaks (contract §1).
    if (!row || row.adminUserId !== adminUserId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Prompt request not found.');
    }
    return row;
  }

  private async auditExecution(row: PromptActionRequest, op: OperatorContext): Promise<void> {
    if (!this.deps.auditLogService) return;
    await this.deps.auditLogService.record({
      actorAdminUserId: op.adminUserId,
      action: 'prompt_action.execute',
      objectType: 'prompt_action_request',
      objectId: row.id,
      stateAfter: {
        prompt: row.prompt,
        provider: row.provider,
        model: row.model,
        operations: row.plan?.operations.map((o) => ({
          toolId: o.toolId,
          params: o.params,
          headline: o.preview.headline,
        })),
        outcome: row.result?.outcome ?? row.status,
        bulkOperationId: row.bulkOperationId,
      },
      ...(op.auditCtx.ipAddress !== undefined ? { ipAddress: op.auditCtx.ipAddress } : {}),
      ...(op.auditCtx.userAgent !== undefined ? { userAgent: op.auditCtx.userAgent } : {}),
      ...(op.auditCtx.requestId !== undefined ? { requestId: op.auditCtx.requestId } : {}),
    });
  }

  private async auditRefusal(
    row: PromptActionRequest,
    op: OperatorContext,
    phase: 'interpretation' | 'execution',
  ): Promise<void> {
    if (!this.deps.auditLogService) return;
    await this.deps.auditLogService.record({
      actorAdminUserId: op.adminUserId,
      action: 'prompt_action.refused',
      objectType: 'prompt_action_request',
      objectId: row.id,
      stateAfter: { prompt: row.prompt, phase, detail: row.error },
      ...(op.auditCtx.requestId !== undefined ? { requestId: op.auditCtx.requestId } : {}),
    });
  }
}
