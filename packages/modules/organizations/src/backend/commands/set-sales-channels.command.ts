import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { assertSalesChannelsExist } from '../services/organization-write-guards.js';

/**
 * `organization.sales_channels.set` — replaces the stores an Organization's
 * members may sign in and shop on (feature 154, US5;
 * `specs/186-aggregate-ports/` T028, research R-16.1). The admin route
 * `PUT /api/v1/admin/organizations/:id/sales-channels` and
 * `organizationCommandPort.setSalesChannels` run this factory.
 *
 * **Two records of one change, on purpose (R-16.1).** The bridge rows are
 * written by the kernel's membership writer, on this Command's `em`: the writer
 * enlists in the Command's transaction, so its `sales_channel.membership.changed`
 * entries — one per membership added or removed, object type
 * `sales_channel_membership` — commit or roll back with this one, and the
 * access-cache drop waits for the commit (`EventBus.afterScope`) and runs
 * before the buffered `sales_channels.membership_changed` events. This Command
 * adds one `organization` entry, the channel ids before and after (ids,
 * `specs/conventions/audit-state.md` list 1), for the Organization's own record
 * history. The same set again is the writer's no-op and answers `skipAudit`.
 *
 * The refusals are the route's, in its order: an unknown, malformed or
 * soft-deleted Organization `404 NOT_FOUND`; a channel id that names no channel
 * `422` with the field path, `VALIDATION_FAILED` unless the caller names
 * `UNKNOWN_SALES_CHANNEL` (the port, R-16.5). The empty set is the input
 * schema's refusal, and the writer's at-least-one-channel floor behind it. Who
 * may reach the Organization is the caller's gate (FR-009).
 */

export interface SetSalesChannelsCommandDeps {
  readonly membership: Pick<SalesChannelMembershipPort, 'replaceChannelsForEntity' | 'listChannelsForEntity'>;
}

export interface SetSalesChannelsCommandInput {
  readonly organizationId: string;
  readonly salesChannelIds: readonly string[];
  /** The code an unknown channel is refused with; the admin route's `VALIDATION_FAILED` by default. */
  readonly unknownChannelCode?:
    | typeof ERROR_CODES.VALIDATION_FAILED
    | typeof ERROR_CODES.UNKNOWN_SALES_CHANNEL
    | undefined;
}

export function makeSetSalesChannelsCommand(
  deps: SetSalesChannelsCommandDeps,
  input: SetSalesChannelsCommandInput,
): Command<Organization> {
  return {
    action: 'organization.sales_channels.set',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em, actor }) => {
      const organization = isUuidShape(input.organizationId)
        ? await em.findOne(Organization, { id: input.organizationId, deletedAt: null })
        : null;
      if (!organization) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      await assertSalesChannelsExist(em, input.salesChannelIds, input.unknownChannelCode);
      const [first, ...rest] = input.salesChannelIds;
      if (first === undefined) {
        // The input schemas refuse it first; the writer's floor would too.
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'An Organization needs at least one sales channel.', [
          { path: 'salesChannelIds', issue: 'too_small' },
        ]);
      }
      // The committed set the replacement starts from, for the entry's `before`.
      const before = (await deps.membership.listChannelsForEntity('organization', organization.id))
        .map((channel) => channel.id)
        .sort();
      const { changed } = await deps.membership.replaceChannelsForEntity('organization', organization.id, [first, ...rest], {
        em,
        actorAdminUserId: actor.actorAdminUserId,
      });
      if (!changed) return { result: organization, skipAudit: true };
      return {
        result: organization,
        before: { salesChannelIds: before },
        after: { salesChannelIds: [...new Set(input.salesChannelIds)].sort() },
      };
    },
  };
}
