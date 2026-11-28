import type { EntityManager } from '@mikro-orm/postgresql';
import { organizationMergeRoleMap, type MergeStepInput } from '@endora-commerce/contracts';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService, SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { Organization } from '../entities/organization.entity.js';
import {
  buildRoleMap,
  channelsToAdd,
  childrenOf,
  customRolesToCopy,
  pendingInvitationsOf,
} from '../merge/organization-merge-structure.js';
import type { OrganizationTreeService } from '../services/organization-tree-service.js';

/**
 * `organization.merge.structure` (`specs/192-organization-merge/` FR-041,
 * FR-042, R-11) — one batch of the host's `structure` phase, as one Command:
 *
 *  1. the role map, once: the loser's custom roles the survivor lacks are
 *     copied into it, and loser role → survivor role goes into the merge's host
 *     context for the members phase;
 *  2. the loser's pending invitations, re-pointed with the mapped role;
 *  3. its sales-representative assignments, unioned into the survivor's;
 *  4. its sales channels, unioned through the kernel's membership service;
 *  5. its children, each moved under the survivor by the tree service's own
 *     rules — so the tree and tax-ID rules of 177 run unchanged, and the move
 *     is recorded in this entry with the merge id.
 *
 * Each unit consumes loser-side state, so a re-run after a failure finds only
 * what is left (R-3). At most `batchSize` units per batch; `moved: 0` is done.
 */
export interface MergeStructureDeps {
  readonly recordMerge: () => RecordMergeService;
  readonly tree: () => OrganizationTreeService;
  readonly membership: () => Pick<SalesChannelMembershipPort, 'copyMemberships'>;
}

export interface MergeStructureResult {
  readonly moved: number;
  readonly roleMapWritten: boolean;
}

export function makeMergeStructureCommand(deps: MergeStructureDeps, input: MergeStepInput): Command<MergeStructureResult> {
  return {
    action: 'organization.merge.structure',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }: { em: EntityManager }) => {
      const { survivorId, loserId } = input;
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      let roleMapWritten = false;

      // 1. The role map, once (the merge row is the authority; the context the
      //    runner handed in may be a batch old).
      const context = await deps.recordMerge().hostContextWithin(em, input.mergeId);
      let roleMap = organizationMergeRoleMap(context);
      if (context['roleMap'] === undefined) {
        const copies = new Map<string, string>();
        for (const role of await customRolesToCopy(em, survivorId, loserId)) {
          const copy = em.create(OrganizationRole, {
            organizationId: survivorId,
            kind: 'custom',
            name: role.name,
            nameNormalized: role.nameNormalized,
            description: role.description,
            permissions: [...role.permissions],
            memberDefaultsOffered: [...role.memberDefaultsOffered],
          });
          em.persist(copy);
          copies.set(role.id, copy.id);
          ids.push(copy.id);
        }
        await em.flush();
        roleMap = await buildRoleMap(em, survivorId, loserId, copies);
        await deps.recordMerge().setHostContext(em, input.mergeId, { roleMap });
        roleMapWritten = true;
        budget -= 1;
      }

      // 2. Pending invitations, with the mapped role (FR-041).
      if (budget > 0) {
        const survivorMember = await em.findOne(OrganizationRole, { organizationId: survivorId, kind: 'member' });
        for (const invitation of await pendingInvitationsOf(em, loserId, budget)) {
          invitation.organizationId = survivorId;
          invitation.organizationRoleId = roleMap[invitation.organizationRoleId] ?? survivorMember?.id ?? invitation.organizationRoleId;
          ids.push(invitation.id);
          budget -= 1;
        }
        await em.flush();
      }

      // 3. Sales-representative assignments: the survivor's twin, then the loser's row goes.
      if (budget > 0) {
        const moved = await em.execute<{ admin_user_id: string }[]>(
          `with picked as (select "id", "admin_user_id", "assigned_by_admin_user_id" from "organization_sales_rep_assignments" ` +
            `where "organization_id" = ? order by "id" limit ?), ` +
            `added as (insert into "organization_sales_rep_assignments" ("id", "organization_id", "admin_user_id", "assigned_by_admin_user_id", "created_at") ` +
            `select gen_random_uuid(), ?, "admin_user_id", "assigned_by_admin_user_id", now() from picked on conflict do nothing) ` +
            `delete from "organization_sales_rep_assignments" where "id" in (select "id" from picked) returning "admin_user_id"`,
          [loserId, budget, survivorId],
        );
        for (const row of moved) ids.push(row.admin_user_id);
        budget -= moved.length;
      }

      // 4. Sales channels (FR-042): the kernel's single mutator, on this transaction.
      if (budget > 0) {
        const missing = await channelsToAdd(em, survivorId, loserId);
        if (missing.length > 0) {
          await deps.membership().copyMemberships('organization', loserId, survivorId, { em });
          ids.push(...missing);
          budget -= 1;
        }
      }

      // 5. Children, one tree move each (FR-042), by the tree service's own
      //    rules — the cycle, the depth, the subtree's tax-ID locks and 177's
      //    one-tree rule — inside this Command, so the move is recorded in this
      //    entry with the merge id (FR-060) rather than in an entry without it.
      if (budget > 0) {
        const survivor = await em.findOne(Organization, { id: survivorId, deletedAt: null });
        if (survivor === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
        const tree = deps.tree();
        for (const child of await childrenOf(em, loserId, budget)) {
          tree.assertNoCycle(child, survivor);
          await tree.lockSubtreeTaxIds(em, child);
          await tree.assertMaxDepth(em, child, survivor);
          await tree.assertTaxIdsStayInOneTree(em, child, survivor);
          await tree.applyReparentPaths(em, child, survivor);
          await em.flush();
          ids.push(child.id);
          budget -= 1;
        }
      }

      const moved = ids.length + (roleMapWritten && ids.length === 0 ? 1 : 0);
      if (moved === 0) return { result: { moved: 0, roleMapWritten: false }, skipAudit: true };
      return {
        result: { moved, roleMapWritten },
        before: null,
        after: {
          mergeId: input.mergeId,
          loserId,
          moved,
          ids: ids.slice(0, input.batchSize),
          ...(roleMapWritten ? { roleMapSize: Object.keys(roleMap).length } : {}),
        },
      };
    },
  };
}
