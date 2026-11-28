import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  RecordMergeChoice,
  RecordMergeDeferredReason,
  RecordMergeHostType,
  RecordMergeRecord,
  RecordMergeState,
  RecordMergeStepState,
} from '@endora-commerce/contracts';
import type { CommandActor } from '../../commands/command.js';
import { RecordMerge } from './record-merge.entity.js';
import { RecordMergeStep } from './record-merge-step.entity.js';
import { RecordMergeLock } from './record-merge-lock.entity.js';

/**
 * The persisted state of merges, as the runner and the service read and move
 * it (`specs/192-organization-merge/` data-model §1). An interface so the
 * runner's ordering, retry and resume rules are unit-tested over memory; the
 * Postgres implementation below is the only production one.
 */

export interface StoredMerge {
  readonly id: string;
  readonly hostType: RecordMergeHostType;
  readonly survivorId: string;
  readonly loserId: string;
  readonly state: RecordMergeState;
  readonly hostContext: Readonly<Record<string, unknown>>;
  readonly finalizedAt: Date | null;
  readonly version: number;
}

export interface StoredStep {
  readonly mergeId: string;
  readonly moduleId: string;
  readonly participationKey: string;
  readonly phase: string;
  readonly state: RecordMergeStepState;
  readonly trailing: boolean;
  readonly movedCount: number;
  readonly batchCount: number;
  readonly attempts: number;
  readonly deferredReason: RecordMergeDeferredReason | null;
}

export interface NewStep {
  readonly moduleId: string;
  readonly participationKey: string;
  readonly phase: string;
  readonly trailing: boolean;
}

export interface StepRef {
  readonly mergeId: string;
  readonly moduleId: string;
  readonly participationKey: string;
}

export interface RecordMergeStore {
  load(mergeId: string): Promise<{ merge: StoredMerge; steps: StoredStep[] } | null>;
  /** Insert the step rows a merge does not have yet, as `pending`. Existing rows are untouched. */
  ensureSteps(mergeId: string, steps: readonly NewStep[]): Promise<void>;
  /**
   * Mark a step `running`, under a lock on its merge row, only while the merge
   * is in one of `mergeStates`. `false` means the merge moved on (cancelled,
   * needs attention) and the step must not start — which is what makes a
   * cancel and a first batch unable to interleave.
   */
  claimStep(step: StepRef, mergeStates: readonly RecordMergeState[]): Promise<boolean>;
  /** Count one committed batch. Answers the merge's state now, so a sibling's failure stops this step too. */
  recordBatch(step: StepRef, moved: number): Promise<RecordMergeState | null>;
  finishStep(step: StepRef): Promise<void>;
  deferStep(step: StepRef, reason: RecordMergeDeferredReason): Promise<void>;
  /** One failed attempt of the current batch; answers the attempts so far. */
  failAttempt(step: StepRef, error: { code: string; message: string }): Promise<number>;
  /** The step failed for good; for a non-trailing step the merge needs attention. */
  failStep(step: StepRef, error: { code: string; message: string }, stopMerge: boolean): Promise<void>;
  /** Stop the merge in `needs_attention` with a code (the finalize residue). */
  needsAttention(mergeId: string, code: string): Promise<void>;
  markFinalized(mergeId: string): Promise<void>;
  /** `completed`, and the locks released. Idempotent. */
  complete(mergeId: string): Promise<void>;
  /** Merges a catch-up should look at: running ones, and completed ones with a deferred or failed trailing step. */
  catchUpCandidates(): Promise<{ mergeId: string; state: RecordMergeState; moduleIds: string[] }[]>;
}

