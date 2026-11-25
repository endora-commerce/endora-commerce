// The Organization merge (`specs/192-organization-merge/`,
// `contracts/organization-merge.md`, `contracts/events-and-webhooks.md`).
//
// `organizations` is the host of the `organization` record type in the
// platform's merge mechanism (`./record-merge.ts`). These are the shapes its
// admin routes, its read port and its event carry.

import { z } from 'zod';
import { uuidSchema } from './common.js';
import {
  RECORD_MERGE_CHOICES,
  RECORD_MERGE_STATES,
  recordMergePreviewSchema,
  recordMergeRecordSchema,
  type RecordMergeChoice,
  type RecordMergePreview,
  type RecordMergeRecord,
} from './record-merge.js';

/** The host's own refusal codes (data-model §6). */
export const ORGANIZATION_MERGE_ERROR_CODES = {
  /** 409 — either Organization is personal (D-299, OQ-1). */
  PERSONAL: 'ORGANIZATION_MERGE_PERSONAL',
  /** 409 — token `ancestor` | `different_trees` (D-299, OQ-3). */
  TREE_INVALID: 'ORGANIZATION_MERGE_TREE_INVALID',
  /** 409 — a write names an archived (merged) Organization; `details.survivorId` (OQ-6). */
  MERGED: 'ORGANIZATION_MERGED',
} as const;

/** The tokens `ORGANIZATION_MERGE_TREE_INVALID` is raised with. */
export const ORGANIZATION_MERGE_TREE_TOKENS = ['ancestor', 'different_trees'] as const;
export type OrganizationMergeTreeToken = (typeof ORGANIZATION_MERGE_TREE_TOKENS)[number];

/**
 * The Organization fields the operator may take from the loser (FR-030).
 * `fulfilmentStrategy` carries the strategy and its warehouse order together.
 * `orderConfirmationEmails` is always the union of both and is not offered;
 * status, moderation stamps and the tree position are never offered (FR-032).
 */
export const ORGANIZATION_MERGE_FIELD_CODES = [
  'name',
  'legalName',
  'taxId',
  'vatStatus',
  'registeredAddress',
  'customerGroupId',
  'creditInheritanceMode',
  'fulfilmentStrategy',
] as const;
export type OrganizationMergeFieldCode = (typeof ORGANIZATION_MERGE_FIELD_CODES)[number];

const choiceSchema = z.enum(RECORD_MERGE_CHOICES);

/** `POST /api/v1/admin/organizations/:id/merge-preview`. `:id` is the survivor. */
export const organizationMergePreviewBodySchema = z.object({ loserId: uuidSchema }).strict();
export type OrganizationMergePreviewBody = z.infer<typeof organizationMergePreviewBodySchema>;

/**
 * `POST /api/v1/admin/organizations/:id/merges`. The acknowledgement is read
 * by the route rather than by the schema, so that leaving it out answers the
 * merge's own `422 RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED` rather than a
 * generic validation failure (FR-012).
 */
export const organizationMergeStartBodySchema = z
  .object({
    loserId: uuidSchema,
    fieldChoices: z.partialRecord(z.enum(ORGANIZATION_MERGE_FIELD_CODES), choiceSchema).optional(),
    customFieldChoices: z.record(z.string().min(1).max(128), choiceSchema).optional(),
    acknowledgeIrreversible: z.boolean().optional(),
  })
  .strict();
export type OrganizationMergeStartBody = z.infer<typeof organizationMergeStartBodySchema>;

/** What server code hands the start (`organizationCommandPort.startMerge`, after #1821). */
export interface OrganizationMergeStartInput {
  readonly loserId: string;
  readonly fieldChoices?: Partial<Record<OrganizationMergeFieldCode, RecordMergeChoice>>;
  readonly customFieldChoices?: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible: true;
}

/** `POST /api/v1/admin/organization-merges/:mergeId/{resume,cancel}`. */
export const organizationMergeVersionBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export type OrganizationMergeVersionBody = z.infer<typeof organizationMergeVersionBodySchema>;

/** `GET /api/v1/admin/organization-merges` — reach-filtered. */
export const organizationMergeListQuerySchema = z
  .object({
    state: z.enum(RECORD_MERGE_STATES).optional(),
    organizationId: uuidSchema.optional(),
  })
  .strict();
export type OrganizationMergeListQuery = z.infer<typeof organizationMergeListQuerySchema>;

export const organizationMergePreviewResponseSchema = z.object({ data: recordMergePreviewSchema });
export type OrganizationMergePreviewResponse = z.infer<typeof organizationMergePreviewResponseSchema>;

export const organizationMergeRecordResponseSchema = z.object({ data: recordMergeRecordSchema });
export type OrganizationMergeRecordResponse = z.infer<typeof organizationMergeRecordResponseSchema>;

export const organizationMergeListResponseSchema = z.object({ data: z.array(recordMergeRecordSchema) });
export type OrganizationMergeListResponse = z.infer<typeof organizationMergeListResponseSchema>;

export type OrganizationMergePreview = RecordMergePreview;
export type OrganizationMergeRecord = RecordMergeRecord;

/**
 * What `organizations` writes into the merge's `host_context` during the
 * `structure` phase, for the participants after it: the loser's role id → the
 * survivor's role id (predefined roles to predefined roles, custom roles by
 * name, a missing custom role copied into the survivor; FR-041).
 */
export interface OrganizationMergeHostContext {
  readonly roleMap: Readonly<Record<string, string>>;
}

/** Read an Organization merge's host context; an absent or malformed map reads as empty. */
export function organizationMergeRoleMap(hostContext: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  const roleMap = hostContext['roleMap'];
  if (roleMap === null || typeof roleMap !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(roleMap as Record<string, unknown>)) {
    if (typeof to === 'string') out[from] = to;
  }
  return out;
}

/** The merged event (`contracts/events-and-webhooks.md` §1). */
export const ORGANIZATION_MERGE_EVENTS = {
  MERGED: 'organization.merged.v1',
} as const;

/**
 * `organization.merged.v1` — exactly once per completed merge, dispatched by
 * the finalize Command on commit. Ids only: no names, tax IDs or values.
 * `organizationId` is the survivor, which is the tenant key the webhook bridge
 * reads, so an Organization-bound subscription receives it when bound to the
 * survivor.
 */
export interface OrganizationMergedEventV1 {
  readonly eventId: string;
  /** ISO-8601. */
  readonly occurredAt: string;
  /** The survivor. */
  readonly organizationId: string;
  /** The archived loser. */
  readonly mergedOrganizationId: string;
  readonly mergeId: string;
  /** ISO-8601 — when the finalize committed. */
  readonly mergedAt: string;
  /** D-293.6 source of the start, if any. */
  readonly source: string | null;
}

/**
 * The Organization event types offered for outbound webhook delivery — the
 * first Organization webhook type. `organizations` pushes them into the
 * `webhooks` registry from a contribution-only boot hook.
 */
export const ORGANIZATION_WEBHOOK_EVENT_TYPES = [ORGANIZATION_MERGE_EVENTS.MERGED] as const;
