import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { DictionaryValidator, TransactionalEmailSender } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type {
  RequireAdminAnyFactory,
  RequireAdminFactory,
} from '../../kernel/ports/require-admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { ORGANIZATIONS_SETTING_CODES } from './manifest.js';
import {
  creditInheritanceModeSchema,
  moderationModeSchema,
  notificationRecipientsSchema,
} from './schemas/settings.js';
import { OrganizationContextService } from './services/organization-context-service.js';
import { OrganizationRestrictionService } from './services/organization-restriction-service.js';
import { OrganizationTreeService } from './services/organization-tree-service.js';
import { OrganizationInheritanceService } from './services/organization-inheritance-service.js';
import { OrganizationModerationService } from './services/organization-moderation-service.js';
import { OrganizationEffectivePriceListsService } from './services/organization-effective-pricelists-service.js';
import { OrganizationTaxIdValidationService } from './services/organization-tax-id-validation-service.js';
import { OrgRegistrationNotifier } from './services/org-registration-notifier.js';
import { ViesClient } from './integrations/vies-client.js';
import { MinisterstwoFinansowClient } from './integrations/ministerstwo-finansow-client.js';
import type { TemplateEmail } from '../transactional_emails/services/template-email.js';
import type { OrganizationEventBus } from './services/registration-service.js';
import { organizationsModule, type OrganizationsModuleOptions } from './plugin.js';
import { EMAIL_VERIFICATION_DEFAULT, NEW_ORG_REGISTRATION_DEFAULT, ORGANIZATION_INVITATION_DEFAULT } from './email-templates/transactional-defaults.js';
import type { EmailDefaultsRegistry } from '../transactional_emails/services/email-defaults-registry.js';

/**
 * `organizations` — the tenancy root, and seven container names claimed by a
 * table that nobody was registering (feature 072, wave 4, T138).
 *
 * This module owns more root-built machinery than any other converted so far:
 * eight services, two EventBus subscriptions, and the four closures that turn a
 * request actor into a per-Organization allow-list. Converting it drains all
 * seven `HOST_REGISTERED_PORTS` entries declared `'organizations'`.
 *
 * **The allow-lists are the interesting part.** `buildOrgAllowListResolver` in
 * each root fused two unrelated reads into one closure: *actor → organization
 * id* (composition-shaped — production reads `request.actor`, the harness
 * `request.testActor`) and *organization id → allowed ids* (this module's
 * domain knowledge). Fused, it could only be a root contribution, which is why
 * `payment_methods`, `delivery_methods` and `inventory` each declared a
 * contribution point for it. Split, neither half is a contribution point: the
 * first is a deployment input the roots register once as
 * `customerOrganizationIdResolver`, the second is
 * {@link OrganizationRestrictionService.allowedIdsFor} behind a gated port, and
 * each consumer composes the two itself.
 *
 * That split is forced, not stylistic. A module may not write a name another
 * module owns — `ctx.di.register` claims every key and the kernel throws
 * `DuplicateRegistrationError` on the second writer — so "`organizations`
 * contributes to `payment_methods`' contribution point" was never available.
 * Contribution points are a root↔module seam because a root sits outside the
 * manifest graph and has no `dependencies` array that could record the edge; a
 * module↔module edge always can be expressed as the dependent resolving the
 * provider's port, and therefore must be.
 *
 * **The degrade moved with it.** The old closure wrapped the read in a bare
 * `catch` that returned "no restriction". Around a *port* call that also
 * swallows `ModuleDisabledError`, turning a fail-closed gate into a fail-open
 * restriction check — on the one path whose whole job is to restrict. The
 * "organization unknown or soft-deleted ⇒ unrestricted" policy now lives in
 * `allowedIdsFor`'s return type, where it belongs, and no consumer needs a
 * `catch` at all.
 *
 * **Two EventBus subscriptions stop being ungated.** Both roots called
 * `eventBus.on('organization.registered.v1', …)` directly, so the admin
 * notification and the moderation reactor fired even with the module switched
 * off — the defect `shipments` and `payments` produced in wave 2. They are
 * `ctx.subscribe` now (Constitution XVII item 2).
 *
 * **`dictionaryValidator` is passed for the first time.** `RegistrationService`
 * has always taken one and `validateCountry` returns early without it; neither
 * root ever passed one, so organization registration accepted any country
 * string, including a code an operator had deactivated. Third instance of that
 * exact shape after `sales_channels` and `inventory`.
 *
 * This module is **non-deactivatable** and composes in the **early pass**:
 * `customer_accounts` and `credit_limits` are early and both declare it as a
 * dependency.
 */

