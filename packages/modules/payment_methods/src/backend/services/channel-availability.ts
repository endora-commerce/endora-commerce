import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

/**
 * In which sales channels a payment method is offered — the one statement of
 * the rule, read by the storefront catalogue, by the admin list and, through
 * `paymentMethodReadPort.isAvailableInChannel`, by order placement.
 *
 * ## The rule
 *
 * A membership row is a **restriction**. A method bound to one or more channels
 * is offered in exactly those; a method bound to **none** is offered in every
 * channel.
 *
 * ## Why "none" is not "nowhere", although it is for a product
 *
 * The bridge's own convention is the opposite one: an entity belongs to at
 * least one channel, and a channel-scoped read fails closed on an entity with
 * no row. It is right for a product, where "bound to nothing" means
 * unpublished. It cannot be this module's, because rows without a membership
 * are how methods ordinarily exist:
 *
 *   - a module that ships its own method seeds the row from its **install
 *     hook**, and `bindToDefaultChannel` answers `false` there whenever the
 *     system-default channel does not exist yet — which is every fresh
 *     instance, since that channel is created at first boot and the install
 *     runs before it (`payment-method-reconciler.ts`);
 *   - the demo seed writes no membership at all;
 *   - and until this rule the storefront catalogue filtered on nothing, so
 *     every such method has been offered at every checkout all along.
 *
 * Reading those rows as "nowhere" would empty existing checkouts on upgrade,
 * and repairing them at boot is the rebind issue #96 removed on purpose. So the
 * module declares the other convention on its bridge registration
 * (`emptyMeansEveryChannel`, `../index.ts`) and this file is where it is read.
 *
 * ## The read, and where the rule is actually applied
 *
 * One call to the sanctioned bridge accessor and no SQL of this module's own
 * (Constitution XII): `filterEntityIdsAvailableInChannel`. The platform's
 * membership service applies the "bound to none means offered" half **because
 * this module's bridge is registered with `emptyMeansEveryChannel`**
 * (`../index.ts`) — the declaration is the single source of the convention, and
 * without it the same call answers the way it does for a product. This file
 * names the entity type and adds nothing to the rule.
 */
export type PaymentMethodChannelReads = Pick<
  SalesChannelMembershipPort,
  'filterEntityIdsAvailableInChannel'
>;

/**
 * The subset of `methodIds` offered in `channelId`: the methods bound to that
 * channel, plus the methods bound to no channel at all.
 */
export async function paymentMethodIdsAvailableInChannel(
  membership: PaymentMethodChannelReads,
  channelId: string,
  methodIds: readonly string[],
): Promise<ReadonlySet<string>> {
  return new Set(
    await membership.filterEntityIdsAvailableInChannel(channelId, 'payment-method', methodIds),
  );
}
