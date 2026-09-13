import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { FastifyRequest } from 'fastify';
import type { CmsBlockSeedPort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { newsletterModule, type NewsletterModuleOptions } from './plugin.js';
import { ensureNewsletterConsentBlock } from './services/consent-block-seeder.js';
import { NewsletterAutomationRun } from './entities/newsletter-automation-run.entity.js';
import { NewsletterAutomation } from './entities/newsletter-automation.entity.js';
import { NewsletterCampaignSubscriber } from './entities/newsletter-campaign-subscriber.entity.js';
import { NewsletterCampaign } from './entities/newsletter-campaign.entity.js';
import { NewsletterCustomField } from './entities/newsletter-custom-field.entity.js';
import { NewsletterEmailBlockSalesChannel } from './entities/newsletter-email-block-sales-channel.entity.js';
import { NewsletterEmailBlock } from './entities/newsletter-email-block.entity.js';
import { NewsletterEngagementEvent } from './entities/newsletter-engagement-event.entity.js';
import { NewsletterSendRecord } from './entities/newsletter-send-record.entity.js';
import { NewsletterSubscriberTag } from './entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSubscriber } from './entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from './entities/newsletter-suppression.entity.js';
import { NewsletterTag } from './entities/newsletter-tag.entity.js';

/**
 * `newsletter` — the module whose secret the harness pins (feature 072, wave 2,
 * T114), and which assembled nine of its own inputs in a composition root until
 * `specs/117-instance-bring-up/` Phase 6.
 *
 * **`newsletterBridge` is gone.** It was contributed by
 * `backend/src/composition.ts` and by `backend/test/helpers/test-server.ts` and
 * by nothing else, so a composition that is neither — which is every client
 * instance, whose whole composition is one `composeApp({ deploymentRoot })`
 * call — could not resolve it, and the module's own registration read
 * `b.tokenSecret` eagerly, so that composition failed the moment anything
 * touched `newsletter`.
 *
 * The argument for the bridge was that the harness differs from production and
 * *"what the harness does differently is information about the seam"*. That is
 * still true and it is an argument for a **contribution point**, not for a
 * required value: a module default the harness overwrites says the same thing
 * and leaves a composition that overwrites nothing with a working module.
 * `newsletterEmailBranding`, eleven lines below, has been the right shape all
 * along.
 *
 * Every member was a port, a platform contribution or an environment input —
 * none was a judgement anybody makes:
 *
 *  - `tokenSecret` -> `newsletterTokenSecret`, the platform's own value, so
 *    `NEWSLETTER_TOKEN_SECRET` stays a platform-declared input that
 *    `check:env-inputs` can see (T6-B1 route (b)).
 *  - `defaultChannelId` -> `salesChannelResolutionPort.getSystemDefault()`, as
 *    an accessor: it was the one member only a root could produce, because it
 *    was an *awaited value*.
 *  - `resolveChannelIdByCode` -> `salesChannelCodeIdPort`.
 *  - `publicBaseUrl` -> `resolvePublicApiBaseUrl()`, the platform's helper.
 *  - `storefrontBaseUrl` -> the platform's own registration of that name.
 *  - `loadCustomerEmail` -> `customerAccountReadPort`, already resolved eleven
 *    lines down for `customerAccounts`.
 *  - `mailer` -> `emailMailer`.
 *  - `emitEvent` -> `eventBus`.
 *  - `resolveCustomerAccountId` -> the platform's `customerAccountIdResolver`,
 *    which is the identical closure under its own name.
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
  /**
   * The key confirmation and unsubscribe links are signed with. The platform's
   * own registration — `NEWSLETTER_TOKEN_SECRET`, falling back to the session
   * key — so that the environment read stays in the tree `check:env-inputs`
   * judges (T6-B1). A harness pins it, because a token signed on one request
   * and verified on another has to be predictable for a test to assert a link.
   */
  readonly newsletterTokenSecret: string;
  readonly emailMailer: NonNullable<NewsletterModuleOptions['mailer']>;
  readonly customerAccountIdResolver: NonNullable<
    NewsletterModuleOptions['resolveCustomerAccountId']
  >;
  readonly storefrontBaseUrl: string;
  readonly eventBus: EventBus;
  readonly salesChannelResolutionPort: {
    getSystemDefault(): Promise<{ id: string }>;
  };
  readonly salesChannelCodeIdPort: { idByCode(code: string): Promise<string | null> };
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
      .asFunction(
        ({
          emFactory,
          auditLogService,
          moduleQueueRedis,
          newsletterTokenSecret,
          storefrontBaseUrl,
          eventBus,
        }: NewsletterCradle) => {
        const cradle = (): NewsletterCradle => ctx.cradle<NewsletterCradle>();
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
          // Feature 087 Group B / D-187 — the organisation an owned subscriber
          // carries. A new edge for this module, and it needs no manifest
          // change: `check:port-dependencies` uses the transitive closure of
          // `dependencies`, and `customers` (declared) reaches
          // `customer_accounts`. No deactivation-consequence entry either —
          // `customer_accounts` declares `nonDeactivatable`, so it has no
          // absent state for a consequence to describe.
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<NewsletterCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<NewsletterCradle>().requireCustomer(req, reply),
          resolveAuditContext: (req: FastifyRequest) =>
            ctx.cradle<NewsletterCradle>().adminAuditActorResolver(req),
          // The nine former `newsletterBridge` members, each read where it
          // belongs. A composition that wants a different answer contributes
          // over the name it disagrees with; the harness pins the secret and
          // the two origins, and gets a capturing mailer through `emailMailer`.
          tokenSecret: newsletterTokenSecret,
          publicBaseUrl: resolvePublicApiBaseUrl(),
          storefrontBaseUrl,
          // `lazyPort`, not `cradle().emailMailer`: this factory body runs once,
          // and a cradle read written into it resolves the name there — the
          // captured-registration shape `check:port-dependencies` refuses.
          mailer: lazyPort<NonNullable<NewsletterModuleOptions['mailer']>>(ctx, 'emailMailer'),
          // An accessor, so nothing is awaited while this factory runs. The
          // opt-in policy is the only reader and it asks per subscribe.
          resolveDefaultChannelId: async () =>
            (await cradle().salesChannelResolutionPort.getSystemDefault()).id,
          resolveChannelIdByCode: (code) => cradle().salesChannelCodeIdPort.idByCode(code),
          resolveCustomerAccountId: (req) => cradle().customerAccountIdResolver(req),
          loadCustomerEmail: async (customerAccountId) =>
            (await lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort').findById(
              customerAccountId,
            ))?.email ?? null,
          emitEvent: (name, payload) =>
            eventBus.emit(name, {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              ...payload,
            }),
          // Queue-backed dispatch when the composition has Redis; the module
          // falls back to inline sending when it does not (Principle X).
          ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
          runWorkers: process.env['BACKEND_ROLE'] !== 'api',
          // The lifecycle gate, threaded in rather than imported. The module
          // builds its consumers inside the attach function — two need
          // `app.log`, one an awaited settings read — so it has no
          // `ModuleContext` where the workers exist; it called
          // `defineModuleWorker('newsletter', …)` for itself until T051, which
          // `contracts/host-package.md` §1.4c classifies **A**. Same gate,
          // through the seam a composed module is meant to use.
          registerWorker: (worker, workerOptions) => {
            ctx.worker(worker, workerOptions);
          },
          // Read per call, so a root may contribute branding at any point in
          // its own ordering.
          resolveEmailBranding: async (salesChannelId: string | null) => {
            const resolve = ctx.cradle<NewsletterCradle>().newsletterEmailBranding;
            return resolve === undefined
              ? { logoUrl: '', accentColor: '#1f2937' }
              : resolve(salesChannelId);
          },
        });
        },
      )
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
  NewsletterAutomationRun,
  NewsletterAutomation,
  NewsletterCampaignSubscriber,
  NewsletterCampaign,
  NewsletterCustomField,
  NewsletterEmailBlockSalesChannel,
  NewsletterEmailBlock,
  NewsletterEngagementEvent,
  NewsletterSendRecord,
  NewsletterSubscriberTag,
  NewsletterSubscriber,
  NewsletterSuppression,
  NewsletterTag,
];
