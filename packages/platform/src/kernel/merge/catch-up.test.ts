import { describe, expect, it } from 'vitest';
import type { MergeHostImplementation, MergeParticipant, ModuleManifest } from '@endora-commerce/contracts';
import { mergeDeclarationsFrom } from './declarations.js';
import { MemoryRecordMergeStore } from './memory-store.js';
import { RecordMergeRegistry } from './registry.js';
import { runRecordMerge, type RecordMergeRunnerDeps } from './runner.js';
import { processRecordMergeJob, runRecordMergeCatchUp, watchPresenceForCatchUp } from './worker.js';

/**
 * `specs/192-organization-merge/` T015 (D-299 / OQ-4, R-10): a step deferred
 * because its module was off runs, once and under the original merge id, when
 * the module is effectively present again — through the presence
 * notification, and through the repeatable sweep when that notification was
 * lost.
 */

const MERGE = '00000000-0000-4000-8000-00000000c001';

function manifest(id: string, merge: ModuleManifest['merge']): ModuleManifest {
  return { id, name: id, description: id, version: '1.0.0', dependencies: [], merge } as unknown as ModuleManifest;
}

function setup() {
  const rows = { crm: 2 };
  const seenMergeIds: string[] = [];
  const crm: MergeParticipant<'organization'> = {
    host: 'organization',
    preview: async () => ({ counts: { 'CrmOpportunity.organizationId': rows.crm }, conflicts: [], warnings: [], refusals: [] }),
    applyBatch: async (input) => {
      seenMergeIds.push(input.mergeId);
      const moved = Math.min(rows.crm, input.batchSize);
      rows.crm -= moved;
      return { moved };
    },
  };
  const host: MergeHostImplementation<'organization'> = {
    host: 'organization',
    preview: async () => ({ refusals: [], fields: [], customFields: [], counts: {}, warnings: [] }),
    applyStructureBatch: async () => ({ moved: 0 }),
    finalize: async () => {},
  };
  const registry = new RecordMergeRegistry();
  registry.registerHost('organizations', host);
  registry.registerParticipant('crm', 'organization', 'crm', crm);
  registry.seal({
    declarations: mergeDeclarationsFrom([
      manifest('organizations', { hosts: [{ type: 'organization' }] }),
      manifest('crm', {
        participates: [
          {
            host: 'organization',
            key: 'crm',
            phase: 'records',
            references: [{ entity: 'CrmOpportunity', property: 'organizationId', disposition: 're_point' }],
          },
        ],
      }),
    ]),
  });
  const store = new MemoryRecordMergeStore();
  store.seedMerge({ id: MERGE, hostType: 'organization', survivorId: 's', loserId: 'l' });
  const present = new Set(['organizations']);
  const deps: RecordMergeRunnerDeps = {
    store,
    registry,
    isPresent: (moduleId) => present.has(moduleId),
    enterScope: (_reason, run) => run(),
    sleep: async () => {},
    onChanged: async () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { rows, seenMergeIds, store, present, deps };
}

describe('the deferred-step catch-up', () => {
  it('enqueues nothing while the module is still off, and the completed merge keeps its step deferred', async () => {
    const h = setup();
    await runRecordMerge(MERGE, h.deps);
    const enqueued: string[] = [];
    await runRecordMergeCatchUp({ store: h.store, isPresent: h.deps.isPresent, enqueue: async (id) => void enqueued.push(id) });
    expect(enqueued).toEqual([]);
    expect((await h.store.load(MERGE))!.steps.find((s) => s.moduleId === 'crm')?.state).toBe('deferred');
  });

  it('runs the step when the presence notification arrives (the pub/sub path)', async () => {
    const h = setup();
    await runRecordMerge(MERGE, h.deps);
    let listener: (() => void) | undefined;
    const ran: Promise<void>[] = [];
    const stop = watchPresenceForCatchUp(
      (l) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
      () => {
        const p = runRecordMergeCatchUp({
          store: h.store,
          isPresent: h.deps.isPresent,
          enqueue: (mergeId) => processRecordMergeJob({ kind: 'run', mergeId }, { runner: h.deps, store: h.store, enqueue: async () => {} }).then(() => {}),
        }).then(() => {});
        ran.push(p);
        return p;
      },
    );
    h.present.add('crm');
    listener?.();
    await Promise.all(ran);
    expect(h.rows.crm).toBe(0);
    expect(h.seenMergeIds.every((id) => id === MERGE)).toBe(true);
    expect((await h.store.load(MERGE))!.steps.find((s) => s.moduleId === 'crm')?.state).toBe('done');
    stop();
    expect(listener).toBeUndefined();
  });

  it('runs the step from the repeatable sweep when the notification was lost (the sweep path)', async () => {
    const h = setup();
    await runRecordMerge(MERGE, h.deps);
    h.present.add('crm');
    const enqueued: string[] = [];
    await processRecordMergeJob({ kind: 'catch-up' }, { runner: h.deps, store: h.store, enqueue: async (id) => void enqueued.push(id) });
    expect(enqueued).toEqual([MERGE]);
    await processRecordMergeJob({ kind: 'run', mergeId: MERGE }, { runner: h.deps, store: h.store, enqueue: async () => {} });
    expect(h.rows.crm).toBe(0);
  });

  it('re-enqueues a running merge (a crash between commit and enqueue, or a lost job)', async () => {
    const h = setup();
    const enqueued: string[] = [];
    await runRecordMergeCatchUp({ store: h.store, isPresent: h.deps.isPresent, enqueue: async (id) => void enqueued.push(id) });
    expect(enqueued).toEqual([MERGE]);
  });
});
