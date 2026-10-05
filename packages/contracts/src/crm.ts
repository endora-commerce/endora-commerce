import { z } from 'zod';
import { collectionEnvelope, dataEnvelope } from './envelopes.js';
import { customFieldValuesSchema } from './custom-fields.js';
import type { QuoteRequestStatus } from './quote-requests.js';

/**
 * CRM — Sales Opportunities (`specs/143-crm-sales-opportunities/`).
 *
 * Every request, response, event and port shape of the `crm` module, written
 * before the first route (Constitution II). The normative prose is
 * `specs/143-crm-sales-opportunities/contracts/admin-api.md` and
 * `contracts/events-and-ports.md`; this file is what the backend validates
 * with and what the admin types its calls from.
 *
 * Base path of the HTTP API: `/api/v1/admin/crm`. There is no storefront or
 * customer route.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * A status code — stable, snake_case, immutable after create. The grammar is
 * what lets a templated event name be built without escaping.
 */
export const opportunityStatusCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Status code must be snake_case and start with a letter');

/** What a status means for the Opportunity: still worked, or closed as won / lost. */
export const opportunityStatusKindSchema = z.enum(['open', 'won', 'lost']);
export type OpportunityStatusKind = z.infer<typeof opportunityStatusKindSchema>;

export const opportunityClosedKindSchema = z.enum(['won', 'lost']);
export type OpportunityClosedKind = z.infer<typeof opportunityClosedKindSchema>;

export const opportunityValueModeSchema = z.enum(['manual', 'computed']);
export type OpportunityValueMode = z.infer<typeof opportunityValueModeSchema>;

export const opportunitySourceSchema = z.enum(['manual', 'order', 'quote_request']);
export type OpportunitySource = z.infer<typeof opportunitySourceSchema>;

export const opportunityDocumentKindSchema = z.enum(['order', 'quote_request']);
export type OpportunityDocumentKind = z.infer<typeof opportunityDocumentKindSchema>;

export const opportunityLinkSourceSchema = z.enum([
  'manual',
  'auto',
  'created_from_opportunity',
  'quote_conversion',
]);
export type OpportunityLinkSource = z.infer<typeof opportunityLinkSourceSchema>;

export const orderStatusMappingDirectionSchema = z.enum([
  'opportunity_to_order',
  'order_to_opportunity',
]);
export type OrderStatusMappingDirection = z.infer<typeof orderStatusMappingDirectionSchema>;

/**
 * What became of one attempt to carry a status across the Opportunity ↔ Order
 * link. The first six are `OrderTransitionOutcome`'s answers, recorded
 * verbatim; `failed` is a call that did not return one, `skipped` is the
 * reverse direction declining to move the Opportunity, and `pending` is a row
 * written before the call that has not been resolved yet.
 */
export const propagationOutcomeKindSchema = z.enum([
  'pending',
  'applied',
  'already_there',
  'not_found',
  'unknown_status',
  'not_permitted',
  'vetoed',
  'skipped',
  'failed',
]);
export type PropagationOutcomeKind = z.infer<typeof propagationOutcomeKindSchema>;

export const opportunityCommentKindSchema = z.enum(['note', 'message']);
export type OpportunityCommentKind = z.infer<typeof opportunityCommentKindSchema>;

export const opportunityReferenceTypeSchema = z.enum(['product', 'order']);
export type OpportunityReferenceType = z.infer<typeof opportunityReferenceTypeSchema>;

/** The six `QuoteRequestStatus` values — a fixed union, unlike Order statuses. */
const QUOTE_REQUEST_STATUS_VALUES = [
  'Created from admin',
  'Pending',
  'Canceled',
  'Approved',
  'Completed',
  'Expired',
] as const satisfies readonly QuoteRequestStatus[];
const quoteRequestStatusValueSchema = z.enum(QUOTE_REQUEST_STATUS_VALUES);

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a #rrggbb hex value');

const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 code, e.g. PLN');

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** A non-negative decimal held as a string, as `numeric(14,2)` money is everywhere. */
const decimalAmountSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Amount must be a non-negative decimal with at most two places');

const isoTimestampSchema = z.string();

/**
 * A query-string field that may repeat. One occurrence arrives as a string and
 * several as an array; both normalise to an array.
 */
function repeatable<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item).max(50).optional(),
  );
}

const statusNameSchema = z.record(z.string().min(2).max(16), z.string().min(1).max(120));

// ---------------------------------------------------------------------------
// §9 References
// ---------------------------------------------------------------------------

/**
 * The reference-token grammar: `[[product:<uuid>]]`, `[[order:<uuid>]]`.
 *
 * Free text (`description`, a comment `body`) is stored as plain text carrying
 * these tokens. This is the one place the grammar is written; the backend
 * extracts with it and the admin's composer inserts with it.
 */
const REFERENCE_TOKEN_SOURCE =
  '\\[\\[(product|order):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\]\\]';