/** What `organizations` resolves from the container, and the names it owns. */
export interface OrganizationsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditLogService;
  readonly settingsReadPort: SettingsService;
  readonly salesChannelResolutionPort: SalesChannelResolverService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireAdminAny: RequireAdminAnyFactory;
  readonly requireCustomer: OrganizationsModuleOptions['requireCustomer'];
  readonly customerContextResolver: OrganizationsModuleOptions['resolveCustomerContext'];
  readonly customerAuthService: OrganizationsModuleOptions['customerAuthService'];
  readonly passwordResetService: OrganizationsModuleOptions['passwordResetService'];
  readonly customerRoleService: OrganizationsModuleOptions['customerRoleService'];
  readonly totpEnrolmentService: OrganizationsModuleOptions['totpEnrolmentService'];
  readonly addressService: OrganizationsModuleOptions['addressService'];
  readonly customFieldValueService: NonNullable<OrganizationsModuleOptions['customFieldValues']>;
  readonly dictionaryValidator: DictionaryValidator;
  readonly emailMailer: NonNullable<OrganizationsModuleOptions['mailer']>;
  readonly adminNotificationService: ConstructorParameters<
    typeof OrgRegistrationNotifier
  >[0]['adminNotificationService'];
  /**
   * `transactional_emails`' own accessors since T120. The sender is late-bound
   * — that module publishes it at route registration — and the template adapter
   * is the one this module used to build for itself from a helper it owned.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  readonly templateEmailPort: TemplateEmail;
  /**
   * Deployment inputs. The storefront origin an invitation link points at is an
   * environment fact; the probe is a harness fact — a route that hands back the
   * last verification token must never exist in production.
   */
  readonly storefrontBaseUrl: string;
  readonly organizationsExposeTestProbe: boolean;
  /**
   * The channel scope this module's own settings are read at. Root-supplied
   * because it is `ORGANIZATIONS_SETTINGS_CHANNEL_ID`, an env knob.
   */
  readonly organizationsSettingsChannelId: string;
  /**
   * Contribution point: what else a login must do. `carts` merges the anonymous
   * cart, `comparisons` adopts the anonymous comparison. Points *outward* from
   * this module to two that depend on it, so it cannot be a port; defaulted to
   * doing nothing, which is a coherent login.
   */
  readonly organizationsLoginHook: NonNullable<OrganizationsModuleOptions['onLogin']>;
  /**
   * Contribution point: the VAT-ID clients. Production contributes nothing and
   * this module talks to VIES and Ministerstwo Finansów; the harness scripts
   * both, because no test may open that socket.
   */
  readonly organizationsTaxIdClients: Pick<
    ConstructorParameters<typeof OrganizationTaxIdValidationService>[0],
    'vies' | 'mfPl'
  >;
  readonly organizationReadPort: OrganizationReadPort;
  readonly organizationRestrictionPort: OrganizationRestrictionService;
  readonly organizationTreeService: OrganizationTreeService;
  readonly organizationInheritancePort: OrganizationInheritanceService;
  readonly organizationModerationService: OrganizationModerationService;
  readonly organizationRegistrationNotifier: OrgRegistrationNotifier;
  readonly organizations: ReturnType<typeof organizationsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): OrganizationsCradle => ctx.cradle<OrganizationsCradle>();

  /**
   * Both settings reads degrade to the manifest's own default rather than
   * failing a registration. The identical try/catch stood in each root; the
   * `manual` fallback in particular is deliberate, so a brand-new install never
   * grants an unverified Organization transaction rights by accident.
   */
  const readSetting = async <T>(
    code: string,
    schema: Parameters<SettingsService['get']>[2],
    fallback: T,
  ): Promise<T> => {
    try {
      return (await cradle().settingsReadPort.get(
        code,
        cradle().organizationsSettingsChannelId,
        schema,
      )) as T;
    } catch {
      return fallback;
    }
  };

  ctx.di.register({
    // Production contributes nothing and reaches the real registries.
    organizationsTaxIdClients: ctx
      .asFunction((): OrganizationsCradle['organizationsTaxIdClients'] => ({
        vies: new ViesClient(),
        mfPl: new MinisterstwoFinansowClient(),
      }))
      .singleton(),

    // Default: a login does nothing beyond logging in.
    organizationsLoginHook: ctx
      .asFunction((): OrganizationsCradle['organizationsLoginHook'] => async () => ({}))
      .singleton(),

    organizationModerationService: ctx
      .asFunction(
        ({ emFactory, auditLogService, eventBus }: OrganizationsCradle) =>
          new OrganizationModerationService(
            emFactory,
            auditLogService,
            eventBus as unknown as OrganizationEventBus,
            // Every one of these three is another module's gated service and is
            // *stored* by the constructor, so a plain cradle read would freeze
            // a transient gate inside a singleton — it would keep answering
            // after `email` was switched off, and Awilix's strict mode refuses
            // it outright.
            lazyPort<OrganizationsCradle['emailMailer']>(ctx, 'emailMailer'),
            () =>
              readSetting<'auto' | 'manual'>(
                ORGANIZATIONS_SETTING_CODES.MODERATION_MODE,
                moderationModeSchema,
                'manual',
              ),
          ),
      )
      .singleton(),

    organizationRegistrationNotifier: ctx
      .asFunction(
        ({ emFactory }: OrganizationsCradle) =>
          new OrgRegistrationNotifier({
            emFactory,
            adminNotificationService: lazyPort<
              OrganizationsCradle['adminNotificationService']
            >(ctx, 'adminNotificationService'),
            mailer: lazyPort<OrganizationsCradle['emailMailer']>(ctx, 'emailMailer'),
            resolveRecipients: () =>
              readSetting<string[]>(
                ORGANIZATIONS_SETTING_CODES.NEW_REGISTRATION_RECIPIENTS,
                notificationRecipientsSchema,
                [],
              ),
            templateEmail: lazyPort<OrganizationsCradle['templateEmailPort']>(
              ctx,
              'templateEmailPort',
            ),
          }),
      )
      .singleton(),

    organizations: ctx
      .asFunction(
        ({ emFactory, eventBus, commandBus, auditLogService }: OrganizationsCradle) =>
          organizationsModule({
            emFactory,
            eventBus,
            commandBus,
            auditLogService,
            addressService: lazyPort<OrganizationsCradle['addressService']>(
              ctx,
              'addressService',
            ),
            // Every one of these is another module's **gated** port, and this
            // registration is a singleton: reading one here would put a
            // transient gate inside a longer-lived object, which Awilix's
            // strict mode refuses outright — `Dependency has a shorter lifetime
            // than its ancestor`. `lazyPort` resolves per method call, so the
            // gate stays live and the lifetimes stay honest.
            customerAuthService: lazyPort<OrganizationsCradle['customerAuthService']>(
              ctx,
              'customerAuthService',
            ),
            passwordResetService: lazyPort<OrganizationsCradle['passwordResetService']>(
              ctx,
              'passwordResetService',
            ),
            customerRoleService: lazyPort<OrganizationsCradle['customerRoleService']>(
              ctx,
              'customerRoleService',
            ),
            totpEnrolmentService: lazyPort<OrganizationsCradle['totpEnrolmentService']>(
              ctx,
              'totpEnrolmentService',
            ),
            customFieldValues: lazyPort<OrganizationsCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            // Passed for the first time by any composition — see the note above
            // on `validateCountry`.
            dictionaryValidator: lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            mailer: lazyPort<OrganizationsCradle['emailMailer']>(ctx, 'emailMailer'),
            templateEmail: lazyPort<OrganizationsCradle['templateEmailPort']>(
              ctx,
              'templateEmailPort',
            ),
            storefrontBaseUrl: cradle().storefrontBaseUrl,
            exposeTestProbe: cradle().organizationsExposeTestProbe,
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireAdminAny: (permissions) => async (req, reply) =>
              cradle().requireAdminAny(permissions)(req, reply),
            requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
            resolveCustomerContext: (req: FastifyRequest) =>
              cradle().customerContextResolver(req),
            onLogin: (input) => cradle().organizationsLoginHook(input),
            // Registered unconditionally. Before T138 each of these four was an
            // optional argument, and an omitted one silently removed a route
            // surface: no `restrictionService` meant no storefront preflight,
            // no `moderationService` meant approve/reject/block did not exist.
            // Which endpoints a deployment serves is not a function of which
            // arguments a root remembered to pass.
            moderationService: cradle().organizationModerationService,
            restrictionService: lazyPort<OrganizationsCradle['organizationRestrictionPort']>(
              ctx,
              'organizationRestrictionPort',
            ),
            effectivePriceListsService: new OrganizationEffectivePriceListsService({
              emFactory,
              resolveDefaultSalesChannelId: async () =>
                (await cradle().salesChannelResolutionPort.getSystemDefault())?.id ?? 'default',
            }),
            taxIdValidationService: new OrganizationTaxIdValidationService({
              emFactory,
              auditLog: auditLogService,
              ...cradle().organizationsTaxIdClients,
            }),
          }),
      )
      .singleton(),
  });

  // The four gated ports this module owns. Every one of them was a
  // `HOST_REGISTERED_PORTS` entry — a table row asserting an owner that never
  // registered anything. `organizationReadPort` is the starkest: the kernel has
  // declared its shape since D-32 and no composition ever provided it, so the
  // name existed only in a test fixture.
  ctx.di.providePort(
    'organizationReadPort',
    ctx
      .asFunction(({ emFactory }: OrganizationsCradle) => new OrganizationContextService(emFactory))
      .singleton(),
  );

  ctx.di.providePort(
    'organizationRestrictionPort',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: OrganizationsCradle) =>
          new OrganizationRestrictionService(emFactory, auditLogService),
      )
      .singleton(),
  );

  // One instance per composition. Production shared one; the harness built four
  // separate ones for four consumers, which is issue #44's shape.
  ctx.di.providePort(
    'organizationTreeService',
    ctx
      .asFunction(({ emFactory }: OrganizationsCradle) => new OrganizationTreeService(emFactory))
      .singleton(),
  );

  ctx.di.providePort(
    'organizationInheritancePort',
    ctx
      .asFunction(
        ({ emFactory }: OrganizationsCradle) =>
          new OrganizationInheritanceService(
            emFactory,
            // Its own port, and gated all the same — a singleton may not hold
            // the gate.
            lazyPort<OrganizationTreeService>(ctx, 'organizationTreeService'),
            () =>
            readSetting<'shared_pool' | 'independent_default'>(
              ORGANIZATIONS_SETTING_CODES.CREDIT_INHERITANCE_MODE,
              creditInheritanceModeSchema,
              'shared_pool',
            ),
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    await cradle().organizations(app);
  });

  // Both reactors used to be bare `eventBus.on` calls in each root, so they ran
  // whether or not the module was present. Failures inside either one never
  // poison the registration itself — the EventBus catches handler throws.
  ctx.subscribe('organization.registered.v1', async (payload) => {
    const { organizationId } = payload as unknown as { organizationId: string };
    await cradle().organizationRegistrationNotifier.handleRegistered(organizationId);
  });
  ctx.subscribe('organization.registered.v1', async (payload) => {
    const { organizationId } = payload as unknown as { organizationId: string };
    await cradle().organizationModerationService.handleNewlyRegistered(organizationId);
  });

  /**
   * The default subject and content for the 3 transactional emails this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
    defaults.register('email_verification', EMAIL_VERIFICATION_DEFAULT, 'organizations');
    defaults.register('organization_invitation', ORGANIZATION_INVITATION_DEFAULT, 'organizations');
    defaults.register('new_org_registration', NEW_ORG_REGISTRATION_DEFAULT, 'organizations');
  });

}
