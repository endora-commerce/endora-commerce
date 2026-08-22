import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, deliveryMethodUpsertSchema } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { CommandBus } from '../../commands/index.js';
import {
  makeDeleteDeliveryMethodCommand,
  makeUpsertDeliveryMethodCommand,
  type ShipmentUsageCounter,
} from './commands/delivery-method.commands.js';
import { DeliveryMethod } from './entities/delivery-method.entity.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import type { ShippingAdapterRegistry } from './services/shipping-adapter-registry.js';
import type { ShippingMethodEligibilityService } from './services/shipping-method-eligibility.js';
import {
  OrderStatusRegistryError,
  type OrderStatusRegistry,
} from './services/order-status-registry.port.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

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
   * history from a delete (there is no foreign key).
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

    // Feature 035 — adapter validateUseOnStorefront + registered-adapter filter.
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
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(DeliveryMethod, {}, { orderBy: { code: 'asc' } });
      const data = await Promise.all(rows.map((m) => serializeAdmin(m, deps)));
      return { data };
    },
  );

  // Note: `GET /api/v1/admin/order-statuses` is registered once by the
  // payment-methods admin routes (same OrderStatusRegistry data); the admin
  // delivery-methods page reuses that endpoint for its status selectors.

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/delivery-methods/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: deliveryMethodUpsertSchema },
    },
    async (request) => {
      const body = deliveryMethodUpsertSchema.parse(request.body);
      const em = deps.emFactory();

      // Only hard-reject an *explicitly* provided unknown adapter. A row whose
      // derived adapter is not registered is retained but excluded from
      // selection by the eligibility filter (FR-003), so admins can still
      // manage catalog rows whose adapter module is currently disabled.
      if (body.adapter !== undefined && deps.registry && !deps.registry.isRegistered(body.adapter)) {
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

      // The read below only tells the Command whether this call creates or
      // updates; the write itself happens inside the bus transaction, which is
      // also where the adapter is resolved against the row it finds (#125).
      const existing = await em.findOne(DeliveryMethod, { code: request.params.code });
      const { method: row, created: isNew } = await deps.commandBus.run(
        makeUpsertDeliveryMethodCommand({
          code: request.params.code,
          body,
          existingId: existing?.id ?? null,
        }),
      );

      // Channel membership is the sales-channel bridge's own write, on its own
      // EntityManager, so it stays outside the Command rather than pretending to
      // share its transaction.
      if (isNew && deps.salesChannelMembership) {
        await deps.salesChannelMembership.bindToDefaultIfEmpty('delivery-method', row.id);
      }
      // Replace sales-channel membership when an explicit (non-empty) set is given.
      if (body.salesChannelIds && body.salesChannelIds.length > 0 && deps.salesChannelMembership) {
        await replaceChannelMembership(deps.salesChannelMembership, row.id, body.salesChannelIds);
      }

      return { data: await serializeAdmin(row, deps) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/delivery-methods/:id',
    { preHandler: requireAdmin('catalog:write') },
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

async function serializeAdmin(m: DeliveryMethod, deps: DeliveryMethodsAdminDeps) {
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
  };
}