export interface OpportunityReferenceToken {
  type: OpportunityReferenceType;
  id: string;
}

export function formatOpportunityReferenceToken(type: OpportunityReferenceType, id: string): string {
  return `[[${type}:${id}]]`;
}

/** Every well-formed token in `text`, in first-appearance order, each target once. */
export function extractOpportunityReferenceTokens(text: string): OpportunityReferenceToken[] {
  const seen = new Set<string>();
  const tokens: OpportunityReferenceToken[] = [];
  // A fresh expression per call: a shared global one carries `lastIndex`.
  for (const match of text.matchAll(new RegExp(REFERENCE_TOKEN_SOURCE, 'g'))) {
    const type = match[1] as OpportunityReferenceType;
    const id = (match[2] as string).toLowerCase();
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ type, id });
  }
  return tokens;
}

/**
 * A resolved reference, returned beside every free-text field. A target the
 * reader may not see, or that is gone, is `available: false` with no label.
 */
export const OpportunityReferenceSchema = z.object({
  type: opportunityReferenceTypeSchema,
  id: z.string().uuid(),
  available: z.boolean(),
  label: z.string().nullable(),
  url: z.string().nullable(),
});
export type OpportunityReference = z.infer<typeof OpportunityReferenceSchema>;

// ---------------------------------------------------------------------------
// §1 Opportunities
// ---------------------------------------------------------------------------

export const opportunityStateSchema = opportunityStatusKindSchema;

export const opportunitySortSchema = z.enum([
  'createdAt',
  'updatedAt',
  'value',
  'expectedCloseDate',
  'number',
]);

/** `me` and `unassigned` are tokens the service resolves; anything else is a user id. */
const assigneeFilterSchema = z.union([z.literal('me'), z.literal('unassigned'), z.string().uuid()]);

/** The filters the list and the board share. */
const opportunityFilterShape = {
  q: z.string().trim().min(1).max(200).optional(),
  organizationId: z.string().uuid().optional(),
  assignedAdminUserId: assigneeFilterSchema.optional(),
  salesChannelId: z.string().uuid().optional(),
  /** Every tag must be carried (AND). */
  tagId: repeatable(z.string().uuid()),
  createdFrom: calendarDateSchema.optional(),
  createdTo: calendarDateSchema.optional(),
};

export const OpportunityListQuerySchema = z.object({
  ...opportunityFilterShape,
  statusCode: repeatable(opportunityStatusCodeSchema),
  state: opportunityStateSchema.optional(),
  sort: opportunitySortSchema.optional(),
  order: z.enum(['asc', 'desc']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type OpportunityListQuery = z.infer<typeof OpportunityListQuerySchema>;

export const CreateOpportunityRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  organizationId: z.string().uuid(),
  currency: currencyCodeSchema,
  description: z.string().max(20_000).nullable().optional(),
  customerAccountId: z.string().uuid().nullable().optional(),
  salesChannelId: z.string().uuid().nullable().optional(),
  /** `null` = explicitly unassigned; absent = apply the default-assignee rule. */
  assignedAdminUserId: z.string().uuid().nullable().optional(),
  valueMode: opportunityValueModeSchema.optional(),
  manualValue: decimalAmountSchema.nullable().optional(),
  expectedCloseDate: calendarDateSchema.nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  // §12a (US15) — operator-defined fields, keyed by definition key. On an edit,
  // absent means "leave the values as they are".
  customFieldValues: customFieldValuesSchema.optional(),
});
export type CreateOpportunityRequest = z.infer<typeof CreateOpportunityRequestSchema>;

/**
 * Every create field except the two immutable ones. Strict, so a body naming
 * `organizationId` or `currency` is refused instead of silently ignored.
 */
export const UpdateOpportunityRequestSchema = CreateOpportunityRequestSchema.omit({
  organizationId: true,
  currency: true,
})
  .partial()
  .strict();
export type UpdateOpportunityRequest = z.infer<typeof UpdateOpportunityRequestSchema>;

export const OpportunityStatusRefSchema = z.object({
  code: z.string(),
  name: z.string(),
  color: z.string(),
  kind: opportunityStatusKindSchema,
});
export type OpportunityStatusRef = z.infer<typeof OpportunityStatusRefSchema>;

export const OpportunityTagRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
});
export type OpportunityTagRef = z.infer<typeof OpportunityTagRefSchema>;

export const OpportunitySummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  title: z.string(),
  organization: z.object({ id: z.string().uuid(), name: z.string() }),
  status: OpportunityStatusRefSchema,
  assignee: z.object({ id: z.string().uuid(), name: z.string(), active: z.boolean() }).nullable(),
  /** The effective value: `manualValue` or `computedValue`, by `valueMode`. */
  value: z.string().nullable(),
  valueMode: opportunityValueModeSchema,
  currency: z.string(),
  salesChannelId: z.string().uuid().nullable(),
  expectedCloseDate: z.string().nullable(),
  tags: z.array(OpportunityTagRefSchema),
  closedAt: isoTimestampSchema.nullable(),
  closedKind: opportunityClosedKindSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type OpportunitySummary = z.infer<typeof OpportunitySummarySchema>;

