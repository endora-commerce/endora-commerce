import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  MERGE_CONFLICT_UNRESOLVABLE,
  type ErrorCode,
  type MergeCoverageResult,
  type RecordMergeChoice,
  type RecordMergeHostType,
  type RecordMergePreview,
  type RecordMergeRecord,
  type RecordMergeState,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { CommandActor } from '../../commands/command.js';
import { mergeFreezeState, type MergeFreezeSnapshot } from '../../tenancy/merge-freeze.js';
import { incompleteModules } from './completeness.js';
import { RecordMerge } from './record-merge.entity.js';
import { RecordMergeLock } from './record-merge-lock.entity.js';
import { RecordMergeStep } from './record-merge-step.entity.js';
import { HOST_STRUCTURE_STEP_KEY, type RecordMergeRegistry } from './registry.js';
import { toRecordMergeRecord } from './store.js';

/**
 * Container name: `recordMergeService`. Owner: the platform
 * (`specs/192-organization-merge/` `contracts/merge-mechanism.md` §5).
 *
 * What a **host** module's merge Commands call. It is not a port: a host is
 * the only caller, every write method takes the host Command's own
 * `EntityManager` so the merge rows commit or roll back with the Command and
 * its audit entry, and it checks no permission and no reach — the host's
 * routes do (R-15). After the Command commits, the host calls
 * {@link announce}, which refreshes this process's frozen set, tells the other
 * processes, and hands a running merge to the runner.
 */
export interface RecordMergeService {
  /** Insert the merge, its locks (refused `409 RECORD_MERGE_ALREADY_RUNNING`) and its steps. */
  begin(em: EntityManager, input: RecordMergeBeginInput): Promise<RecordMergeRecord>;
  /** `409 RECORD_MERGE_NOT_CANCELLABLE` once any step has started; `409 VERSION_CONFLICT` on a stale version. */
  cancel(em: EntityManager, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord>;
  /** `needs_attention` → `running`, failed steps back to pending; `409 RECORD_MERGE_NOT_RESUMABLE` otherwise. */
  resume(em: EntityManager, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord>;
  /** Merge keys into the host context the later participants read (the Organization role map). */
  setHostContext(em: EntityManager, mergeId: string, patch: Readonly<Record<string, unknown>>): Promise<void>;
  /** Read the merge inside the caller's transaction (a host's finalize, its structure batch). */
  getWithin(em: EntityManager, mergeId: string): Promise<RecordMergeRecord | null>;
  /** The host context inside the caller's transaction (the host's own structure batch writes it). */
  hostContextWithin(em: EntityManager, mergeId: string): Promise<Readonly<Record<string, unknown>>>;
  get(mergeId: string): Promise<RecordMergeRecord | null>;
  list(filter: { readonly hostType: RecordMergeHostType; readonly state?: RecordMergeState; readonly recordId?: string }): Promise<RecordMergeRecord[]>;
  /** The host's preview, every present participant's, the lock check and the completeness twin. Writes nothing. */
  preview(hostType: RecordMergeHostType, survivorId: string, loserId: string): Promise<RecordMergePreview>;
  /** After the host's Command committed: refresh, announce, enqueue. Never throws for a lost announcement. */
  announce(mergeId: string): Promise<void>;
  isFrozen(hostType: RecordMergeHostType, id: string): boolean;
  archivedInto(hostType: RecordMergeHostType, id: string): string | null;
}

export interface RecordMergeBeginInput {
  readonly hostType: RecordMergeHostType;
  readonly survivorId: string;
  readonly loserId: string;
  readonly fieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly actor: CommandActor;
  readonly source: string | null;
  /** The merge id, when the host minted it first (so its audit entry and hook data carry it). */
  readonly mergeId?: string;
}

export interface RecordMergeServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly registry: RecordMergeRegistry;
  readonly isPresent: (moduleId: string) => boolean;
  /** The completeness twin's result, computed once the ORM's metadata is complete. */
  readonly coverage: () => MergeCoverageResult;
  /** Hand a merge to the runner (a BullMQ job; a no-op where this process runs no queue). */
  readonly enqueue: (mergeId: string) => Promise<void>;
  /** Tell every other process to reload its frozen set. */
  readonly publishChanged: () => Promise<void>;
}

function conflict(code: ErrorCode, message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(409, code, message, details);
}

export class PlatformRecordMergeService implements RecordMergeService {
  constructor(private readonly deps: RecordMergeServiceDeps) {}

