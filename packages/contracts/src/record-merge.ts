// The platform's record-merge vocabulary (`specs/192-organization-merge/`,
// `contracts/merge-mechanism.md`, `contracts/merge-participant.md`,
// `data-model.md` §5, §6).
//
// A **merge** declares that two records of one host type were always one: the
// **loser** is archived with a pointer to the **survivor**, and every module
// holding a reference to the loser moves its own rows to the survivor in its
// own audited Commands (Principle I). The platform runs the steps; the host
// module owns the operation; each participant owns its step. This file is the
// shape every one of them shares — no behaviour beyond the population rule and
// the coverage analysis, which are pure and run in two hosts (the static
// `check:merge-participation` and the platform's boot-time twin, R-9).

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// --- the closed sets ---------------------------------------------------------

/** The record types a merge may join. Each has exactly one host module. */
export const RECORD_MERGE_HOST_TYPES = ['organization', 'project'] as const;
export type RecordMergeHostType = (typeof RECORD_MERGE_HOST_TYPES)[number];

/**
 * The Organization merge's phases, in order (research R-11). The host's own
 * steps are fixed at `structure` and `finalize`; a participant declares one of
 * the others, never `finalize`.
 */
export const ORGANIZATION_MERGE_PHASES = [
  'structure',
  'configuration',
  'addresses',
  'members',
  'records',
  'finalize',
] as const;
export type OrganizationMergePhase = (typeof ORGANIZATION_MERGE_PHASES)[number];

/** The Project merge's phases, in order (research R-11). */
export const PROJECT_MERGE_PHASES = ['structure', 'records', 'finalize'] as const;
export type ProjectMergePhase = (typeof PROJECT_MERGE_PHASES)[number];

/** Each host type's phases. A participation names one of its host's. */
export const RECORD_MERGE_HOST_PHASES: {
  readonly organization: typeof ORGANIZATION_MERGE_PHASES;
  readonly project: typeof PROJECT_MERGE_PHASES;
} = {
  organization: ORGANIZATION_MERGE_PHASES,
  project: PROJECT_MERGE_PHASES,
};

/** The phase only the host runs: field values, the archive pointer, the event. */
export const RECORD_MERGE_FINALIZE_PHASE = 'finalize';

/** A merge's state (data-model §1.6). */
export const RECORD_MERGE_STATES = ['running', 'needs_attention', 'completed', 'cancelled'] as const;
export type RecordMergeState = (typeof RECORD_MERGE_STATES)[number];

/** One step's state. `deferred` is a step whose module was off when it was reached (D-299). */
export const RECORD_MERGE_STEP_STATES = ['pending', 'running', 'done', 'failed', 'deferred'] as const;
export type RecordMergeStepState = (typeof RECORD_MERGE_STEP_STATES)[number];

/** Why a step was deferred. */
export const RECORD_MERGE_DEFERRED_REASONS = ['module_off', 'module_unavailable'] as const;
export type RecordMergeDeferredReason = (typeof RECORD_MERGE_DEFERRED_REASONS)[number];

/**
 * What happens to one kind of record (spec *Vocabulary*, research R-3):
 * `re_point` moves it, `union` inserts the survivor's twin and drops the
 * loser's, `survivor_wins` leaves the loser's on the archived loser,
 * `survivor_wins_fill_gaps` adopts the loser's where the survivor has none,
 * `sum` adds counters, `stricter` keeps the stricter policy, `kept` stays.
 */
export const MERGE_DISPOSITIONS = [
  're_point',
  'union',
  'survivor_wins',
  'survivor_wins_fill_gaps',
  'sum',
  'stricter',
  'kept',
] as const;
export type MergeDisposition = (typeof MERGE_DISPOSITIONS)[number];

/**
 * Does a disposition write anything? `kept` leaves the row on the archived
 * loser and plain `survivor_wins` leaves the loser's row there too (R-3), so a
 * participation holding only those has no step, no phase and no participant.
 */
