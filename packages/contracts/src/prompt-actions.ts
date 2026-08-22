// Prompt Actions module — feature 043 contract surface.
// Three sections, matching the per-module convention in @endora-commerce/contracts:
//   (1) Lifecycle: request statuses + provider registry.
//   (2) JSONB payload shapes persisted on `prompt_action_requests`
//       (plan / clarification / result) — the Zod schemas are the source of
//       truth for both the HTTP DTOs and the interpreter's validation.
//   (3) Admin HTTP request/response schemas + the v1 tool parameter schemas
//       (one Zod schema per registered tool; the same schema validates the
//       LLM's arguments and generates the provider-facing JSON Schema).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// (1) Lifecycle
// ---------------------------------------------------------------------------

export const PROMPT_ACTION_STATUSES = [
  'interpreting',
  'awaiting_confirmation',
  'needs_clarification',
  'unsupported',
  'refused',
  'failed',
  'executing',
  'completed',
  'completed_with_errors',
  'cancelled',
  'expired',
] as const;

export const PromptActionStatusSchema = z.enum(PROMPT_ACTION_STATUSES);
export type PromptActionStatus = z.infer<typeof PromptActionStatusSchema>;

export const PromptActionsProviderSchema = z.enum(['anthropic', 'google', 'openai']);
export type PromptActionsProvider = z.infer<typeof PromptActionsProviderSchema>;

/** Minutes a plan stays confirmable after interpretation (lazy expiry). */
export const PROMPT_ACTION_PLAN_TTL_MINUTES = 10;

// ---------------------------------------------------------------------------
// (2) Persisted JSONB shapes
// ---------------------------------------------------------------------------

export const OperationPreviewSchema = z.object({
  /** Server-computed human-readable headline, e.g. 'Set stock of "Bolts 0193" in "Default" to 120'. */
  headline: z.string(),
  /** Current state snapshot for single-record mutations, e.g. { onHand: 80 }. */
  current: z.unknown().optional(),
  affectedCount: z.number().int().nonnegative(),
  /** ≤ 10 labels for bulk mutations. */
  sample: z
    .array(z.object({ id: z.string(), label: z.string() }))
    .max(10)
    .optional(),
});
export type OperationPreview = z.infer<typeof OperationPreviewSchema>;

export const PlanOperationSchema = z.object({
  toolId: z.string(),
  moduleId: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** Snapshot at plan time; re-checked against the live permission set at execution. */
  requiredPermission: z.string(),
  preview: OperationPreviewSchema,
});
export type PlanOperation = z.infer<typeof PlanOperationSchema>;

export const PromptActionPlanSchema = z.object({
  /** Localized, server-assembled headline for the whole plan. */
  summary: z.string(),
  operations: z.array(PlanOperationSchema).min(1),
  /** The bulk cap applied at preview time (FR-010). */
  bulkLimit: z.number().int().positive(),
});
export type PromptActionPlan = z.infer<typeof PromptActionPlanSchema>;

export const PromptActionClarificationSchema = z.object({
  question: z.string(),
  kind: z.enum(['entity_choice', 'free_text']),
  candidates: z
    .array(z.object({ id: z.string(), label: z.string(), hint: z.string().optional() }))
    .max(20)
    .optional(),
});
export type PromptActionClarification = z.infer<typeof PromptActionClarificationSchema>;

export const ResultOperationSchema = z.object({
  toolId: z.string(),
  status: z.enum(['succeeded', 'failed', 'delegated']),
  /** Operator-facing failure reason. */
  message: z.string().optional(),
  /** Set when the operation rides the catalog bulk-operation machinery. */
  bulkOperationId: z.uuid().optional(),
  /** Per-item outcome counts (folded from the bulk operation when delegated). */
  summary: z
    .object({
      total: z.number().int().nonnegative(),
      succeeded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      failures: z
        .array(z.object({ id: z.string(), label: z.string().optional(), reason: z.string() }))
        .max(50)
        .optional(),
    })
    .optional(),
});
export type ResultOperation = z.infer<typeof ResultOperationSchema>;

