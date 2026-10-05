import {
  ERROR_CODES,
  OpportunityTransitionVetoError,
  type OpportunityStatusEvent,
  type OpportunityTransitionGuard,
  type OpportunityTransitionGuardRegistryPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The guards other modules register on an Opportunity transition — the seam
 * that can **refuse** one (`contracts/events-and-ports.md` §3).
 *
 * A contribution seam: registered ungated, pushed into from a contributor's
 * contribution-only boot hook. `register` and `owners` are the published half
 * (`OpportunityTransitionGuardRegistryPort`); `run` is this module's own, called
 * by the transition service before anything is written.
 *
 * **Enumeration policy, applied at dispatch and not at registration**: a guard
 * whose owner module is not effectively present is skipped, so a switched-off
 * module does not veto — and switching it back on takes effect without a
 * restart.
 */
export class OpportunityTransitionGuardRegistry implements OpportunityTransitionGuardRegistryPort {
  private readonly guards: OpportunityTransitionGuard[] = [];

  constructor(private readonly isModulePresent: (moduleId: string) => boolean) {}

  register(guard: OpportunityTransitionGuard): void {
    if (this.guards.includes(guard)) return;
    this.guards.push(guard);
  }

  owners(): readonly string[] {
    return this.guards.map((guard) => guard.ownerModuleId);
  }

  /**
   * Ask every present guard matching `event`, in registration order. The first
   * veto ends the run as a 409 `CRM_TRANSITION_VETOED` whose message is the
   * guard's own sentence; anything else a guard throws is its defect and
   * surfaces as one.
   *
   * The sentence travels in `details.reason` as well: the error envelope
   * replaces a declared code's message with the bundle's sentence, and this
   * code's bundle sentence is that placeholder alone.
   */
  async run(event: OpportunityStatusEvent): Promise<void> {
    for (const entry of this.guards) {
      if (entry.match.from !== undefined && entry.match.from !== event.from) continue;
      if (entry.match.to !== undefined && entry.match.to !== event.to) continue;
      if (!this.isModulePresent(entry.ownerModuleId)) continue;
      try {
        await entry.guard(event);
      } catch (error) {
        if (error instanceof OpportunityTransitionVetoError) {
          throw new HttpError(409, ERROR_CODES.CRM_TRANSITION_VETOED, error.message, {
            reason: error.message,
            from: event.from,
            to: event.to,
          });
        }
        throw error;
      }
    }
  }
}
