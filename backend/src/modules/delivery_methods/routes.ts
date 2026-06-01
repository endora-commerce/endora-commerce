import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, deliveryMethodUpsertSchema } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { DeliveryMethod } from './entities/delivery-method.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import type { ShippingAdapterRegistry } from './services/shipping-adapter-registry.js';
import type { ShippingMethodEligibilityService } from './services/shipping-method-eligibility.js';
import {
  OrderStatusRegistryError,
  type OrderStatusRegistry,
} from './services/order-status-registry.port.js';

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
  /** Feature 005 / T027b — new delivery methods auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
  /** Feature 035 — validates `adapter` against the registered adapters. */
  registry?: ShippingAdapterRegistry;
  /** Feature 035 — validates `statusOn*` references + powers /admin/order-statuses. */
  orderStatusRegistry?: OrderStatusRegistry;
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

      let row = await em.findOne(DeliveryMethod, { code: request.params.code });
      let isNew = false;
      // The adapter is set at registration time and rarely changed; preserve an
      // existing row's adapter unless the body explicitly overrides it. A new
      // row defaults its adapter to the code.
      const adapter = body.adapter ?? row?.adapter ?? request.params.code;
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

      if (row) {
        row.name = body.name;
        row.cost = body.cost.toFixed(2);
        row.currency = body.currency;
        row.adapter = adapter;
        if (body.status !== undefined) row.status = body.status;
        if (body.statusOnSuccess !== undefined) row.statusOnSuccess = body.statusOnSuccess;
        if (body.statusOnFailure !== undefined) row.statusOnFailure = body.statusOnFailure;
      } else {
        row = em.create(DeliveryMethod, {
          code: request.params.code,
          name: body.name,
          cost: body.cost.toFixed(2),
          currency: body.currency,
          adapter,
          status: body.status ?? 'active',
          statusOnSuccess: body.statusOnSuccess ?? 'shipment_sent',
          statusOnFailure: body.statusOnFailure ?? 'processing',
        });
        isNew = true;
      }
      await em.persistAndFlush(row);

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
      const em = deps.emFactory();
      const row = await em.findOne(DeliveryMethod, { id: request.params.id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery method not found.');
      }
      // Delete-guard (FR-003): never orphan a Shipment's method reference.
      const referencing = await countShipmentsForMethod(em, row.id);
      if (referencing > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete delivery method: ${referencing} shipment(s) reference it. Set status to "inactive" instead.`,
        );
      }
      await em.removeAndFlush(row);
      reply.status(204).send();
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

async function countShipmentsForMethod(em: EntityManager, methodId: string): Promise<number> {
  const rows = await em
    .getConnection()
    .execute<Array<{ count: string }>>(
      `select count(*)::text as count from "shipments" where "delivery_method_id" = ?`,
      [methodId],
      'all',
      em.getTransactionContext(),
    );
  return Number(rows[0]?.count ?? '0');
}

async function replaceChannelMembership(
  membership: SalesChannelMembershipService,
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
