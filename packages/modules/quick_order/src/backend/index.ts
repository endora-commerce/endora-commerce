import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type {
  AddressReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CatalogQuickSearchPort,
  CustomerAccountReadPort,
  CustomerAddressReadPort,
  DefaultPreferencePort,
  DeliveryMethodReadPort,
  OrderPlacementPort,
  OrganizationRestrictionPort,
  PaymentMethodReadPort,
  RfqCustomerPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import {
  QUICK_ORDER_SETTING_CODES,
  DEFAULT_IMPORT_MAX_ROWS,
  DEFAULT_ONE_CLICK_BUY_ENABLED,
} from '../manifest.js';
import { CatalogPortLookup } from './services/catalog-lookup.js';
import { QuickOrderImportPipeline } from './services/import-pipeline.js';
import { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { DefaultPreferenceService } from './services/default-preference-service.js';
import { OneClickService } from './services/one-click-service.js';
import { registerQuickOrderRoutes } from './routes.js';
import { registerQuickOrderAdminRoutes } from './routes.admin.js';
import { registerQuickOrderPreferenceRoutes } from './routes.preferences.js';
import { registerQuickOrderPreferenceAdminRoutes } from './routes.preferences.admin.js';
import { registerQuickOrderOneClickRoutes } from './routes.one-click.js';
import { QuickOrderDefaultPreference } from './entities/quick-order-default-preference.entity.js';

/**
 * `quick_order` — a module that owned five route files and was mounted by
 * another module's plugin (feature 072, wave 4, T139).
 *
 * Nothing here is new code. All of it lived in `shopping_lists/plugin.ts`,
 * whose header described itself as *"composition root for the shopping_lists +
 * quick_order modules"* — two lifecycle participants, one factory, and
 * therefore one activation control. `shopping_lists`' own manifest said so
 * outright: its description covered "the quick-order surfaces this module
 * hosts", with a note pointing at this task.
 *
 * The cost was not organisational. Because the surfaces were mounted by
 * `shopping_lists`, switching *that* module off took quick order with it, and
 * switching quick order off was not expressible at all — a deployment that
 * wants CSV import but no shopping lists, or the reverse, could not be
 * configured. Constitution XVII says presence is per module; a module whose
 * surfaces another module mounts has no presence of its own.
 *
 * **Three nested conditionals decided which endpoints existed.** The host
 * mounted the preference routes only `if (options.auditLog)`, the admin
 * preference routes only `if (options.requireAdmin && options.resolveAdminContext)`,
 * and one-click buy only `if (options.getOrderService && options.resolveOneClickEnabled)`.
 * Every root passed all five, so the reduced shapes were nobody's deployment —
 * but "which endpoints does this module serve" answered by "which arguments did
 * a root remember", which is the defect this whole wave removes. All five route
 * groups register unconditionally now, and the module's own activation control
 * is the one intentional gate.
 *
 * **Feature 075, Phase C — every collaborator is a published port now.** The
 * five type imports this file carried (`CartService`, `CatalogAttributeReadService`,
 * `OrderService`, `OrganizationRestrictionService`, `RfqService`) named five
 * other modules' classes; they are `@endora-commerce/contracts` interfaces resolved by
 * `lazyPort` with a string literal. Six more ports arrive with them, because
 * the two preference surfaces and the CSV lookup were reading five modules'
 * entities directly.
 *
 * `orderServiceAccessor` is gone with the last of them. The one-click flow
 * reached `OrderService` through it — a `() => OrderService | null` whose
 * `null` arm the service turned into a 503 — and `orderPlacementPort` answers
 * the same 503 at the resolution seam, where a wiring mistake and an absent
 * module stop being the same value.
 */

/** What `quick_order` resolves from the container, and the names it owns. */
export interface QuickOrderCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly customerContextResolver: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly settingsReadPort: SettingsReadPort;
  readonly quickOrderPipeline: QuickOrderImportPipeline;
  readonly quickOrderBuildService: QuickOrderBuildService;
  readonly quickOrderPreferenceService: DefaultPreferenceService;
  readonly quickOrderOneClickService: OneClickService;
}

/**
 * Conditions this module has already reported (D-43's warn-once). Module scope
 * and never reset: the import cap is read on every upload, admin and customer.
 */
const warnedConditions = new Set<string>();

function warnOnce(condition: string, message: string): void {
  if (warnedConditions.has(condition)) return;
  warnedConditions.add(condition);
  console.warn(message);
}

/**
 * `customers` absent: the buyer has no personal addresses (issue #216).
 *
 * D-44 `degrades-without`, and the degrade is not invented for the occasion.
 * Principle XVII says a switched-off module behaves as if never installed, and
 * a platform on which `customers` was never installed has no
 * `customer_addresses`: only the organisation's shared addresses are eligible
 * defaults. That is exactly what `resolveForCustomer` already does with a
 * default it finds ineligible (FR-020) — it drops the field to `null`, and
 * one-click buy hides itself because not all four defaults resolve. A buyer
 * whose defaults are org addresses is unaffected.
 *
 * Failing closed here instead would 503 the whole preference resolution — and
 * with it one-click buy for *every* buyer — because the personal-address branch
 * is probed on every eligibility check. Switching off a CRM surface must not do
 * that.
 *
 * `customerAddressReadPort` is a **gated** port: a closed gate throws rather
 * than answering `null`, so the presence probe comes *before* the resolution,
 * and it is per call rather than per composition — the factory below is a
 * singleton, and an operator flipping `customers` on must not need a restart.
 */
const ABSENT_CUSTOMER_ADDRESSES: CustomerAddressReadPort = {
  findById: async () => null,
  listForCustomer: async () => [],
};

export function customerAddressesOrAbsent(
  port: CustomerAddressReadPort,
): CustomerAddressReadPort {
  const pick = (): CustomerAddressReadPort =>
    effectiveState.isPresent('customers') ? port : ABSENT_CUSTOMER_ADDRESSES;
  return {
    findById: (customerAccountId, addressId, options) =>
      pick().findById(customerAccountId, addressId, options),
    listForCustomer: (customerAccountId, kind) => pick().listForCustomer(customerAccountId, kind),
  };
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): QuickOrderCradle => ctx.cradle<QuickOrderCradle>();

  /**
   * Feature 075, Phase P — the buyer's one-click defaults.
   *
   * `customers` renders and edits them from its own customer-detail screen, so
   * the surface and the table sit in different modules by design.
   * `resolveForCustomer` answers with the defaults **already resolved** —
   * through the buyer's saved addresses and the platform's methods — rather
   * than the stored row, because the fallback chain is this module's and a
   * caller reproducing it would reproduce it differently.
   */
  ctx.di.providePort<DefaultPreferencePort>(
    'defaultPreferencePort',
    ctx
      .asFunction(() => ({
        resolveForCustomer: (customerAccountId: string) =>
          cradle().quickOrderPreferenceService.resolveForCustomer(customerAccountId),
        upsert: (
          actor: Parameters<DefaultPreferencePort['upsert']>[0],
          input: Parameters<DefaultPreferencePort['upsert']>[1],
          audit: Parameters<DefaultPreferencePort['upsert']>[2],
        ) => cradle().quickOrderPreferenceService.upsert(actor, input, audit),
      }))
      .singleton(),
  );

  ctx.di.register({
    quickOrderPipeline: ctx
      .asFunction(
        () =>
          new QuickOrderImportPipeline(
            new CatalogPortLookup(
              lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
              // Issue #259 — the channel assortment gate on the pasted-SKU
              // seam. A kernel registration, so no module edge to declare.
              lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            ),
          ),
      )
      .singleton(),

    quickOrderBuildService: ctx
      .asFunction(
        () =>
          new QuickOrderBuildService(
            // Both are other modules' gated ports and both are stored by the
            // constructor, so a singleton may not hold them directly — Awilix's
            // strict mode refuses a transient inside a longer-lived object.
            lazyPort<CartWritePort>(ctx, 'cartWritePort'),
            lazyPort<RfqCustomerPort>(ctx, 'rfqService'),
          ),
      )
      .singleton(),

    quickOrderPreferenceService: ctx
      .asFunction(
        ({ emFactory, auditLogService }: QuickOrderCradle) =>
          new DefaultPreferenceService(emFactory, auditLogService, {
            // Five gated ports and one degrade. Every one of these was an
            // `em.findOne` against another module's entity until issue #216:
            // deactivation drops no tables, so a stored default kept resolving
            // out of a switched-off module's rows and one-click buy went on
            // offering a payment method the platform had stopped serving.
            //
            // `payment_methods`, `delivery_methods`, `addresses`,
            // `customer_accounts` and `organizations` are all binding
            // dependencies of this module, so their gates fail closed: the
            // resolution throws `ModuleDisabledError` and the call answers 503
            // `MODULE_DISABLED` rather than resolving half a set of defaults.
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            paymentMethods: lazyPort<PaymentMethodReadPort>(ctx, 'paymentMethodReadPort'),
            deliveryMethods: lazyPort<DeliveryMethodReadPort>(ctx, 'deliveryMethodReadPort'),
            addresses: lazyPort<AddressReadPort>(ctx, 'addressReadPort'),
            customerAddresses: customerAddressesOrAbsent(
              lazyPort<CustomerAddressReadPort>(ctx, 'customerAddressReadPort'),
            ),
            restriction: lazyPort<OrganizationRestrictionPort>(ctx, 'organizationRestrictionPort'),
          }),
      )
      .singleton(),

    quickOrderOneClickService: ctx
      .asFunction(
        ({ quickOrderPreferenceService }: QuickOrderCradle) =>
          new OneClickService(
            quickOrderPreferenceService,
            lazyPort<CartWritePort>(ctx, 'cartWritePort'),
            lazyPort<OrderPlacementPort>(ctx, 'orderPlacementPort'),
            // This module's own setting, read here rather than through a
            // resolver a host passes down. The channel comes from the request
            // (`routes.one-click.ts`), so `null` means there was none and the
            // per-storefront value is read platform-wide (D-41 case c).
            //
            // The bare `catch { return false }` this replaces is what made
            // issue #99 invisible: it swallowed `SettingsChannelIdInvalid` from
            // the `'default'` code the service used to compile in, and reported
            // the result as `setting_disabled`. It would swallow
            // `ModuleDisabledError` just as happily (composition rule 7). Only
            // the two conditions with a defined degrade are absorbed now, and
            // both degrade to the manifest default rather than to a second
            // literal beside it (D-43).
            async (salesChannelId: string | null) => {
              try {
                return await cradle().settingsReadPort.get(
                  QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED,
                  salesChannelId,
                  z.boolean(),
                );
              } catch (error) {
                if (error instanceof SettingNotRegistered) return DEFAULT_ONE_CLICK_BUY_ENABLED;
                if (error instanceof SettingOutOfScopeForChannel) {
                  warnOnce(
                    `out-of-scope:${QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED}`,
                    `[quick_order] setting "${QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED}" ` +
                      `is scoped to specific sales channels, so it has no value for this read — ` +
                      `falling back to the manifest default (logged once per process).`,
                  );
                  return DEFAULT_ONE_CLICK_BUY_ENABLED;
                }
                throw error;
              }
            },
          ),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const {
      requireAdmin,
      quickOrderPipeline: pipeline,
      quickOrderBuildService: buildService,
      quickOrderPreferenceService: preferenceService,
      quickOrderOneClickService: oneClickService,
    } = cradle();
    const requireCustomer = (req: FastifyRequest, reply: unknown): Promise<void> =>
      cradle().requireCustomer(req, reply);
    const resolveCustomerContext = (
      req: FastifyRequest,
    ): { customerAccountId: string; organizationId: string } =>
      cradle().customerContextResolver(req);

    /**
     * Read **platform-wide** (feature 072, D-41 case c). The manifest has
     * always described this setting as "Global" — it is an upper bound on what
     * one upload may cost the server, not a per-storefront policy — and the
     * same value has to answer on the admin surface, where there is no
     * storefront channel to resolve at all.
     *
     * Before T139 the host read it against a `settingsChannelId` option it
     * defaulted to `'default'`, and fell back to the constant whenever a
     * composition passed no settings service — which the harness did, so every
     * test ran the manifest default while production read the configured value
     * (T133's finding, one layer down). T139 lifted the read here and kept the
     * `'default'` literal, which is a channel **code** against a `uuid` column:
     * every read threw in the driver and the bare `catch` made it look like an
     * unconfigured platform. The cap has therefore been the compiled-in 2000 on
     * every deployment, whatever the operator set.
     */
    const resolveImportMaxRows = async (): Promise<number> => {
      try {
        return await cradle().settingsReadPort.get(
          QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
          null,
          z.number().int().positive(),
        );
      } catch (error) {
        if (error instanceof SettingNotRegistered) return DEFAULT_IMPORT_MAX_ROWS;
        if (error instanceof SettingOutOfScopeForChannel) {
          warnOnce(
            `out-of-scope:${QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS}`,
            `[quick_order] setting "${QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS}" is ` +
              `scoped to specific sales channels, so it has no platform-wide value — ` +
              `falling back to the manifest default (logged once per process).`,
          );
          return DEFAULT_IMPORT_MAX_ROWS;
        }
        throw error;
      }
    };

    await registerQuickOrderRoutes(app, {
      pipeline,
      buildService,
      requireCustomer,
      resolveCustomerContext,
      resolveImportMaxRows,
      // Issue #174 — one port where three deps used to be, and the type-ahead
      // is scoped to the request's sales channel because `catalog` scopes it.
      catalogQuickSearch: lazyPort<CatalogQuickSearchPort>(ctx, 'catalogQuickSearchPort'),
    });

    await registerQuickOrderAdminRoutes(app, {
      pipeline,
      buildService,
      requireAdmin,
      resolveImportMaxRows,
      customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
    });

    await registerQuickOrderPreferenceRoutes(app, {
      service: preferenceService,
      customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
      requireCustomer,
      resolveCustomerContext,
    });

    await registerQuickOrderPreferenceAdminRoutes(app, {
      service: preferenceService,
      customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
      salesRepScope: lazyPort<SalesRepAssignmentPort>(ctx, 'organizationSalesRepScopePort'),
      requireAdmin,
      resolveAdminContext: (req: FastifyRequest) => cradle().adminContextResolver(req),
    });

    await registerQuickOrderOneClickRoutes(app, {
      service: oneClickService,
      requireCustomer,
      resolveCustomerContext,
    });
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
  QuickOrderDefaultPreference,
];
