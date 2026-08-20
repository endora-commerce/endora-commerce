import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { TemplateEmailPort, ModuleManifest, TransactionalEmailSender } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { transactionalEmailsModule, type TransactionalEmailsModuleOptions } from './plugin.js';
import type { BrandingService, AssetUrlResolver } from './services/branding.service.js';
import type { TransactionalEmailService } from './services/transactional-email.service.js';
import { makeTemplateEmail, type TemplateEmail } from './services/template-email.js';
import { EmailDefaultsRegistry } from './services/email-defaults-registry.js';

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
  readonly commandBus: CommandBus;
  readonly settingsReadPort: SettingsService;
  readonly salesChannelResolutionPort: SalesChannelResolverService;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string | null };
  readonly resolvedModuleRegistry: ReadonlyArray<{ manifest: ModuleManifest }>;
  readonly emailMailer: NonNullable<TransactionalEmailsModuleOptions['mailer']>;
  readonly emailDeliveryRecorder: NonNullable<TransactionalEmailsModuleOptions['deliveryRecorder']>;
  readonly settingsAdminService: NonNullable<TransactionalEmailsModuleOptions['settingsAdmin']>;
  /**
   * Contributed: how an asset id becomes a public URL in an email. It reaches
   * `assets_library`, which this module must not read through directly.
   */
  readonly transactionalEmailAssetUrl: AssetUrlResolver;
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  readonly emailBrandingAccessor: () => BrandingService | undefined;
  readonly templateEmailPort: TemplateEmail;
  /**
   * Where a module declaring a transactional email puts its default subject and
   * content (T143a).
   *
   * The registry is read once, by the boot reconciler in this module's plugin
   * body, so a contributor pushes from `ctx.onBoot` — boot hooks run during
   * composition and plugin bodies only when the Fastify app is built, so the
   * ordering holds by construction rather than by luck. This is the "push at
   * boot" shape: a module contributing a *descriptor* to a registry the host
   * enumerates, as opposed to the pull shape, where a dependent resolves an
   * answer.
   *
   * **Ungated** — `ctx.di.register`, not `ctx.di.providePort` (D-39). See the
   * registration below for why the distinction is the difference between a
   * degraded feature and a dead deployment.
   */
  readonly emailDefaultsPort: EmailDefaultsRegistry;
  readonly emailDefaultsRegistryInstance: EmailDefaultsRegistry;
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
    // One registry per composition. It used to be a module-level singleton
    // shared by every composition in the process.
    emailDefaultsRegistryInstance: ctx
      .asFunction(() => new EmailDefaultsRegistry())
      .singleton(),

    // Contribution point: a composition that cannot resolve asset URLs sends
    // emails without them rather than failing to send.
    transactionalEmailAssetUrl: ctx
      .asFunction((): AssetUrlResolver => async () => null)
      .singleton(),

    transactionalEmails: ctx
      .asFunction(
        ({ emFactory, auditLogService, commandBus, resolvedModuleRegistry }: TransactionalEmailsCradle) =>
          transactionalEmailsModule({
            emFactory,
            auditLog: auditLogService,
            commandBus,
            manifests: resolvedModuleRegistry.map((entry) => entry.manifest),
            defaultsRegistry: cradle().emailDefaultsRegistryInstance,
            settingsService: lazyPort<SettingsService>(ctx, 'settingsReadPort'),
            settingsAdmin: lazyPort<TransactionalEmailsCradle['settingsAdminService']>(
              ctx,
              'settingsAdminService',
            ),
            mailer: lazyPort<TransactionalEmailsCradle['emailMailer']>(ctx, 'emailMailer'),
            // D-59 — the three outcomes this module decides before the
            // transport is reached leave no row unless it writes one, and one
            // of them is the operator's own "off".
            deliveryRecorder: lazyPort<TransactionalEmailsCradle['emailDeliveryRecorder']>(
              ctx,
              'emailDeliveryRecorder',
            ),
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
  // Feature 075, Phase P — the type parameter is the compile-time proof that
  // this adapter still satisfies `TemplateEmailPort`, the shape `organizations`
  // reaches. It is still a gated port and must stay one: `trySend` renders and
  // sends, which is what the gate is for.
  ctx.di.providePort<TemplateEmailPort>(
    'templateEmailPort',
    ctx
      .asFunction((): TemplateEmail =>
        makeTemplateEmail({
          getSender: () => exposed.sender ?? undefined,
          // D-48 — the system-default channel, which always exists. It was
          // `?? null`, which read template-email branding and language
          // platform-wide on a branch that cannot be taken.
          resolveScopeSalesChannelId: async () =>
            (await cradle().salesChannelResolutionPort.getSystemDefault()).id,
          resolveLanguage: async (salesChannelId: string) =>
            (await cradle().salesChannelResolutionPort.getById(salesChannelId))?.defaultLanguage ??
            'en-US',
        }),
      )
      .singleton(),
  );

  /**
   * The contribution seam, deliberately **ungated** (feature 072, D-39).
   *
   * Seven modules push their email defaults into this registry from
   * `ctx.onBoot`, and `runBootHooks()` does not consult module presence. A
   * `providePort` here is a transient gate that throws `MODULE_DISABLED` on
   * resolution, so every one of those seven hooks would have thrown during
   * composition the moment an operator switched `transactional_emails` off —
   * `index.ts` turns that into `process.exit(1)`, and with the API down the
   * `/platform/modules` screen the operator would undo their own change from is
   * unreachable. "Off is non-destructive and reversible" (Constitution XVII) is
   * not satisfied by a platform that will not start.
   *
   * Nothing leaks by leaving it ungated: an entry is inert data — a subject and
   * a content envelope — and every behavioural seam in this module is still a
   * port. `templateEmailPort` sends, `transactionalEmailSenderAccessor` hands
   * out the sender, and both fail closed.
   *
   * Whether an entry is *honoured* while its contributor is absent is the host's
   * question, answered at enumeration and keyed on the owner the registry
   * records — see `services/email-defaults-registry.ts`.
   */
  ctx.di.register({
    emailDefaultsPort: ctx
      .asFunction(
        ({ emailDefaultsRegistryInstance }: TransactionalEmailsCradle) =>
          emailDefaultsRegistryInstance,
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    await cradle().transactionalEmails(app);
  });
}
