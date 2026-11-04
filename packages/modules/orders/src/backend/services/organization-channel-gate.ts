import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #515 — the channel an operator places a customer's order on must be one
 * of the customer's Organization's **active assigned** channels: the ones its
 * members may shop on, and the set the create screen offers. The rule the
 * on-behalf quote request has followed since feature 163
 * (`RfqAdminService.createOnBehalf`); without it an order could land on a
 * channel the Organization is not assigned to, or on an inactive one.
 *
 * Exactly that channel — a stale, foreign, inactive or nonexistent id is
 * refused, never replaced by another, and all four get the one answer, so the
 * refusal does not tell an operator which channel ids exist. `422
 * ORDER_SALES_CHANNEL_NOT_ALLOWED`.
 *
 * The membership port is optional where the module is composed; an unwired one
 * fails closed (`500 INTERNAL`) rather than reading as "every channel allowed",
 * as the order preview's assortment read does.
 */
export interface OrganizationChannelsRead {
  /** `SalesChannelMembershipPort.listChannelsForEntity`, narrowed to what the gate reads. */
  listChannelsForEntity(
    entityType: 'organization',
    entityId: string,
  ): Promise<ReadonlyArray<{ readonly id: string; readonly active: boolean }>>;
}

export async function assertChannelAllowedForOrganization(
  membership: OrganizationChannelsRead | undefined,
  organizationId: string,
  salesChannelId: string,
): Promise<void> {
  if (!membership) {
    throw new HttpError(
      500,
      ERROR_CODES.INTERNAL,
      'Creating an order on behalf of a customer requires the salesChannelMembership port, which is not wired.',
    );
  }
  const channels = await membership.listChannelsForEntity('organization', organizationId);
  if (!channels.some((c) => c.id === salesChannelId && c.active)) {
    throw new HttpError(
      422,
      ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED,
      "This sales channel is not one of the organization's active sales channels.",
    );
  }
}
