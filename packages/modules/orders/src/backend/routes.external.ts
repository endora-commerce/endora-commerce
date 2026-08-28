import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  apiPlaceOrderRequestSchema,
  ERROR_CODES,
  OrganizationCannotTransactError,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
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

/**
 * What {@link OrdersExternalDeps.requireBoundApiKey} stashes on the request
 * after a successful binding assertion, as **this** route requires it.
 *
 * `request.apiKeyBinding` is not on `FastifyRequest`: it is a
 * declaration-merging augmentation `api_keys` contributes from its own plugin.
 * Inside `backend/src` that augmentation arrived ambiently, through the host's
 * one program, so nothing here ever named it — and a package compiles against
 * its own manifest, where it does not exist (TS2339).
 *
 * The remedy every other module took for this — `import type {} from '<pkg>'`
 * (`@fastify/cookie`, `@fastify/multipart`, `@fastify/rate-limit`) — is not
 * available, and the difference is the point: in all thirteen of those cases the
 * augmenting package is a **third party**, and here it is another **module**.
 * `api_keys` publishes `.`, `./backend` and `./migrations` and no `./ports`, so
 * naming it would be a reach into a subpath that exports runtime bindings —
 * a counted cross-module reach under D-171, needing a fresh ledger entry, which
 * is the debt this sweep exists to retire rather than to add to.
 *
 * So the shape is declared where the collaborator that produces it is already
 * declared, as a statement of what this route needs of the gate it is handed.
 * `@endora-commerce/contracts`' `ApiKeyBinding` is the published half and is
 * deliberately not reused: it carries the three identity columns and not
 * `apiKeyId`, which the intake below records as the authorship of the order.
 * Publishing the request-scoped shape is `api_keys`' call, not this move's.
 */
interface BoundApiKeyRequest {
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly salesChannelId: string;
  readonly customerAccountId: string;
}

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

  const requireBinding = (request: FastifyRequest): BoundApiKeyRequest => {
    const binding = (request as FastifyRequest & { apiKeyBinding?: BoundApiKeyRequest })
      .apiKeyBinding;
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
 * `@endora-commerce/contracts` `orderSchema`, which pins the shape against drift.
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
    deliveryPoint: order.deliveryPointSnapshot ?? null,
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