export function mergeDispositionMoves(disposition: MergeDisposition): boolean {
  return disposition !== 'kept' && disposition !== 'survivor_wins';
}

/**
 * The key of a host's own structure step. A participation the host module
 * declares under it is the host's structure work (`MergeHostImplementation
 * .applyStructureBatch`), not a participant.
 */
export const RECORD_MERGE_HOST_STRUCTURE_KEY = 'host-structure';

/** The value a field choice takes. */
export const RECORD_MERGE_CHOICES = ['survivor', 'loser'] as const;
export type RecordMergeChoice = (typeof RECORD_MERGE_CHOICES)[number];

/**
 * A conflict a participant cannot resolve by its declared disposition
 * (FR-026): reported with this `resolution`, it refuses the start as
 * `RECORD_MERGE_PARTICIPANT_CONFLICT`, naming the participant and the conflict.
 */
export const MERGE_CONFLICT_UNRESOLVABLE = 'unresolvable';

/**
 * The platform's merge error codes (data-model §6). `RECORD_MERGE_BUSY` (an
 * in-flight placement or payment, R-20) is not here yet: it arrives with the
 * `orders` participant that raises it (tasks T058), because a code nothing
 * raises is refused by `check:error-translations`. A host's own codes
 * (`ORGANIZATION_MERGE_*`) are its contract's. Reach failures answer the
 * platform's `404 NOT_FOUND`, indistinguishable from absence.
 */
export const RECORD_MERGE_ERROR_CODES = {
  /** 422 — survivor and loser are the same record. */
  SAME_RECORD: 'RECORD_MERGE_SAME_RECORD',
  /** 409 — either is deleted or already merged, or the survivor is rejected. */
  RECORD_UNAVAILABLE: 'RECORD_MERGE_RECORD_UNAVAILABLE',
  /** 409 — a running merge already holds one of the two records. */
  ALREADY_RUNNING: 'RECORD_MERGE_ALREADY_RUNNING',
  /** 409 — a present module holds a reference no participation declares; `details.modules`. */
  PARTICIPATION_INCOMPLETE: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE',
  /** 409 — a participant reports a conflict it cannot resolve; `details.module`, `details.conflict`. */
  PARTICIPANT_CONFLICT: 'RECORD_MERGE_PARTICIPANT_CONFLICT',
  /** 409 — a write names a record a running merge has frozen. */
  IN_PROGRESS: 'RECORD_MERGE_IN_PROGRESS',
  /** 409 — a participant step has committed, so the merge can no longer be cancelled. */
  NOT_CANCELLABLE: 'RECORD_MERGE_NOT_CANCELLABLE',
  /** 409 — only a merge that needs attention can be resumed. */
  NOT_RESUMABLE: 'RECORD_MERGE_NOT_RESUMABLE',
  /** 422 — the start did not acknowledge that a merge cannot be undone (FR-012). */
  ACKNOWLEDGEMENT_REQUIRED: 'RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED',
  /**
   * Recorded on a merge, never answered to a request: finalize found rows still
   * naming the loser after three sweeps of the participants that hold them, so
   * the merge stopped in `needs_attention` rather than archive a referenced loser.
   */
  RESIDUE: 'RECORD_MERGE_RESIDUE',
} as const;
export type RecordMergeErrorCode = (typeof RECORD_MERGE_ERROR_CODES)[keyof typeof RECORD_MERGE_ERROR_CODES];

// --- runtime names -------------------------------------------------------------

/** The BullMQ queue the platform's merge runner consumes (one job per merge). */
export const RECORD_MERGE_QUEUE = 'platform.record-merge';

/** The Redis channel a merge's state change is announced on (frozen and archived sets, R-6). */
export const RECORD_MERGE_CHANGED_CHANNEL = 'b2b:record-merge:changed';

