// What the retention sweep's four passes select — specs/156-asset-stable-url/
// contracts/storage-and-retention.md §4 — as row sources (issue #909).
//
// **The one statement of each pass's rule.** Every pass lists through its row
// source here, and `RetentionDueProbe` asks whether any of them holds a row
// through the same functions, so a condition added to a pass is added to the
// tick's question by the same edit and the two cannot drift apart.
//
// Each source starts at `from` and carries no select list, order or limit: the
// pass adds those, the probe adds `exists(select 1 …)`.

import type { WorkRows } from '../services/scheduled-work-probe.js';
import { ASSET_CLEANUP_GRACE_MS, cutoffFor } from './retention-sweep-deps.js';

/** Pass 1: assets whose kept previous version was replaced at or before `cutoff`. */
export function previousVersionsDue(cutoff: Date): WorkRows {
  return { from: 'from "assets" where "previous_replaced_at" <= ?', params: [cutoff] };
}

/** Pass 2: assets soft-deleted at or before `cutoff` that no failed delete has parked. */
export function softDeletedDue(cutoff: Date): WorkRows {
  return {
    from: 'from "assets" where "deleted_at" is not null and "deleted_at" <= ? and "pending_cleanup" = false',
    params: [cutoff],
  };
}

/** Pass 3: soft-deleted assets a failed storage delete parked in `pending_cleanup`. */
export function pendingCleanupDue(): WorkRows {
  return { from: 'from "assets" where "deleted_at" is not null and "pending_cleanup" = true', params: [] };
}

/** Pass 4: cleanup-ledger entries recorded at or before `recordedBefore`. */
export function cleanupEntriesDue(recordedBefore: Date): WorkRows {
  return { from: 'from "asset_object_cleanups" where "recorded_at" <= ?', params: [recordedBefore] };
}

/** All four passes at `now`, with the retention a tick reads — what the probe asks about. */
export function retentionDueRows(now: Date, retentionDays: number): readonly WorkRows[] {
  const cutoff = cutoffFor(now, retentionDays);
  return [
    previousVersionsDue(cutoff),
    softDeletedDue(cutoff),
    pendingCleanupDue(),
    cleanupEntriesDue(new Date(now.getTime() - ASSET_CLEANUP_GRACE_MS)),
  ];
}