// ---------------------------------------------------------------------------
// §3 Links
// ---------------------------------------------------------------------------

export const CreateOpportunityLinkRequestSchema = z.object({
  documentKind: opportunityDocumentKindSchema,
  documentId: z.string().uuid(),
  syncStatus: z.boolean().optional(),
});
export type CreateOpportunityLinkRequest = z.infer<typeof CreateOpportunityLinkRequestSchema>;

export const UpdateOpportunityLinkRequestSchema = z.object({
  syncStatus: z.boolean(),
});
export type UpdateOpportunityLinkRequest = z.infer<typeof UpdateOpportunityLinkRequestSchema>;

/**
 * A linked document. `number`, `status`, `total` and `currency` are present
 * only when `available` — a document the reader may not see, or whose owning
 * module is switched off, renders as unavailable.
 */
export const OpportunityLinkSchema = z.object({
  id: z.string().uuid(),
  documentKind: opportunityDocumentKindSchema,
  documentId: z.string().uuid(),
  available: z.boolean(),
  number: z.string().optional(),
  status: z.string().optional(),
  total: z.string().optional(),
  currency: z.string().optional(),
  syncStatus: z.boolean(),
  linkSource: opportunityLinkSourceSchema,
  createdAt: isoTimestampSchema,
});
export type OpportunityLink = z.infer<typeof OpportunityLinkSchema>;

// ---------------------------------------------------------------------------
// §2 Transition
// ---------------------------------------------------------------------------

export const TransitionOpportunityRequestSchema = z.object({
  to: opportunityStatusCodeSchema,
  reason: z.string().max(2000).nullable().optional(),
});
export type TransitionOpportunityRequest = z.infer<typeof TransitionOpportunityRequestSchema>;

export const PropagationOutcomeSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderNumber: z.string().nullable(),
  direction: orderStatusMappingDirectionSchema,
  orderStatusCode: z.string(),
  outcome: propagationOutcomeKindSchema.exclude(['pending']),
  detail: z.string().nullable(),
  createdAt: isoTimestampSchema,
});
export type PropagationOutcome = z.infer<typeof PropagationOutcomeSchema>;

export const OpportunityExcludedDocumentSchema = z.object({
  kind: opportunityDocumentKindSchema,
  id: z.string().uuid(),
  reason: z.string(),
});
export type OpportunityExcludedDocument = z.infer<typeof OpportunityExcludedDocumentSchema>;

export const OpportunityDetailSchema = OpportunitySummarySchema.extend({
  description: z.string().nullable(),
  references: z.array(OpportunityReferenceSchema),
  customerAccount: z
    .object({ id: z.string().uuid(), name: z.string(), email: z.string() })
    .nullable(),
  manualValue: z.string().nullable(),
  computedValue: z.string(),
  excludedDocuments: z.array(OpportunityExcludedDocumentSchema),
  source: opportunitySourceSchema,
  version: z.number().int(),
  allowedTransitions: z.array(OpportunityStatusRefSchema),
  links: z.array(OpportunityLinkSchema),
  unresolvedPropagations: z.array(PropagationOutcomeSchema),
  // §12a (US15) — the values of the fields defined today; a value whose
  // definition was removed is not returned.
  customFieldValues: customFieldValuesSchema,
});
export type OpportunityDetail = z.infer<typeof OpportunityDetailSchema>;

export const OpportunityTransitionResultSchema = z.object({
  opportunity: OpportunityDetailSchema,
  from: z.string(),
  to: z.string(),
  propagation: z.array(PropagationOutcomeSchema),
});
export type OpportunityTransitionResult = z.infer<typeof OpportunityTransitionResultSchema>;

export const OpportunityListResponseSchema = collectionEnvelope(OpportunitySummarySchema);
export const OpportunityDetailResponseSchema = dataEnvelope(OpportunityDetailSchema);
export const OpportunityLinkResponseSchema = dataEnvelope(OpportunityLinkSchema);
export const OpportunityTransitionResponseSchema = dataEnvelope(OpportunityTransitionResultSchema);
export const PropagationOutcomeResponseSchema = dataEnvelope(PropagationOutcomeSchema);

// ---------------------------------------------------------------------------
// §4 Workflow configuration
// ---------------------------------------------------------------------------

export const CreateOpportunityStatusRequestSchema = z.object({
  code: opportunityStatusCodeSchema,
  name: statusNameSchema.optional(),
  defaultName: z.string().trim().min(1).max(120),
  kind: opportunityStatusKindSchema,
  isInitial: z.boolean().optional(),
  weight: z.number().int().min(0).max(100_000).optional(),
  color: colorSchema.optional(),
});
export type CreateOpportunityStatusRequest = z.infer<typeof CreateOpportunityStatusRequestSchema>;

