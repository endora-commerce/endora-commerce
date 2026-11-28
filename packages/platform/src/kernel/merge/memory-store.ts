import type { RecordMergeDeferredReason, RecordMergeHostType, RecordMergeState } from '@endora-commerce/contracts';
import type { NewStep, RecordMergeStore, StepRef, StoredMerge, StoredStep } from './store.js';

/**
 * An in-memory {@link RecordMergeStore}, for the runner's own tests and for a
 * module's merge-participant tests that drive the runner without a database.
 * It keeps the same rules as the Postgres store — a step is claimed only while
 * its merge is in a listed state, a batch reports the merge's state back — and
 * nothing else.
 */
export class MemoryRecordMergeStore implements RecordMergeStore {
  readonly #merges = new Map<string, StoredMerge & { lastErrorCode: string | null; locks: boolean }>();
  readonly #steps = new Map<string, StoredStep>();

  #key(ref: StepRef): string {
    return `${ref.mergeId}/${ref.moduleId}/${ref.participationKey}`;
  }

  seedMerge(input: { id: string; hostType: RecordMergeHostType; survivorId: string; loserId: string }): void {
    this.#merges.set(input.id, {
      ...input,
      state: 'running',
      hostContext: {},
      finalizedAt: null,
      version: 1,
      lastErrorCode: null,
      locks: true,
    });
  }

  setHostContext(mergeId: string, hostContext: Record<string, unknown>): void {
    const merge = this.#merges.get(mergeId)!;
    this.#merges.set(mergeId, { ...merge, hostContext });
  }

  lastErrorCode(mergeId: string): string | null {
    return this.#merges.get(mergeId)?.lastErrorCode ?? null;
  }

  locksReleased(mergeId: string): boolean {
    return this.#merges.get(mergeId)?.locks === false;
  }

  /** What `recordMergeService.resume` does to the rows. */
  resume(mergeId: string): void {
    const merge = this.#merges.get(mergeId)!;
    this.#merges.set(mergeId, { ...merge, state: 'running', version: merge.version + 1 });
    for (const [key, step] of this.#steps) {
      if (step.mergeId === mergeId && step.state === 'failed') this.#steps.set(key, { ...step, state: 'pending', attempts: 0 });
    }
  }

  cancel(mergeId: string): void {
    this.#setState(mergeId, 'cancelled');
  }

  #setState(mergeId: string, state: RecordMergeState, lastErrorCode?: string): void {
    const merge = this.#merges.get(mergeId);
    if (!merge) return;
    this.#merges.set(mergeId, {
      ...merge,
      state,
      version: merge.version + 1,
      ...(lastErrorCode !== undefined ? { lastErrorCode } : {}),
    });
  }

  #patch(ref: StepRef, patch: Partial<StoredStep>): void {
    const step = this.#steps.get(this.#key(ref));
    if (step) this.#steps.set(this.#key(ref), { ...step, ...patch });
  }

  async load(mergeId: string): Promise<{ merge: StoredMerge; steps: StoredStep[] } | null> {
    const merge = this.#merges.get(mergeId);
    if (!merge) return null;
    return { merge: { ...merge }, steps: [...this.#steps.values()].filter((step) => step.mergeId === mergeId) };
  }

  async ensureSteps(mergeId: string, steps: readonly NewStep[]): Promise<void> {
    for (const step of steps) {
      const ref = { mergeId, moduleId: step.moduleId, participationKey: step.participationKey };
      if (this.#steps.has(this.#key(ref))) continue;
      this.#steps.set(this.#key(ref), {
        ...ref,
        phase: step.phase,
        trailing: step.trailing,
        state: 'pending',
        movedCount: 0,
        batchCount: 0,
        attempts: 0,
        deferredReason: null,
      });
    }
  }

  async claimStep(ref: StepRef, mergeStates: readonly RecordMergeState[]): Promise<boolean> {
    const merge = this.#merges.get(ref.mergeId);
    if (!merge || !mergeStates.includes(merge.state)) return false;
    this.#patch(ref, { state: 'running', deferredReason: null });
    return true;
  }

  async recordBatch(ref: StepRef, moved: number): Promise<RecordMergeState | null> {
    const step = this.#steps.get(this.#key(ref));
    if (step) this.#patch(ref, { movedCount: step.movedCount + moved, batchCount: step.batchCount + 1, attempts: 0 });
    return this.#merges.get(ref.mergeId)?.state ?? null;
  }

  async finishStep(ref: StepRef): Promise<void> {
    this.#patch(ref, { state: 'done', attempts: 0 });
  }

  async deferStep(ref: StepRef, reason: RecordMergeDeferredReason): Promise<void> {
    this.#patch(ref, { state: 'deferred', deferredReason: reason });
  }

  async failAttempt(ref: StepRef): Promise<number> {
    const step = this.#steps.get(this.#key(ref));
    const attempts = (step?.attempts ?? 0) + 1;
    this.#patch(ref, { attempts });
    return attempts;
  }

  async failStep(ref: StepRef, error: { code: string }, stopMerge: boolean): Promise<void> {
    this.#patch(ref, { state: 'failed' });
    if (stopMerge && this.#merges.get(ref.mergeId)?.state === 'running') {
      this.#setState(ref.mergeId, 'needs_attention', error.code);
    }
  }

  async needsAttention(mergeId: string, code: string): Promise<void> {
    if (this.#merges.get(mergeId)?.state === 'running') this.#setState(mergeId, 'needs_attention', code);
  }

  async markFinalized(mergeId: string): Promise<void> {
    const merge = this.#merges.get(mergeId)!;
    this.#merges.set(mergeId, { ...merge, finalizedAt: new Date() });
  }

  async complete(mergeId: string): Promise<void> {
    const merge = this.#merges.get(mergeId)!;
    if (merge.state === 'running') this.#merges.set(mergeId, { ...merge, state: 'completed', locks: false, version: merge.version + 1 });
  }

  async catchUpCandidates(): Promise<{ mergeId: string; state: RecordMergeState; moduleIds: string[] }[]> {
    const out: { mergeId: string; state: RecordMergeState; moduleIds: string[] }[] = [];
    for (const merge of this.#merges.values()) {
      const pending = [...this.#steps.values()].filter(
        (step) =>
          step.mergeId === merge.id &&
          (step.state === 'deferred' || step.state === 'failed' || (step.trailing && step.state !== 'done')),
      );
      if (merge.state === 'running' || (merge.state === 'completed' && pending.length > 0)) {
        out.push({ mergeId: merge.id, state: merge.state, moduleIds: [...new Set(pending.map((step) => step.moduleId))] });
      }
    }
    return out;
  }
}
