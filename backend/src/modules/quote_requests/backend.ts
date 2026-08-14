import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
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

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    quoteRequests: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: QuoteRequestsCradle) => {
        /** This module's own settings, read through the port it already holds. */
        const setting = async <T>(
          code: string,
          schema: z.ZodType<T>,
          fallback: T,
        ): Promise<T> => {
          try {
            return await ctx
              .cradle<QuoteRequestsCradle>()
              .settingsReadPort.get(code, 'default', schema);
          } catch {
            return fallback;
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
