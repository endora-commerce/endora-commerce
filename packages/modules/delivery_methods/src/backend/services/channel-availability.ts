import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

/**
 * In which sales channels a delivery method is offered — the one statement of
 * the rule, read by the storefront catalogue, by the admin list and, through
 * `deliveryMethodReadPort.isAvailableInChannel`, by order placement.
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
 *     runs before it (`delivery-method-reconciler.ts`);
 *   - the demo seed writes no membership at all;
 *   - and until this rule the storefront catalogue filtered on nothing, so
 *     every such method has been offered at every checkout all along.
 *
 * Reading those rows as "nowhere" would empty existing checkouts on upgrade,
 * and repairing them at boot is the rebind issue #96 removed on purpose. So the
 * module declares the other convention on its bridge registration
 * (`emptyMeansEveryChannel`, `../index.ts`) and this file is where it is read.
 *
 * ## The read
 *
 * Through the two sanctioned bridge accessors and no SQL of its own
 * (Constitution XII): `filterEntityIdsInChannel` answers which of the methods
 * are bound to the channel, and `listChannelsForEntity` is asked, for the
 * remainder only, whether a method is bound to anything at all. A deployment
 * holds a handful of methods, so the per-method question is a handful of
 * indexed lookups.
 */
export type DeliveryMethodChannelReads = Pick<
  SalesChannelMembershipPort,
  'filterEntityIdsInChannel' | 'listChannelsForEntity'
>;

/**
 * The subset of `methodIds` offered in `channelId`: the methods bound to that
 * channel, plus the methods bound to no channel at all.
 */
export async function deliveryMethodIdsAvailableInChannel(
  membership: DeliveryMethodChannelReads,
  channelId: string,
  methodIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = [...new Set(methodIds)];
  if (ids.length === 0) return new Set<string>();

  const available = new Set(
    await membership.filterEntityIdsInChannel(channelId, 'delivery-method', ids),
  );
  for (const id of ids) {
    if (available.has(id)) continue;
    const boundTo = await membership.listChannelsForEntity('delivery-method', id);
    // Bound to other channels only: restricted, and not to this one.
    if (boundTo.length === 0) available.add(id);
  }
  return available;
}
