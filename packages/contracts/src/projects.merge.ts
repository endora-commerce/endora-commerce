// The Project merge (`specs/192-organization-merge/` US6,
// `contracts/project-merge.md`, `contracts/events-and-webhooks.md`).
//
// `projects` is the host of the `project` record type in the platform's merge
// mechanism (`./record-merge.ts`). These are the shapes its admin routes, its
// read port and its event carry — the Organization host's (`./organizations.merge.ts`)
// with Project values.

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

/** The host's own refusal code (data-model §6). */
export const PROJECT_MERGE_ERROR_CODES = {
  /** 409 — a write names an archived (merged) Project; `details.survivorId` (OQ-6). */
  MERGED: 'PROJECT_MERGED',
} as const;

/**
 * The Project values the operator may take from the loser (FR-090,
 * `contracts/project-merge.md` §2). `value` carries the amount and its
 * currency together. The survivor's state, current Stage, Stages and Template
 * are never offered: a merge does not merge two workflows.
 */
export const PROJECT_MERGE_FIELD_CODES = ['title', 'description', 'value', 'startOn', 'visibility'] as const;
export type ProjectMergeFieldCode = (typeof PROJECT_MERGE_FIELD_CODES)[number];

const choiceSchema = z.enum(RECORD_MERGE_CHOICES);

/** `POST /api/v1/admin/projects/:id/merge-preview`. `:id` is the survivor. */
export const projectMergePreviewBodySchema = z.object({ loserId: uuidSchema }).strict();
export type ProjectMergePreviewBody = z.infer<typeof projectMergePreviewBodySchema>;

/**
 * `POST /api/v1/admin/projects/:id/merges`. The acknowledgement is read by the
 * route rather than by the schema, so that leaving it out answers the merge's
 * own `422 RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED` (FR-012).
 */
export const projectMergeStartBodySchema = z
  .object({
    loserId: uuidSchema,
    fieldChoices: z.partialRecord(z.enum(PROJECT_MERGE_FIELD_CODES), choiceSchema).optional(),
    customFieldChoices: z.record(z.string().min(1).max(128), choiceSchema).optional(),
    acknowledgeIrreversible: z.boolean().optional(),
  })
  .strict();
export type ProjectMergeStartBody = z.infer<typeof projectMergeStartBodySchema>;

/**
 * What server code hands the start (`projectCommandPort.startMerge`, once
 * that port exists — #1828).
 */
export interface ProjectMergeStartInput {
  readonly loserId: string;
  readonly fieldChoices?: Partial<Record<ProjectMergeFieldCode, RecordMergeChoice>>;
  readonly customFieldChoices?: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible: true;
}

/** `POST /api/v1/admin/project-merges/:mergeId/{resume,cancel}`. */
export const projectMergeVersionBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export type ProjectMergeVersionBody = z.infer<typeof projectMergeVersionBodySchema>;

/** `GET /api/v1/admin/project-merges` — only merges both of whose Projects the caller sees. */
export const projectMergeListQuerySchema = z
  .object({
    state: z.enum(RECORD_MERGE_STATES).optional(),
    projectId: uuidSchema.optional(),
  })
  .strict();
export type ProjectMergeListQuery = z.infer<typeof projectMergeListQuerySchema>;

export const projectMergePreviewResponseSchema = z.object({ data: recordMergePreviewSchema });
export type ProjectMergePreviewResponse = z.infer<typeof projectMergePreviewResponseSchema>;

/**
 * A merge as the admin routes answer it: the record, with each Project's
 * label (`<number> <title>`) and the starting administrator's name beside
 * their ids. A label that cannot be read for the caller is `null` and the
 * screen shows the id.
 */
export const projectMergeViewSchema = recordMergeRecordSchema.extend({
  survivorName: z.string().nullable(),
  loserName: z.string().nullable(),
  actorName: z.string().nullable(),
});
export type ProjectMergeView = z.infer<typeof projectMergeViewSchema>;

export const projectMergeRecordResponseSchema = z.object({ data: projectMergeViewSchema });
export type ProjectMergeRecordResponse = z.infer<typeof projectMergeRecordResponseSchema>;

export const projectMergeListResponseSchema = z.object({ data: z.array(projectMergeViewSchema) });
export type ProjectMergeListResponse = z.infer<typeof projectMergeListResponseSchema>;

/**
 * What `projects` writes into a Project merge's `host_context` during the
 * `structure` phase, for `tasks` after it (FR-092): the loser's Stage id → the
 * survivor's Stage a Task tied to it moves to — the survivor's Stage of the
 * same name, otherwise its current Stage — and `fallbackStageId`, the
 * survivor's current Stage, for a Task the map does not name.
 */
export interface ProjectMergeHostContext {
  readonly stageMap: Readonly<Record<string, string>>;
  readonly fallbackStageId: string | null;
}

/** Read a Project merge's host context; an absent or malformed one reads as no map and no fallback. */
export function projectMergeStageMap(hostContext: Readonly<Record<string, unknown>>): ProjectMergeHostContext {
  const raw = hostContext['stageMap'];
  const stageMap: Record<string, string> = {};
  if (raw !== null && typeof raw === 'object') {
    for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof to === 'string') stageMap[from] = to;
    }
  }
  const fallback = hostContext['fallbackStageId'];
  return { stageMap, fallbackStageId: typeof fallback === 'string' ? fallback : null };
}

export type ProjectMergePreview = RecordMergePreview;
export type ProjectMergeRecord = RecordMergeRecord;

/** The merged event (`contracts/events-and-webhooks.md` §1). */
export const PROJECT_MERGE_EVENTS = {
  MERGED: 'project.merged.v1',
} as const;

/**
 * `project.merged.v1` — exactly once per completed merge, dispatched by the
 * finalize Command on commit. Ids only.
 */
export interface ProjectMergedEventV1 {
  readonly eventId: string;
  /** ISO-8601. */
  readonly occurredAt: string;
  /** The survivor. */
  readonly projectId: string;
  /** The archived loser. */
  readonly mergedProjectId: string;
  readonly mergeId: string;
  /** ISO-8601 — when the finalize committed. */
  readonly mergedAt: string;
  /** D-293.6 source of the start, if any. */
  readonly source: string | null;
  /** The survivor's Organizations after the merge, sorted (`contracts/events-and-webhooks.md` §1). */
  readonly organizationIds: readonly string[];
}

/**
 * The Project event types offered for outbound webhook delivery — the first
 * Project webhook type. `projects` pushes them into the `webhooks` registry
 * from a contribution-only boot hook.
 */
export const PROJECT_WEBHOOK_EVENT_TYPES = [PROJECT_MERGE_EVENTS.MERGED] as const;
