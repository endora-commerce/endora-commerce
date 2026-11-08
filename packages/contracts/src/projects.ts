import { z } from 'zod';
import { calendarDateSchema } from './common.js';
import { dataEnvelope } from './envelopes.js';
import { customFieldFiltersQueryParamSchema, customFieldValuesSchema } from './custom-fields.js';
import { twoDecimalAmountString } from './money-input.js';
import { RecordReferenceSchema } from './record-references.js';
import { TaskSummarySchema } from './tasks.js';

/**
 * Projects (`specs/163-projects-and-tasks/`).
 *
 * Every request, response, port, registry and event shape of the `projects`
 * module, written before the first route (Constitution II) and for **every**
 * story of the feature — later phases add no contract here. The normative prose
 * is `specs/163-projects-and-tasks/contracts/admin-api.md` §2 and
 * `contracts/ports-and-events.md` §2; the schema is `data-model.md` §2.
 *
 * A Project that is out of the caller's Organization reach, or invisible to
 * them, answers 404 `PROJECT_NOT_FOUND` — identical to one that does not exist
 * (FR-004, FR-020, Constitution XI).
 *
 * Base path of the HTTP API: `/api/v1/admin/projects`. There is no storefront
 * or customer route (FR-043).
 */

// ---------------------------------------------------------------------------
// Vocabulary and limits
// ---------------------------------------------------------------------------

/** A Project's outcome. `open` while it runs; a closed Project can be reopened. */
export const PROJECT_STATES = ['open', 'completed', 'lost'] as const;
export const projectStateSchema = z.enum(PROJECT_STATES);
export type ProjectState = z.infer<typeof projectStateSchema>;

/** How a closed Project ended — the `close` body's discriminant. */
export const projectOutcomeSchema = z.enum(['completed', 'lost']);
export type ProjectOutcome = z.infer<typeof projectOutcomeSchema>;

/**
 * A Project's own visibility (owner ruling Q2 = A, FR-019): follow the module
 * setting, everyone who may read Projects, or its Members and the people listed
 * on it.
 */
export const projectVisibilitySchema = z.enum(['inherit', 'everyone', 'members_and_listed']);
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

/** The module setting `projects.visibility` (FR-018); default `members`. */
export const projectVisibilitySettingSchema = z.enum(['everyone', 'members']);
export type ProjectVisibilitySetting = z.infer<typeof projectVisibilitySettingSchema>;

/** What a Project links to (R-10). */
export const projectRecordKindSchema = z.enum(['order', 'quote_request', 'opportunity']);
export type ProjectRecordKind = z.infer<typeof projectRecordKindSchema>;

/** The records whose screen shows "which Project is this in" — the link kinds and a Task (R-11). */
export const projectPanelRecordKindSchema = z.enum(['order', 'quote_request', 'opportunity', 'task']);
export type ProjectPanelRecordKind = z.infer<typeof projectPanelRecordKindSchema>;

export const projectCommentKindSchema = z.enum(['note', 'message']);
export type ProjectCommentKind = z.infer<typeof projectCommentKindSchema>;

/** What a Stage-history row records (`project_stage_entries.kind`). */
export const projectStageEntryKindSchema = z.enum(['enter', 'close_completed', 'close_lost', 'reopen']);
export type ProjectStageEntryKind = z.infer<typeof projectStageEntryKindSchema>;

/** What a move recorded beside itself (R-8). */
export const projectStageEntryNoteSchema = z.enum([
  'gate_not_applied_tasks_off',
  'stage_tasks_skipped',
  'tasks_materialize_failed',
]);
export type ProjectStageEntryNote = z.infer<typeof projectStageEntryNoteSchema>;

export const PROJECT_TITLE_MAX = 200;
export const PROJECT_DESCRIPTION_MAX = 20_000;
export const PROJECT_STAGE_NAME_MAX = 80;
export const PROJECT_STAGE_DURATION_MAX_DAYS = 3650;
export const PROJECT_ALERT_OFFSET_MIN_DAYS = 1;
export const PROJECT_ALERT_OFFSET_MAX_DAYS = 365;
export const PROJECT_LOSS_COMMENT_MAX = 2000;
export const PROJECT_COMMENT_BODY_MAX = 20_000;
export const PROJECT_TEMPLATE_NAME_MAX = 120;
export const PROJECT_DICTIONARY_NAME_MAX = 120;
/** The most Stage Task definitions one Stage holds (R-22). */
export const PROJECT_STAGE_TASKS_MAX = 100;
export const PROJECT_STAGES_MAX = 50;
export const PROJECT_LIST_LIMIT_MAX = 100;
/**
 * The largest file `POST /projects/:id/attachments/upload` reads, in bytes
 * (25 MB) — CRM's bound, for CRM's reason: the route holds the whole file in
 * memory before the asset library decides anything about it.
 */
export const PROJECT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const uuid = z.string().uuid();
const isoTimestampSchema = z.string();

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a #rrggbb hex value');

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 code, e.g. PLN');

/**
 * A non-negative amount as a decimal string — `numeric(18,2)`; more than two
 * decimal places is refused with the platform's precision code, never rounded
 * (`money-input.ts`, issue #417).
 */
const amountSchema = twoDecimalAmountString(z.string().trim(), {
  pattern: /^\d{1,16}(\.\d+)?$/,
  message: 'Amount must be a non-negative decimal with at most two places',
});

const titleSchema = z.string().trim().min(1).max(PROJECT_TITLE_MAX);
const descriptionSchema = z.string().max(PROJECT_DESCRIPTION_MAX);

/** A list of ids in which each appears once. */
function distinctIds(max: number) {
  return z
    .array(uuid)
    .max(max)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Each id may appear once',
    });
}

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

/** A name per admin language (`{ en, pl }`), resolved with `pickLocalized`. */
const localizedNameSchema = z.record(
  z.string().min(2).max(16),
  z.string().trim().min(1).max(PROJECT_DICTIONARY_NAME_MAX),
);

// ---------------------------------------------------------------------------
// Field shapes shared by Projects and Templates
// ---------------------------------------------------------------------------

/** A value is an amount **and** its currency, or nothing (`data-model.md` §2.2). */
export const ProjectValueSchema = z
  .object({
    amount: amountSchema,
    currency: currencyCodeSchema,
  })
  .strict();
export type ProjectValue = z.infer<typeof ProjectValueSchema>;

