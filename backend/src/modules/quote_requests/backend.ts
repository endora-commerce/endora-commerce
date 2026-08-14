import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import {
  lazyPort,
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { QUOTE_REQUESTS_SETTING_CODES } from './manifest.js';
import { quoteRequestsModule, type QuoteRequestsModuleOptions } from './plugin.js';

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
 * `salesRepSubtree` has the same story with a sharper edge. Absent, the RFQ
 * admin scope silently stops being subtree-aware, so a sales representative
 * holding `organizations:rollup` sees only their own rows. The harness passed
 * nothing, so feature 056's rollup was exercised by no test at all. It is a
 * contribution now — the org tree and the permission check are both other
 * modules' — but a contribution a root always makes rather than an argument it
 * can forget.
 *
 * The two actor resolvers stay root-shaped for the reason they always were:
 * production reads `request.actor` and throws a 401 envelope, the harness reads
 * `request.testActor`. That is a composition's answer to "who is asking".
 */

/** What `quote_requests` resolves from the container, and the names it owns. */
export interface QuoteRequestsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: QuoteRequestsModuleOptions['requireCustomer'];
  readonly settingsReadPort: SettingsService;
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
   * The two ports the sales-rep roll-up scope is built from (T138). They used
   * to arrive fused as a root-built `rfqSalesRepSubtree` object, which no
   * `HOST_REGISTERED_PORTS` owner column could describe honestly: the tree
   * belongs to `organizations`, the permission check to `admin_roles`. Split,
   * each is an ordinary port and this module writes the one line of policy it
   * already owns — that a rep holding the roll-up capability sees the subtree.
   */
  readonly organizationTreeService: NonNullable<
    QuoteRequestsModuleOptions['salesRepSubtree']
  >['treeService'];
  readonly permissionService: {
    hasPermission(adminUserId: string, permission: string): Promise<boolean>;
  };
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
          salesRepSubtree: {
            // Resolved under the owner's own name. T132 tried exactly this
            // spelling and it answered 500: the name was declared in
            // `HOST_REGISTERED_PORTS` and registered by nobody, because a table
            // entry is a claim about who *would* own it (issue #49). T138 made
            // the claim true — `organizations` provides it — so the workaround
            // that read it off a fused root contribution is gone.
            treeService: lazyPort<QuoteRequestsCradle['organizationTreeService']>(
              ctx,
              'organizationTreeService',
            ),
            // `organizations:rollup` is a core `PERMISSION_CATALOGUE` code, not
            // another module's private string, so naming it here crosses no
            // boundary.
            hasRollupCapability: (adminUserId: string) =>
              ctx
                .cradle<QuoteRequestsCradle>()
                .permissionService.hasPermission(adminUserId, 'organizations:rollup'),
          },
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

  ctx.di.providePort(
    'rfqService',
    ctx
      .asFunction(({ quoteRequests }: QuoteRequestsCradle) => quoteRequests.handle().rfqService)
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<QuoteRequestsCradle>().quoteRequests.register(app);
  });
}