  async begin(em: EntityManager, input: RecordMergeBeginInput): Promise<RecordMergeRecord> {
    const host = this.deps.registry.hostOf(input.hostType);
    if (host === undefined) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `No module hosts merges of ${input.hostType}.`);
    }
    const merge = em.create(RecordMerge, {
      ...(input.mergeId !== undefined ? { id: input.mergeId } : {}),
      hostType: input.hostType,
      survivorId: input.survivorId,
      loserId: input.loserId,
      fieldChoices: { ...input.fieldChoices },
      customFieldChoices: { ...input.customFieldChoices },
      hostContext: {},
      actorKind: input.actor.kind,
      actorAdminUserId: input.actor.actorAdminUserId,
      source: input.source,
    });
    em.persist(merge);
    await em.flush();
    // The race guard (data-model §1.3): two starts over overlapping ids both
    // insert, and the primary key admits exactly one. `on conflict do nothing`
    // keeps the transaction usable for the refusal's own rollback.
    const inserted = await em.execute<{ record_id: string }[]>(
      `insert into "record_merge_locks" ("host_type", "record_id", "merge_id") values (?, ?, ?), (?, ?, ?) ` +
        `on conflict do nothing returning "record_id"`,
      [input.hostType, input.survivorId, merge.id, input.hostType, input.loserId, merge.id],
    );
    if (inserted.length < 2) {
      throw conflict(ERROR_CODES.RECORD_MERGE_ALREADY_RUNNING, 'Another merge already involves one of these records.');
    }
    const steps = [
      { moduleId: host.moduleId, participationKey: HOST_STRUCTURE_STEP_KEY, phase: 'structure', trailing: false },
      ...this.deps.registry.participantsOf(input.hostType).map((participant) => ({
        moduleId: participant.moduleId,
        participationKey: participant.key,
        phase: participant.phase,
        trailing: participant.trailing,
      })),
    ];
    for (const step of steps) em.persist(em.create(RecordMergeStep, { mergeId: merge.id, ...step }));
    await em.flush();
    return this.#record(em, merge.id) as Promise<RecordMergeRecord>;
  }

  async cancel(em: EntityManager, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord> {
    const merge = await this.#lockMerge(em, mergeId, expectedVersion);
    const steps = await em.find(RecordMergeStep, { mergeId });
    const started = steps.some(
      (step) => !(step.state === 'pending' || step.state === 'deferred') || Number(step.movedCount) > 0 || step.batchCount > 0,
    );
    if (!(merge.state === 'running' || merge.state === 'needs_attention') || started) {
      throw conflict(
        ERROR_CODES.RECORD_MERGE_NOT_CANCELLABLE,
        'Records have started moving, so this merge can no longer be cancelled; resume it instead.',
        { mergeId },
      );
    }
    merge.state = 'cancelled';
    merge.cancelledAt = new Date();
    merge.version += 1;
    await em.flush();
    await em.nativeDelete(RecordMergeLock, { mergeId });
    return this.#record(em, mergeId) as Promise<RecordMergeRecord>;
  }

  async resume(em: EntityManager, mergeId: string, expectedVersion: number): Promise<RecordMergeRecord> {
    const merge = await this.#lockMerge(em, mergeId, expectedVersion);
    if (merge.state !== 'needs_attention') {
      throw conflict(ERROR_CODES.RECORD_MERGE_NOT_RESUMABLE, 'Only a merge that needs attention can be resumed.', {
        mergeId,
        state: merge.state,
      });
    }
    merge.state = 'running';
    merge.needsAttentionAt = null;
    merge.lastErrorCode = null;
    merge.version += 1;
    await em.flush();
    await em.nativeUpdate(RecordMergeStep, { mergeId, state: 'failed', trailing: false }, { state: 'pending', attempts: 0 });
    return this.#record(em, mergeId) as Promise<RecordMergeRecord>;
  }

  async setHostContext(em: EntityManager, mergeId: string, patch: Readonly<Record<string, unknown>>): Promise<void> {
    const merge = await em.findOneOrFail(RecordMerge, { id: mergeId });
    merge.hostContext = { ...(merge.hostContext ?? {}), ...patch };
    await em.flush();
  }

  getWithin(em: EntityManager, mergeId: string): Promise<RecordMergeRecord | null> {
    return this.#record(em, mergeId);
  }

  async hostContextWithin(em: EntityManager, mergeId: string): Promise<Readonly<Record<string, unknown>>> {
    const merge = await em.findOne(RecordMerge, { id: mergeId }, { refresh: true });
    return merge?.hostContext ?? {};
  }

  get(mergeId: string): Promise<RecordMergeRecord | null> {
    return this.#record(this.deps.emFactory().fork({ clear: true }), mergeId);
  }

  async list(filter: {
    readonly hostType: RecordMergeHostType;
    readonly state?: RecordMergeState;
    readonly recordId?: string;
  }): Promise<RecordMergeRecord[]> {
    const em = this.deps.emFactory().fork({ clear: true });
    const merges = await em.find(
      RecordMerge,
      {
        hostType: filter.hostType,
        ...(filter.state !== undefined ? { state: filter.state } : {}),
        ...(filter.recordId !== undefined ? { $or: [{ survivorId: filter.recordId }, { loserId: filter.recordId }] } : {}),
      },
      { orderBy: { startedAt: 'desc' }, limit: 200 },
    );
    if (merges.length === 0) return [];
    const steps = await em.find(RecordMergeStep, { mergeId: { $in: merges.map((merge) => merge.id) } });
    return merges.map((merge) => toRecordMergeRecord(merge, steps.filter((step) => step.mergeId === merge.id)));
  }

  async preview(hostType: RecordMergeHostType, survivorId: string, loserId: string): Promise<RecordMergePreview> {
    const host = this.deps.registry.hostOf(hostType);
    if (host === undefined) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `No module hosts merges of ${hostType}.`);
    }
    const own = await host.implementation.preview({ survivorId, loserId });
    const refusals: { code: string; details?: Record<string, unknown> }[] = own.refusals.map((refusal) => ({
      code: refusal.code,
      ...(refusal.details ? { details: { ...refusal.details } } : {}),
    }));
    // A host refusal that says the pair cannot merge at all (same record,
    // unavailable) is the whole answer: participants are not asked about a
    // pair that does not exist as one.
    const terminal = own.refusals.some(
      (refusal) =>
        refusal.code === ERROR_CODES.RECORD_MERGE_SAME_RECORD || refusal.code === ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE,
    );

    const lock = await this.deps
      .emFactory()
      .fork({ clear: true })
      .findOne(RecordMergeLock, { hostType, recordId: { $in: [survivorId, loserId] } });
    if (lock !== null) refusals.push({ code: ERROR_CODES.RECORD_MERGE_ALREADY_RUNNING, details: { mergeId: lock.mergeId } });

    const participants: RecordMergePreview['participants'][number][] = [];
    if (Object.keys(own.counts).length > 0 || own.warnings.length > 0) {
      participants.push({
        moduleId: host.moduleId,
        key: HOST_STRUCTURE_STEP_KEY,
        phase: 'structure',
        counts: { ...own.counts },
        conflicts: [],
        warnings: own.warnings.map((warning) => ({ code: warning.code, ...(warning.details ? { details: { ...warning.details } } : {}) })),
      });
    }
    if (!terminal) {
      for (const participant of this.deps.registry.participantsOf(hostType)) {
        // Principle XVII: a module that is off is neither called nor shown.
        if (!this.deps.isPresent(participant.moduleId)) continue;
        const answer = await participant.participant.preview({ hostType, survivorId, loserId, hostContext: {} });
        participants.push({
          moduleId: participant.moduleId,
          key: participant.key,
          phase: participant.phase,
          counts: { ...answer.counts },
          conflicts: answer.conflicts.map((c) => ({ code: c.code, resolution: c.resolution, ...(c.details ? { details: { ...c.details } } : {}) })),
          warnings: answer.warnings.map((w) => ({ code: w.code, ...(w.details ? { details: { ...w.details } } : {}) })),
        });
        // FR-026 — a conflict the participant cannot resolve by its declared
        // disposition refuses the start, naming the participant and the conflict.
        for (const conflict of answer.conflicts) {
          if (conflict.resolution !== MERGE_CONFLICT_UNRESOLVABLE) continue;
          refusals.push({
            code: ERROR_CODES.RECORD_MERGE_PARTICIPANT_CONFLICT,
            details: { module: participant.moduleId, conflict: conflict.code },
          });
        }
        for (const refusal of answer.refusals) {
          refusals.push({
            code: refusal.code,
            details: { module: participant.moduleId, retryable: refusal.retryable, ...(refusal.details ?? {}) },
          });
        }
      }
    }

    const incomplete = incompleteModules(this.deps.coverage(), this.deps.isPresent).filter((moduleId) =>
      this.#holdsHostReference(moduleId, hostType),
    );
    if (incomplete.length > 0) {
      refusals.push({ code: ERROR_CODES.RECORD_MERGE_PARTICIPATION_INCOMPLETE, details: { modules: incomplete } });
    }

    return {
      refusals,
      fields: own.fields.map((field) => ({ ...field })),
      customFields: own.customFields.map((field) => ({ ...field })),
      participants,
      incomplete,
    };
  }

  async announce(mergeId: string): Promise<void> {
    const merge = await this.deps.emFactory().fork({ clear: true }).findOne(RecordMerge, { id: mergeId });
    if (merge === null) return;
    if (merge.state === 'running' || merge.state === 'needs_attention') {
      mergeFreezeState.freeze(merge.hostType, merge.loserId, merge.id);
    } else if (merge.state === 'completed') {
      mergeFreezeState.archive(merge.hostType, merge.loserId, merge.id, merge.survivorId);
    } else {
      mergeFreezeState.unfreeze(merge.hostType, merge.loserId);
    }
    await this.deps.publishChanged().catch(() => undefined);
    if (merge.state === 'running') await this.deps.enqueue(merge.id);
  }

  isFrozen(hostType: RecordMergeHostType, id: string): boolean {
    return mergeFreezeState.isFrozen(hostType, id);
  }

  archivedInto(hostType: RecordMergeHostType, id: string): string | null {
    return mergeFreezeState.archivedInto(hostType, id);
  }

  /** Does `moduleId`'s uncovered set concern this host? (The twin answers per module, over both hosts.) */
  #holdsHostReference(moduleId: string, hostType: RecordMergeHostType): boolean {
    return this.deps
      .coverage()
      .findings.some((finding) => finding.moduleId === moduleId && finding.host === hostType && finding.kind === 'undeclared-reference');
  }

  async #lockMerge(em: EntityManager, mergeId: string, expectedVersion: number): Promise<RecordMerge> {
    const rows = await em.execute<{ id: string }[]>(`select "id" from "record_merges" where "id" = ? for update`, [mergeId]);
    if (rows.length === 0) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
    const merge = await em.findOneOrFail(RecordMerge, { id: mergeId }, { refresh: true });
    if (merge.version !== expectedVersion) {
      throw conflict(ERROR_CODES.VERSION_CONFLICT, 'This merge changed since it was read; reload it and try again.', {
        currentVersion: merge.version,
      });
    }
    return merge;
  }

  async #record(em: EntityManager, mergeId: string): Promise<RecordMergeRecord | null> {
    const merge = await em.findOne(RecordMerge, { id: mergeId });
    if (merge === null) return null;
    const steps = await em.find(RecordMergeStep, { mergeId });
    return toRecordMergeRecord(merge, steps);
  }
}

/** The frozen and archived sets as the database holds them (boot load, pub/sub refresh, periodic reload). */
export async function loadMergeFreezeSnapshot(em: EntityManager): Promise<MergeFreezeSnapshot> {
  const rows = await em.execute<
    { id: string; host_type: RecordMergeHostType; survivor_id: string; loser_id: string; state: RecordMergeState }[]
  >(
    `select "id", "host_type", "survivor_id", "loser_id", "state" from "record_merges" ` +
      `where "state" in ('running', 'needs_attention', 'completed')`,
  );
  return {
    frozen: rows
      .filter((row) => row.state !== 'completed')
      .map((row) => ({ hostType: row.host_type, id: row.loser_id, mergeId: row.id })),
    archived: rows
      .filter((row) => row.state === 'completed')
      .map((row) => ({ hostType: row.host_type, id: row.loser_id, mergeId: row.id, survivorId: row.survivor_id })),
  };
}