/** Deadline alerts: whole days before the deadline, 1–365, each once (FR-010). */
export const alertOffsetsDaysSchema = z
  .array(z.number().int().min(PROJECT_ALERT_OFFSET_MIN_DAYS).max(PROJECT_ALERT_OFFSET_MAX_DAYS))
  .max(20)
  .refine((offsets) => new Set(offsets).size === offsets.length, {
    message: 'Each alert offset may appear once',
  });

const plannedDurationDaysSchema = z.number().int().min(0).max(PROJECT_STAGE_DURATION_MAX_DAYS);

/** One Member and the Project Roles they hold (≥ 0 — a Member without a Role is allowed). */
export const ProjectMemberInputSchema = z
  .object({
    adminUserId: uuid,
    roleIds: distinctIds(50),
  })
  .strict();
export type ProjectMemberInput = z.infer<typeof ProjectMemberInputSchema>;

const membersSchema = z
  .array(ProjectMemberInputSchema)
  .max(200)
  .refine((members) => new Set(members.map((m) => m.adminUserId.toLowerCase())).size === members.length, {
    message: 'Each person may be a Member once',
  });

/**
 * A Stage Task definition — copied from a Template or written on the Project;
 * it becomes a Task when the Project enters its Stage (R-7, R-8).
 */
export const StageTaskDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(PROJECT_DESCRIPTION_MAX).optional(),
    responsibleRoleId: uuid.nullable().optional(),
    /** Due date = the Stage's start + this many days. */
    dueOffsetDays: z.number().int().min(0).max(PROJECT_STAGE_DURATION_MAX_DAYS),
  })
  .strict();
export type StageTaskDefinition = z.infer<typeof StageTaskDefinitionSchema>;

const stageTasksSchema = z.array(StageTaskDefinitionSchema).max(PROJECT_STAGE_TASKS_MAX);

/** The attributes of FR-010 a Stage has in a Project and in a Template alike. */
const stageAttributesShape = {
  name: z.string().trim().min(1).max(PROJECT_STAGE_NAME_MAX),
  color: colorSchema,
  plannedDurationDays: plannedDurationDaysSchema.optional(),
  responsibleRoleIds: distinctIds(50).optional(),
  alertOffsetsDays: alertOffsetsDaysSchema.optional(),
  completionGate: z.boolean().optional(),
  completionPermitted: z.boolean().optional(),
};

// ---------------------------------------------------------------------------
// §2.1 Projects — requests
// ---------------------------------------------------------------------------

/** `memberId`: an admin user's id or `me`. */
const memberFilterSchema = z.union([z.literal('me'), uuid]);

