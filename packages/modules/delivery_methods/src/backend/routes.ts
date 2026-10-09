import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  deliveryMethodUpsertSchema,
  type DeliveryMethodAdapterOption,
  type DeliveryMethodAdminListItem,
  type DeliveryMethodAvailability,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeDeleteDeliveryMethodCommand,
  makeUpsertDeliveryMethodCommand,
  type ShipmentUsageCounter,
} from './commands/delivery-method.commands.js';
import { DeliveryMethod } from './entities/delivery-method.entity.js';
import {
  effectiveState,
  toModulePresenceDto,
  type SalesChannelMembershipPort,
} from '@endora-commerce/platform/kernel';
import type { ShippingAdapterRegistry } from './services/shipping-adapter-registry.js';
import type { ShippingMethodEligibilityService } from './services/shipping-method-eligibility.js';
import {
  OrderStatusRegistryError,
  type OrderStatusRegistry,
} from './services/order-status-registry.port.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import {
  deliveryMethodIdsAvailableInChannel,
  type DeliveryMethodChannelReads,
} from './services/channel-availability.js';

/**
 * Delivery-method catalog routes (feature 035 — adapter framework).
 *
 * Public read endpoint lists active, eligible methods for storefront checkout;
 * admin mutation lives under `/api/v1/admin/delivery-methods`. Eligibility
 * validators (validateUseOnStorefront) + registered-adapter filtering are
 * layered on by the eligibility service; the org allow-list filter is retained.
 */
export interface DeliveryMethodsPublicDeps {
  emFactory: () => EntityManager;
  /**
   * The bridge reads behind the catalogue's sales-channel filter. Required, not
   * optional: an absent one would be indistinguishable from "no method is
   * restricted", which offers every method on every channel.
   */
  salesChannelMembership: DeliveryMethodChannelReads;
  /**
   * Feature 026 US4 — per-Organization allow-list of delivery-method IDs.
   * Empty / null ⇒ platform defaults apply (every active method is offered).
   */
  resolveOrganizationDeliveryMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /** Feature 035 — resolves a method's storefront renderer key. */
  registry?: ShippingAdapterRegistry;
  /** Feature 035 — applies adapter `validateUseOnStorefront` + registered-adapter filtering. */
  eligibility?: ShippingMethodEligibilityService;
}

export interface DeliveryMethodsAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Issue #125 — the two admin writes run on the bus (Principle XIII). */
  commandBus: CommandBus;
  /** Feature 005 / T027b — new delivery methods auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipPort;
  /** Feature 035 — validates `adapter` against the registered adapters. */
  registry?: ShippingAdapterRegistry;
  /** Feature 035 — validates `statusOn*` references + powers /admin/order-statuses. */
  orderStatusRegistry?: OrderStatusRegistry;
  /**
   * Feature 075 — the FR-003 delete guard's count, asked of `shipments` because
   * the rows are its own. Required, not optional: a guard that can be left out
   * is a guard that silently is, and it is the only thing protecting shipment
   * history from a delete (there is no foreign key). The upsert asks it too,
   * before it rebinds a method to another adapter.
   */
  countShipmentsForMethod: ShipmentUsageCounter;
}

function rendererKeyFor(deps: { registry?: ShippingAdapterRegistry }, adapter: string): string | null {
  return deps.registry?.get(adapter)?.renderers?.storefront ?? null;
}

export async function registerDeliveryMethodsPublicRoutes(
  app: FastifyInstance,
  deps: DeliveryMethodsPublicDeps,
): Promise<void> {
  app.get('/api/v1/delivery-methods', async (request) => {
    const em = deps.emFactory();
    let rows = await em.find(DeliveryMethod, { status: 'active' }, { orderBy: { code: 'asc' } });

    // Feature 026 US4 — intersect with the Organization's delivery-method
    // allow-list when one is configured.
    if (deps.resolveOrganizationDeliveryMethodAllowList) {
      const allowList = await deps.resolveOrganizationDeliveryMethodAllowList(request);
      if (allowList && allowList.length > 0) {
        const allowSet = new Set(allowList);
        rows = rows.filter((m) => allowSet.has(m.id));
      }
    }

    // The sales-channel filter (Constitution XII): only the methods offered in
    // the channel **this request resolved**. A method bound to no channel is
    // offered in every one — `services/channel-availability.ts` states the rule
    // and why it differs from a product's.
    //
    // `currentSalesChannel()` is `null` only where the resolver did not run,
    // which inside `/api/v1/*` is never: it falls back to the system default.
    // The `null` arm therefore narrows nothing rather than inventing a channel
    // to narrow against — the same reading `productIdsInRequestChannel` gives it.
    const channel = currentSalesChannel();
    if (channel) {
      const offered = await deliveryMethodIdsAvailableInChannel(
        deps.salesChannelMembership,
        channel.id,
        rows.map((m) => m.id),
      );
      rows = rows.filter((m) => offered.has(m.id));
    }

    // Feature 035 — adapter validateUseOnStorefront + registered-adapter filter.
    // The adapter context is deliberately left as it was (`salesChannelId:
    // null`): which channel an adapter's own validator is told about is a
    // separate question from which methods the channel offers, and changing it
    // here would change what every gateway and carrier module decides.
    if (deps.eligibility) {
      rows = await deps.eligibility.filter(rows, {
        salesChannelId: null,
        organizationId: null,
        customerAccountId: null,
        surface: 'storefront',
      });
    }

    return { data: rows.map((m) => serializeDeliveryMethod(m, deps)) };
  });
}

