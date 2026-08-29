import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import type {
  AdminUserReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
  QuoteRequestReadPort,
  RfqCustomerPort,
  SalesChannelAttributionRegistryPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { QuoteRequestReadService } from './services/quote-request-read-port.js';
import { registerQuoteRequestSalesChannelAttributions } from './services/sales-channel-attributions.js';
import {
  lazyPort,
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { QUOTE_REQUESTS_SETTING_CODES } from '../manifest.js';
import { quoteRequestsModule, type QuoteRequestsModuleOptions } from './plugin.js';
import { QuoteRequest } from './entities/quote-request.entity.js';
import { QuoteRequestEvent } from './entities/quote-request-event.entity.js';
import { QuoteRequestItem } from './entities/quote-request-item.entity.js';
import { QuoteRequestNotificationEvent } from './entities/quote-request-notification-event.entity.js';
import { QuoteRequestRevision } from './entities/quote-request-revision.entity.js';

/**
 * `quote_requests` — four settings resolvers that belonged to the module
 * (feature 072, wave 3, T132).
 *
 * `resolveExpiryDays`, `resolveBoolSetting`, `resolveBusinessIdPrefix` and
 * `resolveBusinessIdSuffix` each read a `quote_requests.*` setting and fall back
 * to this module's own default. All four were written out in a composition root
 * — twice, once per root, with the same try/catch — so that the module "isn't
 * coupled to the settings read API". It resolves a settings port already; the
 * indirection put four of the module's own knobs somewhere they could drift,
 * and they did: the harness passed neither business-ID resolver, so RFQ numbers
 * in tests never carried the prefix or suffix production stamps on them.
 *
 * The sales-rep scope has the same story with a sharper edge. Absent, the RFQ
 * admin scope silently stops being subtree-aware, so a sales representative
 * holding `organizations:rollup` sees only their own rows. The harness passed
 * nothing, so feature 056's rollup was exercised by no test at all. It became a
 * `salesRepSubtree` contribution out of which this module assembled its own
 * `SalesRepAssignmentService`; issue #108 found the third such assembly, in
 * `customers`, missing the optional argument that carries the roll-up. So the
 * assembly moved to its owner and this module resolves
 * `organizationSalesRepScopePort` — one implementation, nothing to forget.
 *
 * The two actor resolvers stay root-shaped for the reason they always were:
 * production reads `request.actor` and throws a 401 envelope, the harness reads
 * `request.testActor`. That is a composition's answer to "who is asking".
 */

/** What `quote_requests` resolves from the container, and the names it owns. */
export interface QuoteRequestsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: QuoteRequestsModuleOptions['requireCustomer'];
  readonly settingsReadPort: SettingsReadPort;
  /**
   * The channel a global-scope settings read resolves against: the deployment's
   * system-default sales channel, or `null` when it has none. A root input
   * (`check-port-dependencies.ts`), resolved by `stripe`, `autopay`,
   * `inventory` and others under this same name.
   */
  readonly settingsChannelResolver: () => Promise<string | null>;
  readonly customFieldValueService: NonNullable<
    QuoteRequestsModuleOptions['customFieldValues']
  >;
  /** Root-shaped: production reads `request.actor`, the harness `request.testActor`. */
  readonly rfqCustomerContextResolver: QuoteRequestsModuleOptions['resolveCustomerContext'];
  readonly rfqAdminContextResolver: QuoteRequestsModuleOptions['resolveAdminContext'];
  /** Contributed: the organization's effective tax rate for a quoted line. */
  readonly rfqTaxRateResolver: NonNullable<QuoteRequestsModuleOptions['resolveTaxRate']>;
  /**
   * The sales-rep assignment scope, owned by `organizations` (issue #108).
   *
   * T138 split it into the two ports it is *built* from — the org tree and the
   * `organizations:rollup` capability check — and this module assembled a
   * `SalesRepAssignmentService` out of them. That put the assembly in three
   * places, and the one place that got it wrong (`customers`, which omitted the
   * optional subtree argument entirely) compiled. The assembled port is one
   * name, and nobody can assemble it differently.
   */
  readonly organizationSalesRepScopePort: QuoteRequestsModuleOptions['salesRepAssignment'];
  readonly quoteRequests: ReturnType<typeof quoteRequestsModule>;
  readonly rfqService: ReturnType<typeof quoteRequestsModule>['handle'] extends () => infer H
    ? H extends { rfqService: infer S }
      ? S
      : never
    : never;
}

/**
 * `setting_values.sales_channel_id` is a `uuid` column, so a channel id that is
 * not one cannot match a row — PostgreSQL rejects the comparison outright. The
 * check is here rather than in the settings service because this is the caller
 * that has somewhere to degrade to.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conditions this module has already reported. Module scope and never reset, so
 * the guard is deliberately **per process** rather than per read: an unresolved
 * channel or a mis-scoped setting is a deployment fact that holds for every
 * subsequent read, and RFQ settings are read on every quote creation and every
 * storefront page load. One line per condition is what makes it findable; one
 * line per read is what makes it invisible. Same shape as
 * `transactional_emails`' `noTransportWarned`.
 */
const warnedConditions = new Set<string>();

function warnOnce(condition: string, message: string): void {
  if (warnedConditions.has(condition)) return;
  warnedConditions.add(condition);
  console.warn(message);
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    quoteRequests: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: QuoteRequestsCradle) => {
        /**
         * This module's own settings, read through the port it already holds,
         * against the **resolved** sales channel.
         *
         * It used to pass the literal `'default'` as the `salesChannelId`, a
         * spelling that came down from the composition root T132 lifted this
         * out of. `'default'` is a channel *code*; `setting_values.sales_channel_id`
         * is `uuid`, so PostgreSQL rejected every one of these reads
         * (`invalid input syntax for type uuid: "default"`), the bare `catch`
         * below swallowed it, and all four settings answered with their module
         * fallback on every call — expiry never applied, RFQ numbers never
         * carried the configured prefix or suffix, and an operator switching a
         * storefront flag off changed nothing.
         *
         * What the handler may absorb is now enumerated, because a bare `catch`
         * around a port call turns fail-closed into fail-open
         * (`docs/docs/architecture/kernel.md`; the composition checklist's rule 7):
         *
         *  - `SettingNotRegistered` — "no value configured yet", the normal
         *    state before the manifest reconciler has run. Quiet fallback.
         *  - `SettingOutOfScopeForChannel` — the operator scoped this setting to
         *    other channels, so no value applies here. The module default is the
         *    right answer, but the scoping is almost certainly unintended, so it
         *    is warned about.
         *  - everything else — a shape mismatch, a driver error, a
         *    `ModuleDisabledError` from a switched-off owner — propagates.
         */
        const setting = async <T>(
          code: string,
          schema: z.ZodType<T>,
          fallback: T,
        ): Promise<T> => {
          const cradle = ctx.cradle<QuoteRequestsCradle>();
          const channelId = await cradle.settingsChannelResolver();
          if (channelId === null || !UUID_PATTERN.test(channelId)) {
            // Both roots answer this resolver with the system-default channel's
            // id, falling back to `ORGANIZATIONS_SETTINGS_CHANNEL_ID` — an env
            // knob whose own default is the string `'default'`. So "no channel"
            // arrives here in two shapes, `null` and a non-uuid placeholder, and
            // neither can address a `setting_values` row. Degrading to the
            // module default keeps RFQs working, but silently is exactly the
            // failure above, so it is reported.
            warnOnce(
              'unresolved-channel',
              `[quote_requests] no sales channel resolved for settings (got ` +
                `${channelId === null ? 'null' : `"${channelId}"`}) — every ` +
                `quote_requests.* setting falls back to its module default ` +
                `(logged once per process).`,
            );
            return fallback;
          }
          try {
            return await cradle.settingsReadPort.get(code, channelId, schema);
          } catch (error) {
            if (error instanceof SettingNotRegistered) return fallback;
            if (error instanceof SettingOutOfScopeForChannel) {
              warnOnce(
                `out-of-scope:${code}`,
                `[quote_requests] setting "${code}" is not in scope for sales channel ` +
                  `"${channelId}" — falling back to the module default ` +
                  `(logged once per process).`,
              );
              return fallback;
            }
            throw error;
          }
        };

        return quoteRequestsModule({
          emFactory,
          eventBus,
          auditLog: auditLogService,
          customFieldValues: lazyPort<QuoteRequestsCradle['customFieldValueService']>(
            ctx,
            'customFieldValueService',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<QuoteRequestsCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<QuoteRequestsCradle>().requireCustomer(req, reply),
          resolveCustomerContext: (req) =>
            ctx.cradle<QuoteRequestsCradle>().rfqCustomerContextResolver(req),
          resolveAdminContext: (req) =>
            ctx.cradle<QuoteRequestsCradle>().rfqAdminContextResolver(req),
          resolveTaxRate: (organizationId) =>
            ctx.cradle<QuoteRequestsCradle>().rfqTaxRateResolver(organizationId),
          // Issue #108 — `organizations`' scope, resolved. This used to be the
          // two feature-056 subtree deps, out of which this module built its own
          // `SalesRepAssignmentService`: one of three assemblies of one class,
          // and the shape whose optional third argument `customers` omitted.
          salesRepAssignment: lazyPort<QuoteRequestsCradle['organizationSalesRepScopePort']>(
            ctx,
            'organizationSalesRepScopePort',
          ),
          // Feature 075, Phase C — the five owners this module read out of
          // directly, and the one it wrote into. Each was an `em.find` /
          // `em.create` against another module's table, which no gate can see;
          // all six are already binding `dependencies` of this manifest, and
          // `carts.replaceItemsForCustomer` moves the quote-to-cart conversion
          // inside the module that owns the tables (D-78 rule 1).
          catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
          // Issue #259 — the channel assortment gate on the three quote-line
          // seams. A kernel registration, so there is no seventh module edge.
          channelMembership: lazyPort<SalesChannelMembershipPort>(
            ctx,
            'salesChannelMembershipPort',
          ),
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          carts: lazyPort<CartWritePort>(ctx, 'cartWritePort'),
          resolveExpiryDays: () =>
            setting(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, z.number().int().nonnegative(), 0),
          resolveBoolSetting: (key) =>
            setting(
              key === 'show_add_to_quote_on_card'
                ? QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_CARD
                : QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_PDP,
              z.boolean(),
              true,
            ),
          resolveBusinessIdPrefix: () =>
            setting(QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_PREFIX, z.string(), ''),
          resolveBusinessIdSuffix: () =>
            setting(QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_SUFFIX, z.string(), ''),
        });
      })
      .singleton(),
  });

  // The type parameter is feature 075 Phase P's compile-time proof that the
  // service still satisfies `RfqCustomerPort` — the two methods `carts`,
  // `orders`, `shopping_lists`, `quick_order` and `customers` measurably call.
  // Both already answer with contract DTOs, so no adapter was needed.
  ctx.di.providePort<QuoteRequestReadPort>(
    'quoteRequestReadPort',
    ctx
      .asFunction(
        ({ emFactory }: QuoteRequestsCradle) => new QuoteRequestReadService(emFactory),
      )
      .singleton(),
  );

  ctx.di.providePort<RfqCustomerPort>(
    'rfqService',
    ctx
      .asFunction(({ quoteRequests }: QuoteRequestsCradle) => quoteRequests.handle().rfqService)
      .singleton(),
  );

  /**
   * US5 — an order created from a quote request completes it (issue #107).
   *
   * This was a bare `eventBus.on` in the plugin body: with `quote_requests`
   * switched off it still flipped the RFQ to Completed, appended a `completed`
   * event row and enqueued the customer notification — while every route that
   * could show the customer that quote request refused. `ctx.subscribe` makes
   * the module's effective state decide.
   */
  ctx.subscribe('order.created.v1', async (payload) => {
    await ctx
      .cradle<QuoteRequestsCradle>()
      .quoteRequests.handle()
      .orderCompletionReactor.onOrderCreated(payload);
  });

  /**
   * How many quote requests are attributed to a sales channel (feature 075,
   * D-87).
   *
   * `sales_channels` used to count them itself, naming this module's table and
   * this module's column in raw SQL. A read port would have been the wrong
   * repair and this module is the reason: `sales_channels` is
   * `nonDeactivatable`, and the lifecycle refuses to disable a module a
   * non-deactivatable one depends on, so a `dependencies` entry pointing this
   * way would have made this module permanently undeactivatable in order to
   * count rows before a channel delete.
   *
   * A **contribution** hook: it pushes an inert counter into
   * `salesChannelAttributionRegistry`, an ungated registry, and carries no
   * presence probe (D-67/D-68). It must not carry one for a second reason here
   * — the registry's policy is to honour an absent contributor, because the
   * rows survive a deactivation and `quote_requests_sales_channel_fk` is
   * `on delete restrict`, so a probe would turn a 422 naming this module into a
   * raw constraint violation.
   */
  ctx.onBoot(() => {
    registerQuoteRequestSalesChannelAttributions(
      lazyPort<SalesChannelAttributionRegistryPort>(ctx, 'salesChannelAttributionRegistry'),
      ctx.cradle<QuoteRequestsCradle>().emFactory,
    );
  });

  ctx.routes(async (app) => {
    await ctx.cradle<QuoteRequestsCradle>().quoteRequests.register(app);
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform already reads, in two places: the boot-time
 * loader (`src/packages/package-runtime.ts`, `exported['entities']`) and the
 * static declaration reader (`scripts/lib/package-declarations.ts`), which is
 * the third source of `check:module-boundary`'s `table→owner` map and the
 * package pass of `check-entity-tenant-classification`. `blog` published
 * `export *` lines instead until D-168, which satisfied only the committed host
 * registry — the one path that stops being taken the day the module is
 * *installed* rather than linked, at which point the loader read `undefined`,
 * returned `[]`, and registered zero entities without a word.
 *
 * The absence of a named export is the load-bearing half. With one,
 * `import type { QuoteRequest } from '@endora-commerce/mod-quote-requests/backend'`
 * compiles in any consumer — ours, a deployment's, a stranger's — and only a
 * check whose population is *this* repository could ever object. Without it,
 * that import is TS2459 in the consumer's own tree (the barrel imports the
 * classes to build the array, so TypeScript gives the more precise "declares it
 * locally, but it is not exported"), which is Principle I holding by
 * construction. Nothing legitimate is lost: D-32 already forbids an ORM
 * relation from another module into these classes, and every other cross-module
 * read goes through a contract type — `QuoteRequestReadPort` and
 * `RfqCustomerPort`, both published above.
 *
 * Identity matters more here than anywhere else in the package: MikroORM keys
 * its metadata on the class, so a consumer that reached these files by a second
 * specifier would register a second `QuoteRequest` and lose one of them at
 * discovery (D-160.6, measured). One array behind one declared subpath is the
 * only way in.
 */
export const entities = [
  QuoteRequest,
  QuoteRequestEvent,
  QuoteRequestItem,
  QuoteRequestNotificationEvent,
  QuoteRequestRevision,
];