export const ProjectListQuerySchema = z.object({
  state: repeatable(projectStateSchema),
  organizationId: uuid.optional(),
  memberId: memberFilterSchema.optional(),
  roleId: uuid.optional(),
  templateId: uuid.optional(),
  /** The current Stage's name, case-insensitive. */
  stageName: z.string().trim().min(1).max(PROJECT_STAGE_NAME_MAX).optional(),
  /** Number or title. */
  q: z.string().trim().max(200).optional(),
  /**
   * Custom fields marked as list filters (User Story 9), as JSON — the shape
   * the Orders, Quote Requests and Opportunities lists take. A field the list
   * does not offer answers 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it.
   */
  customFieldFilters: customFieldFiltersQueryParamSchema,
  sort: z.enum(['createdAt', 'value', 'deadline']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(PROJECT_LIST_LIMIT_MAX).default(50),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

/** A Stage written with the Project that holds it (`POST /projects`, `stages`). */
export const ProjectStageInputSchema = z.object(stageAttributesShape).strict();
export type ProjectStageInput = z.infer<typeof ProjectStageInputSchema>;

/**
 * `POST /projects`. `organizationIds` may be empty — an internal Project,
 * visible only to administrators unrestricted in Organization reach (FR-004);
 * each Organization must be in the caller's reach (422
 * `PROJECT_ORGANIZATION_OUT_OF_SCOPE`). With a `templateId` the Template's
 * structure is copied (R-7) and the body's own fields win.
 *
 * `stages` are the Project's Stages in order — an open Project is always in
 * one, so without a Template at least one is required (422
 * `VALIDATION_FAILED`). The Project starts in the first; the default workflow
 * lets each move to the next (FR-011), and completing is permitted from the
 * last unless a Stage says otherwise (FR-010).
 */
export const CreateProjectBodySchema = z
  .object({
    title: titleSchema,
    stages: z.array(ProjectStageInputSchema).min(1).max(PROJECT_STAGES_MAX).optional(),
    description: descriptionSchema.optional(),
    value: ProjectValueSchema.nullable().optional(),
    startOn: calendarDateSchema.optional(),
    organizationIds: distinctIds(50),
    templateId: uuid.optional(),
    members: membersSchema.optional(),
    visibility: projectVisibilitySchema.optional(),
    viewerIds: distinctIds(200).optional(),
    customFieldValues: customFieldValuesSchema.optional(),
  })
  .strict();
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

/**
 * `PATCH /projects/:id`. Organizations and Members have routes of their own;
 * `version` is the optimistic-concurrency token (409 `PROJECT_CHANGED`).
 */
export const UpdateProjectBodySchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    value: ProjectValueSchema.nullable().optional(),
    startOn: calendarDateSchema.optional(),
    visibility: projectVisibilitySchema.optional(),
    viewerIds: distinctIds(200).optional(),
    customFieldValues: customFieldValuesSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict();
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;

/** `PUT /projects/:id/organizations` — the whole set (409 `PROJECT_ORGANIZATION_IN_USE`). */
export const SetProjectOrganizationsBodySchema = z
  .object({ organizationIds: distinctIds(50) })
  .strict();
export type SetProjectOrganizationsBody = z.infer<typeof SetProjectOrganizationsBodySchema>;

/**
 * The answer of `PUT /projects/:id/organizations` when the change the caller
 * just made took the Project out of their own Organization reach — a caller
 * confined to some Organizations who removed them all, making the Project
 * internal (T144 F3). The change committed; nothing else of the Project is
 * theirs to be shown.
 */
export const ProjectOutOfReachAfterWriteSchema = z.object({ id: uuid, outOfReach: z.literal(true) }).strict();
export type ProjectOutOfReachAfterWrite = z.infer<typeof ProjectOutOfReachAfterWriteSchema>;

/** `PUT /projects/:id/members` — the whole set, Members and their Roles, in one Command. */
export const SetProjectMembersBodySchema = z.object({ members: membersSchema }).strict();
export type SetProjectMembersBody = z.infer<typeof SetProjectMembersBodySchema>;

// ---------------------------------------------------------------------------
// §2.2 Stages and moves — requests
// ---------------------------------------------------------------------------

/** `POST /projects/:id/stages`. */
export const CreateProjectStageBodySchema = z.object(stageAttributesShape).strict();
export type CreateProjectStageBody = z.infer<typeof CreateProjectStageBodySchema>;

/**
 * `PATCH /projects/:id/stages/:stageId` — any attribute, at least one.
 * `deadlineOn` sets the deadline by hand; `null` drops the manual deadline and
 * recomputes it as start + planned duration (FR-013).
 */
export const UpdateProjectStageBodySchema = z
  .object({ ...stageAttributesShape, deadlineOn: calendarDateSchema.nullable() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateProjectStageBody = z.infer<typeof UpdateProjectStageBodySchema>;

/** `PUT /projects/:id/stages/order` — every Stage id of the Project, in the new order. */
export const ReorderProjectStagesBodySchema = z
  .object({ stageIds: distinctIds(PROJECT_STAGES_MAX).refine((ids) => ids.length > 0, 'At least one Stage') })
  .strict();
export type ReorderProjectStagesBody = z.infer<typeof ReorderProjectStagesBodySchema>;

export const ProjectStageMoveSchema = z
  .object({ fromStageId: uuid, toStageId: uuid })
  .strict()
  .refine((move) => move.fromStageId.toLowerCase() !== move.toStageId.toLowerCase(), {
    message: 'A move must connect two different Stages',
  });
export type ProjectStageMove = z.infer<typeof ProjectStageMoveSchema>;

/** `PUT /projects/:id/moves` — the whole set of permitted moves (FR-011). */
export const SetProjectMovesBodySchema = z
  .object({ moves: z.array(ProjectStageMoveSchema).max(PROJECT_STAGES_MAX * PROJECT_STAGES_MAX) })
  .strict();
export type SetProjectMovesBody = z.infer<typeof SetProjectMovesBodySchema>;

/** `PUT /projects/:id/stages/:stageId/tasks` — the Stage's Task definitions, replaced whole. */
export const SetProjectStageTasksBodySchema = z.object({ tasks: stageTasksSchema }).strict();
export type SetProjectStageTasksBody = z.infer<typeof SetProjectStageTasksBodySchema>;

/** `POST /projects/:id/move`. */
export const MoveProjectBodySchema = z
  .object({ toStageId: uuid, version: z.number().int().positive() })
  .strict();
export type MoveProjectBody = z.infer<typeof MoveProjectBodySchema>;

/**
 * `POST /projects/:id/close` — discriminated on `outcome`. Completing needs a
 * Stage that permits it and passes its gate; losing is allowed from any Stage,
 * needs a non-archived loss reason and is never gated (FR-005, FR-012).
 */
export const CloseProjectBodySchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('completed'), version: z.number().int().positive() }).strict(),
  z
    .object({
      outcome: z.literal('lost'),
      lossReasonId: uuid,
      comment: z.string().trim().max(PROJECT_LOSS_COMMENT_MAX).optional(),
      version: z.number().int().positive(),
    })
    .strict(),
]);
export type CloseProjectBody = z.infer<typeof CloseProjectBodySchema>;

/** `POST /projects/:id/reopen` — back into the Stage it was closed in (FR-006). */
export const ReopenProjectBodySchema = z.object({ version: z.number().int().positive() }).strict();
export type ReopenProjectBody = z.infer<typeof ReopenProjectBodySchema>;

// ---------------------------------------------------------------------------
// §2.3 Links and the record panel — requests
// ---------------------------------------------------------------------------

/** `POST /projects/:id/links`. */
export const CreateProjectLinkBodySchema = z
  .object({ kind: projectRecordKindSchema, recordId: uuid })
  .strict();
export type CreateProjectLinkBody = z.infer<typeof CreateProjectLinkBodySchema>;

/** `GET /projects/records/:kind/:recordId/project` — the path parameters. */
export const RecordProjectParamsSchema = z.object({
  kind: projectPanelRecordKindSchema,
  recordId: uuid,
});
export type RecordProjectParams = z.infer<typeof RecordProjectParamsSchema>;

// ---------------------------------------------------------------------------
// §2.4 Collaboration — requests
// ---------------------------------------------------------------------------

const commentBodySchema = z.string().min(1).max(PROJECT_COMMENT_BODY_MAX);

export const ProjectCommentListQuerySchema = z.object({ kind: projectCommentKindSchema });
export type ProjectCommentListQuery = z.infer<typeof ProjectCommentListQuerySchema>;

export const CreateProjectCommentBodySchema = z
  .object({ kind: projectCommentKindSchema, body: commentBodySchema })
  .strict();
export type CreateProjectCommentBody = z.infer<typeof CreateProjectCommentBodySchema>;

/** `PATCH /projects/:id/comments/:commentId` — a note, by its author; a message never changes. */
export const UpdateProjectCommentBodySchema = z.object({ body: commentBodySchema }).strict();
export type UpdateProjectCommentBody = z.infer<typeof UpdateProjectCommentBodySchema>;

/**
 * `POST /projects/:id/messages/read` — the caller has read the thread up to and
 * including this message. Named by the message, so no browser clock is in it.
 */
export const MarkProjectMessagesReadBodySchema = z.object({ throughMessageId: uuid }).strict();
export type MarkProjectMessagesReadBody = z.infer<typeof MarkProjectMessagesReadBodySchema>;

/** `POST /projects/:id/attachments` — a private, live asset that is not active content. */
export const CreateProjectAttachmentBodySchema = z.object({ assetId: uuid }).strict();
export type CreateProjectAttachmentBody = z.infer<typeof CreateProjectAttachmentBodySchema>;

const lookupSearchSchema = z.string().trim().max(200).optional();

/** `GET /projects/lookups/mentionable` — people who could see the Project (R-4). */
export const ProjectMentionableLookupQuerySchema = z.object({
  projectId: uuid.optional(),
  q: lookupSearchSchema,
});
export type ProjectMentionableLookupQuery = z.infer<typeof ProjectMentionableLookupQuerySchema>;

/**
 * `GET /projects/lookups/documents` — the `@@` list; answered with
 * `RecordDocumentLookupResponseSchema` of `record-references.ts` (FR-044).
 * Without a `projectId` (a Project being created) Orders and Quote Requests of
 * no Organization are offered — none.
 */
export const ProjectDocumentLookupQuerySchema = z.object({
  projectId: uuid.optional(),
  /**
   * Before a Project exists (the create form): the Organizations chosen on the
   * form, whose Orders and Quote Requests are offered — only those within the
   * caller's reach count. Ignored beside `projectId`, whose Project's
   * Organizations are the answer.
   */
  organizationIds: repeatable(uuid),
  q: lookupSearchSchema,
});
export type ProjectDocumentLookupQuery = z.infer<typeof ProjectDocumentLookupQuerySchema>;

/** At most this many options per lookup answer. */
const lookupLimitSchema = z.coerce.number().int().positive().max(50).default(20);

/**
 * `GET /projects/lookups/organizations` — the Organizations the caller may
 * name on a Project, by name (`q`), or one by `id` (the label of a value chosen
 * earlier). Only Organizations in the caller's reach are ever answered.
 */
export const ProjectOrganizationLookupQuerySchema = z.object({
  q: lookupSearchSchema,
  id: uuid.optional(),
  limit: lookupLimitSchema,
});
export type ProjectOrganizationLookupQuery = z.infer<typeof ProjectOrganizationLookupQuerySchema>;

/**
 * `GET /projects/lookups/admin-users` — active administrators by name or
 * e-mail (`q`), or one by `id` — who may be a Member or a listed person.
 */
export const ProjectAdminUserLookupQuerySchema = z.object({
  q: lookupSearchSchema,
  id: uuid.optional(),
  limit: lookupLimitSchema,
});
export type ProjectAdminUserLookupQuery = z.infer<typeof ProjectAdminUserLookupQuerySchema>;

// ---------------------------------------------------------------------------
// §2.5 Configuration — requests
// ---------------------------------------------------------------------------

/**
 * `GET /projects/roles`, `GET /projects/loss-reasons`. `active=true` leaves
 * archived rows out — what a picker offers; without it every row is listed,
 * archived ones included, because a Project still shows the ones it uses.
 */
export const ProjectDictionaryListQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});
export type ProjectDictionaryListQuery = z.infer<typeof ProjectDictionaryListQuerySchema>;