/** `code` is immutable; strict, so a body naming it is refused. */
export const UpdateOpportunityStatusRequestSchema = CreateOpportunityStatusRequestSchema.omit({
  code: true,
})
  .partial()
  .strict();
export type UpdateOpportunityStatusRequest = z.infer<typeof UpdateOpportunityStatusRequestSchema>;

export const OpportunityTransitionEdgeSchema = z
  .object({
    fromStatusCode: opportunityStatusCodeSchema,
    toStatusCode: opportunityStatusCodeSchema,
  })
  .refine((edge) => edge.fromStatusCode !== edge.toStatusCode, {
    message: 'A transition must connect two different statuses',
  });
export type OpportunityTransitionEdge = z.infer<typeof OpportunityTransitionEdgeSchema>;

export const SetOpportunityTransitionsRequestSchema = z.object({
  add: z.array(OpportunityTransitionEdgeSchema).max(500).optional(),
  remove: z.array(OpportunityTransitionEdgeSchema).max(500).optional(),
});
export type SetOpportunityTransitionsRequest = z.infer<typeof SetOpportunityTransitionsRequestSchema>;

export const OrderStatusMappingSchema = z.object({
  direction: orderStatusMappingDirectionSchema,
  opportunityStatusCode: opportunityStatusCodeSchema,
  /** An Order status code, by value — the Order workflow is the operator's. */
  orderStatusCode: z.string().min(1).max(64),
  /** Meaningful for `order_to_opportunity` only. */
  requireAllOrders: z.boolean().optional(),
});
export type OrderStatusMapping = z.infer<typeof OrderStatusMappingSchema>;

/** Replaces the whole set. */
export const SetOrderStatusMappingsRequestSchema = z.object({
  mappings: z.array(OrderStatusMappingSchema).max(500),
});
export type SetOrderStatusMappingsRequest = z.infer<typeof SetOrderStatusMappingsRequestSchema>;

export const SetValueCountingStatusesRequestSchema = z.object({
  order: z.array(z.string().min(1).max(64)).max(200),
  quoteRequest: z.array(quoteRequestStatusValueSchema).max(QUOTE_REQUEST_STATUS_VALUES.length),
});
export type SetValueCountingStatusesRequest = z.infer<typeof SetValueCountingStatusesRequestSchema>;

export const OpportunityWorkflowStatusSchema = z.object({
  code: z.string(),
  name: z.record(z.string(), z.string()),
  defaultName: z.string(),
  kind: opportunityStatusKindSchema,
  isInitial: z.boolean(),
  weight: z.number().int(),
  color: z.string(),
  /** Opportunities currently in this status that the caller may see. */
  inUseCount: z.number().int().nonnegative(),
});
export type OpportunityWorkflowStatus = z.infer<typeof OpportunityWorkflowStatusSchema>;

export const OpportunityWorkflowSchema = z.object({
  statuses: z.array(OpportunityWorkflowStatusSchema),
  transitions: z.array(z.object({ fromStatusCode: z.string(), toStatusCode: z.string() })),
  orderStatusMappings: z.array(
    z.object({
      direction: orderStatusMappingDirectionSchema,
      opportunityStatusCode: z.string(),
      orderStatusCode: z.string(),
      requireAllOrders: z.boolean(),
      /** `false` once the Order status the mapping names no longer exists. */
      orderStatusKnown: z.boolean(),
    }),
  ),
  valueCountingStatuses: z.object({
    order: z.array(z.string()),
    quoteRequest: z.array(z.string()),
  }),
});
export type OpportunityWorkflow = z.infer<typeof OpportunityWorkflowSchema>;

export const OpportunityWorkflowResponseSchema = dataEnvelope(OpportunityWorkflowSchema);

// ---------------------------------------------------------------------------
// §5 Assignment
// ---------------------------------------------------------------------------

export const AssignOpportunityRequestSchema = z.object({
  adminUserId: z.string().uuid().nullable(),
});
export type AssignOpportunityRequest = z.infer<typeof AssignOpportunityRequestSchema>;

// ---------------------------------------------------------------------------
// §6 Notes and messages
// ---------------------------------------------------------------------------

const commentBodySchema = z.string().min(1).max(10_000);

export const OpportunityCommentListQuerySchema = z.object({
  kind: opportunityCommentKindSchema,
});
export type OpportunityCommentListQuery = z.infer<typeof OpportunityCommentListQuerySchema>;

export const CreateOpportunityCommentRequestSchema = z.object({
  kind: opportunityCommentKindSchema,
  body: commentBodySchema,
});
export type CreateOpportunityCommentRequest = z.infer<typeof CreateOpportunityCommentRequestSchema>;

