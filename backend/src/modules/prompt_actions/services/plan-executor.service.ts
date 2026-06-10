import type {
  PromptActionPlan,
  PromptActionResult,
  ResultOperation,
} from '@b2b/contracts';
import type { PromptActionToolRegistry, ToolContext } from './tool-registry.js';

/**
 * PlanExecutorService — feature 043 US1/US2 (research §R6).
 *
 * Walks a confirmed plan with defense-in-depth re-validation: catalogue
 * membership, Zod params, and the operator's LIVE permission are all checked
 * again at execution time (a plan may be minutes old — FR-007). Execution
 * delegates to the owning module's service through the tool handler; this
 * module owns zero domain logic.
 *
 * Partial-failure semantics (FR-011): independent operations keep their
 * outcome; one failure never rolls back a previously succeeded operation.
 */

export class PermissionRevoked extends Error {
  override readonly name = 'PermissionRevoked';
  readonly code = 'PROMPT_PERMISSION_REVOKED' as const;
  constructor(public readonly toolId: string, public readonly permission: string) {
    super(`Permission "${permission}" required by "${toolId}" is no longer held by the operator.`);
  }
}

export interface ExecutorVisibility {
  hasPermission(permission: string): Promise<boolean>;
  isModuleInstalled(moduleId: string): Promise<boolean>;
}

/** Marker returned by tool handlers that delegate to the catalog bulk queue (US2). */
export interface DelegatedExecution {
  delegated: true;
  bulkOperationId: string;
}

export function isDelegatedExecution(value: unknown): value is DelegatedExecution {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { delegated?: unknown }).delegated === true &&
    typeof (value as { bulkOperationId?: unknown }).bulkOperationId === 'string'
  );
}

export interface ExecutePlanResult {
  result: PromptActionResult;
  /** Set when at least one operation was delegated to the bulk machinery. */
  bulkOperationId: string | null;
}

export class PlanExecutorService {
  constructor(private readonly registry: PromptActionToolRegistry) {}

  /**
   * Executes every operation in the plan. Throws {@link PermissionRevoked}
   * (the whole request becomes `refused`) when a live permission check
   * fails BEFORE any operation has run; revocation discovered mid-plan is
   * reported as a per-operation failure instead (already-applied work must
   * stay applied — FR-011).
   */
  async execute(
    plan: PromptActionPlan,
    toolCtx: ToolContext,
    visibility: ExecutorVisibility,
  ): Promise<ExecutePlanResult> {
    // Up-front live permission sweep: refuse before side effects.
    for (const op of plan.operations) {
      const tool = this.registry.get(op.toolId);
      if (tool && !(await visibility.hasPermission(tool.requiredPermission))) {
        throw new PermissionRevoked(op.toolId, tool.requiredPermission);
      }
    }

    const operations: ResultOperation[] = [];
    let bulkOperationId: string | null = null;

    for (const op of plan.operations) {
      const tool = this.registry.get(op.toolId);
      if (!tool || tool.kind !== 'mutation') {
        operations.push({
          toolId: op.toolId,
          status: 'failed',
          message: 'Operation is no longer available on this platform.',
        });
        continue;
      }
      if (!(await visibility.isModuleInstalled(tool.moduleId))) {
        operations.push({
          toolId: op.toolId,
          status: 'failed',
          message: 'The owning module is disabled.',
        });
        continue;
      }
      const params = tool.paramsSchema.safeParse(op.params);
      if (!params.success) {
        operations.push({
          toolId: op.toolId,
          status: 'failed',
          message: 'Stored plan parameters failed re-validation.',
        });
        continue;
      }

      try {
        const value = await tool.execute(params.data, toolCtx);
        if (isDelegatedExecution(value)) {
          bulkOperationId = value.bulkOperationId;
          operations.push({
            toolId: op.toolId,
            status: 'delegated',
            bulkOperationId: value.bulkOperationId,
          });
        } else {
          operations.push({ toolId: op.toolId, status: 'succeeded' });
        }
      } catch (err) {
        operations.push({
          toolId: op.toolId,
          status: 'failed',
          message: (err as Error).message ?? 'Execution failed.',
        });
      }
    }

    const failed = operations.filter((o) => o.status === 'failed').length;
    const outcome: PromptActionResult['outcome'] =
      failed === 0
        ? 'completed'
        : failed === operations.length
          ? 'failed'
          : 'completed_with_errors';

    return { result: { outcome, operations }, bulkOperationId };
  }
}
