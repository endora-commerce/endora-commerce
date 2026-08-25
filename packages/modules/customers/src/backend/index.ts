import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type {
  AddressReadPort,
  AuthSessionPort,
  AuthSessionReadPort,
  CartQueryPort,
  CustomFieldValuePort,
  CustomerAccountAdminSearchPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountReadPort,
  CustomerAddressReadPort,
  CustomerAuthPort,
  CustomerGroupReadPort,
  CustomerPasswordResetPort,
  DefaultPreferencePort,
  EmailMailerPort,
  ImpersonationPort,
  OrderListPort,
  OrderReadPort,
  OrganizationDetailsPort,
  PersonalOrganizationPort,
  RfqCustomerPort,
  VatValidator,
} from '@endora-commerce/contracts';
import { CustomerAddressReadService } from './services/customer-address-read-port.js';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { CUSTOMERS_SETTING_CODES } from '../manifest.js';
import { customersModule, type CustomersModuleOptions } from './plugin.js';
import { CustomerAddress } from './entities/customer-address.entity.js';

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
 * them. The order-list getter used to be a third: it was late-bound because
 * `orders` builds the service inside its plugin body and a root bridged the
 * accessor. Feature 075's cut resolves `orderListPort` instead — the port keeps
 * that timing and answers a too-early call with a 503, so the late binding is
 * the owner's problem rather than a name two roots have to agree on.
 */