export const UpdateOpportunityCommentRequestSchema = z.object({
  body: commentBodySchema,
});
export type UpdateOpportunityCommentRequest = z.infer<typeof UpdateOpportunityCommentRequestSchema>;

export const OpportunityCommentSchema = z.object({
  id: z.string().uuid(),
  kind: opportunityCommentKindSchema,
  author: z.object({ id: z.string().uuid(), name: z.string() }),
  body: z.string(),
  references: z.array(OpportunityReferenceSchema),
  editedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
});
export type OpportunityComment = z.infer<typeof OpportunityCommentSchema>;

export const OpportunityCommentResponseSchema = dataEnvelope(OpportunityCommentSchema);
export const OpportunityCommentListResponseSchema = dataEnvelope(z.array(OpportunityCommentSchema));

// ---------------------------------------------------------------------------
// §7 Attachments
// ---------------------------------------------------------------------------

export const CreateOpportunityAttachmentRequestSchema = z.object({
  assetId: z.string().uuid(),
});
export type CreateOpportunityAttachmentRequest = z.infer<
  typeof CreateOpportunityAttachmentRequestSchema
>;

export const OpportunityAttachmentSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string().nullable(),
  uploadedBy: z.object({ id: z.string().uuid(), name: z.string() }),
  createdAt: isoTimestampSchema,
});
export type OpportunityAttachment = z.infer<typeof OpportunityAttachmentSchema>;

export const OpportunityAttachmentResponseSchema = dataEnvelope(OpportunityAttachmentSchema);
export const OpportunityAttachmentListResponseSchema = dataEnvelope(
  z.array(OpportunityAttachmentSchema),
);

// ---------------------------------------------------------------------------
// §8 Tags
// ---------------------------------------------------------------------------

const tagNameSchema = z.string().trim().min(1).max(64);

export const CreateOpportunityTagRequestSchema = z.object({
  name: tagNameSchema,
  color: colorSchema.optional(),
});
export type CreateOpportunityTagRequest = z.infer<typeof CreateOpportunityTagRequestSchema>;

export const UpdateOpportunityTagRequestSchema = z.object({
  name: tagNameSchema.optional(),
  color: colorSchema.optional(),
});
export type UpdateOpportunityTagRequest = z.infer<typeof UpdateOpportunityTagRequestSchema>;

/** Replaces the Opportunity's whole tag set. */
export const SetOpportunityTagsRequestSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(50),
});
export type SetOpportunityTagsRequest = z.infer<typeof SetOpportunityTagsRequestSchema>;

export const OpportunityTagSchema = OpportunityTagRefSchema.extend({
  /** Opportunities carrying the tag that the caller may see. */
  usageCount: z.number().int().nonnegative(),
});
export type OpportunityTag = z.infer<typeof OpportunityTagSchema>;

export const OpportunityTagResponseSchema = dataEnvelope(OpportunityTagSchema);
export const OpportunityTagListResponseSchema = dataEnvelope(z.array(OpportunityTagSchema));

// ---------------------------------------------------------------------------
// §10 Board
// ---------------------------------------------------------------------------

/** The list filters minus `statusCode` / `state` — the columns *are* the statuses. */
export const OpportunityBoardQuerySchema = z.object({
  ...opportunityFilterShape,
  perColumn: z.coerce.number().int().positive().max(200).default(50),
});
export type OpportunityBoardQuery = z.infer<typeof OpportunityBoardQuerySchema>;

export const OpportunityCurrencyTotalSchema = z.object({
  currency: z.string(),
  total: z.string(),
});
export type OpportunityCurrencyTotal = z.infer<typeof OpportunityCurrencyTotalSchema>;

export const OpportunityBoardColumnSchema = z.object({
  status: OpportunityStatusRefSchema,
  count: z.number().int().nonnegative(),
  valueTotals: z.array(OpportunityCurrencyTotalSchema),
  items: z.array(OpportunitySummarySchema),
  hasMore: z.boolean(),
});
export type OpportunityBoardColumn = z.infer<typeof OpportunityBoardColumnSchema>;

export const OpportunityBoardSchema = z.object({
  columns: z.array(OpportunityBoardColumnSchema),
});
export type OpportunityBoard = z.infer<typeof OpportunityBoardSchema>;

export const OpportunityBoardResponseSchema = dataEnvelope(OpportunityBoardSchema);

// ---------------------------------------------------------------------------
// §10a Lookups — what the CRM screens' pickers choose from
// ---------------------------------------------------------------------------
//
// The Organization, Sales Channel, assignee and contact-person pickers of the
// CRM screens read from CRM's own endpoints, gated by CRM's own codes, and not
// from the admin lists of the modules that own those rows: a Sales Rep holding
// `crm:read` / `crm:write` holds neither `customers:read`, `sales_channels:read`
// nor `admin_users:manage`, and must not need them to fill in a form
// (`specs/143-crm-sales-opportunities/research.md` N-D4). Each answer is the
// minimum a picker shows — an id and a label.

