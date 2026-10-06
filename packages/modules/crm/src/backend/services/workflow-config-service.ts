import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateOpportunityStatusRequest,
  type SetOpportunityTransitionsRequest,
  type SetOrderStatusMappingsRequest,
  type UpdateOpportunityStatusRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  OpportunityWorkflowConfigError,
  type OpportunityWorkflowRule,
} from '../domain/opportunity-status-graph.js';
import { CrmOpportunityStatus } from '../entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusTransition } from '../entities/crm-opportunity-status-transition.entity.js';
import { CrmOrderStatusMapping } from '../entities/crm-order-status-mapping.entity.js';
import type { WorkflowReadService } from './workflow-read-service.js';

type AuditState = Record<string, unknown> | null;

interface ConfigWrite {
  before: AuditState;
  after: AuditState;
}

/** 422 `CRM_WORKFLOW_INVALID`, naming the rule both where the contract reads it and as the refusal token. */
function workflowInvalid(rule: OpportunityWorkflowRule, message: string): HttpError {
  return new HttpError(422, ERROR_CODES.CRM_WORKFLOW_INVALID, message, { rule, code: rule });
}

function statusNotFound(code: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `Opportunity status "${code}" not found.`);
}

function snapshot(status: CrmOpportunityStatus): Record<string, unknown> {
  return {
    code: status.code,
    name: status.name,
    defaultName: status.defaultName,
    kind: status.kind,
    isInitial: status.isInitial,
    weight: status.weight,
    color: status.color,
  };
}

/**
 * Writes to the Opportunity workflow configuration: statuses, transitions and
 * the Order-status mappings (`contracts/admin-api.md` §4).
 *
 * **Every write is one Command** (Constitution XIII), so its audit entry is
 * co-transactional with it, and **every write re-validates the whole workflow
 * before it commits**: the change is flushed, the graph is read back on the
 * same transaction and held to its structural rules, and a broken rule rolls
 * the whole Command back as 422 `CRM_WORKFLOW_INVALID` naming the rule. So no
 * sequence of calls can leave a workflow without a start status, or without a
 * way to close an Opportunity as won or as lost.
 */
