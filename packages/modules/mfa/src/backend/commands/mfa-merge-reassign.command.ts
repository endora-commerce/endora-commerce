import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';

/**
 * `mfa.merge_reassign` (`specs/192-organization-merge/` T054,
 * `contracts/merge-participant.md` §2) — this module's part of an
 * Organization merge. The customer MFA policy is a security policy, so the
 * survivor keeps the **stricter** of the two (FR-034, research R-3):
 *
 *  - the survivor has no policy: the loser's is adopted (re-pointed);
 *  - the loser enforces TOTP and the survivor does not: the survivor's is
 *    raised to enforcement, and the loser's stays on the archived loser;
 *  - otherwise the survivor's already is the stricter, and nothing is written.
 *
 * One policy per Organization (`organization_id` is unique), so a batch writes
 * at most one row. Irreversible, no event; the audit records ids and the
 * resulting flag only.
 */
export interface MfaMergeReassignResult {
  readonly moved: number;
}

export const MFA_MERGE_REASSIGN_ACTION = 'mfa.merge_reassign';

export type MfaMergePlan =
  | { readonly kind: 'adopt'; readonly policy: MfaOrganizationPolicy }
  | { readonly kind: 'raise'; readonly policy: MfaOrganizationPolicy }
  | null;

/** What the stricter rule still has to write for the pair; `null` when nothing. */
export async function mfaMergePlan(em: Pick<EntityManager, 'findOne'>, survivorId: string, loserId: string): Promise<MfaMergePlan> {
  const loser = await em.findOne(MfaOrganizationPolicy, { organizationId: loserId });
  if (loser === null) return null;
  const survivor = await em.findOne(MfaOrganizationPolicy, { organizationId: survivorId });
  if (survivor === null) return { kind: 'adopt', policy: loser };
  if (loser.enforceTotp && !survivor.enforceTotp) return { kind: 'raise', policy: survivor };
  return null;
}

export function makeMfaMergeReassignCommand(input: MergeStepInput): Command<MfaMergeReassignResult> {
  return {
    action: MFA_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const plan = await mfaMergePlan(em, input.survivorId, input.loserId);
      if (plan === null) return { result: { moved: 0 }, skipAudit: true };
      if (plan.kind === 'adopt') {
        plan.policy.organizationId = input.survivorId;
      } else {
        plan.policy.enforceTotp = true;
        plan.policy.updatedByActor = `merge:${input.mergeId}`;
      }
      await em.flush();
      return {
        result: { moved: 1 },
        before: null,
        after: {
          mergeId: input.mergeId,
          loserId: input.loserId,
          moved: 1,
          ids: [plan.policy.id],
          resolution: plan.kind,
          enforceTotp: plan.policy.enforceTotp,
        },
      };
    },
  };
}