/** Every column `RecordMergeRecord` serves, from the entities. */
export function toRecordMergeRecord(merge: RecordMerge, steps: readonly RecordMergeStep[]): RecordMergeRecord {
  return {
    id: merge.id,
    hostType: merge.hostType,
    survivorId: merge.survivorId,
    loserId: merge.loserId,
    state: merge.state,
    version: merge.version,
    source: merge.source,
    actorKind: merge.actorKind,
    actorAdminUserId: merge.actorAdminUserId,
    startedAt: merge.startedAt.toISOString(),
    completedAt: merge.completedAt?.toISOString() ?? null,
    cancelledAt: merge.cancelledAt?.toISOString() ?? null,
    needsAttentionAt: merge.needsAttentionAt?.toISOString() ?? null,
    lastErrorCode: merge.lastErrorCode,
    fieldChoices: { ...merge.fieldChoices },
    customFieldChoices: { ...merge.customFieldChoices },
    steps: [...steps]
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.participationKey.localeCompare(b.participationKey))
      .map((step) => ({
        moduleId: step.moduleId,
        key: step.participationKey,
        phase: step.phase,
        state: step.state,
        movedCount: Number(step.movedCount),
        deferredReason: step.deferredReason,
        lastErrorCode: step.lastErrorCode,
        trailing: step.trailing,
      })),
  };
}

const where = (step: StepRef): { mergeId: string; moduleId: string; participationKey: string } => ({
  mergeId: step.mergeId,
  moduleId: step.moduleId,
  participationKey: step.participationKey,
});

function stored(merge: RecordMerge): StoredMerge {
  return {
    id: merge.id,
    hostType: merge.hostType,
    survivorId: merge.survivorId,
    loserId: merge.loserId,
    state: merge.state,
    hostContext: merge.hostContext ?? {},
    finalizedAt: merge.finalizedAt ?? null,
    version: merge.version,
  };
}

function storedStep(step: RecordMergeStep): StoredStep {
  return {
    mergeId: step.mergeId,
    moduleId: step.moduleId,
    participationKey: step.participationKey,
    phase: step.phase,
    state: step.state,
    trailing: step.trailing,
    movedCount: Number(step.movedCount),
    batchCount: step.batchCount,
    attempts: step.attempts,
    deferredReason: step.deferredReason,
  };
}

/**
 * The Postgres store. Every method opens its own short transaction on a fork:
 * the runner's bookkeeping is never part of a participant's Command, so a
 * participant's batch and the count of it are two commits — which is why a
 * batch must consume loser-side state (R-3), not trust the count.
 */
export class PostgresRecordMergeStore implements RecordMergeStore {
  constructor(private readonly emFactory: () => EntityManager) {}

