import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { ModuleManifest, TransactionalEmailSender } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { transactionalEmailsModule, type TransactionalEmailsModuleOptions } from './plugin.js';
import type { BrandingService, AssetUrlResolver } from './services/branding.service.js';
import type { TransactionalEmailService } from './services/transactional-email.service.js';
import { makeTemplateEmail, type TemplateEmail } from './services/template-email.js';

/**
 * `transactional_emails` — the last of the 65 (feature 072, T120).
 *
 * It sat in wave 2 and was skipped, which is why `composition.ts` still called
 * a module factory after every other module had stopped needing one. Both roots
 * held `let transactionalEmailSender` and `let emailBrandingService`, filled in
 * by this module's two `expose…` callbacks, and **six** consumers read the
 * sender back out of that variable.
 *
 * Both sinks become accessor ports, the seam `orders` got in T141: the services
 * are constructed inside the plugin body, so they do not exist until route
 * registration, and an accessor resolved before then answers `null` honestly.
 *
 * **`templateEmailPort` is the substantive part.** `inventory` and
 * `organizations` both send template-routed mail against the system-default
 * channel, and both got there through `makeOrgTemplateEmail` — a 59-line
 * adapter that lived in `organizations` and that each root imported and passed
 * down to `inventory`. Every line of it is about the transactional sender and
 * the channel an unscoped email resolves against, so it moved here (see
 * `services/template-email.ts`) and both modules resolve one port. That removes
 * a converted module importing another converted module's helper, which is what
 * the root indirection had been hiding.
 *
 * The harness passed neither `resolveAssetUrl` nor `exposeBranding`, so email
 * asset URLs and branding resolution ran in no test. Both are wired for both
 * compositions now.
 */

/** What `transactional_emails` resolves from the container, and the names it owns. */
export interface TransactionalEmailsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsService;
  readonly salesChannelResolutionPort: SalesChannelResolverService;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string | null };
  readonly resolvedModuleRegistry: ReadonlyArray<{ manifest: ModuleManifest }>;
  readonly emailMailer: NonNullable<TransactionalEmailsModuleOptions['mailer']>;
  readonly settingsAdminService: NonNullable<TransactionalEmailsModuleOptions['settingsAdmin']>;
  /**
   * Contributed: how an asset id becomes a public URL in an email. It reaches
   * `assets_library`, which this module must not read through directly.
   */
  readonly transactionalEmailAssetUrl: AssetUrlResolver;
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  readonly emailBrandingAccessor: () => BrandingService | undefined;
  readonly templateEmailPort: TemplateEmail;
  readonly transactionalEmails: ReturnType<typeof transactionalEmailsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): TransactionalEmailsCradle => ctx.cradle<TransactionalEmailsCradle>();

  /** Filled in at route registration by the module's two `expose…` callbacks. */
  const exposed: {
    sender: TransactionalEmailService | null;
    branding: BrandingService | null;
  } = { sender: null, branding: null };

  ctx.di.register({
    // Contribution point: a composition that cannot resolve asset URLs sends
    // emails without them rather than failing to send.
    transactionalEmailAssetUrl: ctx
      .asFunction((): AssetUrlResolver => async () => null)
      .singleton(),

    transactionalEmails: ctx
      .asFunction(
        ({ emFactory, auditLogService, resolvedModuleRegistry }: TransactionalEmailsCradle) =>
          transactionalEmailsModule({
            emFactory,
            auditLog: auditLogService,
            manifests: resolvedModuleRegistry.map((entry) => entry.manifest),
            settingsService: lazyPort<SettingsService>(ctx, 'settingsReadPort'),
            settingsAdmin: lazyPort<TransactionalEmailsCradle['settingsAdminService']>(
              ctx,
              'settingsAdminService',
            ),
            mailer: lazyPort<TransactionalEmailsCradle['emailMailer']>(ctx, 'emailMailer'),
            resolveAssetUrl: (assetId: string) => cradle().transactionalEmailAssetUrl(assetId),
            requireAdmin: (permission?: string) => async (req, reply) =>
              cradle().requireAdmin(permission ?? '')(req, reply),
            resolveAdminUserId: (req: FastifyRequest) =>
              cradle().adminContextResolver(req).adminUserId,
            exposeSender: (sender) => {
              exposed.sender = sender;
            },
            exposeBranding: (branding) => {
              exposed.branding = branding;
            },
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'transactionalEmailSenderAccessor',
    ctx
      .asFunction(
        (): (() => TransactionalEmailSender | undefined) => () => exposed.sender ?? undefined,
      )
      .singleton(),
  );

  ctx.di.providePort(
    'emailBrandingAccessor',
    ctx
      .asFunction((): (() => BrandingService | undefined) => () => exposed.branding ?? undefined)
      .singleton(),
  );

  // One template-email adapter for every module that sends unscoped,
  // template-routed mail. `organizations` and `inventory` each used to get their
  // own, built by a root from a helper the first of them owned.
  ctx.di.providePort(
    'templateEmailPort',
    ctx
      .asFunction((): TemplateEmail =>
        makeTemplateEmail({
          getSender: () => exposed.sender ?? undefined,
          resolveScopeSalesChannelId: async () =>
            (await cradle().salesChannelResolutionPort.getSystemDefault())?.id ?? null,
          resolveLanguage: async (salesChannelId: string) =>
            (await cradle().salesChannelResolutionPort.getById(salesChannelId))?.defaultLanguage ??
            'en-US',
        }),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    await cradle().transactionalEmails(app);
  });
}
