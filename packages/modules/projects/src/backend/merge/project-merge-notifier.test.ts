import { describe, expect, it, vi } from 'vitest';
import type {
  RecordAdminNotificationInput as RecordInput,
  RecordMergeRecord,
  RecordMergeState,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';
import { createProjectMergeNotifier, type ProjectMergeNotifierDeps } from './project-merge-notifier.js';

/**
 * `specs/192-organization-merge/` US6, `contracts/events-and-webhooks.md` §3 —
 * the bell entries a Project merge leaves: on `needs_attention`, every holder
 * of `projects:merge` who sees both Projects; on completion, the administrator
 * who started it. Nothing while `admin_notifications` is off, and one entry per
 * stop.
 */
const MERGE = '00000000-0000-4000-8000-00000000c001';
const SURVIVOR = '00000000-0000-4000-8000-00000000c002';
const LOSER = '00000000-0000-4000-8000-00000000c003';
const STARTER = '00000000-0000-4000-8000-00000000c004';
const OTHER = '00000000-0000-4000-8000-00000000c005';

function record(state: RecordMergeState, overrides: Partial<RecordMergeRecord> = {}): RecordMergeRecord {
  return {
    id: MERGE,
    hostType: 'project',
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
    lastErrorCode: null,
    fieldChoices: {},
    customFieldChoices: {},
    steps: [],
    ...overrides,
  };
}

const change = (state: RecordMergeState): RecordMergeStateChange => ({
  mergeId: MERGE,
  hostType: 'project',
  survivorId: SURVIVOR,
  loserId: LOSER,
  state,
});

function build(state: RecordMergeState, overrides: Partial<ProjectMergeNotifierDeps> = {}) {
  const recorded: RecordInput[] = [];
  const deps: ProjectMergeNotifierDeps = {
    isPresent: () => true,
    notifications: () => ({ record: vi.fn(async (input: RecordInput) => void recorded.push(input)) as never }),
    merges: () => ({ get: async () => record(state) }),
    labels: async () => new Map([[SURVIVOR, 'PRJ-1 Tender'], [LOSER, 'PRJ-2 Tender (copy)']]),
    holders: async () => [STARTER, OTHER],
    seeingBoth: async (ids) => ids.filter((id) => id === OTHER),
    ...overrides,
  };
  return { notifier: createProjectMergeNotifier(deps), recorded };
}

describe('createProjectMergeNotifier', () => {
  it('tells the holders of projects:merge who see both Projects that a merge needs attention, once', async () => {
    const { notifier, recorded } = build('needs_attention');
    expect(await notifier.onStateChanged(change('needs_attention'))).toBe('recorded');
    expect(await notifier.onStateChanged(change('needs_attention'))).toBe('skipped');
    expect(recorded).toEqual([
      expect.objectContaining({
        targetAdminUserId: OTHER,
        kind: 'project.merge.needs_attention',
        subjectType: 'project',
        subjectId: SURVIVOR,
        linkPath: `/projects/merges/${MERGE}`,
        titleMessage: {
          scope: 'projects',
          key: 'notifications.merge.needsAttention.title',
          params: { loser: 'PRJ-2 Tender (copy)', survivor: 'PRJ-1 Tender' },
        },
      }),
    ]);
  });

  it('tells the administrator who started it that it completed, and nobody for server code', async () => {
    const { notifier, recorded } = build('completed');
    expect(await notifier.onStateChanged(change('completed'))).toBe('recorded');
    expect(recorded.map((entry) => entry.targetAdminUserId)).toEqual([STARTER]);
    const server = build('completed', { merges: () => ({ get: async () => record('completed', { actorKind: 'system', actorAdminUserId: null }) }) });
    expect(await server.notifier.onStateChanged(change('completed'))).toBe('skipped');
  });

  it('records nothing while the bell is off', async () => {
    const { notifier, recorded } = build('needs_attention', { isPresent: () => false });
    expect(await notifier.onStateChanged(change('needs_attention'))).toBe('not-present');
    expect(recorded).toEqual([]);
  });
});