  #fork(): EntityManager {
    return this.emFactory().fork({ clear: true });
  }

  async load(mergeId: string): Promise<{ merge: StoredMerge; steps: StoredStep[] } | null> {
    const em = this.#fork();
    const merge = await em.findOne(RecordMerge, { id: mergeId });
    if (merge === null) return null;
    const steps = await em.find(RecordMergeStep, { mergeId });
    return { merge: stored(merge), steps: steps.map(storedStep) };
  }

  async ensureSteps(mergeId: string, steps: readonly NewStep[]): Promise<void> {
    if (steps.length === 0) return;
    const em = this.#fork();
    const values = steps.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = steps.flatMap((step) => [mergeId, step.moduleId, step.participationKey, step.phase, step.trailing]);
    await em.execute(
      `insert into "record_merge_steps" ("merge_id", "module_id", "participation_key", "phase", "trailing") ` +
        `values ${values} on conflict do nothing`,
      params,
    );
  }

  async claimStep(step: StepRef, mergeStates: readonly RecordMergeState[]): Promise<boolean> {
    return this.#fork().transactional(async (em) => {
      const rows = await em.execute<{ state: RecordMergeState }[]>(
        `select "state" from "record_merges" where "id" = ? for update`,
        [step.mergeId],
      );
      const state = rows[0]?.state;
      if (state === undefined || !mergeStates.includes(state)) return false;
      await em.nativeUpdate(RecordMergeStep, where(step), {
        state: 'running',
        deferredReason: null,
        startedAt: new Date(),
      });
      return true;
    });
  }

  async recordBatch(step: StepRef, moved: number): Promise<RecordMergeState | null> {
    const em = this.#fork();
    await em.execute(
      `update "record_merge_steps" set "moved_count" = "moved_count" + ?, "batch_count" = "batch_count" + 1, ` +
        `"attempts" = 0 where "merge_id" = ? and "module_id" = ? and "participation_key" = ?`,
      [moved, step.mergeId, step.moduleId, step.participationKey],
    );
    const rows = await em.execute<{ state: RecordMergeState }[]>(`select "state" from "record_merges" where "id" = ?`, [
      step.mergeId,
    ]);
    return rows[0]?.state ?? null;
  }

  async finishStep(step: StepRef): Promise<void> {
    await this.#fork().nativeUpdate(RecordMergeStep, where(step), {
      state: 'done',
      attempts: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: new Date(),
    });
  }

  async deferStep(step: StepRef, reason: RecordMergeDeferredReason): Promise<void> {
    await this.#fork().nativeUpdate(RecordMergeStep, where(step), { state: 'deferred', deferredReason: reason });
  }

  async failAttempt(step: StepRef, error: { code: string; message: string }): Promise<number> {
    const rows = await this.#fork().execute<{ attempts: number }[]>(
      `update "record_merge_steps" set "attempts" = "attempts" + 1, "last_error_code" = ?, "last_error_message" = ? ` +
        `where "merge_id" = ? and "module_id" = ? and "participation_key" = ? returning "attempts"`,
      [error.code, error.message, step.mergeId, step.moduleId, step.participationKey],
    );
    return Number(rows[0]?.attempts ?? 0);
  }

  async failStep(step: StepRef, error: { code: string; message: string }, stopMerge: boolean): Promise<void> {
    await this.#fork().transactional(async (em) => {
      await em.nativeUpdate(RecordMergeStep, where(step), {
        state: 'failed',
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      });
      if (stopMerge) {
        await em.nativeUpdate(
          RecordMerge,
          { id: step.mergeId, state: 'running' },
          { state: 'needs_attention', needsAttentionAt: new Date(), lastErrorCode: error.code },
        );
        await em.execute(`update "record_merges" set "version" = "version" + 1 where "id" = ?`, [step.mergeId]);
      }
    });
  }

  async needsAttention(mergeId: string, code: string): Promise<void> {
    await this.#fork().execute(
      `update "record_merges" set "state" = 'needs_attention', "needs_attention_at" = now(), "last_error_code" = ?, ` +
        `"version" = "version" + 1 where "id" = ? and "state" = 'running'`,
      [code, mergeId],
    );
  }

  async markFinalized(mergeId: string): Promise<void> {
    await this.#fork().nativeUpdate(RecordMerge, { id: mergeId }, { finalizedAt: new Date() });
  }

  async complete(mergeId: string): Promise<void> {
    await this.#fork().transactional(async (em) => {
      await em.execute(
        `update "record_merges" set "state" = 'completed', "completed_at" = coalesce("completed_at", now()), ` +
          `"last_error_code" = null, "version" = "version" + 1 where "id" = ? and "state" = 'running'`,
        [mergeId],
      );
      await em.nativeDelete(RecordMergeLock, { mergeId });
    });
  }

  async catchUpCandidates(): Promise<{ mergeId: string; state: RecordMergeState; moduleIds: string[] }[]> {
    const rows = await this.#fork().execute<{ merge_id: string; state: RecordMergeState; module_ids: string[] | null }[]>(
      `select m."id" as "merge_id", m."state", ` +
        `array_remove(array_agg(distinct s."module_id") filter (where s."state" in ('deferred', 'failed') ` +
        `or (m."state" = 'completed' and s."trailing" and s."state" <> 'done')), null) as "module_ids" ` +
        `from "record_merges" m left join "record_merge_steps" s on s."merge_id" = m."id" ` +
        `where m."state" = 'running' or (m."state" = 'completed' and exists (select 1 from "record_merge_steps" x ` +
        `where x."merge_id" = m."id" and (x."state" in ('deferred', 'failed') or (x."trailing" and x."state" <> 'done')))) ` +
        `group by m."id", m."state"`,
    );
    return rows.map((row) => ({ mergeId: row.merge_id, state: row.state, moduleIds: row.module_ids ?? [] }));
  }
}

/** The insert half of a start, inside the host's start Command (its `em`, its transaction). */
export interface BeginMergeRows {
  readonly hostType: RecordMergeHostType;
  readonly survivorId: string;
  readonly loserId: string;
  readonly fieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly hostContext: Readonly<Record<string, unknown>>;
  readonly actor: CommandActor;
  readonly source: string | null;
  readonly steps: readonly NewStep[];
}