export const PromptActionResultSchema = z.object({
  outcome: z.enum(['completed', 'completed_with_errors', 'failed']),
  operations: z.array(ResultOperationSchema),
});
export type PromptActionResult = z.infer<typeof PromptActionResultSchema>;

// ---------------------------------------------------------------------------
// (3) Admin HTTP
// ---------------------------------------------------------------------------

export const PromptActionsCapabilitySchema = z.object({
  status: z.enum(['ready', 'disabled', 'not_configured']),
  bulkLimit: z.number().int().positive(),
});
export type PromptActionsCapability = z.infer<typeof PromptActionsCapabilitySchema>;

export const SubmitPromptRequestSchema = z.object({
  prompt: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(2000)),
});
export type SubmitPromptRequest = z.infer<typeof SubmitPromptRequestSchema>;

export const ClarifyRequestSchema = z.union([
  z.object({ selectedCandidateId: z.string().min(1).max(200) }),
  z.object({
    text: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1).max(500)),
  }),
]);
export type ClarifyRequest = z.infer<typeof ClarifyRequestSchema>;

export const PromptActionRequestDtoSchema = z.object({
  id: z.uuid(),
  status: PromptActionStatusSchema,
  prompt: z.string(),
  plan: PromptActionPlanSchema.nullable(),
  clarification: PromptActionClarificationSchema.nullable(),
  result: PromptActionResultSchema.nullable(),
  /** Operator-facing message for unsupported / refused / failed states. */
  error: z.string().nullable(),
  bulkOperationId: z.uuid().nullable(),
  /** Confirm deadline (created/refreshed at interpretation + 10 min); null once terminal. */
  expiresAt: z.iso.datetime().nullable(),
  seenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type PromptActionRequestDto = z.infer<typeof PromptActionRequestDtoSchema>;

export const PromptActionRequestResponseSchema = z.object({
  data: PromptActionRequestDtoSchema,
});

export const PromptActionListQuerySchema = z.object({
  unseen: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

export const PromptActionListResponseSchema = z.object({
  data: z.array(PromptActionRequestDtoSchema),
});

// ---------------------------------------------------------------------------
// v1 tool parameter schemas (data-model §4)
// ---------------------------------------------------------------------------

export const SearchProductsParamsSchema = z.object({
  q: z.string().min(1).max(200).describe('Name, SKU or slug fragment to search for (case- and diacritic-insensitive substring).'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default 10, max 20).'),
});
export type SearchProductsParams = z.infer<typeof SearchProductsParamsSchema>;

export const SearchCategoriesParamsSchema = z.object({
  q: z.string().min(1).max(200).describe('Category name fragment to search for.'),
});
export type SearchCategoriesParams = z.infer<typeof SearchCategoriesParamsSchema>;

export const SearchWarehousesParamsSchema = z.object({
  q: z.string().min(1).max(200).describe('Warehouse name or code fragment to search for.'),
});
export type SearchWarehousesParams = z.infer<typeof SearchWarehousesParamsSchema>;

export const SetStockLevelParamsSchema = z.object({
  productId: z.uuid().describe('ID of the product, resolved via catalog.search_products.'),
  warehouseId: z.uuid().describe('ID of the warehouse, resolved via inventory.search_warehouses.'),
  quantity: z.number().int().min(0).describe('New absolute on-hand quantity for the product in that warehouse.'),
});
export type SetStockLevelParams = z.infer<typeof SetStockLevelParamsSchema>;

export const AssignProductsToCategoryParamsSchema = z.object({
  productIds: z
    .array(z.uuid())
    .min(1)
    .describe('IDs of the products to assign, resolved via catalog.search_products.'),
  categoryId: z.uuid().describe('ID of the target category, resolved via catalog.search_categories.'),
});
export type AssignProductsToCategoryParams = z.infer<typeof AssignProductsToCategoryParamsSchema>;

export const RemoveProductsFromCategoryParamsSchema = z.object({
  productIds: z
    .array(z.uuid())
    .min(1)
    .describe('IDs of the products to remove from the category, resolved via catalog.search_products.'),
  categoryId: z.uuid().describe('ID of the category to remove the products from, resolved via catalog.search_categories.'),
});
export type RemoveProductsFromCategoryParams = z.infer<typeof RemoveProductsFromCategoryParamsSchema>;

export const SearchOrdersParamsSchema = z.object({
  q: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Order business ID, customer name or organization name fragment to search for (case-insensitive).',
    ),
});
export type SearchOrdersParams = z.infer<typeof SearchOrdersParamsSchema>;

export const SetProductStatusParamsSchema = z.object({
  productIds: z
    .array(z.uuid())
    .min(1)
    .describe('IDs of the products to update, resolved via catalog.search_products.'),
  status: z
    .enum(['draft', 'active', 'inactive'])
    .describe('New product status to apply to every listed product.'),
});
export type SetProductStatusParams = z.infer<typeof SetProductStatusParamsSchema>;

export const SetProductsVisibilityParamsSchema = z.object({
  productIds: z
    .array(z.uuid())
    .min(1)
    .describe('IDs of the products to update, resolved via catalog.search_products.'),
  visibility: z
    .enum(['public', 'logged_in_only', 'organization_restricted'])
    .describe('New storefront visibility to apply to every listed product.'),
});
export type SetProductsVisibilityParams = z.infer<typeof SetProductsVisibilityParamsSchema>;

export const SetOrderStatusParamsSchema = z.object({
  orderId: z.uuid().describe('ID of the order, resolved via orders.search_orders.'),
  toStatusCode: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'Target order status code (e.g. "processing", "shipment_sent", "cancelled"). Must be a status reachable from the order\'s current status by the configured transition graph.',
    ),
  reason: z.string().max(500).optional().describe('Optional note recorded with the status change.'),
});
export type SetOrderStatusParams = z.infer<typeof SetOrderStatusParamsSchema>;

export const BulkSetOrderStatusParamsSchema = z.object({
  orderIds: z
    .array(z.uuid())
    .min(1)
    .describe('IDs of the orders to update, resolved via orders.search_orders.'),
  toStatusCode: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'Target order status code applied to every order for which the transition is valid; orders whose current status cannot reach it are skipped.',
    ),
  reason: z.string().max(500).optional().describe('Optional note recorded with each status change.'),
});
export type BulkSetOrderStatusParams = z.infer<typeof BulkSetOrderStatusParamsSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// What of `prompt_actions`' contribution surface can be published (feature
// 075, Phase P) — and, stated here rather than discovered later, what cannot.
//
// Phase P published the three manager-free shapes and escalated the two that
// carried a MikroORM `EntityManager`. **D-75 and D-76 settled both, and neither
// needed a way to carry a manager across a boundary.**
//
// The escalation's premise was that "a tool runs inside the confirm-time
// transaction the request row is being written in". It does not: `confirm()`
// forks an `EntityManager` and flushes, with no `em.transactional` anywhere in
// the file, so every flush is its own implicit transaction and a tool that
// "joins" it joins nothing. Measured against the tree, all three contributing
// modules used `ctx.em` **only in `preview()`**, only for reads, only of their
// own tables — every write already went through the owner's own audited
// service, which opens its own unit of work. It was a read handle wearing a
// transaction's name, so it is deleted (D-75) and each preview forks its own.
//
// `BulkProgressResolver(row, em)` was worse than co-transactional: its `em` was
// **dead** at its only implementation, and the parameter that was not dead —
// `row` — handed `prompt_actions`' own entity, and its state machine, to a
// contributor that then decided whether the request was `completed`, `failed`
// or `completed_with_errors`. The reader returns a snapshot now and the host
// rules on its own row (D-76).
// ---------------------------------------------------------------------------

/** Who is running a tool, for the audit entry the mutation writes. */
export interface ToolAuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** The tool as the LLM is told about it. Derived from the tool's `paramsSchema`. */
export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>;
}

