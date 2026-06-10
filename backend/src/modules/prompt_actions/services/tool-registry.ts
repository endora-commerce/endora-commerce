import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OperationPreview } from '@b2b/contracts';

/**
 * PromptActionToolRegistry — the module-facing port of feature 043
 * (data-model §4, contracts/prompt-actions-api.md "Tool-contribution
 * contract").
 *
 * Owning modules contribute tools at composition time (the same pattern as
 * the payment/shipping adapter registries), so `prompt_actions` never
 * imports another module's internals. The registry is the ONLY catalogue the
 * interpreter may draw operations from: anything the LLM proposes that is
 * not registered here is rejected (FR-002 / FR-014).
 *
 * Contribution rules (enforced at registration where statically checkable):
 *   1. `id` is '<moduleId>.<snake_case_name>' and unique.
 *   2. `requiredPermission` mirrors the permission guarding the equivalent
 *      manual admin route.
 *   3. `paramsSchema` (Zod) is the single source for validating LLM
 *      arguments and for the provider-facing JSON Schema.
 *   4. Mutations are inert at interpretation time and MUST implement
 *      `preview()` returning server-computed facts.
 *   5. Resolvers are side-effect-free and cap their result size.
 */

export interface ToolAuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ToolContext {
  adminUserId: string;
  requestId: string;
  em: EntityManager;
  auditCtx: ToolAuditContext;
}

export interface PromptActionTool<P = unknown> {
  /** '<moduleId>.<snake_case_name>' */
  id: string;
  moduleId: string;
  kind: 'resolver' | 'mutation';
  /** English, action-oriented — this is the LLM's only documentation. */
  description: string;
  requiredPermission: string;
  paramsSchema: z.ZodType<P>;
  /** Resolvers run during interpretation; mutations only at confirm time. */
  execute(params: P, ctx: ToolContext): Promise<unknown>;
  /** Mutations only: server-computed preview shown in the confirmable plan. */
  preview?(params: P, ctx: ToolContext): Promise<OperationPreview>;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (derived from paramsSchema). */
  inputSchema: Record<string, unknown>;
}

export interface ToolVisibilityContext {
  hasPermission(permission: string): Promise<boolean>;
  isModuleInstalled(moduleId: string): Promise<boolean>;
}

const TOOL_ID_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export class PromptActionToolRegistry {
  private readonly tools = new Map<string, PromptActionTool>();

  register<P>(tool: PromptActionTool<P>): void {
    if (!TOOL_ID_RE.test(tool.id)) {
      throw new Error(
        `Prompt-action tool id "${tool.id}" must match '<moduleId>.<snake_case_name>'.`,
      );
    }
    const [prefix] = tool.id.split('.', 1);
    if (prefix !== tool.moduleId) {
      throw new Error(
        `Prompt-action tool "${tool.id}" must be prefixed with its owning moduleId "${tool.moduleId}".`,
      );
    }
    if (tool.kind === 'mutation' && typeof tool.preview !== 'function') {
      throw new Error(
        `Prompt-action mutation "${tool.id}" must implement preview() — plans render server-computed facts only.`,
      );
    }
    if (this.tools.has(tool.id)) {
      throw new Error(`Duplicate prompt-action tool id "${tool.id}".`);
    }
    this.tools.set(tool.id, tool as PromptActionTool);
  }

  get(id: string): PromptActionTool | undefined {
    return this.tools.get(id);
  }

  list(): PromptActionTool[] {
    return [...this.tools.values()];
  }

  /**
   * The catalogue sent to the LLM for one operator: tools whose owning
   * module is installed AND whose permission the operator holds. Filtering
   * happens here (before the model ever sees a tool) and again at execution
   * time in the plan executor (defense in depth, FR-007).
   */
  async visibleFor(ctx: ToolVisibilityContext): Promise<PromptActionTool[]> {
    const out: PromptActionTool[] = [];
    const moduleStates = new Map<string, boolean>();
    for (const tool of this.tools.values()) {
      let installed = moduleStates.get(tool.moduleId);
      if (installed === undefined) {
        installed = await ctx.isModuleInstalled(tool.moduleId);
        moduleStates.set(tool.moduleId, installed);
      }
      if (!installed) continue;
      if (!(await ctx.hasPermission(tool.requiredPermission))) continue;
      out.push(tool);
    }
    return out;
  }

  /** Provider-facing definition: same Zod schema, serialized as JSON Schema. */
  toLlmToolDefinition(tool: PromptActionTool): LlmToolDefinition {
    return {
      name: tool.id,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.paramsSchema, { io: 'input' }) as Record<string, unknown>,
    };
  }
}