export class WorkflowConfigService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly workflowRead: WorkflowReadService,
  ) {}

  /**
   * One audited configuration write. `write` performs the change on the
   * Command's EntityManager; the workflow is validated afterwards, on the same
   * transaction.
   */
  async #configure(
    command: { action: string; objectType: string; objectId: string },
    write: (em: EntityManager) => Promise<ConfigWrite>,
  ): Promise<void> {
    await this.commandBus.run({
      ...command,
      run: async ({ em }) => {
        const { before, after } = await write(em);
        await em.flush();
        await this.#assertValid(em);
        return { result: undefined, before, after };
      },
    });
  }

  async #assertValid(em: EntityManager): Promise<void> {
    const graph = await this.workflowRead.loadGraph(em);
    try {
      graph.assertValid();
    } catch (error) {
      if (error instanceof OpportunityWorkflowConfigError) {
        throw workflowInvalid(error.rule, error.message);
      }
      throw error;
    }
  }

  /**
   * Opportunities in a status, across **every** Organization. A raw statement
   * on purpose: `CrmOpportunity` is organization-scoped, so a count through the
   * entity would answer for the caller's tenant only, and a configuration
   * change is platform-wide — a status other tenants' Opportunities are in is
   * in use whoever asks.
   */
  async #inUseCount(em: EntityManager, code: string): Promise<number> {
    const rows = (await em.execute(
      'select count(*)::int as n from "crm_opportunities" where "status_code" = ?',
      [code],
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Move the initial flag onto `target`. Two flushes: the partial unique index
   * allows one initial row at any instant, so the old flag is cleared before
   * the new one is set.
   */
  async #moveInitialFlag(em: EntityManager, target: CrmOpportunityStatus): Promise<string | null> {
    const current = await em.findOne(CrmOpportunityStatus, { isInitial: true });
    if (current && current.id !== target.id) {
      current.isInitial = false;
      await em.flush();
    }
    target.isInitial = true;
    return current && current.id !== target.id ? current.code : null;
  }

  async createStatus(input: CreateOpportunityStatusRequest): Promise<void> {
    await this.#configure(
      { action: 'crm.status.create', objectType: 'crm_opportunity_status', objectId: input.code },
      async (em) => {
        if (await em.findOne(CrmOpportunityStatus, { code: input.code })) {
          throw new HttpError(
            409,
            ERROR_CODES.CRM_STATUS_CODE_TAKEN,
            `An opportunity status with the code "${input.code}" already exists.`,
            { statusCode: input.code },
          );
        }
        if (input.isInitial && input.kind !== 'open') {
          throw workflowInvalid(
            'initial_must_be_open',
            `The initial status "${input.code}" must be an open status.`,
          );
        }
        const status = em.create(CrmOpportunityStatus, {
          code: input.code,
          name: input.name ?? {},
          defaultName: input.defaultName,
          kind: input.kind,
          isInitial: false,
          ...(input.weight !== undefined ? { weight: input.weight } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        });
        let previousInitial: string | null = null;
        if (input.isInitial) {
          await em.flush();
          previousInitial = await this.#moveInitialFlag(em, status);
        }
        return {
          before: previousInitial ? { initialStatusCode: previousInitial } : null,
          after: snapshot(status),
        };
      },
    );
  }

  async updateStatus(code: string, patch: UpdateOpportunityStatusRequest): Promise<void> {
    const fields = Object.keys(patch).filter(
      (key) => patch[key as keyof UpdateOpportunityStatusRequest] !== undefined,
    );
    // Moving the start status is its own audited act when it is all the request asks for.
    const onlyInitial = fields.length === 1 && fields[0] === 'isInitial' && patch.isInitial === true;
    await this.#configure(
      {
        action: onlyInitial ? 'crm.status.set_initial' : 'crm.status.update',
        objectType: 'crm_opportunity_status',
        objectId: code,
      },
      async (em) => {
        // Locked before the count below: a transition (or a creation) into this
        // status holds the row shared until it commits, so this waits for it
        // and then counts what it wrote (research N-R12).
        const status = await em.findOne(CrmOpportunityStatus, { code }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!status) throw statusNotFound(code);
        const before = snapshot(status);

        if (patch.name !== undefined) status.name = patch.name;
        if (patch.defaultName !== undefined) status.defaultName = patch.defaultName;
        if (patch.weight !== undefined) status.weight = patch.weight;
        if (patch.color !== undefined) status.color = patch.color;

        if (patch.kind !== undefined && patch.kind !== status.kind) {
          // What a status means is stamped on the Opportunities in it
          // (`closedAt`, `closedKind`), so it changes only while none is.
          const inUse = await this.#inUseCount(em, code);
          if (inUse > 0) {
            throw new HttpError(
              409,
              ERROR_CODES.CRM_STATUS_IN_USE,
              `The status "${code}" is used by ${inUse} opportunities, so what it means cannot change.`,
              { statusCode: code, count: inUse },
            );
          }
          status.kind = patch.kind;
        }

        let previousInitial: string | null = null;
        if (patch.isInitial === false && status.isInitial) {
          throw new HttpError(
            409,
            ERROR_CODES.CRM_STATUS_INITIAL_REQUIRED,
            'The workflow needs an initial status. Make another status the initial one instead.',
          );
        }
        if (patch.isInitial === true && !status.isInitial) {
          if (status.kind !== 'open') {
            throw workflowInvalid(
              'initial_must_be_open',
              `The initial status "${code}" must be an open status.`,
            );
          }
          await em.flush();
          previousInitial = await this.#moveInitialFlag(em, status);
        }
        return {
          before: previousInitial ? { ...before, initialStatusCode: previousInitial } : before,
          after: snapshot(status),
        };
      },
    );
  }

  async deleteStatus(code: string): Promise<void> {
    await this.#configure(
      { action: 'crm.status.delete', objectType: 'crm_opportunity_status', objectId: code },
      async (em) => {
        // Locked before the count below: a transition (or a creation) into this
        // status holds the row shared until it commits, so this waits for it
        // and then counts what it wrote (research N-R12).
        const status = await em.findOne(CrmOpportunityStatus, { code }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!status) throw statusNotFound(code);
        if (status.isInitial) {
          throw new HttpError(
            409,
            ERROR_CODES.CRM_STATUS_INITIAL_REQUIRED,
            'The initial status cannot be deleted. Make another status the initial one first.',
          );
        }
        const inUse = await this.#inUseCount(em, code);
        if (inUse > 0) {
          throw new HttpError(
            409,
            ERROR_CODES.CRM_STATUS_IN_USE,
            `The status "${code}" is used by ${inUse} opportunities and cannot be deleted.`,
            { statusCode: code, count: inUse },
          );
        }
        // A status takes its transitions and its mappings with it, and nothing else.
        const [transitions, mappings] = await Promise.all([
          em.find(CrmOpportunityStatusTransition, {
            $or: [{ fromStatusCode: code }, { toStatusCode: code }],
          }),
          em.find(CrmOrderStatusMapping, { opportunityStatusCode: code }),
        ]);
        const before = {
          ...snapshot(status),
          transitions: transitions.map((edge) => `${edge.fromStatusCode}>${edge.toStatusCode}`).sort(),
          mappings: mappings.map((mapping) => `${mapping.direction}:${mapping.orderStatusCode}`).sort(),
        };
        em.remove(transitions);
        em.remove(mappings);
        em.remove(status);
        return { before, after: null };
      },
    );
  }

  async setTransitions(input: SetOpportunityTransitionsRequest): Promise<void> {
    await this.#configure(
      { action: 'crm.status.set_transitions', objectType: 'crm_opportunity_status', objectId: 'graph' },
      async (em) => {
        const codes = new Set((await em.find(CrmOpportunityStatus, {})).map((status) => status.code));
        const existing = await em.find(CrmOpportunityStatusTransition, {});
        const byKey = new Map(existing.map((edge) => [`${edge.fromStatusCode}>${edge.toStatusCode}`, edge]));
        const added: string[] = [];
        const removed: string[] = [];

        for (const edge of input.add ?? []) {
          if (!codes.has(edge.fromStatusCode) || !codes.has(edge.toStatusCode)) {
            throw workflowInvalid(
              'transition_unknown_status',
              `A transition names a status that is not configured: ${edge.fromStatusCode} → ${edge.toStatusCode}.`,
            );
          }
          const key = `${edge.fromStatusCode}>${edge.toStatusCode}`;
          if (byKey.has(key)) continue;
          byKey.set(
            key,
            em.create(CrmOpportunityStatusTransition, {
              fromStatusCode: edge.fromStatusCode,
              toStatusCode: edge.toStatusCode,
            }),
          );
          added.push(key);
        }
        for (const edge of input.remove ?? []) {
          const key = `${edge.fromStatusCode}>${edge.toStatusCode}`;
          const row = byKey.get(key);
          if (!row) continue;
          em.remove(row);
          byKey.delete(key);
          removed.push(key);
        }
        return { before: { removed }, after: { added } };
      },
    );
  }

  /**
   * Replace the whole set of Order-status mappings.
   *
   * The Order status a mapping names is held by value and not checked here: the
   * Order workflow is the operator's and is validated where it is used, by the
   * Orders transition port, which answers `unknown_status` for one that is
   * gone. The admin screen offers only statuses the Orders API lists.
   */
  async setOrderStatusMappings(input: SetOrderStatusMappingsRequest): Promise<void> {
    await this.#configure(
      { action: 'crm.mapping.set', objectType: 'crm_status_mapping', objectId: 'mappings' },
      async (em) => {
        const codes = new Set((await em.find(CrmOpportunityStatus, {})).map((status) => status.code));
        const seen = new Set<string>();
        for (const mapping of input.mappings) {
          if (!codes.has(mapping.opportunityStatusCode)) {
            throw workflowInvalid(
              'mapping_unknown_status',
              `A mapping names an opportunity status that is not configured: ${mapping.opportunityStatusCode}.`,
            );
          }
          // Uniqueness is per direction, on the side the mapping is read from:
          // one Order status per Opportunity status going forward, one
          // Opportunity status per Order status coming back. Several Order
          // statuses may lead to one Opportunity status.
          const forward = mapping.direction === 'opportunity_to_order';
          const key = `${mapping.direction}:${forward ? mapping.opportunityStatusCode : mapping.orderStatusCode}`;
          if (seen.has(key)) {
            throw forward
              ? workflowInvalid(
                  'mapping_duplicate',
                  `The opportunity status "${mapping.opportunityStatusCode}" is mapped more than once.`,
                )
              : workflowInvalid(
                  'mapping_duplicate_order_status',
                  `The order status "${mapping.orderStatusCode}" is mapped more than once.`,
                );
          }
          seen.add(key);
        }

        const existing = await em.find(CrmOrderStatusMapping, {});
        const describe = (rows: Array<{ direction: string; opportunityStatusCode: string; orderStatusCode: string }>) =>
          rows
            .map((row) => `${row.direction}:${row.opportunityStatusCode}>${row.orderStatusCode}`)
            .sort();
        const before = { mappings: describe(existing) };
        em.remove(existing);
        // Flushed before the inserts: the partial unique indexes would see the
        // old and the new row for one status side by side otherwise.
        await em.flush();
        for (const mapping of input.mappings) {
          em.create(CrmOrderStatusMapping, {
            direction: mapping.direction,
            opportunityStatusCode: mapping.opportunityStatusCode,
            orderStatusCode: mapping.orderStatusCode,
            // The "every Order" rule is a property of the reverse direction only.
            requireAllOrders: mapping.direction === 'order_to_opportunity' && (mapping.requireAllOrders ?? false),
          });
        }
        return { before, after: { mappings: describe(input.mappings) } };
      },
    );
  }
}