const lookupLimitSchema = z.coerce.number().int().positive().max(50).default(20);
const lookupSearchSchema = z.string().trim().max(200).optional();

/** `id` asks for one Organization by id (the label of a preselection); `q` searches by name. */
export const OpportunityOrganizationLookupQuerySchema = z.object({
  q: lookupSearchSchema,
  id: z.string().uuid().optional(),
  limit: lookupLimitSchema,
});
export type OpportunityOrganizationLookupQuery = z.infer<
  typeof OpportunityOrganizationLookupQuerySchema
>;

export const OpportunityOrganizationOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type OpportunityOrganizationOption = z.infer<typeof OpportunityOrganizationOptionSchema>;
export const OpportunityOrganizationLookupResponseSchema = dataEnvelope(
  z.array(OpportunityOrganizationOptionSchema),
);

/** `name` is per language, as the channel stores it; the screen resolves it. */
export const OpportunitySalesChannelOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.record(z.string(), z.string()),
  active: z.boolean(),
  systemDefault: z.boolean(),
  /** The currencies the channel sells in — what an Opportunity's currency is chosen from. */
  defaultCurrency: z.string(),
  currencies: z.array(z.string()),
});
export type OpportunitySalesChannelOption = z.infer<typeof OpportunitySalesChannelOptionSchema>;
export const OpportunitySalesChannelLookupResponseSchema = dataEnvelope(
  z.array(OpportunitySalesChannelOptionSchema),
);

export const OpportunityAssigneeLookupQuerySchema = z.object({
  q: lookupSearchSchema,
  limit: lookupLimitSchema,
});
export type OpportunityAssigneeLookupQuery = z.infer<typeof OpportunityAssigneeLookupQuerySchema>;

/** An administrator who may be assigned — active ones only, by name. */
export const OpportunityAssigneeOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type OpportunityAssigneeOption = z.infer<typeof OpportunityAssigneeOptionSchema>;
export const OpportunityAssigneeLookupResponseSchema = dataEnvelope(
  z.array(OpportunityAssigneeOptionSchema),
);

export const OpportunityContactLookupQuerySchema = z.object({
  organizationId: z.string().uuid(),
  q: lookupSearchSchema,
  limit: lookupLimitSchema,
});
export type OpportunityContactLookupQuery = z.infer<typeof OpportunityContactLookupQuerySchema>;

/** A member of the Organization who may be the Opportunity's contact person. */
export const OpportunityContactOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
});
export type OpportunityContactOption = z.infer<typeof OpportunityContactOptionSchema>;
export const OpportunityContactLookupResponseSchema = dataEnvelope(
  z.array(OpportunityContactOptionSchema),
);

// ---------------------------------------------------------------------------
// §11 History
// ---------------------------------------------------------------------------

export const OpportunityHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type OpportunityHistoryQuery = z.infer<typeof OpportunityHistoryQuerySchema>;

export const OpportunityHistoryEntrySchema = z.object({
  id: z.string(),
  actedAt: isoTimestampSchema,
  action: z.string(),
  actor: z.object({
    kind: z.string(),
    id: z.string().nullable(),
    name: z.string().nullable(),
  }),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type OpportunityHistoryEntry = z.infer<typeof OpportunityHistoryEntrySchema>;

export const OpportunityHistoryResponseSchema = collectionEnvelope(OpportunityHistoryEntrySchema);

// ---------------------------------------------------------------------------
// §12 Analytics
// ---------------------------------------------------------------------------

const analyticsRangeShape = {
  from: calendarDateSchema,
  to: calendarDateSchema,
  salesChannelId: z.string().uuid().optional(),
  assignedAdminUserId: z.string().uuid().optional(),
};

export const OpportunityAnalyticsQuerySchema = z.object(analyticsRangeShape);
export type OpportunityAnalyticsQuery = z.infer<typeof OpportunityAnalyticsQuerySchema>;

export const OpportunityTimeInStatusQuerySchema = z.object({
  ...analyticsRangeShape,
  statusCode: repeatable(opportunityStatusCodeSchema),
});
export type OpportunityTimeInStatusQuery = z.infer<typeof OpportunityTimeInStatusQuerySchema>;

export const TopOpportunitiesQuerySchema = z.object({
  ...analyticsRangeShape,
  limit: z.coerce.number().int().positive().max(100).default(10),
  basis: z.enum(['created', 'closed']).default('created'),
});
export type TopOpportunitiesQuery = z.infer<typeof TopOpportunitiesQuerySchema>;

export const OpportunityHandlingTimeSchema = z.object({
  averageSeconds: z.number().nullable(),
  closedCount: z.number().int().nonnegative(),
  byOutcome: z.object({
    won: z.object({ averageSeconds: z.number().nullable(), closedCount: z.number().int() }),
    lost: z.object({ averageSeconds: z.number().nullable(), closedCount: z.number().int() }),
  }),
});
export type OpportunityHandlingTime = z.infer<typeof OpportunityHandlingTimeSchema>;

export const OpportunityTimeInStatusRowSchema = z.object({
  statusCode: z.string(),
  averageSeconds: z.number().nullable(),
  sampleCount: z.number().int().nonnegative(),
});
export type OpportunityTimeInStatusRow = z.infer<typeof OpportunityTimeInStatusRowSchema>;

export const OpportunityRepEffectivenessRowSchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  adminUser: z.object({ id: z.string().uuid(), name: z.string() }),
  wonCount: z.number().int().nonnegative(),
  wonValue: z.array(OpportunityCurrencyTotalSchema),
});
export type OpportunityRepEffectivenessRow = z.infer<typeof OpportunityRepEffectivenessRowSchema>;