export async function registerDeliveryMethodsAdminRoutes(
  app: FastifyInstance,
  deps: DeliveryMethodsAdminDeps,
): Promise<void> {
  const requireAdmin = deps.requireAdmin;

  app.get(
    '/api/v1/admin/delivery-methods',
    { preHandler: requireAdmin('delivery_methods:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(DeliveryMethod, {}, { orderBy: { code: 'asc' } });
      const data = await Promise.all(rows.map((m) => serializeAdmin(m, deps)));
      return { data };
    },
  );

  /**
   * The adapters an operator may bind a method to — powers the adapter picker
   * on `/delivery-methods`.
   *
   * `list()` and not `listAll()`: the picker offers what can ship a parcel now,
   * so a carrier module an operator switched off drops out of the choice while
   * the rows already bound to it keep saying why they are unavailable (the
   * `availability` projection below). Registered before the `:code` write so
   * the literal segment is never read as a method code.
   */
  app.get(
    '/api/v1/admin/delivery-methods/adapters',
    { preHandler: requireAdmin('delivery_methods:read') },
    async () => {
      const registry = deps.registry;
      const data: DeliveryMethodAdapterOption[] = (registry?.list() ?? []).map((key) => ({
        key,
        ownerModule: registry?.ownerOf(key) ?? '',
      }));
      return { data };
    },
  );

  // Note: `GET /api/v1/admin/order-statuses` is registered once by the
  // payment-methods admin routes (same OrderStatusRegistry data); the admin
  // delivery-methods page reuses that endpoint for its status selectors. Since
  // this module took its own codes it is gated
  // `requireAdminAny(['payment_methods:read', 'delivery_methods:read'])` — an
  // any-of over the two editors' read codes, so whichever screen an operator
  // may open, the shared status list opens with it.

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/delivery-methods/:code',
    {
      preHandler: requireAdmin('delivery_methods:write'),
      schema: { body: deliveryMethodUpsertSchema },
    },
    async (request) => {
      const body = deliveryMethodUpsertSchema.parse(request.body);
      const em = deps.emFactory();

      // The read tells the Command whether this call creates or updates, and
      // tells the adapter guard below what the row is bound to now; the write
      // itself happens inside the bus transaction, which is also where the
      // adapter is resolved against the row it finds (#125).
      const existing = await em.findOne(DeliveryMethod, { code: request.params.code });

      // Only hard-reject an explicitly provided unknown adapter the row does
      // not already carry. A row whose adapter is not registered is retained
      // but excluded from selection by the eligibility filter (FR-003), so an
      // admin can still manage — re-price, deactivate — a row whose carrier
      // module is gone, and a form that sends the adapter it was shown does not
      // turn that edit into a 400. Choosing an unknown key is what is refused.
      if (
        body.adapter !== undefined &&
        body.adapter !== existing?.adapter &&
        deps.registry &&
        !deps.registry.isRegistered(body.adapter)
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown shipping adapter "${body.adapter}". Register an adapter module first.`,
        );
      }
      // Validate any explicitly-provided Order-status references (FR-008).
      if (deps.orderStatusRegistry) {
        for (const ref of [body.statusOnSuccess, body.statusOnFailure]) {
          if (ref !== undefined) assertValidStatus(deps.orderStatusRegistry, ref);
        }
      }

      const { method: row, created: isNew } = await deps.commandBus.run(
        makeUpsertDeliveryMethodCommand(
          {
            code: request.params.code,
            body,
            existingId: existing?.id ?? null,
          },
          deps.countShipmentsForMethod,
        ),
      );

      // Channel membership is the sales-channel bridge's own write, on its own
      // EntityManager, so it stays outside the Command rather than pretending to
      // share its transaction.
      if (deps.salesChannelMembership) {
        await applyChannelSelection(
          deps.salesChannelMembership,
          row.id,
          body.salesChannelIds,
          isNew,
        );
      }

      return { data: await serializeAdmin(row, deps) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/delivery-methods/:id',
    { preHandler: requireAdmin('delivery_methods:write') },
    async (request, reply) => {
      // The 404 and the delete-guard (FR-003) live inside the Command, so a
      // method that is gone is answered before another module is asked about
      // it. The count itself comes from `shipments` — see the Command's
      // `ShipmentUsageCounter` for why it no longer runs on this transaction.
      await deps.commandBus.run(
        makeDeleteDeliveryMethodCommand(request.params.id, deps.countShipmentsForMethod),
      );
      return reply.status(204).send();
    },
  );
}

function assertValidStatus(registry: OrderStatusRegistry, ref: string): void {
  try {
    registry.assertValid(ref);
  } catch (err) {
    if (err instanceof OrderStatusRegistryError) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Unknown order status "${ref}".`);
    }
    throw err;
  }
}

