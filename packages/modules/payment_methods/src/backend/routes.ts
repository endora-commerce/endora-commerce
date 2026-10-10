import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type SalesChannelOption,
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
import { getResolvedChannel, SalesChannel } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import {
  paymentMethodIdsAvailableInChannel,
  type PaymentMethodChannelReads,
} from './services/channel-availability.js';
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
   * The bridge reads behind the catalogue's sales-channel filter. Required, not
   * optional: an absent one would be indistinguishable from "no method is
   * restricted", which offers every method on every channel.
   */
  salesChannelMembership: PaymentMethodChannelReads;
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
  /**
   * Who is acting, for the audit row of every channel assignment this route
   * changes. A change of where a method is offered is a Principle XIII write
   * like the method's own, and an audit row without its actor answers "what
   * changed" and not "who changed it".
   */
  resolveAuditActor?: (request: FastifyRequest) => { actorAdminUserId: string | null };
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

    // The sales-channel filter (Constitution XII): only the methods offered in
    // the channel **this request resolved**. A method bound to no channel is
    // offered in every one — `services/channel-availability.ts` states the rule
    // and why it differs from a product's.
    //
    // `getResolvedChannel` and not the nullable `currentSalesChannel()`: inside
    // `/api/v1/*` the resolver always leaves a channel (it falls back to the
    // system default), so "no channel" here can only be a composition that
    // mounted this route without the resolver — and that must stop the request
    // rather than list every method on it.
    const channel = getResolvedChannel(request);
    const offered = await paymentMethodIdsAvailableInChannel(
      deps.salesChannelMembership,
      channel.id,
      rows.map((m) => m.id),
    );
    rows = rows.filter((m) => offered.has(m.id));

    // Feature 034 — adapter validateUseOnStorefront + registered-adapter filter.
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
   * delivery-method one. Gating it on `payment_methods:read` alone would leave
   * the delivery-method status selectors 403 for a role that holds only the
   * delivery pair, which is every role that can open that screen and not this
   * one.
   *
   * So it is an any-of over the two editors' read codes: holding either one is
   * sufficient, which is what `requireAdminAny` means. The second member was
   * `catalog:read` for as long as `delivery_methods` borrowed the catalogue's
   * authority (MR !1078), and both members were asserted in
   * `test/contract/payment_methods/permission-authority.test.ts` so that the
   * merge request giving that module its own pair had to replace it visibly
   * rather than widen the gate in silence. This is that replacement: the member
   * is now `delivery_methods:read`, and no catalogue holder reaches the shared
   * list any more, because no catalogue holder opens either editor.
   *
   * The edge does not bind: an operator may switch `delivery_methods` off, and
   * when they do the code stops being grantable while `payment_methods:read`
   * goes on opening the list for the only screen still asking for it.
   */
  app.get(
    '/api/v1/admin/order-statuses',
    { preHandler: deps.requireAdminAny(['payment_methods:read', 'delivery_methods:read']) },
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

  /**
   * The sales channels a method may be assigned to — the options of the form's
   * **Sales channels** field.
   *
   * Gated on this module's own read code, and deliberately not on the
   * sales-channel module's. Choosing where a method is offered is part of
   * configuring the method (the `PUT` below takes `salesChannelIds` on this
   * module's write code alone, by owner ruling), so the administrator who may
   * do that must be able to see what there is to choose from; sending them to
   * `GET /api/v1/admin/sales-channels` would hand the field a 403 for every
   * role that configures methods and does not administer channels. It answers
   * the four fields a choice needs and nothing of a channel's configuration.
   *
   * Inactive channels are included and flagged: a method may be assigned to
   * one, and a form that could not show it would drop it on the next save.
   */
  app.get(
    '/api/v1/admin/payment-methods/sales-channels',
    { preHandler: requireAdmin('payment_methods:read') },
    async () => {
      const channels = await deps
        .emFactory()
        .find(SalesChannel, {}, { orderBy: { code: 'asc' } });
      const data: SalesChannelOption[] = channels.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        active: c.active,
      }));
      return { data };
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
      // Before anything is written: every channel named must exist. An unknown
      // id used to surface as a foreign-key failure from the membership write —
      // a 500, **after** the Command had committed the row — which for a new
      // method left it with no membership at all, and no membership means
      // offered on every channel.
      await assertSalesChannelsExist(em, body.salesChannelIds);

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
      if (deps.salesChannelMembership) {
        try {
          await applyChannelSelection(
            deps.salesChannelMembership,
            row.id,
            body.salesChannelIds,
            created,
            deps.resolveAuditActor?.(request) ?? { actorAdminUserId: null },
          );
        } catch (error) {
          // Fail closed. The row and its memberships are written on two
          // transactions, and a **new** row whose assignment failed is a
          // method bound to nothing — offered on every channel, which is wider
          // than anything the operator asked for. So the creation is taken
          // back, and the caller is told it failed. An update needs nothing
          // here: its assignment is replaced in one transaction of the bridge's
          // own, so a failure leaves the method offered exactly where it was.
          if (created) {
            await deps.commandBus
              .run(makeDeletePaymentMethodCommand(row.id, { paymentRead: deps.paymentRead }))
              .catch((cleanupError: unknown) => {
                request.log.error(
                  { err: cleanupError, paymentMethodId: row.id },
                  '[payment_methods] a new method whose channel assignment failed could not be removed; ' +
                    'it is offered on every sales channel until an operator assigns or deletes it',
                );
              });
          }
          throw error;
        }
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
  actor: { actorAdminUserId: string | null },
): Promise<void> {
  if (salesChannelIds === undefined) {
    if (created) await membership.bindToDefaultIfEmpty('payment-method', methodId, actor);
    return;
  }
  if (salesChannelIds.length === 0) {
    await membership.clearChannelsForEntity('payment-method', methodId, actor);
    return;
  }
  // One transaction of the bridge's own: the set is replaced whole or not at
  // all, so a failure cannot leave the method on a mixture of the old channels
  // and the new ones.
  const [first, ...rest] = salesChannelIds as [string, ...string[]];
  await membership.replaceChannelsForEntity('payment-method', methodId, [first, ...rest], actor);
}

/**
 * Refuses a `salesChannelIds` naming a channel that does not exist — one deleted
 * while the form was open, or a mistyped id from an API caller — with a field
 * error, before the method is written.
 *
 * `SalesChannel` is the platform's published entity for a kernel-owned table,
 * read here as the channel-options route above reads it; an inactive channel is
 * a channel, and a method may be assigned to one.
 */
async function assertSalesChannelsExist(
  em: EntityManager,
  salesChannelIds: readonly string[] | undefined,
): Promise<void> {
  if (salesChannelIds === undefined || salesChannelIds.length === 0) return;
  const ids = [...new Set(salesChannelIds)];
  const known = new Set(
    (await em.find(SalesChannel, { id: { $in: ids } }, { fields: ['id'] })).map((c) => c.id),
  );
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length === 0) return;
  throw new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    'One or more of the sales channels do not exist. Reload and choose again.',
    unknown.map((id) => ({ path: 'salesChannelIds', issue: id })),
  );
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
