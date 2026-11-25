import type {
  AdminNotificationMessage,
  AdminNotificationRecordPort,
  RecordMergeRecord,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type OrganizationMergeNotificationOutcome = 'recorded' | 'not-present' | 'skipped';

export interface OrganizationMergeNotifierDeps {
  /** `effectiveState.isPresent`, asked before anything else. */
  readonly isPresent: (moduleId: string) => boolean;
  readonly notifications: () => Pick<AdminNotificationRecordPort, 'record'>;
  readonly merges: () => { get(mergeId: string): Promise<RecordMergeRecord | null> };
  /** Organization names by id, archived ones included. */
  readonly names: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** Active administrators holding `organizations:merge`. */
  readonly holders: () => Promise<readonly string[]>;
  /** Of these administrators, the ones who reach both Organizations (`specs/175-sales-rep-reach-rule/`). */
  readonly reachingBoth: (adminUserIds: readonly string[], survivorId: string, loserId: string) => Promise<readonly string[]>;
}

export interface OrganizationMergeNotifier {
  onStateChanged(change: RecordMergeStateChange): Promise<OrganizationMergeNotificationOutcome>;
}

/** The longest sentence `admin_notifications` stores as an entry's `title`. */
const TITLE_MAX = 255;

const clip = (sentence: string): string => (sentence.length <= TITLE_MAX ? sentence : `${sentence.slice(0, TITLE_MAX - 1)}…`);

/** How many stops are remembered for de-duplication; older ones are forgotten first. */
const SEEN_LIMIT = 500;

/**
 * The bell entries an Organization merge leaves (`specs/192-organization-merge/`
 * `contracts/events-and-webhooks.md` §3), through `admin_notifications`' own
 * port. It is the host's `onStateChanged`, which the platform's runner calls
 * after a state is committed: the platform cannot name the module that tells
 * people, so the host does.
 *
 * - **needs attention** — every active administrator holding
 *   `organizations:merge` who reaches **both** Organizations under the one
 *   reach rule, so nobody is told about an Organization they could not open.
 * - **completed** — the administrator who started it. A merge server code
 *   started (`actorKind` other than `admin`) tells nobody.
 *
 * An entry names the two Organizations, which only its recipients reach, and
 * nothing else; it links to the merge's progress view. Every entry is a
 * sentence in English beside its key and params, so the Admin UI words it in
 * the reader's language (`specs/conventions/module-i18n.md`).
 *
 * `admin_notifications` is operator-switchable and a merge does not depend on
 * it: presence is **decided first**, outside any `try`, and an absent bell is
 * `not-present` rather than a caught refusal. The runner may announce one stop
 * twice when two steps of a phase fail together, and the merge may already
 * have been resumed by the time it is told; both are `skipped`.
 */
export function createOrganizationMergeNotifier(deps: OrganizationMergeNotifierDeps): OrganizationMergeNotifier {
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
    const names = await deps.names([merge.survivorId, merge.loserId]);
    const survivor = names.get(merge.survivorId) ?? merge.survivorId;
    const loser = names.get(merge.loserId) ?? merge.loserId;
    const title =
      key === 'needsAttention' ? `Merging ${loser} into ${survivor} needs attention` : `${loser} was merged into ${survivor}`;
    return {
      title: clip(title),
      titleMessage: { scope: 'organizations', key: `notifications.merge.${key}.title`, params: { loser, survivor } },
    };
  };

  const record = async (
    merge: RecordMergeRecord,
    targets: readonly string[],
    kind: 'organization.merge.needs_attention' | 'organization.merge.completed',
    message: { title: string; titleMessage: AdminNotificationMessage },
  ): Promise<void> => {
    for (const targetAdminUserId of targets) {
      await deps.notifications().record({
        audience: 'admin_user',
        targetAdminUserId,
        kind,
        subjectType: 'organization',
        subjectId: merge.survivorId,
        title: message.title,
        titleMessage: message.titleMessage,
        linkPath: `/organizations/merges/${merge.id}`,
      });
    }
  };

  return {
    async onStateChanged(change): Promise<OrganizationMergeNotificationOutcome> {
      if (change.state !== 'needs_attention' && change.state !== 'completed') return 'skipped';
      if (!deps.isPresent('admin_notifications')) return 'not-present';
      const merge = await deps.merges().get(change.mergeId);
      if (merge === null || merge.state !== change.state) return 'skipped';

      if (change.state === 'completed') {
        if (merge.actorKind !== 'admin' || merge.actorAdminUserId === null) return 'skipped';
        if (!remember(`${merge.id}:completed`)) return 'skipped';
        await record(merge, [merge.actorAdminUserId], 'organization.merge.completed', await text(merge, 'completed'));
        return 'recorded';
      }

      if (!remember(`${merge.id}:needs_attention:${merge.needsAttentionAt ?? ''}`)) return 'skipped';
      const holders = await deps.holders();
      if (holders.length === 0) return 'skipped';
      const targets = await deps.reachingBoth(holders, merge.survivorId, merge.loserId);
      if (targets.length === 0) return 'skipped';
      await record(merge, targets, 'organization.merge.needs_attention', await text(merge, 'needsAttention'));
      return 'recorded';
    },
  };
}
