import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type {
  AuthSessionPort,
  CustomerAccountReadPort,
  CustomerAddressReadPort,
  VatValidator,
} from '@b2b/contracts';
import { CustomerAddressReadService } from './services/customer-address-read-port.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { CUSTOMERS_SETTING_CODES } from './manifest.js';
import { customersModule, type CustomersModuleOptions } from './plugin.js';

/**
 * `customers` — three settings reads that only production performed
 * (feature 072, wave 4, T140).
 *
 * `resolveAllowRegistrationWithoutOrganization`, `resolveDeletionRetentionDays`
 * and `resolvePresenceFreshnessMinutes` all read this module's own settings
 * against the system-default channel. Production spelled each as an inline
 * try/catch closure; the harness passed `async () => 365` and
 * `async () => 10` for the last two, and a **bare string literal** for the
 * first where production used `CUSTOMERS_SETTING_CODES`.
 *
 * The retention one matters beyond tidiness. It is how long a deleted
 * customer's data survives before the anonymization sweep makes the deletion
 * irreversible — a GDPR-facing number an operator configures — and the read was
 * exercised by nothing. A regression in the read, in the channel resolution, or
 * in the schema shipped green. Third instance of this exact shape after
 * `inventory` (T129) and `shopping_lists` (T133).
 *
 * All three are read here now, through the settings port, against the resolved
 * system-default channel. Both compositions run the same code.
 *
 * **The VAT validator is `organizations`' to supply** (feature 076, D-86).
 * This module used to construct `new ViesClient()` from an import of that
 * module's `integrations/` directory, over a contribution point of its own —
 * a statement that `customers` knows how the platform talks to VIES. It does
 * not. `organizations` publishes `vatValidatorPort` over the same object its
 * own tax-ID service uses, so the fake a harness contributes reaches both
 * consumers by construction rather than by two roots agreeing to pass it —
 * which is what the note this paragraph replaces claimed and the mechanism did
 * not deliver.
 *
 * Two names stay a composition's, both actor-shaped and both owned by `auth` in
 * principle: who the calling customer is, and who the moderating admin is. They
 * join the four `auth` entries already in `HOST_REGISTERED_PORTS` and drain with
 * them. `customerOrderListServiceGetter` is the third, late-bound because
 * `orders` builds the service and a root bridges it (T141); the binding is late
 * because the service is constructed there, not because the module is unconverted.
 */

/** What `customers` resolves from the container, and the names it owns. */
export interface CustomersCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsService;
  readonly salesChannelResolutionPort: SalesChannelResolverService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: CustomersModuleOptions['requireCustomer'];
  readonly sessionService: CustomersModuleOptions['sessionService'];
  readonly customerAuthService: CustomersModuleOptions['customerAuthService'];
  readonly passwordResetService: CustomersModuleOptions['passwordResetService'];
  readonly customFieldValueService: NonNullable<CustomersModuleOptions['customFieldValues']>;
  readonly rfqService: CustomersModuleOptions['rfqService'];
  readonly organizationRestrictionPort: NonNullable<
    CustomersModuleOptions['organizationRestrictionService']
  >;
  /** Owned by `organizations`: which organizations a staff member may act on. */
  readonly organizationSalesRepScopePort: CustomersModuleOptions['salesRepVisibility'];
  readonly emailMailer: CustomersModuleOptions['mailer'];
  /** The storefront origin the set-password link points at. */
  readonly storefrontBaseUrl: string;
  /** Root-shaped, owner `auth`: who is asking, with a nullable organisation. */
  readonly customerActorResolver: CustomersModuleOptions['resolveCustomerActor'];
  /** Root-shaped, owner `auth`: the moderating admin and the scope they see. */
  readonly customerModerationActorResolver: CustomersModuleOptions['resolveModerationActor'];
  /**
   * `orders`' own accessor (T141), replacing the root getter this module used
   * to read. Answers `null` until `orders` registers its routes, so the
   * throwing wrapper below is what turns "not yet bound" into an error.
   */
  readonly orderListServiceAccessor: () => ReturnType<
    CustomersModuleOptions['getOrderListService']
  > | null;
  readonly customers: ReturnType<typeof customersModule>;
}

/**
 * What the two order-history panels read while `orders` is not effectively
 * present — the behaviour `customers`' `degrades-without` declaration promises,
 * written as a value so the promise is one object a test can point at.
 *
 * Empty rather than a refusal because the panel is a read-only history and an
 * account with no orders sees exactly this. `counts` is the per-status tally
 * the admin list renders; there are no orders to tally.
 */