const SCOPE_PREFIX = 'record-merge:';

/**
 * The system-scope reason every step of a merge runs under. The tenant write
 * guard lets a write naming a frozen record through only inside this scope,
 * for this merge (R-6).
 */
export function recordMergeScopeReason(mergeId: string): string {
  return `${SCOPE_PREFIX}${mergeId}`;
}

/** The merge id a scope reason names, or `null` when it is not a merge's. */
export function mergeIdOfScopeReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string' || !reason.startsWith(SCOPE_PREFIX)) return null;
  const id = reason.slice(SCOPE_PREFIX.length);
  return id.length > 0 ? id : null;
}

// --- manifest declarations (`contracts/merge-mechanism.md` §1) -----------------

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const mergeParticipationReferenceSchema = z
  .object({
    /** An entity class name in the declaring module. */
    entity: z.string().regex(IDENTIFIER_RE),
    /** The property holding the host id(s), or the polymorphic id. */
    property: z.string().regex(IDENTIFIER_RE),
    /** A polymorphic reference: the discriminator property and the value that means this host. */
    polymorphic: z
      .object({ discriminator: z.string().regex(IDENTIFIER_RE), value: z.string().min(1) })
      .strict()
      .optional(),
    disposition: z.enum(MERGE_DISPOSITIONS),
  })
  .strict();
export type MergeParticipationReference = z.infer<typeof mergeParticipationReferenceSchema>;

export const mergeHostDeclarationSchema = z.object({ type: z.enum(RECORD_MERGE_HOST_TYPES) }).strict();
export type MergeHostDeclaration = z.infer<typeof mergeHostDeclarationSchema>;

