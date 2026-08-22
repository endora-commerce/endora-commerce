import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { FastifyRequest } from 'fastify';
import type { CmsBlockSeedPort } from '@b2b/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { newsletterModule, type NewsletterModuleOptions } from './plugin.js';
import { ensureNewsletterConsentBlock } from './services/consent-block-seeder.js';

/**
 * `newsletter` — the module whose secret the harness pins (feature 072, wave 2,
 * T114).
 *
 * Eight options are composition-specific rather than environmental, and telling
 * the two apart is the whole exercise here. `tokenSecret`, `publicBaseUrl` and
 * `storefrontBaseUrl` *look* like configuration a packaged module should read
 * from `process.env` — and the root does read them from there. But the harness
 * pins a fixed secret and `http://localhost`, because an unsubscribe token is
 * signed on one request and verified on another, and a test asserting a
 * specific link needs the link to be predictable.
 *
 * So they are contributed, with `defaultChannelId`, `resolveChannelIdByCode`,
 * `resolveCustomerAccountId`, `loadCustomerEmail` and `emitEvent`, as one
 * {@link NewsletterBridge}. This is the `pwa` correction applied before the
 * failure rather than after it: what the harness does differently from
 * production is information about the seam, not boilerplate to normalise away.
 *
 * `mailer` stays in the bridge for the same reason — the harness injects a
 * capturing mailer so a test can read what was sent.
 *
 * `auditLog` stops being optional: subscribing and unsubscribing are consent
 * records, and consent that was recorded nowhere is indistinguishable from
 * consent that was never given.
 *
 * `resolveEmailBranding` is a **contribution point this module owns**, absent by
 * default. The logo and accent come from `transactional_emails`, which hands
 * them out through an `exposeBranding` callback a root holds — so a port would
 * make `newsletter` declare a dependency on a module that only *later* announces
 * the value. Absent, campaign email renders with the module's own neutral
 * fallback, which is what the harness has always exercised.
 */

export interface NewsletterBridge {
  readonly tokenSecret: NonNullable<NewsletterModuleOptions['tokenSecret']>;
  readonly defaultChannelId: NewsletterModuleOptions['defaultChannelId'];
  readonly resolveChannelIdByCode: NonNullable<NewsletterModuleOptions['resolveChannelIdByCode']>;
  readonly publicBaseUrl: NonNullable<NewsletterModuleOptions['publicBaseUrl']>;
  readonly storefrontBaseUrl: NonNullable<NewsletterModuleOptions['storefrontBaseUrl']>;
  readonly resolveCustomerAccountId: NonNullable<NewsletterModuleOptions['resolveCustomerAccountId']>;
  readonly loadCustomerEmail: NonNullable<NewsletterModuleOptions['loadCustomerEmail']>;
  readonly mailer: NonNullable<NewsletterModuleOptions['mailer']>;
  readonly emitEvent: NonNullable<NewsletterModuleOptions['emitEvent']>;
}

export interface NewsletterCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: NonNullable<NewsletterModuleOptions['requireCustomer']>;
  readonly settingsReadPort: NonNullable<NewsletterModuleOptions['settings']>;
  readonly settingsAdminService: NonNullable<NewsletterModuleOptions['settingsWrite']>;
  readonly adminAuditActorResolver: NonNullable<NewsletterModuleOptions['resolveAuditContext']>;
  readonly credentialsService: NonNullable<NewsletterModuleOptions['credentials']>;
  /** Undefined in a composition with no queue infrastructure; dispatch then runs inline. */
  readonly moduleQueueRedis: Redis | undefined;
  readonly newsletterBridge: NewsletterBridge;
  /** Contribution point: absent means campaign email renders with the neutral fallback. */
  readonly newsletterEmailBranding: NewsletterModuleOptions['resolveEmailBranding'];
  readonly newsletter: ReturnType<typeof newsletterModule>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, absent by default: no branding source, neutral email.
    newsletterEmailBranding: ctx
      .asFunction((): NewsletterCradle['newsletterEmailBranding'] => undefined)
      .singleton(),

    newsletter: ctx
      .asFunction(({ emFactory, auditLogService, moduleQueueRedis }: NewsletterCradle) => {
        const bridge = (): NewsletterBridge => ctx.cradle<NewsletterCradle>().newsletterBridge;
        const b = bridge();
        return newsletterModule({
          emFactory,
          auditLog: auditLogService,
          settings: lazyPort<NonNullable<NewsletterModuleOptions['settings']>>(
            ctx,
            'settingsReadPort',
          ),
          settingsWrite: lazyPort<NonNullable<NewsletterModuleOptions['settingsWrite']>>(
            ctx,
            'settingsAdminService',
          ),
          credentials: lazyPort<NonNullable<NewsletterModuleOptions['credentials']>>(
            ctx,
            'credentialsService',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<NewsletterCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<NewsletterCradle>().requireCustomer(req, reply),
          resolveAuditContext: (req: FastifyRequest) =>
            ctx.cradle<NewsletterCradle>().adminAuditActorResolver(req),
          // Values a composition pins rather than derives.
          tokenSecret: b.tokenSecret,
          defaultChannelId: b.defaultChannelId,
          publicBaseUrl: b.publicBaseUrl,
          storefrontBaseUrl: b.storefrontBaseUrl,
          mailer: b.mailer,
          resolveChannelIdByCode: (code) => bridge().resolveChannelIdByCode(code),
          resolveCustomerAccountId: (req) => bridge().resolveCustomerAccountId(req),
          loadCustomerEmail: (id) => bridge().loadCustomerEmail(id),
          emitEvent: (name, payload) => bridge().emitEvent(name, payload),
          // Queue-backed dispatch when the composition has Redis; the module
          // falls back to inline sending when it does not (Principle X).
          ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
          runWorkers: process.env['BACKEND_ROLE'] !== 'api',
          // Read per call, so a root may contribute branding at any point in
          // its own ordering.
          resolveEmailBranding: async (salesChannelId: string | null) => {
            const resolve = ctx.cradle<NewsletterCradle>().newsletterEmailBranding;
            return resolve === undefined
              ? { logoUrl: '', accentColor: '#1f2937' }
              : resolve(salesChannelId);
          },
        });
      })
      .singleton(),
  });

  ctx.routes(async (app) => {
    // Seed the predefined consent CMS block (idempotent; runs after channels
    // exist). It sat inside `plugin.ts`'s route registrar until feature 075,
    // where it wrote `cms`' two tables in raw SQL under a `try/catch` that
    // downgraded every failure to a warning so a CMS-less platform could still
    // boot (D-87). `cms` owns the write now, behind `cmsBlockSeedPort`, and the
    // seeder decides that module's presence before it calls — so the absence is
    // an answer logged here rather than an exception a `catch` has to be
    // trusted to tell apart from a real one. The call moves up to `backend.ts`
    // with the port, because a `ModuleContext` is what resolves one; relative
    // order is unchanged, since the plugin's own registrar runs below.
    //
    // `lazyPort` built in a `ctx.routes` body resolves nothing: it defers to
    // the method call, which happens only after the presence decision.
    const seeded = await ensureNewsletterConsentBlock(
      lazyPort<CmsBlockSeedPort>(ctx, 'cmsBlockSeedPort'),
    );
    if (seeded === 'cms-absent') {
      app.log.info('[newsletter] consent CMS block seed skipped — cms is not present');
    }

    await ctx.cradle<NewsletterCradle>().newsletter(app);
  });
}
