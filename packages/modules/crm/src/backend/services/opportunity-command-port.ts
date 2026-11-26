import type { EntityManager } from '@mikro-orm/postgresql';
import type { ZodType } from 'zod';
import {
  AssignOpportunityRequestSchema,
  CreateOpportunityCommentRequestSchema,
  CreateOpportunityLinkRequestSchema,
  CreateOpportunityRequestSchema,
  ERROR_CODES,
  SetOpportunityTagsRequestSchema,
  UpdateOpportunityRequestSchema,
  type AggregateCommandOptions,
  type CreateOpportunityCommentRequest,
  type CreateOpportunityLinkRequest,
  type CreateOpportunityRequest,
  type CustomFieldMerge,
  type OpportunityCommandPort,
  type OpportunityComment,
  type OpportunityLink,
  type OpportunityReadPort,
  type OpportunityRecord,
  type OpportunityTransitionInput,
  type OpportunityTransitionOutcome,
  type UpdateOpportunityRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { z } from 'zod';
import { assertCallerSource, type CallerOptions } from '../commands/caller-options.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { isUuid, opportunityNotFound } from './opportunity-access.js';
import type { OpportunityAssignmentService } from './opportunity-assignment-service.js';
import type { OpportunityCommentService } from './opportunity-comment-service.js';
import type { OpportunityLinkService } from './opportunity-link-service.js';
import type { OpportunityService } from './opportunity-service.js';
import { ambientActor, type OpportunityTransitionService } from './opportunity-transition-service.js';
import type { WorkflowReadService } from './workflow-read-service.js';

/**
 * `opportunityCommandPort` (`specs/186-aggregate-ports/` US9, issue #1827) —
 * the Opportunity aggregate's write port. The contract, the refusals and the
 * options are `OpportunityCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` and refuses any `extensions` key before it reads anything, parses
 * its input with the admin route's schema (a refusal is `422
 * VALIDATION_FAILED`), and calls the service method the route calls — each of
 * which runs the one Command of its operation and does what the route does
 * around it (the notices, the value recalculation, a transition's guards,
 * Orders and events). The caller's `source` and `extensions` are added to that
 * Command by `withCallerOptions`, never by a second Command (research R-21.1).
 *
 * The record a method answers is read after the commit through the read
 * port's mapper, in the caller's tenant scope.
 */
export interface OpportunityCommandServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly workflowRead: Pick<WorkflowReadService, 'loadGraph'>;
  /**
   * The services the routes call, resolved per call: the comment service and
   * the Opportunity service reach the ports back through the reference
   * service, so constructor arguments would be a cycle in the container.
   */
  readonly opportunities: () => Pick<OpportunityService, 'create' | 'update' | 'setCustomFieldValues' | 'setTags' | 'delete'>;
  readonly assignment: () => Pick<OpportunityAssignmentService, 'assign'>;
  readonly transitions: () => Pick<OpportunityTransitionService, 'apply'>;
  readonly links: () => Pick<OpportunityLinkService, 'add' | 'remove'>;
  readonly comments: () => Pick<OpportunityCommentService, 'add'>;
  /** `opportunityReadPort`, whose mapper answers the record. */
  readonly records: Pick<OpportunityReadPort, 'findById'>;
}

/** The transition route's body as the published port takes it: `to` any string, an unknown one an outcome. */
const transitionInputSchema = z.object({
  to: z.string(),
  reason: z.string().nullable().optional(),
});

/**
 * Parses a port input with the admin route's schema; a refusal is the
 * platform's `422 VALIDATION_FAILED` with a field error per issue.
 */
function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The Opportunity write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

export class OpportunityCommandService implements OpportunityCommandPort {
  constructor(private readonly deps: OpportunityCommandServiceDeps) {}

