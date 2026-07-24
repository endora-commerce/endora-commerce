import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { apiPlaceOrderRequestSchema, ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { OrganizationCannotTransactError } from '../organizations/services/organization-context-service.js';
import type { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderStatus } from './entities/order-status.entity.js';
import { OrderAppliedPromotion } from './entities/order-applied-promotion.entity.js';
import type { OrderService } from './services/order-service.js';
import type { OrderApiIntakeService } from './services/order-api-intake-service.js';

/**
 * Feature 062 — external orders namespace (`/api/v1/external/orders*`), per
 * contracts/orders-api-key-intake.md and research §R8.
 *
 * Thin mounts ONLY: intake semantics live in `OrderApiIntakeService`
 * (idempotency + cart seed + full `placeOrder` delegation); reads reuse
 * `OrderService.listForCustomer` / `getById` with the `CustomerContext`
 * resolved from the key binding. The customer surface (`routes.ts`) is
 * untouched — byte-compatibility by construction.
 *
 * Namespace invariants (§0):
 *  - every endpoint requires a BOUND api key (`requireBoundApiKey`);
 *  - every response carries `Cache-Control: private, no-store` (scoped hook);
 *  - responses reuse the existing serialized order envelope — no partner DTO.
 */

export type ExternalOrdersGateFactory = (
  scope: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface OrdersExternalDeps {
  emFactory: () => EntityManager;
  orderService: OrderService;
  intakeService: OrderApiIntakeService;
  requireBoundApiKey: ExternalOrdersGateFactory;
  /** Feature 026 — same optional transact gate the customer surface wires. */
  assertOrganizationCanTransact?: ((organizationId: string) => Promise<void>) | undefined;
}

export async function registerOrdersExternalRoutes(
  app: FastifyInstance,
  deps: OrdersExternalDeps,
): Promise<void> {
  const { emFactory, orderService, intakeService, requireBoundApiKey } = deps;

  const requireBinding = (request: FastifyRequest) => {
    const binding = request.apiKeyBinding;
    if (!binding) {
      // Defensive — requireBoundApiKey always stashes the binding.
      throw new HttpError(
        403,
        ERROR_CODES.API_KEY_NOT_BOUND,
        'This endpoint requires a distributor-bound API key.',
      );
    }
    return binding;
  };

  // Encapsulated scope so the no-store rule applies to exactly this
  // namespace's responses (success and error alike) and nothing else.
  await app.register(async (external) => {
    external.addHook('onSend', async (_request, reply, payload) => {
      reply.header('cache-control', 'private, no-store');
      return payload;
    });

    // POST /api/v1/external/orders — idempotent line-item placement.
    external.post(
      '/api/v1/external/orders',
      { preHandler: requireBoundApiKey('orders:write') },
      async (request, reply) => {
        const binding = requireBinding(request);

        // Parsed in-handler (not via the route schema) so whole-request shape
        // errors are the namespace's 422 envelope.
        const parsed = apiPlaceOrderRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Request failed validation.',
            parsed.error.issues.map((issue) => ({
              path: issue.path.map(String).join('.'),
              issue: issue.message,
            })),
          );
        }

        // Step 1 — the same optional transact gate the customer surface runs
        // (feature 026 semantics; placeOrder's own guard also applies).
        if (deps.assertOrganizationCanTransact) {
          try {
            await deps.assertOrganizationCanTransact(binding.organizationId);
          } catch (err) {
            if (err instanceof OrganizationCannotTransactError) {
              throw new HttpError(
                423,
                ERROR_CODES.FORBIDDEN,
                'The bound Organization cannot transact in its current status.',
                { code: 'organization_cannot_transact', status: err.status },
              );
            }
            throw err;
          }
        }

        const idempotencyKey = headerValue(request.headers['idempotency-key']);
        const result = await intakeService.place(
          {
            apiKeyId: binding.apiKeyId,
            organizationId: binding.organizationId,
            salesChannelId: binding.salesChannelId,
            customerAccountId: binding.customerAccountId,
          },
          idempotencyKey,
          parsed.data,
        );
        reply.status(result.replayed ? 200 : 201);
        return { data: await serializeExternalOrder(emFactory(), result.order) };
      },
    );

    // GET /api/v1/external/orders — the designated service account's view.
    external.get(
      '/api/v1/external/orders',
      { preHandler: requireBoundApiKey('orders:read') },
      async (request) => {
        const binding = requireBinding(request);
        const ctx = {
          customerAccountId: binding.customerAccountId,
          organizationId: binding.organizationId,
        };
        const orders = await orderService.listForCustomer(ctx);
        const em = emFactory();
        return {
          data: await Promise.all(orders.map((o) => serializeExternalOrder(em, o))),
          pagination: { cursor: null, hasMore: false, limit: 50 },
        };
      },
    );

    // GET /api/v1/external/orders/:id — out-of-visibility / foreign ⇒ 404.
    external.get<{ Params: { id: string } }>(
      '/api/v1/external/orders/:id',
      { preHandler: requireBoundApiKey('orders:read') },
      async (request) => {
        const binding = requireBinding(request);
        const ctx = {
          customerAccountId: binding.customerAccountId,
          organizationId: binding.organizationId,
        };
        const order = await orderService.getById(request.params.id, ctx);
        return { data: await serializeExternalOrder(emFactory(), order) };
      },
    );
  });
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * The existing serialized order envelope (contract `orderSchema`). Mirrors the
 * customer surface's serializer in `routes.ts` — kept private there by the
 * "customer route file untouched" guard; both derive from the same
 * `@b2b/contracts` `orderSchema`, which pins the shape against drift.
 */
async function serializeExternalOrder(
  em: EntityManager,
  order: Order,
): Promise<Record<string, unknown>> {
  const items = await em.find(OrderItem, { orderId: order.id });
  const statusDef = await em.findOne(OrderStatus, { code: order.status });
  const appliedPromotions = await em.find(OrderAppliedPromotion, { orderId: order.id });
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    customFieldValues: order.customFieldValues ?? {},
    statusName: statusDef?.name ?? {},
    statusDefaultName: statusDef?.defaultName ?? order.status,
    paymentStatus: order.paymentStatus,
    deliveryAddress: order.deliveryAddress,
    billingAddress: order.billingAddress,
    deliveryMethod: {
      id: order.deliveryMethodId,
      code: order.deliveryMethodSnapshot.code,
      name: order.deliveryMethodSnapshot.name,
      cost: order.deliveryMethodSnapshot.cost,
    },
    paymentMethod: {
      id: order.paymentMethodId,
      code: order.paymentMethodSnapshot.code,
      name: order.paymentMethodSnapshot.name,
      kind: order.paymentMethodSnapshot.kind,
    },
    sourceQuoteRequestId: order.sourceQuoteRequestId ?? null,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productSnapshot: it.productSnapshot,
      variantId: it.variantId ?? null,
      variantSnapshot: it.variantSnapshot ?? null,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      lineTotal: Number(it.lineTotal),
    })),
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    discountTotal: Number(order.discountTotal),
    appliedPromotions: appliedPromotions.map((ap) => ({
      promotionId: ap.promotionId,
      couponId: ap.couponId ?? null,
      amount: Number(ap.amount),
      currency: ap.currency,
    })),
    deliveryTotal: Number(order.deliveryTotal),
    total: Number(order.total),
    currency: order.currency,
    customerNote: order.customerNote ?? null,
    placedAt: order.placedAt.toISOString(),
    nextAction: order.nextAction ?? null,
  };
}
