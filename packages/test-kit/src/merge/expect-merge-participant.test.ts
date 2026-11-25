import { describe, expect, it } from 'vitest';
import type { MergeParticipant, MergeStepInput } from '@endora-commerce/contracts';
import { expectMergeParticipant } from './expect-merge-participant.js';

/**
 * `specs/192-organization-merge/` T018 — the conformance helper's own proof.
 * A well-behaved participant passes; a non-idempotent union, an over-sized
 * batch, a dispatched event, a missing merge id in the audit, and a preview
 * that disagrees with what moved each fail with a message naming the rule.
 */

const SURVIVOR = '00000000-0000-4000-8000-0000000000d1';
const LOSER = '00000000-0000-4000-8000-0000000000d2';

interface Row {
  id: number;
  organizationId: string;
}

/** A table of rows and a union table, held in memory. */
function world() {
  const rows: Row[] = [];
  const members: Row[] = [];
  const audit: { stateAfter: Record<string, unknown> }[] = [];
  let events = 0;
  return {
    rows,
    members,
    audit,
    events: () => events,
    emit: () => {
      events += 1;
    },
    seed: async ({ survivorId, loserId }: { survivorId: string; loserId: string }) => {
      for (let i = 0; i < 5; i += 1) rows.push({ id: i, organizationId: loserId });
      rows.push({ id: 99, organizationId: survivorId });
      members.push({ id: 1, organizationId: loserId }, { id: 1, organizationId: survivorId }, { id: 2, organizationId: loserId });
    },
    snapshot: async () => ({
      rows: rows.map((row) => `${row.id}:${row.organizationId}`).sort(),
      members: members.map((row) => `${row.id}:${row.organizationId}`).sort(),
    }),
  };
}

type World = ReturnType<typeof world>;

function goodParticipant(w: World, overrides: Partial<{ oversize: boolean; duplicateUnion: boolean; event: boolean; noMergeId: boolean; previewLies: boolean }> = {}): MergeParticipant<'organization'> {
  return {
    host: 'organization',
    preview: async ({ loserId }) => ({
      counts: {
        'Row.organizationId': w.rows.filter((row) => row.organizationId === loserId).length + (overrides.previewLies ? 1 : 0),
        'Member.organizationId': w.members.filter((row) => row.organizationId === loserId).length,
      },
      conflicts: [],
      warnings: [],
      refusals: [],
    }),
    applyBatch: async (input: MergeStepInput) => {
      const limit = overrides.oversize ? input.batchSize + 1 : input.batchSize;
      const ids: number[] = [];
      for (const row of w.rows) {
        if (ids.length >= limit) break;
        if (row.organizationId === input.loserId) {
          row.organizationId = input.survivorId;
          ids.push(row.id);
        }
      }
      for (const member of [...w.members]) {
        if (ids.length >= limit) break;
        if (member.organizationId !== input.loserId) continue;
        const twin = w.members.some((m) => m.id === member.id && m.organizationId === input.survivorId);
        if (!twin) w.members.push({ id: member.id, organizationId: input.survivorId });
        if (!overrides.duplicateUnion) w.members.splice(w.members.indexOf(member), 1);
        else member.organizationId = `${input.survivorId}`; // re-run will push again
        ids.push(member.id);
        if (overrides.duplicateUnion) w.members.push({ id: member.id, organizationId: input.loserId });
      }
      if (ids.length > 0) {
        w.audit.push({ stateAfter: { ...(overrides.noMergeId ? {} : { mergeId: input.mergeId }), loserId: input.loserId, moved: ids.length, ids } });
        if (overrides.event) w.emit();
      }
      return { moved: ids.length };
    },
  };
}

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the helper to fail');
}

describe('expectMergeParticipant', () => {
  it('passes a participant that consumes loser-side state in bounded batches', async () => {
    const w = world();
    const result = await expectMergeParticipant({
      participant: goodParticipant(w),
      seed: w.seed,
      snapshot: w.snapshot,
      ids: { survivorId: SURVIVOR, loserId: LOSER },
      batchSize: 2,
      events: w.events,
      audit: { entries: () => w.audit },
    });
    expect(result.moved).toBe(7);
    expect(result.batches).toBeGreaterThan(2);
    expect(w.rows.filter((row) => row.organizationId === LOSER)).toEqual([]);
  });

  it('fails a batch larger than it was asked for', async () => {
    const w = world();
    const message = await failureOf(() =>
      expectMergeParticipant({ participant: goodParticipant(w, { oversize: true }), seed: w.seed, snapshot: w.snapshot, ids: { survivorId: SURVIVOR, loserId: LOSER }, batchSize: 2 }),
    );
    expect(message).toMatch(/batch/i);
  });

  it('fails a union that is not idempotent', async () => {
    const w = world();
    const message = await failureOf(() =>
      expectMergeParticipant({ participant: goodParticipant(w, { duplicateUnion: true }), seed: w.seed, snapshot: w.snapshot, ids: { survivorId: SURVIVOR, loserId: LOSER }, batchSize: 2 }),
    );
    // A union that never consumes the loser's row never reaches a batch that moves nothing.
    expect(message).toMatch(/never reached|idempot/i);
  });

  it('fails a participant that dispatches an event', async () => {
    const w = world();
    const message = await failureOf(() =>
      expectMergeParticipant({ participant: goodParticipant(w, { event: true }), seed: w.seed, snapshot: w.snapshot, ids: { survivorId: SURVIVOR, loserId: LOSER }, batchSize: 2, events: w.events }),
    );
    expect(message).toMatch(/event/i);
  });

  it('fails an audit entry without the merge id', async () => {
    const w = world();
    const message = await failureOf(() =>
      expectMergeParticipant({
        participant: goodParticipant(w, { noMergeId: true }),
        seed: w.seed,
        snapshot: w.snapshot,
        ids: { survivorId: SURVIVOR, loserId: LOSER },
        batchSize: 2,
        audit: { entries: () => w.audit },
      }),
    );
    expect(message).toMatch(/mergeId/);
  });

  it('fails a preview whose counts disagree with what moved', async () => {
    const w = world();
    const message = await failureOf(() =>
      expectMergeParticipant({ participant: goodParticipant(w, { previewLies: true }), seed: w.seed, snapshot: w.snapshot, ids: { survivorId: SURVIVOR, loserId: LOSER }, batchSize: 2 }),
    );
    expect(message).toMatch(/preview|still the loser/i);
  });
});