export const OpportunityAverageValueRowSchema = z.object({
  currency: z.string(),
  average: z.string(),
  count: z.number().int().nonnegative(),
});
export type OpportunityAverageValueRow = z.infer<typeof OpportunityAverageValueRowSchema>;

export const OpportunityHandlingTimeResponseSchema = dataEnvelope(OpportunityHandlingTimeSchema);
export const OpportunityTimeInStatusResponseSchema = dataEnvelope(
  z.array(OpportunityTimeInStatusRowSchema),
);
export const OpportunityRepEffectivenessResponseSchema = dataEnvelope(
  z.array(OpportunityRepEffectivenessRowSchema),
);
export const TopOpportunitiesResponseSchema = dataEnvelope(z.array(OpportunitySummarySchema));
export const OpportunityAverageValueResponseSchema = dataEnvelope(
  z.array(OpportunityAverageValueRowSchema),
);

// ---------------------------------------------------------------------------
// Events (`contracts/events-and-ports.md` §1)
// ---------------------------------------------------------------------------

/**
 * The `eventId` / `occurredAt` envelope every in-process event carries. Spelled
 * structurally because this package may not import the platform's `EventBase`;
 * the two are the same shape.
 */
interface CrmEventEnvelope {
  eventId: string;
  occurredAt: string;
}

export type OpportunityStatusEventKind = 'fromToBefore' | 'fromBefore' | 'fromToAfter' | 'toAfter';

/**
 * The concrete name of one of the four templated status events. Statuses are
 * configured at runtime, so the names are not known at compile time — this is
 * the one place the scheme is written, for the emitter and every subscriber.
 */
export function opportunityStatusEventName(
  kind: OpportunityStatusEventKind,
  p: { from?: string; to?: string },
): string {
  switch (kind) {
    case 'fromToBefore':
      return `crm.opportunity.status.from_${p.from}_to_${p.to}.before`;
    case 'fromBefore':
      return `crm.opportunity.status.from_${p.from}.before`;
    case 'fromToAfter':
      return `crm.opportunity.status.from_${p.from}_to_${p.to}.after`;
    case 'toAfter':
      return `crm.opportunity.status.to_${p.to}.after`;
  }
}

/** The fixed event names CRM emits. */
export const CRM_EVENTS = {
  STATUS_CHANGED: 'crm.opportunity.status_changed.v1',
  CREATED: 'crm.opportunity.created.v1',
  CLOSED: 'crm.opportunity.closed.v1',
  ASSIGNED: 'crm.opportunity.assigned.v1',
  DOCUMENT_LINKED: 'crm.opportunity.document_linked.v1',
} as const;

export interface OpportunityStatusActor {
  kind: 'admin' | 'system';
  adminUserId?: string;
}

export type OpportunityTransitionCause = 'manual' | 'order_status' | 'system';

/** Payload of the four templated status events, and what a guard is handed. */
export interface OpportunityStatusEvent extends CrmEventEnvelope {
  opportunityId: string;
  organizationId: string;
  salesChannelId: string | null;
  from: string;
  to: string;
  fromKind: OpportunityStatusKind;
  toKind: OpportunityStatusKind;
  actor: OpportunityStatusActor;
  cause: OpportunityTransitionCause;
  causeOrderId?: string;
  reason: string | null;
}

/** Payload of `crm.opportunity.status_changed.v1`. */
export interface OpportunityStatusChangedEvent extends OpportunityStatusEvent {
  number: string;
}

/** Payload of `crm.opportunity.created.v1`. */
export interface OpportunityCreatedEvent extends CrmEventEnvelope {
  opportunityId: string;
  organizationId: string;
  number: string;
  source: OpportunitySource;
}

/** Payload of `crm.opportunity.closed.v1`. */
export interface OpportunityClosedEvent extends CrmEventEnvelope {
  opportunityId: string;
  organizationId: string;
  outcome: OpportunityClosedKind;
  value: string | null;
  currency: string;
}

