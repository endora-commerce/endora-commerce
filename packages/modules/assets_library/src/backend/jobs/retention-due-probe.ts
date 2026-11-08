// The retention sweep tick's question — is anything due? — asked before the
// tick runs any pass (issue #909; `docs/docs/architecture/tenant-scoping.md` §
// *A scheduled tick with nothing to do enters no scope*).
//
// It learns one bit, through the module's copy of the scheduled-work helper,
// over the passes' own row sources (`retention-due-rows.ts`). A probe that
// fails counts as yes; `runAssetRetentionSweepTick` decides that, so a failure
// can cost a sweep but never skip one.

import { anyRowExists } from '../services/scheduled-work-probe.js';
import { retentionDueRows } from './retention-due-rows.js';
import type { RetentionSweepDeps } from './retention-sweep-deps.js';

export class RetentionDueProbe {
  constructor(private readonly deps: Pick<RetentionSweepDeps, 'emFactory' | 'loadRetentionDays'>) {}

  /** Whether any of the four passes has a row to work on at `now`. */
  async hasDue(now: Date = new Date()): Promise<boolean> {
    const retentionDays = await this.deps.loadRetentionDays();
    return anyRowExists(this.deps.emFactory().fork(), retentionDueRows(now, retentionDays));
  }
}