/** A Project Role or a loss reason — names per language and a fallback. */
const dictionaryEntryShape = {
  name: localizedNameSchema,
  defaultName: z.string().trim().min(1).max(PROJECT_DICTIONARY_NAME_MAX),
};

/** `POST /projects/roles`. The code is derived from the default name. */
export const CreateProjectRoleBodySchema = z.object(dictionaryEntryShape).strict();
export type CreateProjectRoleBody = z.infer<typeof CreateProjectRoleBodySchema>;

/** `PATCH /projects/roles/:id` — renaming; the code never changes. */
export const UpdateProjectRoleBodySchema = z
  .object(dictionaryEntryShape)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateProjectRoleBody = z.infer<typeof UpdateProjectRoleBodySchema>;

export const CreateProjectLossReasonBodySchema = z.object(dictionaryEntryShape).strict();
export type CreateProjectLossReasonBody = z.infer<typeof CreateProjectLossReasonBodySchema>;

export const UpdateProjectLossReasonBodySchema = z
  .object(dictionaryEntryShape)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateProjectLossReasonBody = z.infer<typeof UpdateProjectLossReasonBodySchema>;

/**
 * A Template's Stage in the whole-graph body. `key` names the Stage inside the
 * body — an existing Stage's id, or any label the editor chose for a new one —
 * so a move can name a Stage that has no id yet.
 */
export const ProjectTemplateStageInputSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    ...stageAttributesShape,
    tasks: stageTasksSchema.optional(),
  })
  .strict();
export type ProjectTemplateStageInput = z.infer<typeof ProjectTemplateStageInputSchema>;

/**
 * `POST /projects/templates`, `PUT /projects/templates/:id` — the whole
 * Template in one body, saved in one Command. A Template carries structure
 * only: no Organizations, Members, value or links (US3 sc.1).
 */
export const ProjectTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_TEMPLATE_NAME_MAX),
    description: descriptionSchema.optional(),
    roleIds: distinctIds(50).optional(),
    stages: z.array(ProjectTemplateStageInputSchema).min(1).max(PROJECT_STAGES_MAX),
    moves: z
      .array(
        z
          .object({ fromStageKey: z.string().min(1).max(64), toStageKey: z.string().min(1).max(64) })
          .strict(),
      )
      .max(PROJECT_STAGES_MAX * PROJECT_STAGES_MAX)
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const keys = body.stages.map((stage) => stage.key);
    const known = new Set(keys);
    if (known.size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Each Stage key may appear once' });
    }
    const seen = new Set<string>();
    (body.moves ?? []).forEach((move, index) => {
      if (!known.has(move.fromStageKey) || !known.has(move.toStageKey)) {
        ctx.addIssue({ code: 'custom', path: ['moves', index], message: 'A move must name Stages of this Template' });
      }
      if (move.fromStageKey === move.toStageKey) {
        ctx.addIssue({ code: 'custom', path: ['moves', index], message: 'A move must connect two different Stages' });
      }
      const pair = `${move.fromStageKey}\u0000${move.toStageKey}`;
      if (seen.has(pair)) {
        ctx.addIssue({ code: 'custom', path: ['moves', index], message: 'Each move may appear once' });
      }
      seen.add(pair);
    });
  });
export type ProjectTemplateBody = z.infer<typeof ProjectTemplateBodySchema>;

// ---------------------------------------------------------------------------
// §2.6 Analytics — request
// ---------------------------------------------------------------------------

/** Every `GET /projects/analytics/*` figure takes this (`projects:analytics`). */
export const ProjectAnalyticsQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    templateId: uuid.optional(),
    organizationId: uuid.optional(),
    projectManagerId: uuid.optional(),
  })
  .refine((query) => query.from <= query.to, { message: 'The range ends before it starts', path: ['to'] });
export type ProjectAnalyticsQuery = z.infer<typeof ProjectAnalyticsQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const personSchema = z.object({ id: uuid, name: z.string() });

