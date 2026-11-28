import {
  ERROR_CODES,
  RECORD_MERGE_FINALIZE_PHASE,
  recordMergeScopeReason,
  type MergeStepInput,
  type RecordMergeHostType,
  type RecordMergeState,
} from '@endora-commerce/contracts';
import type { PlatformLogger } from '../logging.js';
import { HOST_STRUCTURE_STEP_KEY, type ComposedMergeHost, type RecordMergeRegistry } from './registry.js';
import type { RecordMergeStore, StepRef, StoredMerge, StoredStep } from './store.js';

/**
 * The merge runner (`specs/192-organization-merge/` research R-2, R-10, R-11,
 * R-16; `contracts/merge-mechanism.md` §3). One call runs one merge as far as
 * it can go, and is safe to call again at any point: every step is idempotent
 * (R-3), finished steps are skipped, and the host's finalize runs once.
 *
 *  - **running** — the host's phases in order; inside a phase the steps run
 *    with bounded parallelism; a step whose module is off is `deferred`; a
 *    failed batch is retried with backoff and then stops the merge in
 *    `needs_attention`; finalize re-counts every present participant first and
 *    re-runs any with residue (three sweeps, then `RECORD_MERGE_RESIDUE`); then
 *    the host's finalize, completion, and the trailing steps.
 *  - **completed** — the catch-up: deferred steps whose module is present again
 *    and trailing steps that did not finish run under the original merge id.
 *  - anything else — nothing.
 */

export interface RecordMergeChangedEvent {
  readonly mergeId: string;
  readonly hostType: RecordMergeHostType;
  readonly survivorId: string;
  readonly loserId: string;
  readonly state: RecordMergeState;
}

export interface RecordMergeRunnerDeps {
  readonly store: RecordMergeStore;
  readonly registry: RecordMergeRegistry;
  /** The live effective state, asked per step. */
  readonly isPresent: (moduleId: string) => boolean;
  /** Enter the merge's own system scope (`record-merge:<mergeId>`) around a participant call. */
  readonly enterScope: <T>(reason: string, run: () => Promise<T>) => Promise<T>;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Attempts of one batch before the step fails (default 5). */
  readonly maxAttempts?: number;
  /** Backoff base in ms, doubled per attempt (default 2000). */
  readonly backoffBaseMs?: number;
  /** Rows per batch when the participation declares none (default 500). */
  readonly defaultBatchSize?: number;
  /** Steps run at once inside a phase (default 4). */
  readonly parallelism?: number;
  /** Finalize residue sweeps before `needs_attention` (default 3). */
  readonly residueSweeps?: number;
  /** A merge changed state: refresh the freeze sets, announce, notify. */
  readonly onChanged: (event: RecordMergeChangedEvent) => Promise<void>;
  readonly log: Pick<PlatformLogger, 'info' | 'warn' | 'error'>;
}

type StepOutcome = 'done' | 'deferred' | 'stopped';

export type RecordMergeRunOutcome = 'missing' | 'idle' | 'host-absent' | 'stopped' | 'completed' | 'caught-up';

/** A participant or host failure, as the step records it: a code and a class, never a value. */
export function redactMergeError(error: unknown): { code: string; message: string } {
  const code =
    error !== null && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? ((error as { code: string }).code)
      : error instanceof Error
        ? error.name
        : 'UNKNOWN';
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return { code, message: `${name}: ${code}` };
}

