import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  paymentMethodStatusPatchSchema,
  paymentMethodUpsertSchema,
  type PaymentMethodAdminListItem,
  type PaymentMethodAvailability,
  type PaymentReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeDeletePaymentMethodCommand,
  makeSetPaymentMethodStatusCommand,
  makeUpsertPaymentMethodCommand,
} from './commands/payment-method.commands.js';
import {
  effectiveState,
  toModulePresenceDto,
} from '@endora-commerce/platform/kernel';
import { PaymentMethod } from './entities/payment-method.entity.js';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { PaymentAdapterRegistry } from './services/payment-adapter-registry.js';
import type { PaymentMethodEligibilityService } from './services/payment-method-eligibility.js';
import {
  OrderStatusRegistryError,
  type OrderStatusRegistry,
} from './services/order-status-registry.port.js';
import type {
  RequireAdminAnyFactory,
  RequireAdminFactory,
} from '@endora-commerce/platform/kernel';

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
  /** Feature 034 — applies adapter `validateUseOnStorefront` + registered-adapter filtering. */
  eligibility?: PaymentMethodEligibilityService;
}

export interface PaymentMethodsAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /**
   * Only `GET /api/v1/admin/order-statuses` uses it, and only because that one
   * route is read by two editors — see the comment on its registration below.
   */
  requireAdminAny: RequireAdminAnyFactory;
  /** Issue #125 — the two admin writes run on the bus (Principle XIII). */
  commandBus: CommandBus;
  /** Feature 005 / T027b — new payment methods auto-bind to the system default. */
  salesChannelMembership?: SalesChannelMembershipPort;
  /** Feature 034 — validates `adapter` against the registered adapters. */
  registry?: PaymentAdapterRegistry;
  /** Feature 034 — validates `statusOn*` references + powers /admin/order-statuses. */
  orderStatusRegistry?: OrderStatusRegistry;
  /**
   * Feature 075 — the delete-guard's read of `payments`, or `null` when that
   * module is not effectively present. Required, unlike the optional deps
   * above: a missing guard would silently delete a method attempts still point
   * at, which is the one failure FR-003 exists to prevent.
   */
  paymentRead: () => PaymentReadPort | null;
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

    // Feature 034 — adapter validateUseOnStorefront + registered-adapter filter.
    // Sales-channel-assignment filtering is applied upstream once the storefront
    // checkout passes the resolved channel; org/customer context is best-effort
    // here (built-in validators do not depend on it).
    if (deps.eligibility) {
      rows = await deps.eligibility.filter(rows, {
        salesChannelId: null,
        organizationId: null,
        customerAccountId: null,
        surface: 'storefront',
      });
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
    { preHandler: requireAdmin('payment_methods:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(PaymentMethod, {}, { orderBy: { code: 'asc' } });
      const data = await Promise.all(rows.map((m) => serializeAdmin(m, deps)));
      return { data };
    },
  );

  /**
   * T017a — Order-status options for the admin status selectors (FR-009).
   *
   * The one route of this module's six that is **not** gated on
   * `payment_methods:read` alone, and the exception is a fact about its
   * consumers rather than about its data. It is registered once, here, and read
   * by two editors: the payment-method screen and — through
   * `admin/src/modules/delivery_methods/api/delivery-methods-client.ts` — the
   * delivery-method one, whose own routes still enforce `catalog:read` because
   * `delivery_methods` minting its own pair is a separate merge request.
   * Gating this on `payment_methods:read` alone would have left the
   * delivery-method status selectors answering 403 for every role that can open
   * that screen, and its loader rejects the whole page when they do.
   *
   * So it is an any-of over the two editors' read codes: holding either one is
   * sufficient, which is what `requireAdminAny` means. The `catalog:read`
   * member is the delivery-method editor's *current* gate and nothing more —
   * the merge request that gives `delivery_methods` its own pair replaces it,
   * and `test/contract/payment_methods/permission-authority.test.ts` asserts
   * both members so that replacement is a visible edit rather than a silent
   * widening.
   */
  app.get(
    '/api/v1/admin/order-statuses',
    { preHandler: deps.requireAdminAny(['payment_methods:read', 'catalog:read']) },
    async () => {
      const list = deps.orderStatusRegistry?.list() ?? [];
      return { data: list };
    },
  );

  // Registered payment adapters (feature 034) — powers the admin adapter picker
  // so an admin can bind a payment method to a specific backend driver
  // (e.g. `stripe`, `bank_transfer`) rather than defaulting to its `kind`.
  app.get(
    '/api/v1/admin/payment-methods/adapters',
    { preHandler: requireAdmin('payment_methods:read') },
    async () => {
      const list = deps.registry?.list() ?? [];
      return { data: list };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/payment-methods/:code',
    {
      preHandler: requireAdmin('payment_methods:write'),
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

      // Which methods a shop offers, and which order status each payment result
      // moves an order to, is operator configuration. The read below only tells
      // the Command whether this call creates or updates — the write itself
      // happens inside the bus transaction (issue #125).
      const existing = await em.findOne(PaymentMethod, { code: request.params.code });
      const { method: row, created } = await deps.commandBus.run(
        makeUpsertPaymentMethodCommand({
          code: request.params.code,
          body,
          adapter,
          existingId: existing?.id ?? null,
        }),
      );

      // Channel membership is the sales-channel bridge's own write, on its own
      // EntityManager, so it stays outside the Command rather than pretending to
      // share its transaction.
      if (created && deps.salesChannelMembership) {
        await deps.salesChannelMembership.bindToDefaultIfEmpty('payment-method', row.id);
      }
      // Replace sales-channel membership when an explicit (non-empty) set is given.
      if (body.salesChannelIds && body.salesChannelIds.length > 0 && deps.salesChannelMembership) {
        await replaceChannelMembership(deps.salesChannelMembership, row.id, body.salesChannelIds);
      }

      return { data: await serializeAdmin(row, deps) };
    },
  );

  /**
   * Availability — feature 076, D-82. The one write that decides whether a
   * method is offered to buyers, wherever an operator arrives from: the four
   * gateway screens link here rather than writing the column themselves.
   *
   * Keyed by **id**, like the `DELETE` beside it and unlike the `PUT` above:
   * the `PUT` is an upsert, so it is keyed by the natural key it may create,
   * while this operates on a row that must already exist. The 404 is inside the
   * Command, on its own transaction.
   */
  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/payment-methods/:id/status',
    {
      preHandler: requireAdmin('payment_methods:write'),
      schema: { body: paymentMethodStatusPatchSchema },
    },
    async (request) => {
      const body = paymentMethodStatusPatchSchema.parse(request.body);
      const row = await deps.commandBus.run(
        makeSetPaymentMethodStatusCommand(request.params.id, body.status),
      );
      return { data: await serializeAdmin(row, deps) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/payment-methods/:id',
    { preHandler: requireAdmin('payment_methods:write') },
    async (request, reply) => {
      // The 404 and the T017b delete-guard (FR-003) live inside the Command.
      // The guard's count runs on `paymentReadPort`, so it is `payments`
      // answering for its own table rather than this module reading it; with
      // that module switched off the guard has no answer and the delete is
      // refused rather than taken on trust.
      await deps.commandBus.run(
        makeDeletePaymentMethodCommand(request.params.id, { paymentRead: deps.paymentRead }),
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

/**
 * Why this method is, or is not, offered to a buyer (issue #96).
 *
 * The admin keeps every row — switching a gateway off drops nothing — so the
 * list carries the reason instead of the row. The reason is the owning module's
 * presence, taken from the projection `/platform/modules` already renders, so
 * no second vocabulary and no hard-coded module list on either frontend.
 */
function availabilityOf(
  m: PaymentMethod,
  deps: { registry?: PaymentAdapterRegistry },
): PaymentMethodAvailability {
  const ownerModule = deps.registry?.ownerOf(m.adapter) ?? null;
  const presence = ownerModule === null ? undefined : effectiveState.presence(ownerModule);
  return {
    ownerModule,
    available: deps.registry?.isAvailable(m.adapter) ?? false,
    ownerPresence: presence ? toModulePresenceDto(presence) : null,
  };
}

async function serializeAdmin(
  m: PaymentMethod,
  deps: PaymentMethodsAdminDeps,
): Promise<PaymentMethodAdminListItem> {
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
    // Presence-blind: an admin screen goes on rendering a Stripe row the way
    // Stripe renders it while Stripe is switched off.
    rendererKey: deps.registry?.entry(m.adapter)?.adapter.renderers?.admin ?? null,
    availability: availabilityOf(m, deps),
  };
}