/** Payload of `crm.opportunity.assigned.v1`. */
export interface OpportunityAssignedEvent extends CrmEventEnvelope {
  opportunityId: string;
  organizationId: string;
  assignedAdminUserId: string | null;
  previousAdminUserId: string | null;
}

/** Payload of `crm.opportunity.document_linked.v1`. */
export interface OpportunityDocumentLinkedEvent extends CrmEventEnvelope {
  opportunityId: string;
  organizationId: string;
  documentKind: OpportunityDocumentKind;
  documentId: string;
  linkSource: OpportunityLinkSource;
}

// ---------------------------------------------------------------------------
// The guard registry (`contracts/events-and-ports.md` §3)
// ---------------------------------------------------------------------------

/** Thrown by a guard to refuse a transition; the message is what the Sales Rep reads. */
export class OpportunityTransitionVetoError extends Error {
  constructor(
    message: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(message);
    this.name = 'OpportunityTransitionVetoError';
  }
}

export interface OpportunityTransitionGuard {
  /** The contributing module — required; an absent owner's guard is skipped. */
  readonly ownerModuleId: string;
  /** Omit a field to match any status. `{}` matches every transition. */
  readonly match: { readonly from?: string; readonly to?: string };
  /** Throw `OpportunityTransitionVetoError` to refuse. Anything else thrown is a 500. */
  guard(event: OpportunityStatusEvent): void | Promise<void>;
}

/**
 * Container name: `opportunityTransitionGuardRegistry`. Owner: `crm`.
 *
 * The registry a module pushes an {@link OpportunityTransitionGuard} into.
 *
 * A **contribution seam**: registered ungated (a plain `ctx.di.register`),
 * pushed into from a contribution-only boot hook, declared by the contributor
 * as a `contributes-to` edge. A boot hook that resolved a gated port would stop
 * the backend from starting whenever CRM was switched off.
 *
 * **Owner off:** no transition can happen, so no guard runs.
 *
 * **Enumeration policy: skipped while the contributing module is absent.** CRM
 * skips a guard whose `ownerModuleId` is not effectively present at dispatch —
 * a switched-off module does not veto.
 */
export interface OpportunityTransitionGuardRegistryPort {
  register(guard: OpportunityTransitionGuard): void;
  /** Contributing modules, in registration order — for diagnostics and composition tests. */
  owners(): readonly string[];
}

// ---------------------------------------------------------------------------
// Published ports (`contracts/events-and-ports.md` §4)
// ---------------------------------------------------------------------------

/** An Opportunity as it crosses a module boundary — a plain shape, never the entity. */
export interface OpportunityRecord {
  id: string;
  number: string;
  title: string;
  organizationId: string;
  customerAccountId: string | null;
  salesChannelId: string | null;
  statusCode: string;
  statusKind: OpportunityStatusKind;
  assignedAdminUserId: string | null;
  value: string | null;
  valueMode: OpportunityValueMode;
  currency: string;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `opportunityReadPort`. Owner: `crm`.
 *
 * Reading Opportunities from another module.
 *
 * Reads run under the **caller's** ambient tenant context.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`.
 */
export interface OpportunityReadPort {
  findById(id: string): Promise<OpportunityRecord | null>;
  findByDocument(kind: OpportunityDocumentKind, documentId: string): Promise<OpportunityRecord | null>;
  listOpenForOrganization(organizationId: string): Promise<OpportunityRecord[]>;
}

/** Why a requested transition did not happen. */
export const OPPORTUNITY_TRANSITION_REFUSALS = [
  'not_found',
  'unknown_status',
  'not_permitted',
  'vetoed',
] as const;
export type OpportunityTransitionRefusal = (typeof OPPORTUNITY_TRANSITION_REFUSALS)[number];

/**
 * What became of a requested transition — deliberately the shape of
 * `OrderTransitionOutcome`. `already_there` is not a refusal: the Opportunity
 * is where the caller wanted it and nothing was recorded.
 */
export type OpportunityTransitionOutcome =
  | { applied: true; from: string; to: string }
  | { applied: false; reason: 'already_there'; from: string }
  | { applied: false; reason: OpportunityTransitionRefusal; from: string | null; detail: string };

/**
 * Container name: `opportunityTransitionPort`. Owner: `crm`.
 *
 * Moving an Opportunity from another module.
 *
 * **Call this after your own commit, never inside your transaction** — the
 * implementation obtains its own EntityManager. A refusal is a value, not an
 * exception.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`. A consumer
 * must not wrap the call in a bare `catch`.
 */
export interface OpportunityTransitionPort {
  applyStatus(input: {
    opportunityId: string;
    to: string;
    actor: OpportunityStatusActor;
    reason?: string | null;
  }): Promise<OpportunityTransitionOutcome>;
}
