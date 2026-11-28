import type {
  AdminNotificationMessage,
  AdminNotificationRecordPort,
  RecordMergeRecord,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type ProjectMergeNotificationOutcome = 'recorded' | 'not-present' | 'skipped';

export interface ProjectMergeNotifierDeps {
  /** `effectiveState.isPresent`, asked before anything else. */
  readonly isPresent: (moduleId: string) => boolean;
  readonly notifications: () => Pick<AdminNotificationRecordPort, 'record'>;
  readonly merges: () => { get(mergeId: string): Promise<RecordMergeRecord | null> };
  /** Project labels (`<number> <title>`) by id, archived ones included. */
  readonly labels: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Active administrators holding `projects:merge`. */
  readonly holders: () => Promise<readonly string[]>;
  /** Of these administrators, the ones who may see both Projects (`ProjectAccess.canSeeAsMany`). */
  readonly seeingBoth: (adminUserIds: readonly string[], survivorId: string, loserId: string) => Promise<readonly string[]>;
}

export interface ProjectMergeNotifier {
  onStateChanged(change: RecordMergeStateChange): Promise<ProjectMergeNotificationOutcome>;
}

/** The bundle keys of this notifier's two sentences (`i18n/{en,pl}.json`). */
export const PROJECT_MERGE_NOTIFICATION_KEYS = [
  'notifications.merge.needsAttention.title',
  'notifications.merge.completed.title',
] as const;

/** The longest sentence `admin_notifications` stores as an entry's `title`. */
const TITLE_MAX = 255;

const clip = (sentence: string): string => (sentence.length <= TITLE_MAX ? sentence : `${sentence.slice(0, TITLE_MAX - 1)}…`);

/** How many stops are remembered for de-duplication; older ones are forgotten first. */
const SEEN_LIMIT = 500;

/**
 * The bell entries a Project merge leaves (`specs/192-organization-merge/` US6,
 * `contracts/events-and-webhooks.md` §3), through `admin_notifications`' own
 * port — the host's `onStateChanged`, which the platform's runner calls after a
 * state is committed. The Organization host's notifier, for Projects:
 *
 * - **needs attention** — every active administrator holding `projects:merge`
 *   who may see **both** Projects, so nobody is told about a Project they could
 *   not open;
 * - **completed** — the administrator who started it. A merge server code
 *   started tells nobody.
 *
 * An entry names the two Projects and links to the merge's progress view, in
 * English beside its key and params. `admin_notifications` is
 * operator-switchable: its presence is decided first and an absent bell is
 * `not-present`. A stop announced twice, or already resumed, is `skipped`.
 */
export function createProjectMergeNotifier(deps: ProjectMergeNotifierDeps): ProjectMergeNotifier {
  const seen = new Set<string>();
  const remember = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
    return true;
  };

  const text = async (
    merge: RecordMergeRecord,
    key: 'needsAttention' | 'completed',
  ): Promise<{ title: string; titleMessage: AdminNotificationMessage }> => {
    const names = await deps.labels([merge.survivorId, merge.loserId]);
    const survivor = names.get(merge.survivorId) ?? merge.survivorId;
    const loser = names.get(merge.loserId) ?? merge.loserId;
    const title =
      key === 'needsAttention' ? `Merging ${loser} into ${survivor} needs attention` : `${loser} was merged into ${survivor}`;
    return {
      title: clip(title),
      titleMessage: { scope: 'projects', key: `notifications.merge.${key}.title`, params: { loser, survivor } },
    };
  };

  const record = async (
    merge: RecordMergeRecord,
    targets: readonly string[],
    kind: 'project.merge.needs_attention' | 'project.merge.completed',
    message: { title: string; titleMessage: AdminNotificationMessage },
  ): Promise<void> => {
    for (const targetAdminUserId of targets) {
      await deps.notifications().record({
        audience: 'admin_user',
        targetAdminUserId,
        kind,
        subjectType: 'project',
        subjectId: merge.survivorId,
        title: message.title,
        titleMessage: message.titleMessage,
        linkPath: `/projects/merges/${merge.id}`,
      });
    }
  };

  return {
    async onStateChanged(change): Promise<ProjectMergeNotificationOutcome> {
      if (change.state !== 'needs_attention' && change.state !== 'completed') return 'skipped';
      if (!deps.isPresent('admin_notifications')) return 'not-present';
      const merge = await deps.merges().get(change.mergeId);
      if (merge === null || merge.state !== change.state) return 'skipped';

      if (change.state === 'completed') {
        if (merge.actorKind !== 'admin' || merge.actorAdminUserId === null) return 'skipped';
        if (!remember(`${merge.id}:completed`)) return 'skipped';
        await record(merge, [merge.actorAdminUserId], 'project.merge.completed', await text(merge, 'completed'));
        return 'recorded';
      }

      if (!remember(`${merge.id}:needs_attention:${merge.needsAttentionAt ?? ''}`)) return 'skipped';
      const holders = await deps.holders();
      if (holders.length === 0) return 'skipped';
      const targets = await deps.seeingBoth(holders, merge.survivorId, merge.loserId);
      if (targets.length === 0) return 'skipped';
      await record(merge, targets, 'project.merge.needs_attention', await text(merge, 'needsAttention'));
      return 'recorded';
    },
  };
}
