import { describe, expect, it, vi } from 'vitest';
import type {
  MergeHostImplementation,
  MergeParticipant,
  MergeStepInput,
  ModuleManifest,
  RecordMergeState,
} from '@endora-commerce/contracts';
import { mergeDeclarationsFrom } from './declarations.js';
import { RecordMergeRegistry } from './registry.js';
import { runRecordMerge, type RecordMergeRunnerDeps } from './runner.js';
import { MemoryRecordMergeStore } from './memory-store.js';

/**
 * `specs/192-organization-merge/` T014 (R-2, R-10, R-11, R-16,
 * `contracts/merge-mechanism.md` §3) — the runner over memory: phase order,
 * parallelism inside a phase, retry then `needs_attention`, resume without
 * repeating finished steps, the finalize residue sweep, trailing steps, and
 * deferral of a participant whose module is off.
 */

const SURVIVOR = '00000000-0000-4000-8000-00000000a001';
const LOSER = '00000000-0000-4000-8000-00000000a002';
const MERGE = '00000000-0000-4000-8000-00000000a003';

function manifest(id: string, merge: ModuleManifest['merge']): ModuleManifest {
  return { id, name: id, description: id, version: '1.0.0', dependencies: [], merge } as unknown as ModuleManifest;
}

/** A participant over a counter of "loser rows": each batch moves up to batchSize of them. */
function counterParticipant(
  log: string[],
  name: string,
  rows: { left: number },
  options: { failTimes?: number; onBatch?: () => Promise<void> } = {},
): MergeParticipant<'organization'> {
  let failures = options.failTimes ?? 0;
  return {
    host: 'organization',
    preview: async () => ({ counts: { [`${name}.organizationId`]: rows.left }, conflicts: [], warnings: [], refusals: [] }),
    applyBatch: async (input: MergeStepInput) => {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('db timeout'), { code: 'DB_TIMEOUT' });
      }
      await options.onBatch?.();
      const moved = Math.min(rows.left, input.batchSize);
      rows.left -= moved;
      log.push(`${name}:${moved}`);
      return { moved };
    },
  };
}

interface Harness {
  store: MemoryRecordMergeStore;
  deps: RecordMergeRunnerDeps;
  log: string[];
  present: Set<string>;
  finalize: ReturnType<typeof vi.fn>;
  changed: { mergeId: string; state: RecordMergeState }[];
}