const EMPTY_ORDER_LIST: ReturnType<CustomersModuleOptions['getOrderListService']> = {
  list: async () => ({ rows: [], total: 0, counts: {} }),
};

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): CustomersCradle => ctx.cradle<CustomersCradle>();

  /**
   * This module's own settings, read against the system-default channel. Each
   * degrades to the manifest default rather than failing the request — the
   * identical try/catch stood in the production root, three times over.
   *
   * D-48 removed an `if (!channel) return fallback;` from between the two: on
   * the impossible no-channel branch it returned the compiled-in constant
   * without reading the setting at all, which is worse than switching tier.
   */
  const readChannelSetting = async <T>(
    code: string,
    schema: Parameters<SettingsService['get']>[2],
    fallback: T,
  ): Promise<T> => {
    try {
      const channel = await cradle().salesChannelResolutionPort.getSystemDefault();
      return (await cradle().settingsReadPort.get(code, channel.id, schema)) as T;
    } catch {
      return fallback;
    }
  };

  /**
   * Feature 075, Phase P — the customer's own saved addresses.
   *
   * `quick_order` reads one when it fills in a buyer's one-click defaults. The
   * table is distinct from `addresses`' on purpose and the port keeps them
   * distinct: this one hangs off a customer account, that one off an
   * organisation, and a B2C buyer keeps addresses that are theirs rather than
   * their personal organisation's.
   */
  ctx.di.providePort<CustomerAddressReadPort>(
    'customerAddressReadPort',
    ctx
      .asFunction(({ emFactory }: CustomersCradle) => new CustomerAddressReadService(emFactory))
      .singleton(),
  );

  ctx.di.register({
    customers: ctx
      .asFunction(
        ({ emFactory, commandBus, auditLogService }: CustomersCradle) =>
          customersModule({
            emFactory,
            commandBus,
            auditLogService,
            // Every one of these is another module's gated port and is stored by
            // the constructor, so a singleton may not hold one directly.
            customerAuthService: lazyPort<CustomersCradle['customerAuthService']>(
              ctx,
              'customerAuthService',
            ),
            passwordResetService: lazyPort<CustomersCradle['passwordResetService']>(
              ctx,
              'passwordResetService',
            ),
            sessionService: lazyPort<CustomersCradle['sessionService']>(ctx, 'sessionService'),
            // Feature 075 — the two ports the `ImpersonationService` this
            // module still builds itself now takes. See `plugin.ts`.
            authSessionPort: lazyPort<AuthSessionPort>(ctx, 'authSessionPort'),
            customerAccountReadPort: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            customFieldValues: lazyPort<CustomersCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            rfqService: lazyPort<CustomersCradle['rfqService']>(ctx, 'rfqService'),
            organizationRestrictionService: lazyPort<
              CustomersCradle['organizationRestrictionPort']
            >(ctx, 'organizationRestrictionPort'),
            // Issue #108 — `organizations`' scope, not a private copy of its
            // wiring. The copy this replaces omitted the optional subtree deps,
            // so feature 056's roll-up was skipped for every block / unblock /
            // delete / org-assign decision, and `tsc` had nothing to say about
            // it.
            salesRepVisibility: lazyPort<CustomersCradle['organizationSalesRepScopePort']>(
              ctx,
              'organizationSalesRepScopePort',
            ),
            mailer: lazyPort<CustomersCradle['emailMailer']>(ctx, 'emailMailer'),
            // Feature 076 (D-86) — `organizations`' port, resolved lazily: the
            // factory below is a singleton and stores what it is handed, and a
            // captured gate keeps answering after its owner is switched off.
            vatValidator: lazyPort<VatValidator>(ctx, 'vatValidatorPort'),
            storefrontBaseUrl: cradle().storefrontBaseUrl,
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
            resolveCustomerActor: (req: FastifyRequest) => cradle().customerActorResolver(req),
            resolveModerationActor: (req: FastifyRequest) =>
              cradle().customerModerationActorResolver(req),
            getOrderListService: () => {
              // D-44 `degrades-without`: the manifest withdraws the flip-time
              // refusal on `orders`, so an operator may switch it off with the
              // two history panels still mounted. `orderListServiceAccessor` is
              // a **gated port** — a closed gate throws rather than answering
              // `null` — so the presence probe comes before the resolution, not
              // after it. The declared degradation is an empty page, which is
              // also what an account with no orders sees.
              if (!effectiveState.isPresent('orders')) return EMPTY_ORDER_LIST;
              const service = cradle().orderListServiceAccessor();
              if (!service) throw new Error('OrderListService not yet bound');
              return service;
            },
            // The three reads that used to be a root's, one of them exercised
            // by no test at all — see the note above.
            resolveAllowRegistrationWithoutOrganization: () =>
              readChannelSetting(
                CUSTOMERS_SETTING_CODES.ALLOW_REGISTRATION_WITHOUT_ORGANIZATION,
                z.boolean(),
                false,
              ),
            resolveDeletionRetentionDays: () =>
              readChannelSetting(CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS, z.number(), 365),
            resolvePresenceFreshnessMinutes: () =>
              readChannelSetting(
                CUSTOMERS_SETTING_CODES.PRESENCE_FRESHNESS_MINUTES,
                z.number(),
                10,
              ),
          }),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    await cradle().customers.plugin(app);
  });
}