/** What `customers` resolves from the container, and the names it owns. */
export interface CustomersCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly settingsReadPort: SettingsReadPort;
  readonly salesChannelResolutionPort: SalesChannelResolutionPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: CustomersModuleOptions['requireCustomer'];
  readonly customerAuthService: CustomersModuleOptions['customerAuthService'];
  readonly passwordResetService: CustomersModuleOptions['passwordResetService'];
  readonly customFieldValueService: CustomFieldValuePort;
  readonly rfqService: RfqCustomerPort;
  /** Owned by `organizations`: which organizations a staff member may act on. */
  readonly organizationSalesRepScopePort: CustomersModuleOptions['salesRepVisibility'];
  readonly emailMailer: EmailMailerPort;
  /** The storefront origin the set-password link points at. */
  readonly storefrontBaseUrl: string;
  /** Root-shaped, owner `auth`: who is asking, with a nullable organisation. */
  readonly customerActorResolver: CustomersModuleOptions['resolveCustomerActor'];
  /** Root-shaped, owner `auth`: the moderating admin and the scope they see. */
  readonly customerModerationActorResolver: CustomersModuleOptions['resolveModerationActor'];
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
    schema: Parameters<SettingsReadPort['get']>[2],
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
        ({ emFactory, auditLogService }: CustomersCradle) =>
          customersModule({
            emFactory,
            auditLogService,
            // Every one of these is another module's gated port and is stored by
            // the constructor, so a singleton may not hold one directly.
            // Feature 075, Phase C (issue #195) — `customerAuthPort` rather
            // than the `customerAuthService` class registration. Unlike the
            // address pair this was never a record type over a class: the
            // cradle field resolved to a direct class-type import, an ordinary
            // FR-011 edge that happened to share the container name.
            customerAuthService: lazyPort<CustomerAuthPort>(ctx, 'customerAuthPort'),
            passwordResetService: lazyPort<CustomerPasswordResetPort>(
              ctx,
              'passwordResetService',
            ),
            // D-98.2 / issue #196 — `authSessionPort` is the name the contract
            // publishes; `sessionService` is `auth`'s class registration, and
            // resolving it here was the leak D-98.1 repaired for `addressService`.
            sessionService: lazyPort<AuthSessionPort>(ctx, 'authSessionPort'),
            customerAccountReadPort: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            // Feature 075, Phase C — the rest of `customer_accounts`' surface
            // this module's screens run on. Every one of these replaced a
            // direct load or mutation of that module's `CustomerAccount`
            // entity: the block/unblock/delete/restore/assign writes, the
            // retention scrub, the admin list's paginated query, and the
            // customer-group names beside it.
            customerAccountLifecycleWritePort: lazyPort<CustomerAccountLifecycleWritePort>(
              ctx,
              'customerAccountLifecycleWritePort',
            ),
            customerAccountAdminSearchPort: lazyPort<CustomerAccountAdminSearchPort>(
              ctx,
              'customerAccountAdminSearchPort',
            ),
            customerGroupReadPort: lazyPort<CustomerGroupReadPort>(ctx, 'customerGroupReadPort'),
            // `organizations`' row-level read (names on the admin list, the
            // existence check on the assignment screen) and its personal-org
            // provisioner, which the B2C registration and the retention sweep
            // both go through. Both replaced an `em.findOne(Organization, …)`
            // — and the sweep's three-field scrub of that row — here.
            organizationDetailsPort: lazyPort<OrganizationDetailsPort>(
              ctx,
              'organizationDetailsPort',
            ),
            personalOrganizationPort: lazyPort<PersonalOrganizationPort>(
              ctx,
              'personalOrganizationPort',
            ),
            // `addresses`' read: the org-shared book a customer may pick a
            // delivery address from, which this module used to query directly.
            addressReadPort: lazyPort<AddressReadPort>(ctx, 'addressReadPort'),
            customFieldValues: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
            rfqService: lazyPort<RfqCustomerPort>(ctx, 'rfqService'),
            // Issue #108 — `organizations`' scope, not a private copy of its
            // wiring. The copy this replaces omitted the optional subtree deps,
            // so feature 056's roll-up was skipped for every block / unblock /
            // delete / org-assign decision, and `tsc` had nothing to say about
            // it.
            salesRepVisibility: lazyPort<CustomersCradle['organizationSalesRepScopePort']>(
              ctx,
              'organizationSalesRepScopePort',
            ),
            mailer: lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
            // Feature 075 — `carts`' reporting read and `admin_users`'
            // impersonation seam, where this module built a second instance of
            // each from an import of the owner's directory. Both are gated
            // ports, so a singleton may not hold one directly.
            cartQueryPort: lazyPort<CartQueryPort>(ctx, 'cartQueryPort'),
            impersonationPort: lazyPort<ImpersonationPort>(ctx, 'impersonationPort'),
            // `auth`'s read over the session table, for the online-customers
            // panel — the last thing in this module that named `Session`.
            authSessionReadPort: lazyPort<AuthSessionReadPort>(ctx, 'authSessionReadPort'),
            // `orders`' published list, replacing the late-bound accessor and
            // the `Pick<OrderListService, 'list'>` that typed it. `orders` is
            // non-deactivatable, so the edge is an ordinary binding dependency
            // and the panels have no absent state to degrade into: the port's
            // own 503 covers the window before `orders` registers its routes.
            orderList: lazyPort<OrderListPort>(ctx, 'orderListPort'),
            // Feature 080, T048 (D-169) — `orders`' row-level read, for the
            // customer-detail header's sales-channel list. That list was an
            // `em.find(Order, …)` inside this module: a plain read of another
            // module's table, which kept answering out of an `orders` the
            // platform was not serving. A read takes a read-port method, never
            // an `EntityManager`-taking apply port. Same binding edge as
            // `orderListPort` above and the same manifest `dependencies` entry.
            orderReadPort: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            // Feature 076 (D-86) — `organizations`' port, resolved lazily: the
            // factory below is a singleton and stores what it is handed, and a
            // captured gate keeps answering after its owner is switched off.
            vatValidator: lazyPort<VatValidator>(ctx, 'vatValidatorPort'),
            // Issue #216 — the ordering defaults this module renders and edits
            // belong to `quick_order`. Until now it built a **second instance**
            // of that module's `DefaultPreferenceService` from an import of its
            // directory, so the two holders had to be converted together and
            // the port published for this consumer went unreached. Binding, per
            // the port's own contract: a switched-off `quick_order` answers 503
            // `MODULE_DISABLED` at the seam rather than half a set of defaults.
            defaultPreferencePort: lazyPort<DefaultPreferencePort>(ctx, 'defaultPreferencePort'),
            storefrontBaseUrl: cradle().storefrontBaseUrl,
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
            resolveCustomerActor: (req: FastifyRequest) => cradle().customerActorResolver(req),
            resolveModerationActor: (req: FastifyRequest) =>
              cradle().customerModerationActorResolver(req),
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

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  CustomerAddress,
];