/**
 * What decides whether a tool is offered at all: the caller's permissions and
 * the module's presence.
 *
 * Both questions, not one. A tool whose module is switched off must not be
 * advertised even to an admin who holds its permission — Constitution XVII
 * rule 5 — and a tool whose module is present must not be advertised to
 * somebody who would get a 403 running it.
 */
export interface ToolVisibilityContext {
  hasPermission(permission: string): Promise<boolean>;
  isModuleInstalled(moduleId: string): Promise<boolean>;
}

/**
 * What a tool is told about the operator running it (D-75).
 *
 * Three fields, and no unit of work: a preview reads committed rows through the
 * contributing module's own `emFactory`, and an execution goes through that
 * module's own audited service. `requestId` is the prompt request's id, which a
 * tool uses for correlation and never to load the row.
 */
export interface ToolContext {
  adminUserId: string;
  requestId: string;
  auditCtx: ToolAuditContext;
}

/**
 * A tool a module contributes to the assistant's catalogue.
 *
 * `paramsSchema` is a Zod schema and stays one: `zod` is this package's only
 * dependency, and the schema is the single source both for validating what the
 * model proposed and for the provider-facing JSON Schema.
 *
 * Registration rules, enforced by the host at `register`: `id` is
 * `<moduleId>.<snake_case_name>` and unique, `requiredPermission` mirrors the
 * permission guarding the equivalent manual admin route, and a mutation MUST
 * implement `preview()` — a confirmable plan renders server-computed facts
 * only.
 */
