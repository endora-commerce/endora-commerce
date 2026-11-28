import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { PushNotificationPreference } from '../entities/push-notification-preference.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';

/**
 * `pwa.merge_reassign` (`specs/192-organization-merge/` T053,
 * `contracts/merge-participant.md` §2) — one batch of this module's part of an
 * Organization merge: at most `batchSize` rows still naming the loser — push
 * subscriptions first, then push preferences — are re-pointed to the survivor.
 * Re-pointing consumes the loser side, so a re-run finds only what is left
 * (research R-3).
 *
 * A preference is unique per customer account, never per Organization, so a
 * moved preference cannot meet a survivor-side twin: the account it belongs
 * to keeps exactly one.
 *
 * Irreversible, no event; the audit names the survivor and records ids only.
 */
export interface PwaMergeReassignResult {
  readonly moved: number;
}

export const PWA_MERGE_REASSIGN_ACTION = 'pwa.merge_reassign';

export function makePwaMergeReassignCommand(input: MergeStepInput): Command<PwaMergeReassignResult> {
  return {
    action: PWA_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const limit = Math.max(1, input.batchSize);
      const subscriptions = await em.find(
        PushSubscription,
        { organizationId: input.loserId },
        { orderBy: { id: 'asc' }, limit },
      );
      const preferences =
        subscriptions.length < limit
          ? await em.find(
              PushNotificationPreference,
              { organizationId: input.loserId },
              { orderBy: { id: 'asc' }, limit: limit - subscriptions.length },
            )
          : [];
      if (subscriptions.length === 0 && preferences.length === 0) return { result: { moved: 0 }, skipAudit: true };
      for (const row of subscriptions) row.organizationId = input.survivorId;
      for (const row of preferences) row.organizationId = input.survivorId;
      await em.flush();

      const ids = [...subscriptions.map((row) => row.id), ...preferences.map((row) => row.id)];
      return {
        result: { moved: ids.length },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