/** A Project Role or a loss reason as configured. */
const dictionaryEntrySchema = z.object({
  id: uuid,
  code: z.string(),
  name: z.record(z.string(), z.string()),
  defaultName: z.string(),
  /** The name in the language the response is written in (`pickLocalized`, then `defaultName`). */
  label: z.string(),
  /** Seeded rows: renamable and archivable, never deletable. */
  isSystem: z.boolean(),
  archivedAt: isoTimestampSchema.nullable(),
  position: z.number().int(),
});

export const ProjectRoleSchema = dictionaryEntrySchema;
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;
export const ProjectLossReasonSchema = dictionaryEntrySchema;
export type ProjectLossReason = z.infer<typeof ProjectLossReasonSchema>;

export const ProjectCurrentStageSchema = z.object({
  id: uuid,
  name: z.string(),
  color: z.string(),
  deadlineOn: z.string().nullable(),
  overdue: z.boolean(),
});
export type ProjectCurrentStage = z.infer<typeof ProjectCurrentStageSchema>;

export const ProjectSummarySchema = z.object({
  id: uuid,
  number: z.string(),
  title: z.string(),
  state: projectStateSchema,
  currentStage: ProjectCurrentStageSchema.nullable(),
  organizations: z.array(z.object({ id: uuid, name: z.string() })),
  value: ProjectValueSchema.nullable(),
  projectManagers: z.array(personSchema),
  createdAt: isoTimestampSchema,
  closedAt: isoTimestampSchema.nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** `GET /projects` — one page, its next cursor and the total the caller may see. */
export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const ProjectStageSchema = z.object({
  id: uuid,
  name: z.string(),
  color: z.string(),
  position: z.number().int(),
  plannedDurationDays: z.number().int(),
  responsibleRoleIds: z.array(uuid),
  alertOffsetsDays: z.array(z.number().int()),
  completionGate: z.boolean(),
  completionPermitted: z.boolean(),
  startedOn: z.string().nullable(),
  deadlineOn: z.string().nullable(),
  deadlineManual: z.boolean(),
  tasksMaterializedAt: isoTimestampSchema.nullable(),
  tasksSkippedAt: isoTimestampSchema.nullable(),
  /**
   * Creating the Stage's Tasks failed on its last entry and has not been done
   * since — `POST …/stages/:stageId/materialize-tasks` creates them (R-8).
   */
  tasksMaterializeFailed: z.boolean(),
  /** The Stage's own Task definitions (R-7). */
  stageTasks: z.array(StageTaskDefinitionSchema.extend({ id: uuid, position: z.number().int() })),
});
export type ProjectStage = z.infer<typeof ProjectStageSchema>;

export const ProjectMemberSchema = z.object({
  id: uuid,
  adminUser: personSchema.extend({ active: z.boolean() }),
  roles: z.array(z.object({ id: uuid, name: z.string(), archived: z.boolean() })),
  addedAt: isoTimestampSchema,
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  description: z.string(),
  references: z.array(RecordReferenceSchema),
  startOn: z.string(),
  visibility: projectVisibilitySchema,
  viewers: z.array(personSchema),
  template: z.object({ id: uuid, name: z.string() }).nullable(),
  lostStageId: uuid.nullable(),
  lossReason: z.object({ id: uuid, name: z.string() }).nullable(),
  lossComment: z.string().nullable(),
  stages: z.array(ProjectStageSchema),
  moves: z.array(z.object({ fromStageId: uuid, toStageId: uuid })),
  /** Stages no permitted move reaches from the first — a warning, not an error. */
  unreachableStageIds: z.array(uuid),
  members: z.array(ProjectMemberSchema),
  linkCount: z.number().int().nonnegative(),
  /** Messages written by somebody else since the caller's read marker. */
  unreadMessageCount: z.number().int().nonnegative(),
  customFieldValues: customFieldValuesSchema,
  version: z.number().int().positive(),
  permissions: z.object({ canWrite: z.boolean(), canConfigure: z.boolean() }),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectStageEntrySchema = z.object({
  id: uuid,
  kind: projectStageEntryKindSchema,
  fromStageId: uuid.nullable(),
  toStageId: uuid.nullable(),
  fromStageName: z.string().nullable(),
  toStageName: z.string().nullable(),
  notes: z.array(projectStageEntryNoteSchema),
  actor: personSchema.nullable(),
  at: isoTimestampSchema,
});
export type ProjectStageEntry = z.infer<typeof ProjectStageEntrySchema>;

export const SetProjectMovesResultSchema = z.object({
  moves: z.array(z.object({ fromStageId: uuid, toStageId: uuid })),
  unreachableStageIds: z.array(uuid),
});
export type SetProjectMovesResult = z.infer<typeof SetProjectMovesResultSchema>;

/** `POST /projects/:id/move` — the Project after the move and what the move recorded. */
export const ProjectMoveResultSchema = z.object({
  project: ProjectDetailSchema,
  entry: ProjectStageEntrySchema,
  createdTaskIds: z.array(uuid),
  notes: z.array(projectStageEntryNoteSchema),
});
export type ProjectMoveResult = z.infer<typeof ProjectMoveResultSchema>;

export const MaterializeStageTasksResultSchema = z.object({ created: z.number().int().nonnegative() });
export type MaterializeStageTasksResult = z.infer<typeof MaterializeStageTasksResultSchema>;

/**
 * A linked record. `number`, `status`, `amount`, `currency` and `href` are
 * present only when `available` — a record the reader may not read, one that is
 * gone, or one whose owning module is switched off is listed as unavailable
 * (FR-023, FR-024).
 */
export const ProjectLinkSchema = z.object({
  id: uuid,
  kind: projectRecordKindSchema,
  recordId: uuid,
  available: z.boolean(),
  number: z.string().optional(),
  status: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  /**
   * A Quote Request's link only, while available — `true` while not every line
   * has an agreed price, so `amount` counts asked prices for some (issue #456,
   * `quoteRequestAmountSchema`).
   */
  partiallyAgreed: z.boolean().optional(),
  href: z.string().optional(),
  linkedBy: personSchema.nullable(),
  linkedAt: isoTimestampSchema,
});
export type ProjectLink = z.infer<typeof ProjectLinkSchema>;

/** `GET /projects/:id/tasks` — Tasks by Stage; `tasksAvailable: false` while `tasks` is off. */
export const ProjectTasksResponseSchema = z.object({
  tasksAvailable: z.boolean(),
  stages: z.array(z.object({ stageId: uuid, tasks: z.array(TaskSummarySchema) })),
});
export type ProjectTasksResponse = z.infer<typeof ProjectTasksResponseSchema>;

export const ProjectCommentSchema = z.object({
  id: uuid,
  kind: projectCommentKindSchema,
  author: personSchema,
  body: z.string(),
  references: z.array(RecordReferenceSchema),
  editedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
});
export type ProjectComment = z.infer<typeof ProjectCommentSchema>;

export const ProjectUnreadMessagesSchema = z.object({
  unreadMessageCount: z.number().int().nonnegative(),
});
export type ProjectUnreadMessages = z.infer<typeof ProjectUnreadMessagesSchema>;

export const ProjectAttachmentSchema = z.object({
  id: uuid,
  assetId: uuid,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string().nullable(),
  uploadedBy: personSchema,
  createdAt: isoTimestampSchema,
});
export type ProjectAttachment = z.infer<typeof ProjectAttachmentSchema>;

export const ProjectMentionableOptionSchema = z.object({ id: uuid, name: z.string(), email: z.string() });
export type ProjectMentionableOption = z.infer<typeof ProjectMentionableOptionSchema>;

export const ProjectTemplateSummarySchema = z.object({
  id: uuid,
  name: z.string(),
  stageCount: z.number().int().nonnegative(),
  archivedAt: isoTimestampSchema.nullable(),
  updatedAt: isoTimestampSchema,
});
export type ProjectTemplateSummary = z.infer<typeof ProjectTemplateSummarySchema>;

export const ProjectTemplateDetailSchema = z.object({
  id: uuid,
  name: z.string(),
  description: z.string(),
  roleIds: z.array(uuid),
  stages: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      color: z.string(),
      position: z.number().int(),
      plannedDurationDays: z.number().int(),
      responsibleRoleIds: z.array(uuid),
      alertOffsetsDays: z.array(z.number().int()),
      completionGate: z.boolean(),
      completionPermitted: z.boolean(),
      tasks: z.array(StageTaskDefinitionSchema.extend({ id: uuid, position: z.number().int() })),
    }),
  ),
  moves: z.array(z.object({ fromStageId: uuid, toStageId: uuid })),
  archivedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type ProjectTemplateDetail = z.infer<typeof ProjectTemplateDetailSchema>;

export const ProjectDetailResponseSchema = dataEnvelope(ProjectDetailSchema);
export const ProjectSummaryResponseSchema = dataEnvelope(ProjectSummarySchema);
export const ProjectStageResponseSchema = dataEnvelope(ProjectStageSchema);
export const ProjectStageEntryListResponseSchema = dataEnvelope(z.array(ProjectStageEntrySchema));
export const SetProjectMovesResponseSchema = dataEnvelope(SetProjectMovesResultSchema);
export const ProjectMoveResponseSchema = dataEnvelope(ProjectMoveResultSchema);
export const MaterializeStageTasksResponseSchema = dataEnvelope(MaterializeStageTasksResultSchema);
export const ProjectLinkResponseSchema = dataEnvelope(ProjectLinkSchema);
export const ProjectLinkListResponseSchema = dataEnvelope(z.array(ProjectLinkSchema));
export const ProjectTasksEnvelopeSchema = dataEnvelope(ProjectTasksResponseSchema);
export const ProjectCommentResponseSchema = dataEnvelope(ProjectCommentSchema);
export const ProjectCommentListResponseSchema = dataEnvelope(z.array(ProjectCommentSchema));
export const ProjectUnreadMessagesResponseSchema = dataEnvelope(ProjectUnreadMessagesSchema);
export const ProjectAttachmentResponseSchema = dataEnvelope(ProjectAttachmentSchema);
export const ProjectAttachmentListResponseSchema = dataEnvelope(z.array(ProjectAttachmentSchema));
export const ProjectMentionableLookupResponseSchema = dataEnvelope(z.array(ProjectMentionableOptionSchema));

export const ProjectOrganizationOptionSchema = z.object({ id: uuid, name: z.string() });
export type ProjectOrganizationOption = z.infer<typeof ProjectOrganizationOptionSchema>;
export const ProjectOrganizationLookupResponseSchema = dataEnvelope(z.array(ProjectOrganizationOptionSchema));

export const ProjectAdminUserOptionSchema = z.object({ id: uuid, name: z.string(), email: z.string() });
export type ProjectAdminUserOption = z.infer<typeof ProjectAdminUserOptionSchema>;
export const ProjectAdminUserLookupResponseSchema = dataEnvelope(z.array(ProjectAdminUserOptionSchema));

/**
 * `GET /projects/visibility-setting` — the module setting `projects.visibility`
 * as it stands, so a screen can say what *Follow the module setting* means.
 */
export const ProjectVisibilitySettingSchema = z.object({ setting: projectVisibilitySettingSchema });
export type ProjectVisibilitySettingInfo = z.infer<typeof ProjectVisibilitySettingSchema>;
export const ProjectVisibilitySettingResponseSchema = dataEnvelope(ProjectVisibilitySettingSchema);
export const ProjectRoleResponseSchema = dataEnvelope(ProjectRoleSchema);
export const ProjectRoleListResponseSchema = dataEnvelope(z.array(ProjectRoleSchema));
export const ProjectLossReasonResponseSchema = dataEnvelope(ProjectLossReasonSchema);
export const ProjectLossReasonListResponseSchema = dataEnvelope(z.array(ProjectLossReasonSchema));
export const ProjectTemplateListResponseSchema = dataEnvelope(z.array(ProjectTemplateSummarySchema));
export const ProjectTemplateResponseSchema = dataEnvelope(ProjectTemplateDetailSchema);
// `GET /projects/:id/history` answers `RecordHistoryPageSchema`, and
// `GET /projects/lookups/documents` `RecordDocumentLookupResponseSchema`, both
// of `record-references.ts`.

// ---------------------------------------------------------------------------
// §2.6 Analytics — responses (FR-037, FR-038)
// ---------------------------------------------------------------------------

/** An amount in one currency; money figures are per currency, never summed across. */
export const ProjectCurrencyAmountSchema = z.object({ currency: z.string(), amount: z.string() });
export type ProjectCurrencyAmount = z.infer<typeof ProjectCurrencyAmountSchema>;

/**
 * Every figure states the period it covers, how many Projects it was computed
 * from and how many it left out for a missing value (FR-038).
 */
export function projectAnalyticsEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    from: z.string(),
    to: z.string(),
    projectCount: z.number().int().nonnegative(),
    excluded: z.object({ noValue: z.number().int().nonnegative() }),
    data,
  });
}

