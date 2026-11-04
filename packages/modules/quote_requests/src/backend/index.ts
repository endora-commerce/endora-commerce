import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import { ERROR_CODES, QUOTE_REQUEST_PDF_LIMITS, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type {
  Actor,
  AdminI18nTranslatePort,
  AdminSearchProviderRegistryPort,
  AdminRolePort,
  AdminUserReadPort,
  BuyerLinePricePort,
  CartWritePort,
  CatalogAttributeReadPort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldCarryPort,
  CustomFieldCarryReceiverPort,
  CustomFieldListFilterPort,
  CustomFieldDefinitionReadPort,
  DocumentRenderPort,
  DocumentTypeRegistryPort,
  EmailDefaultsRegistryPort,
  OrderReadPort,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
  OrganizationTaxProfilePort,
  QuoteRequestReadPort,
  RfqCustomerPort,
  SalesChannelAttributionRegistryPort,
  SalesRepAssignmentPort,
  TaxServicePort,
  TransactionalEmailSender,
  WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { Redis } from 'ioredis';
import { QuoteRequestReadService } from './services/quote-request-read-port.js';
import { QuoteRequestCustomFieldCarryReceiver } from './services/quote-request-custom-field-carry-receiver.js';
import {
  createQuoteRequestAdminSearchProvider,
  type QuoteRequestAdminSearchProviderDeps,
} from './admin-search-provider.js';
import type { AdminContext } from './services/rfq-admin-service.js';
import { NegotiationPolicyService } from './services/negotiation-policy-service.js';
import { startRfqExpirySweep } from './workers/rfq-expiry-sweep-worker.js';
import { registerQuoteRequestSalesChannelAttributions } from './services/sales-channel-attributions.js';
import {
  effectiveState,
  enterSystemScope,
  lazyPort,
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '@endora-commerce/platform/kernel';
import type { RequireAdminAnyFactory, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelResolutionPort, SettingsReadPort } from '@endora-commerce/platform/kernel';
import { QUOTE_REQUESTS_SETTING_CODES } from '../manifest.js';
import { quoteRequestsModule, type QuoteRequestsModuleOptions } from './plugin.js';
import { QuoteRequest } from './entities/quote-request.entity.js';
import { QuoteRequestEvent } from './entities/quote-request-event.entity.js';
import { QuoteRequestItem } from './entities/quote-request-item.entity.js';
import { QuoteRequestItemGroup } from './entities/quote-request-item-group.entity.js';
import { QuoteRequestListSavedView } from './entities/quote-request-list-saved-view.entity.js';
import { QuoteRequestNotificationEvent } from './entities/quote-request-notification-event.entity.js';
import { QuoteRequestRevision } from './entities/quote-request-revision.entity.js';
import { QuoteRequestOrgPolicy } from './entities/quote-request-org-policy.entity.js';
import { QuoteRequestAccountPolicy } from './entities/quote-request-account-policy.entity.js';
import { QuoteDocumentDataBuilder } from './document/data-builder.js';
import { QuoteRequestDocumentService } from './document/document-service.js';
import { createQuoteRequestDocumentType } from './document/quote-request-document-type.js';
import { QUOTE_REQUEST_PDF_EMAIL_CODE } from './commands/document-template-commands.js';
import { QUOTE_REQUEST_PDF_EMAIL_DEFAULT } from './email-templates/quote-pdf-defaults.js';

/**
 * `quote_requests` — four settings resolvers that belonged to the module
 * (feature 072, wave 3, T132).
 *
 * `resolveExpiryRule` (`resolveExpiryDays` until issue #239 made it per channel),
 * `resolveBoolSetting`, `resolveBusinessIdPrefix` and
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
  /** Feature 146, US4 — the policy reads open to `customers:read` or `customers:manage`. */
  readonly requireAdminAny: RequireAdminAnyFactory;
  /** Feature 146, US4 — the two price-negotiation writes run as Commands (Principle XIII). */
  readonly commandBus: CommandBus;
  readonly requireCustomer: QuoteRequestsModuleOptions['requireCustomer'];
  readonly settingsReadPort: SettingsReadPort;
  /**
   * The channel a global-scope settings read resolves against: the deployment's
   * system-default sales channel, or `null` when it has none. A root input
   * (`check-port-dependencies.ts`), resolved by `stripe`, `autopay`,
   * `inventory` and others under this same name.
   */
  readonly settingsChannelResolver: () => Promise<string | null>;
  /**
   * Every sales channel, for the expiry sweep's per-channel `expiry_days`
   * (issue #239). A kernel port; channel configuration is platform data, so the
   * sweep's tenant-free probe may read it.
   */
  readonly salesChannelResolutionPort: SalesChannelResolutionPort;
  readonly customFieldValueService: NonNullable<
    QuoteRequestsModuleOptions['customFieldValues']
  >;
  /**
   * Defaulted by this module since `specs/117-instance-bring-up/` Phase 6 — see
   * `registerActorResolvers` below. A root that answers differently still
   * contributes over it; the test harness does, reading its own
   * `request.testActor` and widening `isPlatformAdmin` on purpose.
   */
  readonly rfqCustomerContextResolver: QuoteRequestsModuleOptions['resolveCustomerContext'];
  readonly rfqAdminContextResolver: QuoteRequestsModuleOptions['resolveAdminContext'];
  /**
   * The organization's effective tax rate for a quoted line, defaulted by this
   * module since `specs/117-instance-bring-up/` Phase 6 — see
   * `registerTaxRateResolver` below.
   */
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
  /**
   * Whether this process runs queue consumers (Principle X) — the platform's
   * one module-agnostic answer, `false` in the test kit.
   */
  readonly processRunsWorkers: boolean;
  /**
   * The connection a module may build a BullMQ queue on. `undefined` is a
   * composition saying it wants no queues, and the expiry sweep's consumer is
   * then not built.
   */
  readonly moduleQueueRedis: Redis | undefined;
  readonly quoteRequests: ReturnType<typeof quoteRequestsModule>;
  /**
   * Feature 146, US4 — the request owner's price-negotiation lock (research
   * R11). This module's own; resolved per call by `RfqService`, so the one
   * instance is what the routes of Phase 10b and the enforcement both read.
   */
  readonly quoteRequestNegotiationPolicyService: NegotiationPolicyService;
  /**
   * Feature 153 — the quote PDF: choices, remembered template, download and
   * the e-mail (`specs/153-quote-request-pdf-template/`).
   */
  readonly quoteRequestDocumentService: QuoteRequestDocumentService;
  readonly quoteRequestPdfMaxAttachmentBytes: number;
  /** `transactional_emails`' sender, read per send (the `crm` and `returns` precedent). */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
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

/**
 * The two actor-shaped names this module reads, defaulted here
 * (`specs/117-instance-bring-up/` Phase 6, FR-033).
 *
 * They were contributed by `backend/src/composition.ts` and by
 * `backend/test/helpers/test-server.ts` and by nothing else, so a composition
 * that is neither of those two — which is every client instance, `composeApp`
 * being the whole of what one calls — could not resolve them. `composeApp`'s
 * own options say what that state is: `contribute` is *"the one slot where a
 * value a module defaults may be overwritten"*, and a name **nothing** defaults
 * supplied through it is a required value wearing an override's clothes.
 *
 * Both bodies are this module's own and carry no deployment judgement. They
 * read `request.actor`, which is the platform's decoration since T118b, and
 * the admin one reads two ports this manifest already declares as binding
 * `dependencies`: `admin_users` and `admin_roles` (the customer one read
 * `customer_accounts` for the legacy role until `specs/170-organization-roles/`
 * WP-05). A root that wants a
 * different answer still contributes one — the test harness does, and its
 * divergence is deliberate — which is what the window is for.
 */
function registerActorResolvers(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * Who is asking, in this module's shape: the account, its Organization and
     * the role the actor carries (`specs/170-organization-roles/`, R-15).
     * Whether the caller sees the whole Organization is not stated here: the
     * service asks `organizationPermissionPort` (R-30), so the legacy `role`
     * column is no longer read.
     *
     * The Organization guard asserts an invariant rather than describing a
     * business state (D-178) — `customer_accounts.organization_id` is `NOT NULL`
     * and an individual is backed by a personal organisation — so a caller
     * reaching it is a broken invariant and not a buyer who should be told to
     * attach something they cannot attach. It is kept rather than deleted
     * because `Actor`'s `organizationId` is `string | null` at this seam and
     * `CustomerContext`'s is `string`.
     */
    rfqCustomerContextResolver: ctx
      .asFunction(() => {
        return async (request: FastifyRequest) => {
          const actor = request.actor as Actor | undefined;
          if (actor?.kind !== 'customer') {
            throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
          }
          if (!actor.organizationId) {
            throw new HttpError(
              500,
              ERROR_CODES.INTERNAL,
              'Invariant violated: a customer account has no Organization (Principle XI).',
              { code: 'customer_account_organization_missing' },
            );
          }
          return {
            customerAccountId: actor.customerAccountId,
            organizationId: actor.organizationId,
            organizationRoleId: actor.organizationRoleId ?? null,
          };
        };
      })
      .singleton(),
    /**
     * Who is administering, with the role the admin surface renders beside the
     * RFQ and scopes its list by.
     *
     * `getById` rather than a nullable lookup, and it cannot 404 here:
     * `admin_users_admin_role_fk` is `on delete restrict`, so a non-null
     * `adminRoleId` names a row that exists.
     */
    rfqAdminContextResolver: ctx
      .asFunction(() => {
        const admins = lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort');
        const roles = lazyPort<AdminRolePort>(ctx, 'adminRolePort');
        return async (request: FastifyRequest) => {
          const actor = request.actor as Actor | undefined;
          if (actor?.kind !== 'admin') {
            throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
          }
          return rfqAdminContextFor(admins, roles, actor.adminUserId);
        };
      })
      .singleton(),
  });
}

/**
 * The rate a quoted line is priced at (`specs/117-instance-bring-up/` Phase 6,
 * FR-033).
 *
 * Two ports, both already binding `dependencies` of this manifest: the
 * organisation's VAT status and country from `organizations`, and the rate
 * itself from `taxes`.
 *
 * **No `catch`, and that is the design** (issue #84). `taxRateFor` answers
 * "nothing applies" as a *value* — `{ source: 'none' }`, with no rate to read —
 * so the only errors that reach this seam are a failing database and a
 * switched-off owner, and returning 0 for either would quote a zero-VAT price
 * on an operator's behalf and call it an answer. Both owners are
 * `nonDeactivatable`, so neither has an off state here; the refusal is what
 * reaches a caller if that ever changes.
 */
function registerTaxRateResolver(ctx: ModuleContext): void {
  ctx.di.register({
    rfqTaxRateResolver: ctx
      .asFunction((): NonNullable<QuoteRequestsModuleOptions['resolveTaxRate']> => {
        const taxProfiles = lazyPort<OrganizationTaxProfilePort>(
          ctx,
          'organizationTaxProfilePort',
        );
        const taxes = lazyPort<TaxServicePort>(ctx, 'taxService');
        return async (organizationId: string) => {
          const org = await taxProfiles.taxProfileOf(organizationId);
          const vatStatus = org?.vatStatus ?? 'vat_payer';
          if (vatStatus !== 'vat_payer') return 0;
          const resolved = await taxes.taxRateFor({
            country: org?.country ?? 'PL',
            productType: 'simple',
            vatStatus,
          });
          // `none` is the operator's own configuration state — `taxes` is
          // present and holds no rule that applies and no default — so a quote
          // is priced net and the quote view drops its VAT row rather than
          // printing a 0% one.
          return resolved.source === 'none' ? 0 : resolved.rate;
        };
      })
      .singleton(),
  });
}

export function registerModule(ctx: ModuleContext): void {
  registerActorResolvers(ctx);
  registerTaxRateResolver(ctx);
  ctx.di.register({
    quoteRequestNegotiationPolicyService: ctx
      .asFunction(
        () =>
          new NegotiationPolicyService({
            // `customer_accounts` is a binding dependency: off, the read
            // throws and the lock fails closed (analyze M5).
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.di.register({
    quoteRequests: ctx
      .asFunction(({ emFactory, eventBus, auditLogService, commandBus }: QuoteRequestsCradle) => {
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
          const channelId = await ctx.cradle<QuoteRequestsCradle>().settingsChannelResolver();
          return settingFor(code, schema, fallback, channelId);
        };
        /** {@link setting} for a named channel — the expiry sweep reads every channel's (issue #239). */
        const settingFor = async <T>(
          code: string,
          schema: z.ZodType<T>,
          fallback: T,
          channelId: string | null,
        ): Promise<T> => {
          const cradle = ctx.cradle<QuoteRequestsCradle>();
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
          log: ctx.log,
          auditLog: auditLogService,
          customFieldValues: lazyPort<QuoteRequestsCradle['customFieldValueService']>(
            ctx,
            'customFieldValueService',
          ),
          // Feature 157 — the admin list's custom-field filters.
          customFieldListFilter: lazyPort<CustomFieldListFilterPort>(ctx, 'customFieldListFilterPort'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<QuoteRequestsCradle>().requireAdmin(permission)(req, reply),
          requireAdminAny: (permissions) => async (req, reply) =>
            ctx.cradle<QuoteRequestsCradle>().requireAdminAny(permissions)(req, reply),
          commandBus,
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
          catalogAvailability: lazyPort<CatalogProductAvailabilityPort>(
            ctx,
            'catalogProductAvailabilityPort',
          ),
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          // `specs/170-organization-roles/` — the customer routes' permission
          // guards (FR-040) and the *Administrator*-only Organization-wide
          // visibility (R-30). `organizations` is a binding dependency; the
          // port is resolved per call, so its effective state decides.
          organizationPermissions: () =>
            lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort'),
          // The completion reactor's second look at an order whose commit was
          // still in flight (`specs/143-crm-sales-opportunities/`, FR-104). Off
          // the bus's chain, so in a system scope of its own — the handler's
          // ends when it returns — and never rejecting: there is nobody left to
          // hear it, so a failure is logged. Whether this module is still on is
          // asked by the work itself, before every read.
          deferAfterCommit: (work) =>
            enterSystemScope('quote_requests: an order read again after its commit', async () => {
              await work();
            }).catch((error: unknown) => {
              ctx.log.warn(
                { error: error instanceof Error ? error.message : String(error) },
                'quote_requests: an order could not be read again after its commit',
              );
            }),
          isStillPresent: () => effectiveState.isPresent('quote_requests'),
          carts: lazyPort<CartWritePort>(ctx, 'cartWritePort'),
          // Feature 146 — the reference price a customer write stores per line
          // (FR-001). `price_lists` is a binding `dependencies` entry for it;
          // the one tolerated failure is in `services/reference-price.ts`.
          buyerLinePrices: lazyPort<BuyerLinePricePort>(ctx, 'buyerLinePricePort'),
          // Feature 146, US4 — resolved at each call rather than captured, so
          // the container's current registration is the one asked.
          negotiationPolicy: {
            assertProposalsAllowed: (customerAccountId, lines, em) =>
              ctx
                .cradle<QuoteRequestsCradle>()
                .quoteRequestNegotiationPolicyService.assertProposalsAllowed(customerAccountId, lines, em),
            precheckProposalsAllowed: (customerAccountId, lines, em) =>
              ctx
                .cradle<QuoteRequestsCradle>()
                .quoteRequestNegotiationPolicyService.precheckProposalsAllowed(customerAccountId, lines, em),
          },
          negotiationDisplay: () => ctx.cradle<QuoteRequestsCradle>().quoteRequestNegotiationPolicyService,
          // Issue #239 — the sweep holds each request to its own channel's
          // value; it used to read the default channel's alone and apply it to
          // every channel. A request with no channel keeps the default's.
          resolveExpiryRule: async () => {
            const schema = z.number().int().nonnegative();
            const code = QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS;
            const channels = await ctx.cradle<QuoteRequestsCradle>().salesChannelResolutionPort.listAll();
            const byChannel = new Map<string, number>();
            for (const channel of channels) {
              byChannel.set(channel.id, await settingFor(code, schema, 0, channel.id));
            }
            return { byChannel, withoutChannel: await setting(code, schema, 0) };
          },
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
          // Feature 153 — the quote PDF routes' service, resolved when the
          // routes are mounted.
          documentService: () => ctx.cradle<QuoteRequestsCradle>().quoteRequestDocumentService,
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

  /**
   * Feature 162 — a Sales Opportunity's custom-field values received into a
   * Quote Request created from it (`specs/162-custom-fields-value-carry/`,
   * contract `carry-api.md` §4.2). `crm` decides this module's presence before
   * it calls; the carry itself is planned by `custom_fields`.
   */
  ctx.di.providePort<CustomFieldCarryReceiverPort>(
    'quoteRequestCustomFieldCarryPort',
    ctx
      .asFunction(
        ({ commandBus }: QuoteRequestsCradle) =>
          new QuoteRequestCustomFieldCarryReceiver({
            commandBus,
            customFieldCarry: lazyPort<CustomFieldCarryPort>(ctx, 'customFieldCarryPort'),
          }),
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

  /**
   * The events this module offers to outbound webhooks — a **contribution**
   * hook.
   *
   * It pushes two event names into `webhookEventRegistry`, an ungated registry
   * `webhooks` owns, and carries no presence probe: the registry leaves out a
   * contributor that is not present when it is read, so a push made while this
   * module is off costs nothing, and one skipped here would make switching the
   * module on need a restart before its events were offered. `webhooks` names
   * neither event — a module owns its events (Principle I) — and sends the
   * payload whole, which is why the two have strict schemas in the contracts
   * package.
   *
   * Nothing is read back and nothing degrades: with `webhooks` off the events
   * are emitted as ever and nobody is told; in an instance without `webhooks`
   * the push is dropped by the platform.
   */
  ctx.onBoot(() => {
    const registry = lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry');
    for (const eventType of QUOTE_REQUEST_WEBHOOK_EVENT_TYPES) {
      registry.register({ ownerModuleId: 'quote_requests', eventType });
    }
  });

  /**
   * The Quote Request record type for admin global search
   * (`specs/150-admin-global-search/`, T033) — a **contribution** hook: it
   * pushes an inert provider into `admin_search`'s ungated registry and does
   * nothing else, so it carries no presence probe (D-67/D-68). The registry
   * leaves the provider out at enumeration while this module is switched off,
   * so switching it back on needs no restart.
   *
   * The provider asks the same admin context the list's routes resolve (the
   * role decides `isPlatformAdmin`), so it applies exactly the list's
   * visibility.
   */
  ctx.onBoot(() => {
    lazyPort<AdminSearchProviderRegistryPort>(ctx, 'adminSearchProviderRegistry').register(
      createQuoteRequestAdminSearchProvider(quoteRequestAdminSearchDeps(ctx)),
    );
  });

  // ---------------------------------------------------------------------------
  // Feature 153 — the quote PDF (`specs/153-quote-request-pdf-template/`)
  // ---------------------------------------------------------------------------
  ctx.di.register({
    /**
     * The largest PDF the send attaches (owner answer Q4, FR-097). A
     * registration rather than a constant so a composition — and the contract
     * suite — can lower it without producing a 10 MiB document.
     */
    quoteRequestPdfMaxAttachmentBytes: ctx.asValue<number>(QUOTE_REQUEST_PDF_LIMITS.maxAttachmentBytes),
    quoteRequestDocumentService: ctx
      .asFunction(
        ({ emFactory, commandBus }: QuoteRequestsCradle) =>
          new QuoteRequestDocumentService({
            emFactory,
            commandBus,
            salesRepScope: lazyPort<SalesRepAssignmentPort>(ctx, 'organizationSalesRepScopePort'),
            // `refuses-without`: resolved per call and never probed, so while
            // document templates are off every quote PDF route answers 503.
            renderPort: () => lazyPort<DocumentRenderPort>(ctx, 'documentRenderPort'),
            builder: new QuoteDocumentDataBuilder({
              catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
              attributes: lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
              customFieldDefinitions: lazyPort<CustomFieldDefinitionReadPort>(ctx, 'customFieldDefinitionReadPort'),
              organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
              customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
              adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
              // A kernel registration: no module edge.
              salesChannels: lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
              taxRate: (organizationId) => ctx.cradle<QuoteRequestsCradle>().rfqTaxRateResolver(organizationId),
            }),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            // A function announced late; `lazyPort` forwards method calls only,
            // so it is read off the cradle per send (the `crm` precedent).
            sender: () => ctx.cradle<QuoteRequestsCradle>().transactionalEmailSenderAccessor(),
            log: (message, context) => ctx.log.warn(context, message),
            maxAttachmentBytes: () => ctx.cradle<QuoteRequestsCradle>().quoteRequestPdfMaxAttachmentBytes,
          }),
      )
      .singleton(),
  });

  /**
   * The *Quote request* document type — a **contribution** hook: it pushes an
   * inert registration into `document_templates`' ungated registry and carries
   * no presence probe (`specs/conventions/module-activation.md`). The registry
   * answers the type only while this module is present, so switching it off
   * hides the type and its templates and deletes nothing.
   */
  ctx.onBoot(() => {
    const attributes = lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort');
    lazyPort<DocumentTypeRegistryPort>(ctx, 'documentTypeRegistry').register(
      createQuoteRequestDocumentType({ attributes: () => attributes.listByFlag('isVisibleOnProductPage') }),
    );
  });

  /**
   * The *Quote request PDF* e-mail's default subject and body (owner answer
   * Q4) — a **contribution** hook into `emailDefaultsPort`, the ungated
   * registry `transactional_emails` reads once at boot; no presence probe.
   */
  ctx.onBoot(() => {
    lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort').register(
      QUOTE_REQUEST_PDF_EMAIL_CODE,
      QUOTE_REQUEST_PDF_EMAIL_DEFAULT,
      'quote_requests',
    );
  });

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<QuoteRequestsCradle>();
    await cradle.quoteRequests.register(app);

    // The clock of the expiry sweep: a Job Scheduler and its consumer. Until
    // this call existed nothing ran `RfqExpiryWorker.sweep()` at all — see
    // `workers/rfq-expiry-sweep-worker.ts`. `ctx.worker` applies
    // `defineModuleWorker('quote_requests', …)`, which is what stops the
    // consumer with the module: while it is switched off, no tick runs.
    //
    // Attached here rather than at registration for the reason every worker in
    // the tree is: this is where `app.log` exists, and a `BACKEND_ROLE=worker`
    // process reaches it. Built only where the host says this process consumes
    // queues and offers a connection to build one on; the shared test server
    // says neither, and drives `sweep()` directly.
    await startRfqExpirySweep({
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      expiry: cradle.quoteRequests.handle().expiryWorker,
      log: ctx.log,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => {
        app.addHook('onClose', close);
      },
    });
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
  QuoteRequestItemGroup,
  QuoteRequestListSavedView,
  QuoteRequestNotificationEvent,
  QuoteRequestRevision,
  QuoteRequestOrgPolicy,
  QuoteRequestAccountPolicy,
];

/**
 * What global search's Quote Request provider reads through: this module's own
 * admin service, asked with the same admin context the list's routes resolve,
 * and this module's bundle for status labels. Built outside the boot hook so
 * the hook only registers — the closures run per search, never at boot.
 */
function quoteRequestAdminSearchDeps(ctx: ModuleContext): QuoteRequestAdminSearchProviderDeps {
  const admins = lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort');
  const roles = lazyPort<AdminRolePort>(ctx, 'adminRolePort');
  const i18n = lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService');
  return {
    search: async (query, adminUserId) =>
      ctx
        .cradle<QuoteRequestsCradle>()
        .quoteRequests.handle()
        .adminService.searchForAdmin(await rfqAdminContextFor(admins, roles, adminUserId), query),
    translate: (key, language) => i18n.translate('quote_requests', key, language),
  };
}

/**
 * Who is administering, as the quote request list's routes and global search
 * both read it: the role decides whether the sales-representative visibility
 * rule applies (`isPlatformAdmin`) and what the event records call the actor.
 */
async function rfqAdminContextFor(
  admins: AdminUserReadPort,
  roles: AdminRolePort,
  adminUserId: string,
): Promise<AdminContext> {
  const adminUser = await admins.findById(adminUserId);
  const role = adminUser?.adminRoleId ? await roles.getById(adminUser.adminRoleId) : null;
  return {
    adminUserId,
    isPlatformAdmin: role?.code === 'platform_admin',
    roleLabel:
      role?.code === 'platform_admin'
        ? 'Platform administrator'
        : role?.code === 'sales_representative'
          ? 'Sales representative'
          : (role?.name ?? 'Administrator'),
  };
}