async function inParallel<T>(items: readonly T[], limit: number, run: (item: T) => Promise<StepOutcome>): Promise<StepOutcome[]> {
  const results: StepOutcome[] = new Array<StepOutcome>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runRecordMerge(mergeId: string, deps: RecordMergeRunnerDeps): Promise<RecordMergeRunOutcome> {
  const loaded = await deps.store.load(mergeId);
  if (loaded === null) return 'missing';
  const host = deps.registry.hostOf(loaded.merge.hostType);
  if (host === undefined || !deps.isPresent(host.moduleId)) return 'host-absent';
  if (loaded.merge.state === 'running') return runFull(loaded.merge, host, deps);
  if (loaded.merge.state === 'completed') return catchUp(loaded.merge, loaded.steps, host, deps);
  return 'idle';
}

/** Every step a merge of this host should have, from what is composed now. */
function expectedSteps(host: ComposedMergeHost, deps: RecordMergeRunnerDeps) {
  return [
    { moduleId: host.moduleId, participationKey: HOST_STRUCTURE_STEP_KEY, phase: 'structure', trailing: false },
    ...deps.registry.participantsOf(host.type).map((participant) => ({
      moduleId: participant.moduleId,
      participationKey: participant.key,
      phase: participant.phase,
      trailing: participant.trailing,
    })),
  ];
}

function stepInput(merge: StoredMerge, batchSize: number): MergeStepInput {
  return {
    mergeId: merge.id,
    hostType: merge.hostType,
    survivorId: merge.survivorId,
    loserId: merge.loserId,
    hostContext: merge.hostContext,
    batchSize,
  };
}

async function runFull(initial: StoredMerge, host: ComposedMergeHost, deps: RecordMergeRunnerDeps): Promise<RecordMergeRunOutcome> {
  await deps.store.ensureSteps(initial.id, expectedSteps(host, deps));

  for (const phase of host.phases) {
    if (phase === RECORD_MERGE_FINALIZE_PHASE) break;
    // Reloaded per phase: the host's structure phase writes the host context
    // the later phases' participants read (the Organization role map).
    const current = await deps.store.load(initial.id);
    if (current === null || current.merge.state !== 'running') return 'stopped';
    const steps = current.steps.filter((step) => step.phase === phase && !step.trailing && step.state !== 'done');
    const outcomes = await inParallel(steps, deps.parallelism ?? 4, (step) =>
      runStep(current.merge, step, host, deps, ['running']),
    );
    if (outcomes.includes('stopped')) return 'stopped';
  }

  const merge = (await deps.store.load(initial.id))?.merge;
  if (merge === undefined || merge.state !== 'running') return 'stopped';

  if (merge.finalizedAt == null) {
    const clean = await sweepResidue(merge, host, deps);
    if (clean === 'stopped') return 'stopped';
    if (!clean) {
      await deps.store.needsAttention(merge.id, ERROR_CODES.RECORD_MERGE_RESIDUE);
      await announce(merge, 'needs_attention', deps);
      deps.log.warn({ mergeId: merge.id }, 'record-merge: residue remained after the finalize sweeps');
      return 'stopped';
    }
    try {
      await deps.enterScope(recordMergeScopeReason(merge.id), () =>
        host.implementation.finalize(stepInput(merge, deps.defaultBatchSize ?? 500)),
      );
    } catch (error) {
      const redacted = redactMergeError(error);
      await deps.store.needsAttention(merge.id, redacted.code);
      await announce(merge, 'needs_attention', deps);
      deps.log.warn({ mergeId: merge.id, code: redacted.code }, 'record-merge: the host finalize failed');
      return 'stopped';
    }
    await deps.store.markFinalized(merge.id);
  }
  await deps.store.complete(merge.id);
  await announce(merge, 'completed', deps);
  deps.log.info({ mergeId: merge.id, hostType: merge.hostType }, 'record-merge: completed');

  const reloaded = await deps.store.load(merge.id);
  if (reloaded !== null) await runTrailing(reloaded.merge, reloaded.steps, host, deps);
  return 'completed';
}

/**
 * Finalize's re-count (R-6): every present, non-trailing participant's preview
 * must answer zero. One with residue has its step re-run; after the sweeps a
 * remainder answers `false`.
 */
async function sweepResidue(
  merge: StoredMerge,
  host: ComposedMergeHost,
  deps: RecordMergeRunnerDeps,
): Promise<boolean | 'stopped'> {
  const sweeps = deps.residueSweeps ?? 3;
  for (let sweep = 0; sweep <= sweeps; sweep += 1) {
    const residue: StoredStep[] = [];
    const steps = (await deps.store.load(merge.id))?.steps ?? [];
    for (const participant of deps.registry.participantsOf(host.type)) {
      if (participant.trailing || !deps.isPresent(participant.moduleId)) continue;
      const preview = await deps.enterScope(recordMergeScopeReason(merge.id), () =>
        participant.participant.preview({
          mergeId: merge.id,
          hostType: merge.hostType,
          survivorId: merge.survivorId,
          loserId: merge.loserId,
          hostContext: merge.hostContext,
        }),
      );
      const remaining = Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
      if (remaining === 0) continue;
      const step = steps.find((row) => row.moduleId === participant.moduleId && row.participationKey === participant.key);
      if (step !== undefined) residue.push(step);
    }
    if (residue.length === 0) return true;
    if (sweep === sweeps) return false;
    for (const step of residue) {
      const outcome = await runStep(merge, step, host, deps, ['running']);
      if (outcome === 'stopped') return 'stopped';
    }
  }
  return false;
}

async function catchUp(
  merge: StoredMerge,
  steps: readonly StoredStep[],
  host: ComposedMergeHost,
  deps: RecordMergeRunnerDeps,
): Promise<RecordMergeRunOutcome> {
  // A deferred step whose module is back, and a caught-up step that failed last time.
  const deferred = steps.filter(
    (step) => (step.state === 'deferred' || step.state === 'failed') && !step.trailing && deps.isPresent(step.moduleId),
  );
  await inParallel(deferred, deps.parallelism ?? 4, (step) => runStep(merge, step, host, deps, ['completed'], false));
  await runTrailing(merge, steps, host, deps);
  return 'caught-up';
}

async function runTrailing(
  merge: StoredMerge,
  steps: readonly StoredStep[],
  host: ComposedMergeHost,
  deps: RecordMergeRunnerDeps,
): Promise<void> {
  const trailing = steps.filter((step) => step.trailing && step.state !== 'done');
  await inParallel(trailing, deps.parallelism ?? 4, (step) => runStep(merge, step, host, deps, ['completed'], false));
}

/**
 * One step to its end: claimed, then batches until one moves nothing. A step
 * of a merge that is no longer in `mergeStates` is not started. With
 * `stopMergeOnFailure` (every step before completion) exhausted retries stop
 * the merge; a trailing or caught-up step only fails itself and is retried by
 * the next catch-up.
 */
async function runStep(
  merge: StoredMerge,
  step: StoredStep,
  host: ComposedMergeHost,
  deps: RecordMergeRunnerDeps,
  mergeStates: readonly RecordMergeState[],
  stopMergeOnFailure = true,
): Promise<StepOutcome> {
  const ref: StepRef = { mergeId: merge.id, moduleId: step.moduleId, participationKey: step.participationKey };
  if (!deps.isPresent(step.moduleId)) {
    await deps.store.deferStep(ref, 'module_off');
    return 'deferred';
  }
  const isHostStep = step.moduleId === host.moduleId && step.participationKey === HOST_STRUCTURE_STEP_KEY;
  const participant = isHostStep
    ? undefined
    : deps.registry
        .participantsOf(host.type)
        .find((candidate) => candidate.moduleId === step.moduleId && candidate.key === step.participationKey);
  if (!isHostStep && participant === undefined) {
    // Composed no longer: the module is not in this deployment (hard-uninstalled
    // or platform-unavailable). It runs again if it comes back (R-10).
    await deps.store.deferStep(ref, 'module_unavailable');
    return 'deferred';
  }
  if (!(await deps.store.claimStep(ref, mergeStates))) return 'stopped';

  const batchSize = participant?.batchSize ?? deps.defaultBatchSize ?? 500;
  const maxAttempts = deps.maxAttempts ?? 5;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const backoff = deps.backoffBaseMs ?? 2000;
  for (;;) {
    let moved: number;
    try {
      const input = stepInput(merge, batchSize);
      const result = await deps.enterScope(recordMergeScopeReason(merge.id), () =>
        isHostStep ? host.implementation.applyStructureBatch(input) : participant!.participant.applyBatch(input),
      );
      moved = result.moved;
    } catch (error) {
      const redacted = redactMergeError(error);
      const attempts = await deps.store.failAttempt(ref, redacted);
      deps.log.warn(
        { mergeId: merge.id, moduleId: step.moduleId, key: step.participationKey, attempts, code: redacted.code },
        'record-merge: a batch failed',
      );
      if (attempts >= maxAttempts) {
        await deps.store.failStep(ref, redacted, stopMergeOnFailure && !step.trailing);
        if (stopMergeOnFailure && !step.trailing) await announce(merge, 'needs_attention', deps);
        return 'stopped';
      }
      await sleep(backoff * 2 ** (attempts - 1));
      continue;
    }
    if (moved > batchSize) {
      // A participant that moved more than it was asked to broke the lock bound
      // (FR-010); recorded, never trusted silently.
      deps.log.warn({ mergeId: merge.id, moduleId: step.moduleId, moved, batchSize }, 'record-merge: a batch exceeded its size');
    }
    if (moved <= 0) {
      await deps.store.finishStep(ref);
      return 'done';
    }
    const state = await deps.store.recordBatch(ref, moved);
    if (state === null || !mergeStates.includes(state)) return 'stopped';
  }
}

async function announce(merge: StoredMerge, state: RecordMergeState, deps: RecordMergeRunnerDeps): Promise<void> {
  try {
    await deps.onChanged({
      mergeId: merge.id,
      hostType: merge.hostType,
      survivorId: merge.survivorId,
      loserId: merge.loserId,
      state,
    });
  } catch (error) {
    // The state is committed; a lost announcement is caught by the reload.
    deps.log.warn({ mergeId: merge.id, error: redactMergeError(error).code }, 'record-merge: announcing a state change failed');
  }
  // The host's own seam (`contracts/events-and-webhooks.md` §3): whom to tell
  // is the host's question, and the platform names no module that answers it.
  const host = deps.registry.hostOf(merge.hostType);
  if (host?.implementation.onStateChanged === undefined) return;
  try {
    await host.implementation.onStateChanged({
      mergeId: merge.id,
      hostType: merge.hostType,
      survivorId: merge.survivorId,
      loserId: merge.loserId,
      state,
    });
  } catch (error) {
    deps.log.warn({ mergeId: merge.id, error: redactMergeError(error).code }, 'record-merge: the host could not be told of a state change');
  }
}
