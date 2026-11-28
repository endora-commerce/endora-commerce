import type { EntityManager } from '@mikro-orm/postgresql';
import {
  MEMBERSHIP_CHANGE_SOURCES,
  organizationMergeRoleMap,
  type MembershipChangeInput,
  type MergeParticipant,
  type MergeParticipantPreview,
  type MergePreviewInput,
  type MergeStepInput,
  type OrganizationRoleReadPort,
} from '@endora-commerce/contracts';

/**
 * The `customer_accounts` participant of an Organization merge
 * (`specs/192-organization-merge/` T070, `contracts/membership-merge-mode.md`,
 * research R-5): the loser's members — removed and blocked ones included, so
 * no account is left naming the archived loser — move to the survivor in the
 * `members` phase, **one** `customer_account.organization.change` Command per
 * account in the mode `merge` (191 FR-005: one audit entry per move), each
 * with the role the host's role map names (`host_context.roleMap`, written in
 * the `structure` phase) and the survivor's *Member* for a role the map does
 * not know.
 *
 * A batch is at most `batchSize` accounts (50, declared in the manifest).
 * Each account commits on its own, so a `beforeCommit` veto rolls back that
 * account only and the step retries; a moved account no longer names the
 * loser, so a re-run finds only what is left (R-3).
 *
 * Unlike the other participants this step publishes an event, by contract:
 * `customer_account.organization_changed.v1` with `mode: 'merge'` (R-5).
 */
export interface CustomerAccountMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly roles: Pick<OrganizationRoleReadPort, 'predefinedRoleId'>;
  /** Runs one membership move as its own Command (`membershipPort.changeOrganization`). */
  readonly changeOrganization: (input: MembershipChangeInput) => Promise<{ readonly changed: boolean }>;
}

export const CUSTOMER_ACCOUNTS_MERGE_PARTICIPATION_KEY = 'organization-members';

const REMAINING = `select count(*)::int as "count" from "customer_accounts" where "organization_id" = ?`;

export class CustomerAccountMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: CustomerAccountMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const rows = await this.deps.emFactory().fork({ clear: true }).execute<Array<{ count: number }>>(REMAINING, [input.loserId]);
    return { counts: { 'CustomerAccount.organizationId': Number(rows[0]?.count ?? 0) }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const accounts = await this.deps
      .emFactory()
      .fork({ clear: true })
      .execute<Array<{ id: string; organization_role_id: string }>>(
        `select "id", "organization_role_id" from "customer_accounts" where "organization_id" = ? order by "id" limit ?`,
        [input.loserId, Math.max(1, input.batchSize)],
      );
    if (accounts.length === 0) return { moved: 0 };
    const roleMap = organizationMergeRoleMap(input.hostContext);
    let member: string | undefined;
    let moved = 0;
    for (const account of accounts) {
      let roleId = roleMap[account.organization_role_id];
      if (roleId === undefined) {
        member ??= await this.deps.roles.predefinedRoleId(input.survivorId, 'member');
        roleId = member;
      }
      const outcome = await this.deps.changeOrganization({
        customerAccountId: account.id,
        organizationId: input.survivorId,
        organizationRoleId: roleId,
        source: MEMBERSHIP_CHANGE_SOURCES.recordMerge,
        merge: { mergeId: input.mergeId, fromOrganizationId: input.loserId },
      });
      if (outcome.changed) moved += 1;
    }
    return { moved };
  }
}