export interface PromptActionTool<P = unknown> {
  /** `<moduleId>.<snake_case_name>` */
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

/**
 * Container name: `promptActionToolRegistry`. Owner: `prompt_actions`.
 *
 * The **contribution** shape, in the idiom `GatewayRefundRegistryPort` and
 * `PaymentAdapterRegistryPort` already use: the host keeps the class, a
 * contributor names the interface. That is what lets `catalog`, `inventory` and
 * `orders` type their cradle entry without importing `prompt_actions`.
 *
 * Deliberately **not** a gated port. A contributor pushes from its own boot
 * hook, and gating the push would turn an operator's deactivation into an entry
 * missing until the next restart; the presence question is answered by the host
 * at enumeration, keyed on the module recorded with each tool.
 */
export interface PromptActionToolRegistryPort {
  register<P>(tool: PromptActionTool<P>): void;
}

/**
 * What a long-running bulk operation has done so far, as its owner reports it
 * (D-76).
 *
 * Data out, and nothing else. The previous shape handed the contributor
 * `prompt_actions`' request entity and let it write `row.status`, `row.error`
 * and `row.result`: whether a prompt request is `completed`, `failed` or
 * `completed_with_errors` is the host's state machine, and what a bulk
 * operation did is the contributor's fact. This is the fact.
 */
export interface BulkProgressSnapshot {
  total: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
  /** `null` while the run is still going. */
  terminal: 'completed' | 'failed' | null;
  error?: string | null;
}

/** Reads live progress for one bulk operation, or `null` when it knows none. */
export type BulkProgressReader = (
  bulkOperationId: string,
) => Promise<BulkProgressSnapshot | null>;

/**
 * Container name: `promptActionBulkProgressRegistry`. Owner: `prompt_actions`.
 *
 * The same contribution idiom as {@link PromptActionToolRegistryPort}, and
 * ungated for the same reason. The host states its absent-owner policy at the
 * class: an absent contributor's reader is skipped, so the request reports no
 * progress — which is exactly what a deployment shipping no contributor has
 * always seen.
 */
export interface PromptActionBulkProgressRegistryPort {
  register(moduleId: string, read: BulkProgressReader): void;
}