/**
 * What `salesChannelIds` on the upsert body means — three answers, and the
 * difference between the first two is the point.
 *
 * - **Omitted** — the caller said nothing about channels. An update leaves the
 *   memberships exactly as they are. A create binds the new method to the
 *   system-default channel, which is what this route has always done for a
 *   caller that does not send the field: an integration written before channels
 *   could be chosen keeps producing the row state it always produced, and a new
 *   method does not appear on a second channel because nobody mentioned it.
 * - **`[]`** — the caller chose "no restriction". Every membership is removed
 *   and the method is offered in every channel. This is what the admin form
 *   sends for "All channels", on create as on edit, and it is why an empty set
 *   is not treated as an omission any more.
 * - **One or more ids** — exactly those channels, replacing whatever was there.
 */
async function applyChannelSelection(
  membership: SalesChannelMembershipPort,
  methodId: string,
  salesChannelIds: string[] | undefined,
  created: boolean,
): Promise<void> {
  if (salesChannelIds === undefined) {
    if (created) await membership.bindToDefaultIfEmpty('delivery-method', methodId);
    return;
  }
  if (salesChannelIds.length === 0) {
    await membership.clearChannelsForEntity('delivery-method', methodId);
    return;
  }
  await replaceChannelMembership(membership, methodId, salesChannelIds);
}

async function replaceChannelMembership(
  membership: SalesChannelMembershipPort,
  methodId: string,
  desiredChannelIds: string[],
): Promise<void> {
  const current = await membership.listChannelsForEntity('delivery-method', methodId);
  const currentIds = new Set(current.map((c) => c.id));
  const desired = new Set(desiredChannelIds);
  // Add first so a later removal never transiently leaves zero channels.
  for (const id of desired) {
    if (!currentIds.has(id)) await membership.addToChannel(id, 'delivery-method', methodId);
  }
  for (const id of currentIds) {
    if (!desired.has(id)) await membership.removeFromChannel(id, 'delivery-method', methodId);
  }
}

function serializeDeliveryMethod(m: DeliveryMethod, deps: { registry?: ShippingAdapterRegistry }) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    adapter: m.adapter,
    cost: { amount: Number(m.cost), currency: m.currency },
    status: m.status,
    rendererKey: rendererKeyFor(deps, m.adapter),
  };
}

/**
 * Why this method is — or is not — offered at checkout, read off the registry
 * the public list filters on. Presence-blind for the owner and presence-aware
 * for the verdict, like the payment twin: an admin has to see the row *and*
 * which module would bring it back.
 */
function availabilityOf(
  m: DeliveryMethod,
  deps: { registry?: ShippingAdapterRegistry },
): DeliveryMethodAvailability {
  const ownerModule = deps.registry?.ownerOf(m.adapter) ?? null;
  const presence = ownerModule === null ? undefined : effectiveState.presence(ownerModule);
  return {
    ownerModule,
    available: deps.registry?.isAvailable(m.adapter) ?? false,
    ownerPresence: presence ? toModulePresenceDto(presence) : null,
  };
}

async function serializeAdmin(
  m: DeliveryMethod,
  deps: DeliveryMethodsAdminDeps,
): Promise<DeliveryMethodAdminListItem> {
  const channels = deps.salesChannelMembership
    ? await deps.salesChannelMembership.listChannelsForEntity('delivery-method', m.id)
    : [];
  return {
    id: m.id,
    code: m.code,
    adapter: m.adapter,
    name: m.name,
    cost: { amount: Number(m.cost), currency: m.currency },
    status: m.status,
    statusOnSuccess: m.statusOnSuccess,
    statusOnFailure: m.statusOnFailure,
    salesChannelIds: channels.map((c) => c.id),
    rendererKey: deps.registry?.get(m.adapter)?.renderers?.admin ?? null,
    availability: availabilityOf(m, deps),
  };
}
