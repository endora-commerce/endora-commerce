import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, paymentMethodUpsertSchema } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { PaymentMethod } from './entities/payment-method.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import type { PaymentAdapterRegistry } from './services/payment-adapter-registry.js';
import {
  OrderStatusRegistryError,
  type OrderStatusRegistry,
} from './services/order-status-registry.port.js';

/**
 * Public read endpoint: list active payment methods (storefront checkout).
 * Admin mutation lives under `/api/v1/admin/payment-methods`. Eligibility
 * validators (validateUseOnStorefront) are layered on in US2 via the
 * eligibility service; this endpoint keeps the active ∩ org-allow-list
 * filtering.
 */
export interface PaymentMethodsPublicDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 026 US4 — per-Organization allow-list of payment-method IDs.
   * Empty / null ⇒ platform defaults apply (every active method is offered).
   */
  resolveOrganizationPaymentMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /** Feature 034 — resolves a method's storefront renderer key. */
  registry?: PaymentAdapterRegistry;
}

export interface PaymentMethodsAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 005 / T027b — new payment methods auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipService;
  /** Feature 034 — validates `adapter` against the registered adapters. */
  registry?: PaymentAdapterRegistry;
  /** Feature 034 — validates `statusOn*` references + powers /admin/order-statuses. */
  orderStatusRegistry?: OrderStatusRegistry;
}

function rendererKeyFor(deps: { registry?: PaymentAdapterRegistry }, adapter: string): string | null {
  return deps.registry?.get(adapter)?.renderers?.storefront ?? null;
}

export async function registerPaymentMethodsPublicRoutes(
  app: FastifyInstance,
  deps: PaymentMethodsPublicDeps,
): Promise<void> {
  app.get('/api/v1/payment-methods', async (request) => {
    const em = deps.emFactory();
    let rows = await em.find(PaymentMethod, { status: 'active' }, { orderBy: { code: 'asc' } });

    if (deps.resolveOrganizationPaymentMethodAllowList) {
      const allowList = await deps.resolveOrganizationPaymentMethodAllowList(request);
      if (allowList && allowList.length > 0) {
        const allowSet = new Set(allowList);
        rows = rows.filter((m) => allowSet.has(m.id));
      }
    }

    return { data: rows.map((m) => serializePublic(m, deps)) };
  });
}

export async function registerPaymentMethodsAdminRoutes(
  app: FastifyInstance,
  deps: PaymentMethodsAdminDeps,
): Promise<void> {
  const requireAdmin = deps.requireAdmin;

  app.get(
    '/api/v1/admin/payment-methods',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(PaymentMethod, {}, { orderBy: { code: 'asc' } });
      const data = await Promise.all(rows.map((m) => serializeAdmin(m, deps)));
      return { data };
    },
  );

  // T017a — Order-status options for the admin status selectors (FR-009).
  app.get(
    '/api/v1/admin/order-statuses',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const list = deps.orderStatusRegistry?.list() ?? [];
      return { data: list };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/payment-methods/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: paymentMethodUpsertSchema },
    },
    async (request) => {
      const body = paymentMethodUpsertSchema.parse(request.body);
      const em = deps.emFactory();

      const adapter = body.adapter ?? body.kind;
      if (deps.registry && !deps.registry.isRegistered(adapter)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown payment adapter "${adapter}". Register an adapter module first.`,
        );
      }
      // Validate any explicitly-provided Order-status references (FR-009).
      if (deps.orderStatusRegistry) {
        for (const ref of [body.statusOnPending, body.statusOnSuccess, body.statusOnFailure]) {
          if (ref !== undefined) assertValidStatus(deps.orderStatusRegistry, ref);
        }
      }

      let row = await em.findOne(PaymentMethod, { code: request.params.code });
      let isNew = false;
      if (row) {
        row.name = body.name;
        row.kind = body.kind;
        row.adapter = adapter;
        if (body.status !== undefined) row.status = body.status;
        if (body.additionalPrice !== undefined) row.additionalPrice = body.additionalPrice.toFixed(2);
        if (body.statusOnPending !== undefined) row.statusOnPending = body.statusOnPending;
        if (body.statusOnSuccess !== undefined) row.statusOnSuccess = body.statusOnSuccess;
        if (body.statusOnFailure !== undefined) row.statusOnFailure = body.statusOnFailure;
      } else {
        row = em.create(PaymentMethod, {
          code: request.params.code,
          name: body.name,
          kind: body.kind,
          adapter,
          status: body.status ?? 'active',
          additionalPrice: (body.additionalPrice ?? 0).toFixed(2),
          statusOnPending: body.statusOnPending ?? 'new',
          statusOnSuccess: body.statusOnSuccess ?? 'confirmed',
          statusOnFailure: body.statusOnFailure ?? 'cancelled',
        });
        isNew = true;
      }
      await em.persistAndFlush(row);

      if (isNew && deps.salesChannelMembership) {
        await deps.salesChannelMembership.bindToDefaultIfEmpty('payment-method', row.id);
      }
      // Replace sales-channel membership when an explicit (non-empty) set is given.
      if (body.salesChannelIds && body.salesChannelIds.length > 0 && deps.salesChannelMembership) {
        await replaceChannelMembership(deps.salesChannelMembership, row.id, body.salesChannelIds);
      }

      return { data: await serializeAdmin(row, deps) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/payment-methods/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const em = deps.emFactory();
      const row = await em.findOne(PaymentMethod, { id: request.params.id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment method not found.');
      }
      // T017b — delete-guard (FR-003): never orphan a Payment's method reference.
      const referencing = await countPaymentsForMethod(em, row.id);
      if (referencing > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete payment method: ${referencing} payment(s) reference it. Set status to "inactive" instead.`,
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

async function countPaymentsForMethod(em: EntityManager, methodId: string): Promise<number> {
  const rows = await em
    .getConnection()
    .execute<Array<{ count: string }>>(
      `select count(*)::text as count from "payments" where "payment_method_id" = ?`,
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
  const current = await membership.listChannelsForEntity('payment-method', methodId);
  const currentIds = new Set(current.map((c) => c.id));
  const desired = new Set(desiredChannelIds);
  // Add first so a later removal never transiently leaves zero channels.
  for (const id of desired) {
    if (!currentIds.has(id)) await membership.addToChannel(id, 'payment-method', methodId);
  }
  for (const id of currentIds) {
    if (!desired.has(id)) await membership.removeFromChannel(id, 'payment-method', methodId);
  }
}

function serializePublic(m: PaymentMethod, deps: { registry?: PaymentAdapterRegistry }) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    adapter: m.adapter,
    status: m.status,
    additionalPrice: Number(m.additionalPrice),
    rendererKey: rendererKeyFor(deps, m.adapter),
  };
}

async function serializeAdmin(m: PaymentMethod, deps: PaymentMethodsAdminDeps) {
  const channels = deps.salesChannelMembership
    ? await deps.salesChannelMembership.listChannelsForEntity('payment-method', m.id)
    : [];
  return {
    id: m.id,
    code: m.code,
    adapter: m.adapter,
    kind: m.kind,
    name: m.name,
    status: m.status,
    additionalPrice: Number(m.additionalPrice),
    statusOnPending: m.statusOnPending,
    statusOnSuccess: m.statusOnSuccess,
    statusOnFailure: m.statusOnFailure,
    salesChannelIds: channels.map((c) => c.id),
  };
}