export const mergeParticipationDeclarationSchema = z
  .object({
    host: z.enum(RECORD_MERGE_HOST_TYPES),
    /** Unique within the module, kebab-case. */
    key: z.string().regex(KEY_RE),
    /**
     * One of the host's phases, never `finalize`. Absent only for a
     * participation whose every reference is `kept`: it has no step.
     */
    phase: z.string().min(1).optional(),
    /** May finish after finalize (R-16). */
    trailing: z.boolean().optional(),
    /** Rows per batch Command; defaults to 500, members use 50 (R-16). */
    batchSize: z.number().int().positive().max(5000).optional(),
    references: z.array(mergeParticipationReferenceSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const phases: readonly string[] = RECORD_MERGE_HOST_PHASES[value.host];
    const moves = value.references.some((reference) => mergeDispositionMoves(reference.disposition));
    if (value.phase === undefined) {
      if (moves) {
        ctx.addIssue({
          code: 'custom',
          path: ['phase'],
          message: `merge participation "${value.key}" moves records and so needs a phase of the "${value.host}" host`,
        });
      }
      return;
    }
    if (value.phase === RECORD_MERGE_FINALIZE_PHASE) {
      ctx.addIssue({
        code: 'custom',
        path: ['phase'],
        message: `merge participation "${value.key}" declares the finalize phase, which only the host runs`,
      });
      return;
    }
    if (!phases.includes(value.phase)) {
      ctx.addIssue({
        code: 'custom',
        path: ['phase'],
        message:
          `merge participation "${value.key}" declares phase "${value.phase}", which the "${value.host}" host ` +
          `does not have (${phases.join(', ')})`,
      });
    }
  });
export type MergeParticipationDeclaration = z.infer<typeof mergeParticipationDeclarationSchema>;

/** The manifest's `merge` block. */
export const moduleMergeDeclarationSchema = z
  .object({
    /** Only the module that owns the record type. */
    hosts: z.array(mergeHostDeclarationSchema).optional(),
    /** Every module whose persisted rows reference a host's records. */
    participates: z.array(mergeParticipationDeclarationSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const participation of value.participates ?? []) {
      const key = `${participation.host}/${participation.key}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['participates'],
          message: `merge participation "${participation.key}" for host "${participation.host}" is declared twice`,
        });
      }
      keys.add(key);
    }
    const hosts = new Set<string>();
    for (const host of value.hosts ?? []) {
      if (hosts.has(host.type)) {
        ctx.addIssue({ code: 'custom', path: ['hosts'], message: `merge host "${host.type}" is declared twice` });
      }
      hosts.add(host.type);
    }
  });
export type ModuleMergeDeclaration = z.infer<typeof moduleMergeDeclarationSchema>;

// --- the participant contract (`contracts/merge-participant.md` §1) -------------

/** What the runner hands a step (and the host's own structure batch). */
export interface MergeStepInput {
  readonly mergeId: string;
  readonly hostType: RecordMergeHostType;
  readonly survivorId: string;
  readonly loserId: string;
  /** Host-written context (Organization: `{ roleMap }`), typed by the host's contract. */
  readonly hostContext: Readonly<Record<string, unknown>>;
  readonly batchSize: number;
}

/** A merge refusal, conflict or warning: a code and ids/codes only, never values. */
export interface RecordMergeNotice {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** A participant's read-only answer. Counts what is still the loser's and would move. */
export interface MergeParticipantPreview {
  /** Remaining rows per declared reference, keyed `Entity.property`. Reaches 0 after the step. */
  readonly counts: Readonly<Record<string, number>>;
  readonly conflicts: readonly (RecordMergeNotice & { readonly resolution: string })[];
  readonly warnings: readonly RecordMergeNotice[];
  /** A refusal stops the start (FR-026, R-20). */
  readonly refusals: readonly (RecordMergeNotice & { readonly retryable: boolean })[];
}

export type MergePreviewInput = Omit<MergeStepInput, 'batchSize' | 'mergeId'> & { readonly mergeId?: string };

/**
 * One module's part of a merge. It runs inside its owner and uses only its
 * owner's own Commands: `applyBatch` moves at most `batchSize` rows still held
 * by the loser in ONE Command (`<prefix>.merge_reassign`, `reversible: false`,
 * no event, audit `objectType` = host type, `objectId` = survivor,
 * `stateAfter = { mergeId, loserId, moved, ids }`) and returns how many it
 * moved; 0 means done. It consumes loser-side state, so a re-run never
 * duplicates (research R-3). It checks no permission and no module presence:
 * the host's start Command was the gate, and the runner never calls a
 * participant whose module is off.
 */
export interface MergeParticipant<H extends RecordMergeHostType = RecordMergeHostType> {
  readonly host: H;
  preview(input: MergePreviewInput): Promise<MergeParticipantPreview>;
  applyBatch(input: MergeStepInput): Promise<{ readonly moved: number }>;
}

/** A field the host offers for choice. Values are for the preview's screen only, never audited. */
export interface RecordMergeFieldDifference {
  readonly code: string;
  readonly survivor: unknown;
  readonly loser: unknown;
  readonly default: RecordMergeChoice;
}

/** The host's own part of a preview: its refusals and the value differences. */
export interface HostMergePreview {
  readonly refusals: readonly RecordMergeNotice[];
  readonly fields: readonly RecordMergeFieldDifference[];
  readonly customFields: readonly (Omit<RecordMergeFieldDifference, 'code'> & { readonly key: string })[];
  /** Host-side counts for its own structure work, keyed `Entity.property`. */
  readonly counts: Readonly<Record<string, number>>;
  readonly warnings: readonly RecordMergeNotice[];
}

/**
 * What the runner calls for the host's own phases. The host registers it with
 * `ctx.merge.host(type, impl)`; only the module declaring `merge.hosts` may.
 */
export interface MergeHostImplementation<H extends RecordMergeHostType = RecordMergeHostType> {
  readonly host: H;
  /** Host refusals and the field diff. Read-only; runs before every participant preview. */
  preview(input: { readonly survivorId: string; readonly loserId: string }): Promise<HostMergePreview>;
  /** The host's structure-phase work, batched like a participant (0 = done). */
  applyStructureBatch(input: MergeStepInput): Promise<{ readonly moved: number }>;
  /**
   * The host's finalize Command: field values, archive pointer, the merged
   * event. Runs once — a resumed merge whose finalize committed never calls it
   * again (the runner reads that from the merge's state).
   */
  finalize(input: MergeStepInput): Promise<void>;
}

// --- shapes served to hosts and the admin (`contracts/merge-mechanism.md` §6) ---

const noticeSchema = z.object({ code: z.string().min(1), details: z.record(z.string(), z.unknown()).optional() });
const choiceSchema = z.enum(RECORD_MERGE_CHOICES);

export const recordMergePreviewSchema = z.object({
  /** Empty means the merge may start. */
  refusals: z.array(noticeSchema),
  fields: z.array(z.object({ code: z.string(), survivor: z.unknown(), loser: z.unknown(), default: choiceSchema })),
  customFields: z.array(z.object({ key: z.string(), survivor: z.unknown(), loser: z.unknown(), default: choiceSchema })),
  participants: z.array(
    z.object({
      moduleId: z.string(),
      key: z.string(),
      phase: z.string(),
      counts: z.record(z.string(), z.number().int().nonnegative()),
      conflicts: z.array(noticeSchema.extend({ resolution: z.string() })),
      warnings: z.array(noticeSchema),
    }),
  ),
  /** Effectively present modules holding a reference no participation declares (R-9). */
  incomplete: z.array(z.string()),
});
export type RecordMergePreview = z.infer<typeof recordMergePreviewSchema>;

export const recordMergeStepSchema = z.object({
  moduleId: z.string(),
  key: z.string(),
  phase: z.string(),
  state: z.enum(RECORD_MERGE_STEP_STATES),
  movedCount: z.number().int().nonnegative(),
  deferredReason: z.enum(RECORD_MERGE_DEFERRED_REASONS).nullable(),
  lastErrorCode: z.string().nullable(),
  trailing: z.boolean(),
});
export type RecordMergeStep = z.infer<typeof recordMergeStepSchema>;

export const recordMergeRecordSchema = z.object({
  id: uuidSchema,
  hostType: z.enum(RECORD_MERGE_HOST_TYPES),
  survivorId: uuidSchema,
  loserId: uuidSchema,
  state: z.enum(RECORD_MERGE_STATES),
  /** Optimistic concurrency token for resume and cancel. */
  version: z.number().int().positive(),
  /** D-293.6 source code of the start, when server code named one. */
  source: z.string().nullable(),
  actorKind: z.enum(['admin', 'customer', 'system', 'api_key']),
  actorAdminUserId: uuidSchema.nullable(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  needsAttentionAt: isoDateTimeSchema.nullable(),
  lastErrorCode: z.string().nullable(),
  /** Field codes chosen from the loser or the survivor — codes, never values. */
  fieldChoices: z.record(z.string(), choiceSchema),
  customFieldChoices: z.record(z.string(), choiceSchema),
  steps: z.array(recordMergeStepSchema),
});
export type RecordMergeRecord = z.infer<typeof recordMergeRecordSchema>;

// --- the population rule and the coverage analysis (R-9) -----------------------

/**
 * Is `property` of an entity in `moduleId` a reference to a `host` record by
 * name (`contracts/merge-participation-check.md` §1)? Organization:
 * `organizationId`, `organizationIds`, or a name ending in `OrganizationId(s)`.
 * Project: `projectId`, or a name ending in `ProjectId`, outside `projects`
 * (whose own tables are the host's). Polymorphic references cannot be found by
 * name; they enter the population through a declaration.
 */
export function isHostReferenceProperty(host: RecordMergeHostType, moduleId: string, property: string): boolean {
  if (host === 'organization') {
    return /^organizationIds?$/.test(property) || /[a-z0-9]OrganizationIds?$/.test(property);
  }
  if (moduleId === 'projects') return false;
  return property === 'projectId' || /[a-z0-9]ProjectId$/.test(property);
}

/** One persisted entity class, as either host reads it. */
export interface MergePopulationEntity {
  readonly moduleId: string;
  readonly entity: string;
  /** Every persisted property name of the class. */
  readonly properties: readonly string[];
}

/** One composed participation, with the module that declared it. */
export interface MergeDeclarationWithModule {
  readonly moduleId: string;
  readonly host: RecordMergeHostType;
  readonly key: string;
  readonly phase?: string | undefined;
  readonly references: readonly MergeParticipationReference[];
}

/** One reference the static check's ledger lets stand undeclared (it only shrinks). */
export interface MergePendingEntry {
  readonly moduleId: string;
  readonly entity: string;
  readonly property: string;
}

export type MergeCoverageFindingKind =
  | 'undeclared-reference'
  | 'declared-missing-property'
  | 'foreign-declaration'
  | 'double-coverage'
  | 'stale-pending';

export interface MergeCoverageFinding {
  readonly kind: MergeCoverageFindingKind;
  readonly moduleId: string;
  readonly entity: string;
  readonly property: string;
  readonly host: RecordMergeHostType | null;
  readonly message: string;
}

export interface MergeCoverageResult {
  /** Sorted by module, entity, property, kind. */
  readonly findings: readonly MergeCoverageFinding[];
  /**
   * Modules holding a population reference no participation covers. The
   * pending ledger does **not** cover here: the runtime twin never reads it,
   * so a ledgered reference still refuses a merge start (R-9).
   */
  readonly uncoveredModules: readonly string[];
  /** How many population references were read (the check's `sites`). */
  readonly sites: number;
}

/**
 * The coverage analysis, shared by `check:merge-participation` and the
 * platform's runtime twin (`contracts/merge-participation-check.md` §2, §4).
 * Pure: the static host derives the population from source, the runtime host
 * from the ORM's metadata, and both hand it here with the declarations.
 */
export function analyseMergeCoverage(input: {
  readonly population: readonly MergePopulationEntity[];
  readonly declarations: readonly MergeDeclarationWithModule[];
  readonly pending?: readonly MergePendingEntry[];
}): MergeCoverageResult {
  const findings: MergeCoverageFinding[] = [];
  const entities = new Map<string, MergePopulationEntity>();
  for (const entity of input.population) entities.set(entity.entity, entity);

  // The population by name, per host.
  const references = new Map<string, { moduleId: string; entity: string; property: string; hosts: Set<RecordMergeHostType> }>();
  const refKey = (entity: string, property: string): string => `${entity}.${property}`;
  for (const entity of input.population) {
    for (const property of entity.properties) {
      for (const host of RECORD_MERGE_HOST_TYPES) {
        if (!isHostReferenceProperty(host, entity.moduleId, property)) continue;
        const key = refKey(entity.entity, property);
        const row = references.get(key) ?? { moduleId: entity.moduleId, entity: entity.entity, property, hosts: new Set() };
        row.hosts.add(host);
        references.set(key, row);
      }
    }
  }

  // Coverage by declaration.
  const coveredBy = new Map<string, string[]>();
  for (const declaration of input.declarations) {
    for (const reference of declaration.references) {
      const found = entities.get(reference.entity);
      const label = `${declaration.moduleId}/${declaration.host}/${declaration.key}`;
      if (found === undefined || !found.properties.includes(reference.property)) {
        findings.push({
          kind: 'declared-missing-property',
          moduleId: declaration.moduleId,
          entity: reference.entity,
          property: reference.property,
          host: declaration.host,
          message: `${label} declares ${reference.entity}.${reference.property}, which no persisted entity holds`,
        });
        continue;
      }
      if (found.moduleId !== declaration.moduleId) {
        findings.push({
          kind: 'foreign-declaration',
          moduleId: declaration.moduleId,
          entity: reference.entity,
          property: reference.property,
          host: declaration.host,
          message:
            `${label} declares ${reference.entity}.${reference.property}, which module "${found.moduleId}" owns — ` +
            'a module declares only its own records (Principle I)',
        });
        continue;
      }
      if (reference.polymorphic !== undefined && !found.properties.includes(reference.polymorphic.discriminator)) {
        findings.push({
          kind: 'declared-missing-property',
          moduleId: declaration.moduleId,
          entity: reference.entity,
          property: reference.polymorphic.discriminator,
          host: declaration.host,
          message: `${label} names discriminator ${reference.entity}.${reference.polymorphic.discriminator}, which does not exist`,
        });
        continue;
      }
      const key = `${declaration.host}:${refKey(reference.entity, reference.property)}${
        reference.polymorphic ? `:${reference.polymorphic.discriminator}=${reference.polymorphic.value}` : ''
      }`;
      const list = coveredBy.get(key) ?? [];
      list.push(label);
      coveredBy.set(key, list);
    }
  }
  for (const [key, labels] of coveredBy) {
    if (labels.length < 2) continue;
    const [host, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const [entity = '', propertyWithPoly = ''] = rest.split('.');
    const property = propertyWithPoly.split(':')[0] ?? propertyWithPoly;
    findings.push({
      kind: 'double-coverage',
      moduleId: entities.get(entity)?.moduleId ?? '',
      entity,
      property,
      host: host as RecordMergeHostType,
      message: `${entity}.${property} is declared by ${labels.join(' and ')}; one declaration covers one property`,
    });
  }

  const covered = (host: RecordMergeHostType, entity: string, property: string): boolean =>
    coveredBy.has(`${host}:${refKey(entity, property)}`);

  const pending = new Set((input.pending ?? []).map((entry) => `${entry.moduleId}:${refKey(entry.entity, entry.property)}`));
  const uncoveredModules = new Set<string>();
  let sites = 0;
  for (const row of references.values()) {
    for (const host of row.hosts) {
      sites += 1;
      if (covered(host, row.entity, row.property)) continue;
      uncoveredModules.add(row.moduleId);
      if (pending.has(`${row.moduleId}:${refKey(row.entity, row.property)}`)) continue;
      findings.push({
        kind: 'undeclared-reference',
        moduleId: row.moduleId,
        entity: row.entity,
        property: row.property,
        host,
        message:
          `${row.entity}.${row.property} in module "${row.moduleId}" references a ${host} and no merge ` +
          'participation of that module declares it (FR-045). Declare it in the manifest `merge.participates` ' +
          'with a disposition, and register the participant with ctx.merge.participate.',
      });
    }
  }

  for (const entry of input.pending ?? []) {
    const row = references.get(refKey(entry.entity, entry.property));
    const stillUndeclared =
      row !== undefined && row.moduleId === entry.moduleId && [...row.hosts].some((host) => !covered(host, entry.entity, entry.property));
    if (stillUndeclared) continue;
    findings.push({
      kind: 'stale-pending',
      moduleId: entry.moduleId,
      entity: entry.entity,
      property: entry.property,
      host: null,
      message:
        row === undefined
          ? `the pending ledger names ${entry.entity}.${entry.property} in "${entry.moduleId}", which no longer exists — remove the entry`
          : `the pending ledger names ${entry.entity}.${entry.property} in "${entry.moduleId}", which is now declared — remove the entry`,
    });
  }

  findings.sort((a, b) =>
    a.moduleId.localeCompare(b.moduleId) ||
    a.entity.localeCompare(b.entity) ||
    a.property.localeCompare(b.property) ||
    a.kind.localeCompare(b.kind),
  );
  return { findings, uncoveredModules: [...uncoveredModules].sort(), sites };
}
