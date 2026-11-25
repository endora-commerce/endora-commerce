import { describe, expect, it, vi } from 'vitest';
import type {
  RecordAdminNotificationInput as RecordInput,
  RecordMergeRecord,
  RecordMergeState,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';
import { createOrganizationMergeNotifier, type OrganizationMergeNotifierDeps } from './organization-merge-notifier.js';

/**
 * `specs/192-organization-merge/` `contracts/events-and-webhooks.md` §3 (T076):
 * the bell entries a merge leaves. On `needs_attention`, every holder of
 * `organizations:merge` who reaches both Organizations, with a link to the
 * progress view; on completion, the administrator who started it. Nothing when
 * `admin_notifications` is off, and one entry per stop even when two failing
 * steps announce it twice.
 */

const MERGE = '00000000-0000-4000-8000-00000000b001';
const SURVIVOR = '00000000-0000-4000-8000-00000000b002';
const LOSER = '00000000-0000-4000-8000-00000000b003';
const STARTER = '00000000-0000-4000-8000-00000000b004';

function record(state: RecordMergeState, overrides: Partial<RecordMergeRecord> = {}): RecordMergeRecord {
  return {
    id: MERGE,
    hostType: 'organization',
    survivorId: SURVIVOR,
    loserId: LOSER,
    state,
    version: 2,
    source: null,
    actorKind: 'admin',
    actorAdminUserId: STARTER,
    startedAt: '2026-11-25T10:00:00.000Z',
    completedAt: state === 'completed' ? '2026-11-25T10:05:00.000Z' : null,
    cancelledAt: null,
    needsAttentionAt: state === 'needs_attention' ? '2026-11-25T10:03:00.000Z' : null,
    lastErrorCode: state === 'needs_attention' ? 'DB_TIMEOUT' : null,
    fieldChoices: {},
    customFieldChoices: {},
    steps: [],
    ...overrides,
  };
}

function change(state: RecordMergeState): RecordMergeStateChange {
  return { mergeId: MERGE, hostType: 'organization', survivorId: SURVIVOR, loserId: LOSER, state };
}

function harness(merge: RecordMergeRecord, options: { present?: boolean; holders?: string[]; reaching?: string[] } = {}) {
  const recorded: RecordInput[] = [];
  const deps: OrganizationMergeNotifierDeps = {
    isPresent: (moduleId) => moduleId === 'admin_notifications' && options.present !== false,
    notifications: () => ({
      record: async (input) => {
        recorded.push(input);
        return { ...input, id: 'n', targetAdminUserId: input.targetAdminUserId ?? null, subjectType: null, subjectId: null, body: null, linkPath: null, createdAt: new Date() };
      },
    }),
    merges: () => ({ get: async () => merge }),
    names: async () => new Map([[SURVIVOR, 'Acme S.A.'], [LOSER, 'ACME (import)']]),
    holders: vi.fn(async () => options.holders ?? ['a1', 'a2', 'a3']),
    reachingBoth: vi.fn(async (ids: readonly string[]) => (options.reaching ?? ids).filter((id) => ids.includes(id))),
  };
  return { deps, recorded, notifier: createOrganizationMergeNotifier(deps) };
}

describe('the organization merge notifier', () => {
  it('tells every holder of organizations:merge who reaches both organizations that a merge needs attention', async () => {
    const h = harness(record('needs_attention'), { holders: ['a1', 'a2', 'a3'], reaching: ['a1', 'a3'] });
    expect(await h.notifier.onStateChanged(change('needs_attention'))).toBe('recorded');
    expect(h.deps.reachingBoth).toHaveBeenCalledWith(['a1', 'a2', 'a3'], SURVIVOR, LOSER);
    expect(h.recorded.map((entry) => entry.targetAdminUserId)).toEqual(['a1', 'a3']);
    expect(h.recorded[0]).toMatchObject({
      audience: 'admin_user',
      kind: 'organization.merge.needs_attention',
      subjectType: 'organization',
      subjectId: SURVIVOR,
      linkPath: `/organizations/merges/${MERGE}`,
      title: 'Merging ACME (import) into Acme S.A. needs attention',
      titleMessage: {
        scope: 'organizations',
        key: 'notifications.merge.needsAttention.title',
        params: { loser: 'ACME (import)', survivor: 'Acme S.A.' },
      },
    });
  });

  it('records one entry per stop when two failing steps announce it twice', async () => {
    const h = harness(record('needs_attention'), { holders: ['a1'] });
    await h.notifier.onStateChanged(change('needs_attention'));
    expect(await h.notifier.onStateChanged(change('needs_attention'))).toBe('skipped');
    expect(h.recorded).toHaveLength(1);
  });

  it('says nothing about a stop the merge has already left (resumed before it was told)', async () => {
    const h = harness(record('running'));
    expect(await h.notifier.onStateChanged(change('needs_attention'))).toBe('skipped');
    expect(h.recorded).toEqual([]);
  });

  it('tells the administrator who started a merge that it completed', async () => {
    const h = harness(record('completed'));
    expect(await h.notifier.onStateChanged(change('completed'))).toBe('recorded');
    expect(h.deps.holders).not.toHaveBeenCalled();
    expect(h.recorded).toEqual([
      expect.objectContaining({
        audience: 'admin_user',
        targetAdminUserId: STARTER,
        kind: 'organization.merge.completed',
        linkPath: `/organizations/merges/${MERGE}`,
        title: 'ACME (import) was merged into Acme S.A.',
        titleMessage: {
          scope: 'organizations',
          key: 'notifications.merge.completed.title',
          params: { loser: 'ACME (import)', survivor: 'Acme S.A.' },
        },
      }),
    ]);
  });

  it('tells nobody of a completion that server code started', async () => {
    const h = harness(record('completed', { actorKind: 'system', actorAdminUserId: null }));
    expect(await h.notifier.onStateChanged(change('completed'))).toBe('skipped');
    expect(h.recorded).toEqual([]);
  });

  it('decides the bell’s presence first and writes nothing when admin_notifications is off', async () => {
    const h = harness(record('needs_attention'), { present: false });
    expect(await h.notifier.onStateChanged(change('needs_attention'))).toBe('not-present');
    expect(h.deps.holders).not.toHaveBeenCalled();
    expect(h.recorded).toEqual([]);
  });
});