  async create(input: CreateOpportunityRequest, options: AggregateCommandOptions = {}): Promise<OpportunityRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateOpportunityRequestSchema, input);
    return this.#record(await this.deps.opportunities().create(body, caller));
  }

  async update(
    id: string,
    patch: UpdateOpportunityRequest,
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(UpdateOpportunityRequestSchema, patch);
    const expectedVersion = parseOrRefuse(z.number().int().nonnegative().optional(), options.expectedVersion);
    await this.deps.opportunities().update(id, body, expectedVersion ?? null, caller);
    return this.#record(id);
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityRecord> {
    const caller = callerOf(options);
    await this.deps.opportunities().setCustomFieldValues(id, merge, caller);
    return this.#record(id);
  }

  async assign(
    id: string,
    input: { adminUserId: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityRecord> {
    const caller = callerOf(options);
    const { adminUserId } = parseOrRefuse(AssignOpportunityRequestSchema, input);
    await this.deps.assignment().assign(id, adminUserId, caller);
    return this.#record(id);
  }

  /**
   * The published transition port's reading of a move, now this port's
   * (`opportunityTransitionPort` delegates here): the workflow is consulted
   * before `apply`, so `unknown_status` and `not_permitted` are decided up
   * front and a `CRM_TRANSITION_VETOED` left in the `catch` is a guard's
   * decision. The Opportunity is read through the scoped EntityManager: one
   * outside the caller's tenant scope is `not_found`, as one that does not
   * exist. The cause is `manual` under an administrator and `system` under
   * none, as that port recorded it (research R-21.2).
   */
  async transition(
    id: string,
    input: OpportunityTransitionInput,
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityTransitionOutcome> {
    const caller = callerOf(options);
    const { to, reason } = parseOrRefuse(transitionInputSchema, input);
    const missing: OpportunityTransitionOutcome = {
      applied: false,
      reason: 'not_found',
      from: null,
      detail: `No opportunity ${id}.`,
    };
    if (!isUuid(id)) return missing;
    const opportunity = await this.deps.emFactory().findOne(CrmOpportunity, { id });
    if (!opportunity) return missing;

    // Read before the write: once `apply` has moved it, `from` is gone.
    const from = opportunity.statusCode;
    if (from === to) return { applied: false, reason: 'already_there', from };

    const graph = await this.deps.workflowRead.loadGraph();
    if (!graph.has(to)) {
      return { applied: false, reason: 'unknown_status', from, detail: `"${to}" is not a configured opportunity status.` };
    }
    if (!graph.canTransition(from, to)) {
      return {
        applied: false,
        reason: 'not_permitted',
        from,
        detail: `The configured workflow has no transition from "${from}" to "${to}".`,
      };
    }

    const actor = ambientActor();
    try {
      await this.deps.transitions().apply(id, to, {
        actor,
        cause: actor.kind === 'admin' ? 'manual' : 'system',
        reason: reason ?? null,
        caller,
      });
    } catch (error) {
      // The one tolerance this method exists for: with the graph consulted
      // above, a `CRM_TRANSITION_VETOED` left here is a guard's decision, which
      // the caller must be able to read as a value. A module switched off
      // underneath the guards is not a veto — `ModuleDisabledError` is an
      // `HttpError` too, and swallowing it would turn fail-closed into
      // fail-open — so it is rethrown first. Everything else, a concurrent
      // move included, is the caller's to see as thrown.
      rethrowIfModuleDisabled(error);
      if (error instanceof HttpError && error.code === ERROR_CODES.CRM_TRANSITION_VETOED) {
        return { applied: false, reason: 'vetoed', from, detail: error.message };
      }
      throw error;
    }
    return { applied: true, from, to };
  }

  async setTags(
    id: string,
    input: { tagIds: readonly string[] },
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityRecord> {
    const caller = callerOf(options);
    const { tagIds } = parseOrRefuse(SetOpportunityTagsRequestSchema, input);
    await this.deps.opportunities().setTags(id, tagIds, caller);
    return this.#record(id);
  }

  async link(
    id: string,
    input: CreateOpportunityLinkRequest,
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityLink> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateOpportunityLinkRequestSchema, input);
    return this.deps.links().add(id, body, caller);
  }

  async unlink(id: string, linkId: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.links().remove(id, linkId, caller);
  }

  async addComment(
    id: string,
    input: CreateOpportunityCommentRequest,
    options: AggregateCommandOptions = {},
  ): Promise<OpportunityComment> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateOpportunityCommentRequestSchema, input);
    return this.deps.comments().add(id, body, caller);
  }

  async delete(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.opportunities().delete(id, caller);
  }

  /** The written Opportunity as the published record, read after the commit in the caller's scope. */
  async #record(id: string): Promise<OpportunityRecord> {
    const record = await this.deps.records.findById(id);
    if (!record) throw opportunityNotFound();
    return record;
  }
}

/**
 * The caller's options as the Commands take them, refused here, first, so
 * nothing is read or written for a malformed one (issue #1922).
 *
 * - `source` outside the grammar → `422 VALIDATION_FAILED`.
 * - Any `extensions` key → `422 COMMAND_EXTENSION_UNCLAIMED`, the bus's own
 *   refusal. No `crm` action is declared hookable, so no hook module can claim
 *   a key and the bus would refuse it anyway — but only when the Command runs,
 *   which for a transition is after its guards and `.before` events; refused
 *   here it is refused before anything is read (research R-21.5).
 *
 * `expectedVersion` is read by `update` alone, the one route with a version rule.
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  const keys = Object.keys(options.extensions ?? {}).sort();
  if (keys.length > 0) {
    throw new HttpError(
      422,
      ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
      `No present hook module on a crm.opportunity action claims the extension input ${keys.map((k) => `'${k}'`).join(', ')}.`,
      keys.map((key) => ({ path: `extensions.${key}`, issue: 'no present module hooks this action under this key' })),
    );
  }
  return { source: options.source, extensions: options.extensions };
}
