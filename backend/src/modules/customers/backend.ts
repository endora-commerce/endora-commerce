import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { CUSTOMERS_SETTING_CODES } from './manifest.js';
import { ViesClient } from '../organizations/integrations/vies-client.js';
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
 * **`vatValidator` is the `organizations` seam again**, and deliberately the
 * same shape: production defaults to the real `ViesClient`, the harness
 * contributes `FakeVatValidator`. The harness comment on the old call site said
 * it passes "the same fake the organizations wiring gets, rather than a second
 * one that answered differently for the same tax id" — that coupling is now
 * structural rather than a note.
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
  /**
   * Contribution point: production talks to VIES, the harness scripts it —
   * the same validator `organizations` gets, by construction.
   */
  readonly customersVatValidator: CustomersModuleOptions['vatValidator'];
  readonly customers: ReturnType<typeof customersModule>;
}

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

  ctx.di.register({
    // Production contributes nothing and reaches the real registry.
    customersVatValidator: ctx
      .asFunction((): CustomersCradle['customersVatValidator'] => new ViesClient())
      .singleton(),

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
            customFieldValues: lazyPort<CustomersCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            rfqService: lazyPort<CustomersCradle['rfqService']>(ctx, 'rfqService'),
            organizationRestrictionService: lazyPort<
              CustomersCradle['organizationRestrictionPort']
            >(ctx, 'organizationRestrictionPort'),
            mailer: lazyPort<CustomersCradle['emailMailer']>(ctx, 'emailMailer'),
            vatValidator: cradle().customersVatValidator,
            storefrontBaseUrl: cradle().storefrontBaseUrl,
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
            resolveCustomerActor: (req: FastifyRequest) => cradle().customerActorResolver(req),
            resolveModerationActor: (req: FastifyRequest) =>
              cradle().customerModerationActorResolver(req),
            getOrderListService: () => {
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
