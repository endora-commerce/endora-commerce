import { AssertionError, deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  recordMergeScopeReason,
  type MergeParticipant,
  type MergeStepInput,
  type RecordMergeHostType,
} from '@endora-commerce/contracts';
import { expectNoAuditValues, type AuditSentinel, type AuditStateCarrier } from '../audit/index.js';

/**
 * The merge-participant conformance helper (`specs/192-organization-merge/`
 * `contracts/merge-participant.md` §3). Every participant's test calls it over
 * its own tables; it holds the participant to the rules the runner relies on:
 *
 *  - the preview's counts equal the rows the step then moves;
 *  - `applyBatch` never moves more than `batchSize`;
 *  - the step ends — a batch moving nothing — with the preview at zero;
 *  - a second full run moves nothing and changes nothing (no duplicate union
 *    rows, no double sum): the participant consumes loser-side state (R-3);
 *  - an injected failure leaves the participant's tables as they were;
 *  - no event is dispatched (R-13);
 *  - every audit entry carries the merge id, and none carries a sentinel
 *    (`specs/conventions/audit-state.md`).
 *
 * That the participant is never called while its module is off is the
 * runner's rule and is proven there (`kernel/merge/runner.test.ts`), not here.
 */
export interface ExpectMergeParticipantOptions<H extends RecordMergeHostType = RecordMergeHostType> {
  readonly participant: MergeParticipant<H>;
  /** Create rows of every declared reference for the pair (on both sides, so unions meet a twin). */
  readonly seed: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<void>;
  /** A deterministic picture of the participant's own rows for the pair, compared across runs. */
  readonly snapshot: (ids: { readonly survivorId: string; readonly loserId: string }) => Promise<unknown>;
  readonly ids?: { readonly survivorId?: string; readonly loserId?: string; readonly mergeId?: string };
  /** Rows per batch; small by default so a seed of a handful of rows takes several batches. */
  readonly batchSize?: number;
  readonly hostContext?: Readonly<Record<string, unknown>>;
  /**
   * Run a participant call inside the merge's scope — in a backend test,
   * `(reason, fn) => withSystemScope(reason, fn)`. Defaults to calling it.
   */
  readonly enterScope?: <T>(reason: string, run: () => Promise<T>) => Promise<T>;
  /** How many events have been dispatched so far (an `EventBus` spy). Must not move. */
  readonly events?: () => number;
  /** The audit entries recorded so far; those written by the step are checked. */
  readonly audit?: { readonly entries: () => readonly AuditStateCarrier[]; readonly sentinels?: readonly AuditSentinel[] };
  /**
   * A failure injected between the survivor write and the loser consume: while
   * armed, the participant's next batch must throw and leave its tables as
   * they were.
   */
  readonly injectFailure?: { readonly arm: () => void; readonly disarm: () => void };
}

function fail(message: string): never {
  throw new AssertionError({ message: `expectMergeParticipant: ${message}` });
}

function total(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export async function expectMergeParticipant<H extends RecordMergeHostType>(
  options: ExpectMergeParticipantOptions<H>,
): Promise<{ readonly moved: number; readonly batches: number }> {
  const survivorId = options.ids?.survivorId ?? randomUUID();
  const loserId = options.ids?.loserId ?? randomUUID();
  const mergeId = options.ids?.mergeId ?? randomUUID();
  const ids = { survivorId, loserId };
  const batchSize = options.batchSize ?? 2;
  const enter = options.enterScope ?? (<T>(_reason: string, run: () => Promise<T>): Promise<T> => run());
  const reason = recordMergeScopeReason(mergeId);
  const { participant } = options;
  const input: MergeStepInput = {
    mergeId,
    hostType: participant.host,
    survivorId,
    loserId,
    hostContext: options.hostContext ?? {},
    batchSize,
  };
  const preview = () =>
    enter(reason, () => participant.preview({ mergeId, hostType: participant.host, survivorId, loserId, hostContext: input.hostContext }));

  await options.seed(ids);
  const eventsBefore = options.events?.() ?? 0;
  const auditBefore = options.audit?.entries().length ?? 0;

  const before = await preview();
  const expected = total(before.counts);
  if (expected === 0) fail('the seed left the preview at zero, so nothing would be proven. Seed rows of every declared reference.');

  if (options.injectFailure) {
    const picture = await options.snapshot(ids);
    options.injectFailure.arm();
    let threw = false;
    try {
      await enter(reason, () => participant.applyBatch(input));
    } catch {
      threw = true;
    } finally {
      options.injectFailure.disarm();
    }
    if (!threw) fail('the armed failure did not make applyBatch throw.');
    try {
      deepStrictEqual(await options.snapshot(ids), picture);
    } catch {
      fail('a batch that failed between the survivor write and the loser consume left a change behind; it must roll back whole.');
    }
  }

  let moved = 0;
  let batches = 0;
  for (let guard = 0; ; guard += 1) {
    if (guard > expected + 50) fail('the step never reached a batch that moves nothing.');
    const result = await enter(reason, () => participant.applyBatch(input));
    if (result.moved > batchSize) fail(`a batch moved ${result.moved} rows when asked for at most ${batchSize}.`);
    if (result.moved <= 0) break;
    moved += result.moved;
    batches += 1;
  }

  const after = await preview();
  if (total(after.counts) !== 0) {
    fail(`the step finished with rows still the loser's: ${JSON.stringify(after.counts)} remain.`);
  }
  if (moved !== expected) {
    fail(`the preview counted ${expected} rows to move and the step moved ${moved}; the preview must count what the step moves.`);
  }

  const first = await options.snapshot(ids);
  const again = await enter(reason, () => participant.applyBatch(input));
  if (again.moved !== 0) fail(`a second run moved ${again.moved} rows; a step must not be repeatable for effect (idempotence).`);
  try {
    deepStrictEqual(await options.snapshot(ids), first);
  } catch {
    fail('a second run changed the participant’s rows (a duplicated union row or a double sum); the step is not idempotent.');
  }

  if (options.events && options.events() !== eventsBefore) {
    fail(`the step dispatched ${options.events() - eventsBefore} event(s); a merge step publishes none (R-13).`);
  }

  if (options.audit) {
    const written = options.audit.entries().slice(auditBefore);
    if (written.length < batches) fail(`${batches} batch(es) wrote ${written.length} audit entr(y/ies); every batch is one audited Command.`);
    for (const entry of written) {
      const state = (entry.stateAfter ?? entry.after) as Record<string, unknown> | null | undefined;
      if (state?.['mergeId'] !== mergeId) fail('an audit entry the step wrote does not carry the merge id as stateAfter.mergeId.');
    }
    if (options.audit.sentinels && options.audit.sentinels.length > 0) expectNoAuditValues(written, options.audit.sentinels);
  }

  return { moved, batches };
}
