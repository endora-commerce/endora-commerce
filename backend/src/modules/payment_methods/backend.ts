import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PaymentMethodReadPort, PaymentReadPort } from '@b2b/contracts';
import { lazyPort, type ModuleContext } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { CommandBus } from '../../commands/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import {
  registerPaymentMethodsAdminRoutes,
  registerPaymentMethodsPublicRoutes,
} from './routes.js';
import { EnumOrderStatusRegistry } from './services/order-status-registry.port.js';
import { PaymentMethodEligibilityService } from './services/payment-method-eligibility.js';
import { PaymentMethodReadService } from './services/payment-method-read-port.js';
import { paymentAdapterRegistry } from './services/registry-singleton.js';

/**
 * `payment_methods` — the module `orders` was mounting (feature 072, wave 1,
 * T097).
 *
 * `orders/plugin.ts` imported both route files, seeded the built-in adapters,
 * built the order-status registry and mounted the lot inside `commerceModule`.
 * The same shape `audit_logs` had, with the same consequence: the payment-method
 * surface could not exist without the orders module being composed, and the
 * eligibility service that feature 034 wrote for it went unwired for two
 * releases because the wiring lived in somebody else's file.
 *
 * **The adapter registry stays the process singleton, on purpose.** `stripe`,
 * `autopay`, `tpay` and `payu` all `import { paymentAdapterRegistry }` and
 * register into it, so building a second one here and registering *that* under
 * the container name would give the platform two registries — precisely the
 * multi-instance defect this wave has already fixed twice (`currencies`,
 * `addresses`). Registering the existing instance as the container's value
 * keeps exactly one and makes the container the single place that decides what
 * it is, which is what turns the eventual replacement into a one-line change.
 *
 * (The singleton's own comment justifies itself with "the install-hook context
 * cannot carry services". That is stale: all four providers register from their
 * `plugin.ts`, at composition time, where the container is available. The
 * replacement belongs to the wave that converts them.)
 */

export interface PaymentMethodsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly commandBus: CommandBus;
  readonly salesChannelMembershipPort: SalesChannelMembershipPort | undefined;
  /**
   * The two halves the allow-list is composed from (T138). This used to be one
   * `organizationPaymentMethodAllowList` contribution point that a root filled
   * with a closure fusing an actor read and an `organizations` table read.
   * `organizations` could not fill it once converted — a module may not write a
   * name another module owns — and the fusion was the defect anyway: one half
   * is a deployment input, the other is a port.
   */
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly organizationRestrictionPort: {
    allowedIdsFor(
      organizationId: string,
      kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
    ): Promise<string[] | null>;
  };
  readonly paymentAdapterRegistry: typeof paymentAdapterRegistry;
  readonly paymentMethodEligibility: PaymentMethodEligibilityService;
  readonly paymentOrderStatusRegistry: EnumOrderStatusRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // The built-in adapters are **not** seeded here: they live in `payments`
    // (`payments/adapters/built-in-adapters.ts`), so seeding them from this
    // module would be a reach into another module's internals to populate a
    // registry this one merely holds. `payments` pushes them from its own boot
    // hook (T143a), exactly as each gateway module registers its own — this
    // module holds the table and never decides what is in it.
    //
    // And it stays a plain `di.register`. `PaymentAdapterRegistryPort` is
    // published over this name, which makes it look like the odd one out beside
    // the ports below; it is not. Five modules push into it from `ctx.onBoot`,
    // where a `providePort` gate would throw `MODULE_DISABLED` during
    // composition, and converting it would move every edge into it from
    // `contributes` to `fails-closed` in the deactivation-consequence ledger —
    // changing the sentence the operator's confirmation dialog renders
    // (issue #192; port-publication.md §1.4). Presence is answered at
    // enumeration instead, keyed on the module recorded with each entry.
    paymentAdapterRegistry: ctx.asFunction(() => paymentAdapterRegistry).singleton(),

    paymentMethodEligibility: ctx
      .asFunction(
        (cradle: PaymentMethodsCradle) =>
          new PaymentMethodEligibilityService(cradle.paymentAdapterRegistry),
      )
      .singleton(),

    paymentOrderStatusRegistry: ctx.asFunction(() => new EnumOrderStatusRegistry()).singleton(),

  });

  /**
   * Feature 075, Phase P — the row-level read model.
   *
   * A **port**, unlike the two registrations above. The distinction is the one
   * the deactivation-consequence ledger draws: the two registries are
   * contribution seams whose absent-owner policy lives inside them and whose
   * edges classify as `contributes`, so a gate over the registration would
   * withdraw the table rather than one contributor's entry. A read of this
   * module's own table is nothing of the kind — with `payment_methods` off, a
   * caller asking which methods exist should be told the module is off.
   */
  ctx.di.providePort<PaymentMethodReadPort>(
    'paymentMethodReadPort',
    ctx
      .asFunction(
        ({ emFactory }: PaymentMethodsCradle) => new PaymentMethodReadService(emFactory),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const {
      emFactory,
      requireAdmin,
      paymentAdapterRegistry: registry,
      paymentMethodEligibility,
      paymentOrderStatusRegistry,
    } = ctx.cradle<PaymentMethodsCradle>();
    const membership = ctx.cradle<PaymentMethodsCradle>().salesChannelMembershipPort;

    /**
     * Composed here from the two halves, and deliberately without a `catch`.
     * The root closure this replaces wrapped the read in one, so a
     * `ModuleDisabledError` from the port would have read as "no restriction" —
     * fail-open on the one path whose whole job is to restrict. The single
     * degrade that belongs here ("this caller has no Organization") is the
     * resolver's own `null`, and the other ("the Organization is gone") is in
     * `allowedIdsFor`'s return type.
     */
    const resolveAllowList = async (req: FastifyRequest): Promise<string[] | null> => {
      const cradle = ctx.cradle<PaymentMethodsCradle>();
      const organizationId = cradle.customerOrganizationIdResolver(req);
      if (organizationId === null) return null;
      return cradle.organizationRestrictionPort.allowedIdsFor(organizationId, 'paymentMethodIds');
    };

    await registerPaymentMethodsPublicRoutes(app, {
      emFactory,
      registry,
      eligibility: paymentMethodEligibility,
      resolveOrganizationPaymentMethodAllowList: resolveAllowList,
    });

    /**
     * The delete-guard's one question for `payments`: how many attempts point
     * at the method an operator is deleting (FR-003).
     *
     * Resolved per call and never captured — `payments` is deactivatable, so a
     * port taken once at registration would go on answering after an operator
     * switched it off. `null` while it is absent, which the Command turns into
     * a 409 that says so; the alternative, deleting a method whose references
     * nobody could count, is the orphan the guard exists to prevent. Declared
     * in this module's manifest as `degrades-without` rather than in
     * `dependencies`, because `payments` already declares this module and the
     * reverse would close a cycle — and acknowledging it would keep the bind
     * and make `payments.enabled` unusable.
     */
    const paymentRead = (): PaymentReadPort | null =>
      effectiveState.isPresent('payments')
        ? lazyPort<PaymentReadPort>(ctx, 'paymentReadPort')
        : null;

    await registerPaymentMethodsAdminRoutes(app, {
      emFactory,
      requireAdmin,
      commandBus: ctx.cradle<PaymentMethodsCradle>().commandBus,
      registry,
      orderStatusRegistry: paymentOrderStatusRegistry,
      paymentRead,
      ...(membership === undefined ? {} : { salesChannelMembership: membership }),
    });
  });
}