function harness(
  participants: Record<string, { phase: string; participant: MergeParticipant<'organization'>; trailing?: boolean; batchSize?: number }>,
  options: { structureRows?: { left: number }; log?: string[] } = {},
): Harness {
  const log: string[] = options.log ?? [];
  const structureRows = options.structureRows ?? { left: 0 };
  const finalize = vi.fn(async () => {
    log.push('finalize');
  });
  const host: MergeHostImplementation<'organization'> = {
    host: 'organization',
    preview: async () => ({ refusals: [], fields: [], customFields: [], counts: {}, warnings: [] }),
    applyStructureBatch: async (input) => {
      const moved = Math.min(structureRows.left, input.batchSize);
      structureRows.left -= moved;
      log.push(`host-structure:${moved}`);
      return { moved };
    },
    finalize,
  };
  const manifests = [manifest('organizations', { hosts: [{ type: 'organization' }] })];
  const registry = new RecordMergeRegistry();
  registry.registerHost('organizations', host);
  for (const [moduleId, entry] of Object.entries(participants)) {
    manifests.push(
      manifest(moduleId, {
        participates: [
          {
            host: 'organization',
            key: moduleId.replaceAll('_', '-'),
            phase: entry.phase,
            ...(entry.trailing ? { trailing: true } : {}),
            ...(entry.batchSize ? { batchSize: entry.batchSize } : {}),
            references: [{ entity: 'X', property: 'organizationId', disposition: 're_point' }],
          },
        ],
      }),
    );
    registry.registerParticipant(moduleId, 'organization', moduleId.replaceAll('_', '-'), entry.participant);
  }
  registry.seal({ declarations: mergeDeclarationsFrom(manifests) });
  const store = new MemoryRecordMergeStore();
  store.seedMerge({ id: MERGE, hostType: 'organization', survivorId: SURVIVOR, loserId: LOSER });
  const present = new Set(['organizations', ...Object.keys(participants)]);
  const changed: { mergeId: string; state: RecordMergeState }[] = [];
  const deps: RecordMergeRunnerDeps = {
    store,
    registry,
    isPresent: (moduleId) => present.has(moduleId),
    enterScope: (_reason, run) => run(),
    sleep: async () => {},
    maxAttempts: 3,
    defaultBatchSize: 2,
    parallelism: 4,
    onChanged: async (event) => {
      changed.push({ mergeId: event.mergeId, state: event.state });
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { store, deps, log, present, finalize, changed };
}

describe('runRecordMerge', () => {
  it('runs the host structure first, then the phases in order, then finalize, and completes', async () => {
    const log: string[] = [];
    const parts = {
      orders: counterParticipant(log, 'orders', { left: 3 }),
      addresses: counterParticipant(log, 'addresses', { left: 1 }),
      price_lists: counterParticipant(log, 'price_lists', { left: 2 }),
    };
    const h2 = harness(
      {
        orders: { phase: 'records', participant: parts.orders },
        addresses: { phase: 'addresses', participant: parts.addresses },
        price_lists: { phase: 'configuration', participant: parts.price_lists },
      },
      { structureRows: { left: 1 }, log },
    );
    await runRecordMerge(MERGE, h2.deps);
    expect(log).toEqual([
      'host-structure:1',
      'host-structure:0',
      'price_lists:2',
      'price_lists:0',
      'addresses:1',
      'addresses:0',
      'orders:2',
      'orders:1',
      'orders:0',
      'finalize',
    ]);
    const { merge, steps } = (await h2.store.load(MERGE))!;
    expect(merge.state).toBe('completed');
    expect(steps.every((step) => step.state === 'done')).toBe(true);
    expect(steps.find((step) => step.moduleId === 'orders')?.movedCount).toBe(3);
    expect(h2.store.locksReleased(MERGE)).toBe(true);
    expect(h2.changed.at(-1)).toEqual({ mergeId: MERGE, state: 'completed' });
  });

  it('runs the steps of one phase in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async (): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };
    const log: string[] = [];
    const h = harness({
      carts: { phase: 'records', participant: counterParticipant(log, 'carts', { left: 1 }, { onBatch: slow }) },
      invoices: { phase: 'records', participant: counterParticipant(log, 'invoices', { left: 1 }, { onBatch: slow }) },
      returns: { phase: 'records', participant: counterParticipant(log, 'returns', { left: 1 }, { onBatch: slow }) },
    });
    await runRecordMerge(MERGE, h.deps);
    expect(peak).toBeGreaterThan(1);
    expect((await h.store.load(MERGE))!.merge.state).toBe('completed');
  });

  it('retries a failed batch and continues when it succeeds within the attempts', async () => {
    const log: string[] = [];
    const h = harness({ orders: { phase: 'records', participant: counterParticipant(log, 'orders', { left: 1 }, { failTimes: 2 }) } });
    await runRecordMerge(MERGE, h.deps);
    expect((await h.store.load(MERGE))!.merge.state).toBe('completed');
  });

  it('stops in needs_attention when the retries are exhausted, keeping finished steps done, and a resume finishes it without repeating them', async () => {
    const log: string[] = [];
    const addressRows = { left: 1 };
    const failing = { times: 10 };
    const orders: MergeParticipant<'organization'> = {
      host: 'organization',
      preview: async () => ({ counts: {}, conflicts: [], warnings: [], refusals: [] }),
      applyBatch: async () => {
        if (failing.times > 0) {
          failing.times -= 1;
          throw Object.assign(new Error('boom'), { code: 'DB_TIMEOUT' });
        }
        log.push('orders:0');
        return { moved: 0 };
      },
    };
    const h = harness({
      addresses: { phase: 'addresses', participant: counterParticipant(log, 'addresses', addressRows) },
      orders: { phase: 'records', participant: orders },
    });
    await runRecordMerge(MERGE, h.deps);
    let loaded = (await h.store.load(MERGE))!;
    expect(loaded.merge.state).toBe('needs_attention');
    expect(h.store.lastErrorCode(MERGE)).toBe('DB_TIMEOUT');
    expect(loaded.steps.find((step) => step.moduleId === 'addresses')?.state).toBe('done');
    expect(loaded.steps.find((step) => step.moduleId === 'orders')?.state).toBe('failed');
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.changed.map((c) => c.state)).toContain('needs_attention');

    // A run while it needs attention does nothing.
    await runRecordMerge(MERGE, h.deps);
    expect(h.finalize).not.toHaveBeenCalled();

    failing.times = 0;
    h.store.resume(MERGE);
    const before = log.filter((entry) => entry.startsWith('addresses')).length;
    await runRecordMerge(MERGE, h.deps);
    loaded = (await h.store.load(MERGE))!;
    expect(loaded.merge.state).toBe('completed');
    expect(log.filter((entry) => entry.startsWith('addresses')).length).toBe(before);
    expect(h.finalize).toHaveBeenCalledOnce();
  });

  it('defers the step of a module that is off, completes without it, and the catch-up runs it once under the same merge', async () => {
    const log: string[] = [];
    const crmRows = { left: 3 };
    const h = harness({
      orders: { phase: 'records', participant: counterParticipant(log, 'orders', { left: 1 }) },
      crm: { phase: 'records', participant: counterParticipant(log, 'crm', crmRows) },
    });
    h.present.delete('crm');
    await runRecordMerge(MERGE, h.deps);
    let loaded = (await h.store.load(MERGE))!;
    expect(loaded.merge.state).toBe('completed');
    const crm = loaded.steps.find((step) => step.moduleId === 'crm');
    expect(crm?.state).toBe('deferred');
    expect(crm?.deferredReason).toBe('module_off');
    expect(log.some((entry) => entry.startsWith('crm'))).toBe(false);

    // Still off: a catch-up run leaves it deferred.
    await runRecordMerge(MERGE, h.deps);
    expect(crmRows.left).toBe(3);

    h.present.add('crm');
    await runRecordMerge(MERGE, h.deps);
    loaded = (await h.store.load(MERGE))!;
    expect(loaded.steps.find((step) => step.moduleId === 'crm')?.state).toBe('done');
    expect(crmRows.left).toBe(0);
    expect(h.finalize).toHaveBeenCalledOnce();

    // Once more: nothing to do.
    await runRecordMerge(MERGE, h.deps);
    expect(h.finalize).toHaveBeenCalledOnce();
  });

  it('re-runs a participant whose finalize re-count finds residue, and stops with RECORD_MERGE_RESIDUE when it keeps appearing', async () => {
    const log: string[] = [];
    // A step that reports done but leaves a straggler appearing on every preview.
    const stubborn: MergeParticipant<'organization'> = {
      host: 'organization',
      preview: async () => ({ counts: { 'Cart.organizationId': 1 }, conflicts: [], warnings: [], refusals: [] }),
      applyBatch: async () => {
        log.push('carts:0');
        return { moved: 0 };
      },
    };
    const h = harness({ carts: { phase: 'records', participant: stubborn } });
    await runRecordMerge(MERGE, h.deps);
    expect((await h.store.load(MERGE))!.merge.state).toBe('needs_attention');
    expect(h.store.lastErrorCode(MERGE)).toBe('RECORD_MERGE_RESIDUE');
    expect(log.length).toBe(4); // the step, then three sweeps
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('sweeps a straggler that appeared after the step finished, then finalizes', async () => {
    const rows = { left: 1 };
    const log: string[] = [];
    let appeared = false;
    const participant = counterParticipant(log, 'carts', rows);
    const h = harness({
      carts: {
        phase: 'records',
        participant: {
          ...participant,
          preview: async (input) => {
            if (!appeared) {
              appeared = true;
              rows.left += 1; // a straggler written after the step finished
            }
            return participant.preview(input);
          },
        },
      },
    });
    await runRecordMerge(MERGE, h.deps);
    expect((await h.store.load(MERGE))!.merge.state).toBe('completed');
    expect(rows.left).toBe(0);
  });

  it('runs a trailing step after finalize, and the merge is already completed while it runs', async () => {
    const log: string[] = [];
    let stateDuringTrailing: RecordMergeState | undefined;
    const h = harness({
      orders: { phase: 'records', participant: counterParticipant(log, 'orders', { left: 1 }) },
      analytics: {
        phase: 'records',
        trailing: true,
        participant: counterParticipant(log, 'analytics', { left: 3 }, {
          onBatch: async () => {
            stateDuringTrailing = (await h.store.load(MERGE))!.merge.state;
          },
        }),
      },
    });
    await runRecordMerge(MERGE, h.deps);
    const finalizeAt = h.log.indexOf('finalize');
    expect(finalizeAt).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('analytics:2')).toBeGreaterThan(-1);
    expect(stateDuringTrailing).toBe('completed');
    expect((await h.store.load(MERGE))!.steps.find((step) => step.moduleId === 'analytics')?.state).toBe('done');
  });

  it('honours a participant batch size and the default', async () => {
    const seen: number[] = [];
    const recorder: MergeParticipant<'organization'> = {
      host: 'organization',
      preview: async () => ({ counts: {}, conflicts: [], warnings: [], refusals: [] }),
      applyBatch: async (input) => {
        seen.push(input.batchSize);
        return { moved: 0 };
      },
    };
    const h = harness({
      customer_accounts: { phase: 'members', participant: recorder, batchSize: 50 },
      orders: { phase: 'records', participant: recorder },
    });
    await runRecordMerge(MERGE, h.deps);
    expect(seen).toEqual([50, 2]);
  });

  it('does not start a step of a cancelled merge', async () => {
    const log: string[] = [];
    const h = harness({ orders: { phase: 'records', participant: counterParticipant(log, 'orders', { left: 1 }) } });
    h.store.cancel(MERGE);
    await runRecordMerge(MERGE, h.deps);
    expect(log).toEqual([]);
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it('hands every step the merge id, both ids and the host context the structure phase wrote', async () => {
    const inputs: MergeStepInput[] = [];
    const recorder: MergeParticipant<'organization'> = {
      host: 'organization',
      preview: async () => ({ counts: {}, conflicts: [], warnings: [], refusals: [] }),
      applyBatch: async (input) => {
        inputs.push(input);
        return { moved: 0 };
      },
    };
    const h = harness({ customer_accounts: { phase: 'members', participant: recorder } });
    h.store.setHostContext(MERGE, { roleMap: { a: 'b' } });
    await runRecordMerge(MERGE, h.deps);
    expect(inputs[0]).toMatchObject({
      mergeId: MERGE,
      hostType: 'organization',
      survivorId: SURVIVOR,
      loserId: LOSER,
      hostContext: { roleMap: { a: 'b' } },
    });
  });
});