export const ProjectAnalyticsSummarySchema = z.object({
  opened: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  /** completed / (completed + lost); `null` when nothing closed. */
  completionRate: z.number().min(0).max(1).nullable(),
});
export const ProjectAnalyticsDurationsSchema = z.object({
  completedAverageDays: z.number().nullable(),
  completedCount: z.number().int().nonnegative(),
  lostAverageDays: z.number().nullable(),
  lostCount: z.number().int().nonnegative(),
});
/** Grouped by Stage **name** (`lower(trim(name))`), as Stages are per Project (R-15). */
export const ProjectAnalyticsTimeInStageSchema = z.array(
  z.object({
    stageName: z.string(),
    averageDays: z.number().nullable(),
    sampleCount: z.number().int().nonnegative(),
  }),
);
export const ProjectAnalyticsLossesSchema = z.object({
  byStage: z.array(z.object({ stageName: z.string(), count: z.number().int().nonnegative(), share: z.number() })),
  byReason: z.array(
    z.object({
      lossReasonId: uuid,
      code: z.string(),
      name: z.string(),
      count: z.number().int().nonnegative(),
      share: z.number(),
    }),
  ),
  lostValue: z.array(ProjectCurrencyAmountSchema),
});
export const ProjectAnalyticsValueSchema = z.object({
  average: z.array(ProjectCurrencyAmountSchema.extend({ count: z.number().int().nonnegative() })),
});
export const ProjectAnalyticsTopOpenSchema = z.array(ProjectSummarySchema);
export const ProjectAnalyticsManagersSchema = z.array(
  z.object({ adminUser: personSchema, completedCount: z.number().int().nonnegative() }),
);

export const ProjectAnalyticsSummaryResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsSummarySchema);
export const ProjectAnalyticsDurationsResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsDurationsSchema);
export const ProjectAnalyticsTimeInStageResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsTimeInStageSchema);
export const ProjectAnalyticsLossesResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsLossesSchema);
export const ProjectAnalyticsValueResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsValueSchema);
export const ProjectAnalyticsTopOpenResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsTopOpenSchema);
export const ProjectAnalyticsManagersResponseSchema = projectAnalyticsEnvelope(ProjectAnalyticsManagersSchema);

// ---------------------------------------------------------------------------
// Error codes (`contracts/admin-api.md` §2)
// ---------------------------------------------------------------------------

/**
 * The codes the Projects API raises. Each joins the platform's `ERROR_CODES`,
 * the `projects` manifest's `errorCodes` and the module's `errors.<CODE>`
 * sentences in the change that adds its first raise site —
 * `check:error-translations` refuses a code enumerated before a manifest
 * declares it.
 */
export const PROJECTS_ERROR_CODES = [
  /** No such Project, or one out of the caller's reach or visibility — indistinguishable. */
  'PROJECT_NOT_FOUND',
  /** A Project with links cannot be deleted; unlink first. */
  'PROJECT_HAS_LINKS',
  /** A linked record belongs to the Organization being removed. */
  'PROJECT_ORGANIZATION_IN_USE',
  /** An Organization outside the caller's reach. */
  'PROJECT_ORGANIZATION_OUT_OF_SCOPE',
  'PROJECT_STAGE_CURRENT',
  'PROJECT_STAGE_HAS_TASKS',
  'PROJECT_STAGE_LAST',
  /** The Project's workflow has no move between the two Stages. */
  'PROJECT_MOVE_NOT_PERMITTED',
  /** The Stage's completion gate is closed; `details.openTaskCount` counts the open Tasks, `details.openTasks` names them to a reader of Tasks. */
  'PROJECT_STAGE_GATE_OPEN_TASKS',
  /** The `version` sent is stale. */
  'PROJECT_CHANGED',
  /** A registered stage guard refused; `details.reason` is its sentence. */
  'PROJECT_GUARD_REFUSED',
  /** Completing is not permitted from the current Stage. */
  'PROJECT_COMPLETION_NOT_PERMITTED',
  /** The record to link does not exist or is not readable by the caller. */
  'PROJECT_RECORD_NOT_FOUND',
  /** The record already belongs to a Project; `details.project` names it if visible. */
  'PROJECT_RECORD_ALREADY_LINKED',
  'PROJECT_LINK_ORGANIZATION_MISMATCH',
  /** Only a note's author edits or deletes it. */
  'PROJECT_NOTE_NOT_AUTHOR',
  /** A message is never edited or deleted (FR-025). */
  'PROJECT_MESSAGE_IMMUTABLE',
  /** `materialize-tasks` was asked of a Stage whose entry did not record a failure (R-8). */
  'PROJECT_STAGE_TASKS_NOT_RETRYABLE',
  /** The loss reason is unknown or archived (FR-005). */
  'PROJECT_LOSS_REASON_INVALID',
  /** A Member or listed person is not an active administrator, or a Role is unknown (FR-008). */
  'PROJECT_MEMBER_INVALID',
  /** The Template is unknown or archived. */
  'PROJECT_TEMPLATE_NOT_FOUND',
  /** No Project Role or loss reason with that id. */
  'PROJECT_DICTIONARY_ENTRY_NOT_FOUND',
  /** A seeded Role or loss reason is never deleted — archive it. */
  'PROJECT_DICTIONARY_ENTRY_SYSTEM',
  /** A Project or Template uses the Role or loss reason — archive it. */
  'PROJECT_DICTIONARY_ENTRY_IN_USE',
  /** Another row of the same dictionary has this default name, whatever its case. */
  'PROJECT_DICTIONARY_NAME_TAKEN',
  /** The uploaded file is larger than {@link PROJECT_ATTACHMENT_MAX_BYTES}. */
  'PROJECT_ATTACHMENT_TOO_LARGE',
] as const;
export type ProjectsErrorCode = (typeof PROJECTS_ERROR_CODES)[number];

/**
 * `details` of 409 `PROJECT_STAGE_GATE_OPEN_TASKS`: how many Tasks of the Stage
 * are open, and — only to a caller who holds `tasks:read` — which ones. A move
 * needs `projects:write` alone, so a Task's number and title are not the
 * refusal's to hand to somebody who may not read Tasks.
 */
export const ProjectStageGateOpenTasksDetailsSchema = z.object({
  openTaskCount: z.number().int().positive(),
  openTasks: z.array(z.object({ id: uuid, number: z.string(), title: z.string() })).optional(),
});
export type ProjectStageGateOpenTasksDetails = z.infer<typeof ProjectStageGateOpenTasksDetailsSchema>;

// ---------------------------------------------------------------------------
// Events (`data-model.md` §2.5) — emitted once per Command, on commit
// ---------------------------------------------------------------------------

interface ProjectsEventEnvelope {
  eventId: string;
  occurredAt: string;
}

export const PROJECTS_EVENTS = {
  PROJECT_CREATED: 'projects.project.created.v1',
  STAGE_MOVED: 'projects.stage.moved.v1',
  PROJECT_CLOSED: 'projects.project.closed.v1',
  PROJECT_REOPENED: 'projects.project.reopened.v1',
  RECORD_LINKED: 'projects.record.linked.v1',
  RECORD_UNLINKED: 'projects.record.unlinked.v1',
} as const;

/** Payload of `projects.project.created.v1`. */
export interface ProjectCreatedEvent extends ProjectsEventEnvelope {
  projectId: string;
  templateId: string | null;
}

/** Payload of `projects.stage.moved.v1` — names as they were at the move. */
export interface ProjectStageMovedEvent extends ProjectsEventEnvelope {
  projectId: string;
  fromStageId: string | null;
  toStageId: string;
  fromStageName: string | null;
  toStageName: string;
}

/** Payload of `projects.project.closed.v1`. */
export interface ProjectClosedEvent extends ProjectsEventEnvelope {
  projectId: string;
  outcome: ProjectOutcome;
  /** The Stage the Project was closed in. */
  stageId: string;
  /** The loss reason's code, when lost. */
  lossReasonCode?: string;
}

/** Payload of `projects.project.reopened.v1`. */
export interface ProjectReopenedEvent extends ProjectsEventEnvelope {
  projectId: string;
  stageId: string;
}

/** Payload of `projects.record.linked.v1` and `projects.record.unlinked.v1`. */
export interface ProjectRecordLinkEvent extends ProjectsEventEnvelope {
  projectId: string;
  recordKind: ProjectRecordKind;
  recordId: string;
}

// ---------------------------------------------------------------------------
// Published port and the stage-guard registry (`contracts/ports-and-events.md` §2)
//
// The `Container name:` marker of each is added in the change that registers
// it (`check:port-shape` refuses a marked port nothing registers — CRM
// `research.md` N-5).
// ---------------------------------------------------------------------------

/** A Project as it crosses a module boundary — a plain shape, never the entity. */
export interface ProjectRecord {
  id: string;
  number: string;
  title: string;
  state: ProjectState;
  currentStageId: string | null;
  currentStageName: string | null;
  organizationIds: string[];
  valueAmount: string | null;
  valueCurrency: string | null;
  templateId: string | null;
  closedAt: Date | null;
  createdAt: Date;
}

/**
 * Container name: `projectReadPort`. Owner: `projects`.
 *
 * Reading Projects from another module — overlays and later modules.
 *
 * Every read goes through the module's access seam: a Project out of the
 * caller's Organization reach or visibility is `null`, as one that does not
 * exist is.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`.
 */
export interface ProjectReadPort {
  findById(id: string): Promise<ProjectRecord | null>;
  findByRecord(kind: ProjectRecordKind, id: string): Promise<ProjectRecord | null>;
  /**
   * The Projects of `ids` the caller may see, in no particular order — a
   * hidden, missing or malformed id is simply absent. One query for a page of
   * references (`specs/165-task-management/` R-5).
   */
  findByIds(ids: readonly string[]): Promise<ProjectRecord[]>;
  /**
   * Projects the caller may see whose number or title contains `q`
   * (case-insensitively; every visible one for an empty `q`), newest first, at
   * most `limit` (≤ 20) — the Projects group of the `@@` list (R-5).
   */
  search(query: ProjectSearchQuery): Promise<ProjectRecord[]>;
}

/** What `ProjectReadPort.search` is asked. */
export interface ProjectSearchQuery {
  q?: string;
  /** At most {@link PROJECT_READ_PORT_SEARCH_MAX}. */
  limit: number;
}

/** The most Projects one `ProjectReadPort.search` answers. */
export const PROJECT_READ_PORT_SEARCH_MAX = 20;

export type ProjectStageGuardKind = 'move' | 'close_completed' | 'close_lost' | 'reopen';

/** What a guard is asked about. `toStageId` is `null` for a close. */
export interface ProjectStageGuardContext {
  projectId: string;
  fromStageId: string | null;
  toStageId: string | null;
  kind: ProjectStageGuardKind;
}

export type ProjectStageGuardDecision = { allow: true } | { allow: false; reason: string };

export interface ProjectStageGuard {
  /** The contributing module — required; an absent owner's guard is skipped. */
  readonly ownerModuleId: string;
  before(ctx: ProjectStageGuardContext): Promise<ProjectStageGuardDecision>;
}

/**
 * Container name: `projectStageGuardRegistry`. Owner: `projects`.
 *
 * The registry a module pushes a {@link ProjectStageGuard} into (R-6, FR-014) —
 * the "before" side of a move; the "after" side is the events above.
 *
 * A **contribution seam**: registered ungated (a plain `ctx.di.register`),
 * pushed into from a contribution-only boot hook, declared by the contributor
 * as a `contributes-to` edge.
 *
 * **Enumeration policy: skipped while the contributing module is absent** — a
 * switched-off module does not veto. A refusal answers 409
 * `PROJECT_GUARD_REFUSED` with the guard's reason.
 *
 * **Owner off:** no Project moves, so no guard runs; registering stays
 * possible, so a contributor's boot hook never depends on `projects` being on.
 */
export interface ProjectStageGuardRegistryPort {
  register(guard: ProjectStageGuard): void;
  /** Contributing modules, in registration order — for diagnostics and composition tests. */
  owners(): readonly string[];
}
