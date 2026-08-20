import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type {
  AddressServicePort,
  AdminNotificationRecordPort,
  CustomFieldValuePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
  CustomerAuthPort,
  CustomerPasswordResetPort,
  CustomerRolePort,
  CustomerTotpEnrolmentPort,
  DictionaryValidator,
  EmailDefaultsRegistryPort,
  EmailMailerPort,
  OrganizationCartApprovalWritePort,
  OrganizationDetailsPort,
  OrganizationInheritancePort,
  OrganizationRestrictionPort,
  PersonalOrganizationPort,
  PriceListReadPort,
  TemplateEmailPort,
  TransactionalEmailSender,
  VatValidator,
  DictionaryReferenceRegistryPort,
} from '@b2b/contracts';
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
import {
  OrganizationDetailsService,
  toOrganizationRecord,
} from './services/organization-details-port.js';
import { PersonalOrganizationService } from './services/personal-organization-service.js';
import { OrganizationRestrictionService } from './services/organization-restriction-service.js';
import { OrganizationTreeService } from './services/organization-tree-service.js';
import { OrganizationInheritanceService } from './services/organization-inheritance-service.js';
import { OrganizationModerationService } from './services/organization-moderation-service.js';
import { OrganizationEffectivePriceListsService } from './services/organization-effective-pricelists-service.js';
import { OrganizationTaxIdValidationService } from './services/organization-tax-id-validation-service.js';
import {
  SalesRepAssignmentService,
  type SalesRepAssignmentPort,
} from './services/sales-rep-assignment-service.js';
import { OrgRegistrationNotifier } from './services/org-registration-notifier.js';
import { makeSetCartApprovalPolicyCommand } from './commands/set-cart-approval-policy.command.js';
import { Organization } from './entities/organization.entity.js';
import { ViesClient } from './integrations/vies-client.js';
import { MinisterstwoFinansowClient } from './integrations/ministerstwo-finansow-client.js';
import type { OrganizationEventBus } from './services/registration-service.js';
import { organizationsModule, type OrganizationsModuleOptions } from './plugin.js';
import { EMAIL_VERIFICATION_DEFAULT, NEW_ORG_REGISTRATION_DEFAULT, ORGANIZATION_INVITATION_DEFAULT } from './email-templates/transactional-defaults.js';
import { registerOrganizationCountryReferences } from './services/organization-country-reference.js';

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
 * This module is **non-deactivatable**, and `customer_accounts` and
 * `credit_limits` both declare it as a dependency. Where it sits in the
 * composer's emitted order buys nothing on top of that: since D-45 there is one
 * registration pass and registration resolves nothing, so the manifest edge is
 * what the lifecycle, the migration order and an operator's switch all read.
 *
 * **The sales-rep scope came home in T143a cluster 6, and the two roots did not
 * agree on it.** Production built `SalesRepAssignmentService` *with* the
 * feature-056 subtree deps — the org tree and the `organizations:rollup`
 * capability check — so a rep holding the capability saw the subtree of each
 * assignment. The harness built the same class with neither, and its
 * orders/RFQ scope resolver did not use even that: it ran its own raw SQL over
 * `organization_sales_rep_assignments`. So the roll-up rule was exercised by no
 * test through either path, and a flat list is what every test asserted
 * against. `organizationSalesRepScopePort` is one implementation for both
 * compositions, and it is `quote_requests`' `salesRepSubtree` wiring spelled
 * once instead of a fourth time.
 */

/** What `organizations` resolves from the container, and the names it owns. */
/**
 * The Organization facts a VAT rate depends on, as this module answers them.
 *
 * `country` is nullable because the caller's fallback is a business rule
 * (`'PL'`, in the Quote Requests resolver) and belongs where that rule is
 * written, not here — a port that invented a country would make an unregistered
 * address indistinguishable from a Polish one.
 */
export interface OrganizationTaxProfilePort {
  taxProfileOf(organizationId: string): Promise<{
    vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
    country: string | null;
  } | null>;
}

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
  readonly customerAuthPort: CustomerAuthPort;
  readonly passwordResetService: CustomerPasswordResetPort;
  readonly customerRolePort: CustomerRolePort;
  readonly totpEnrolmentService: CustomerTotpEnrolmentPort;
  /**
   * The two halves of `customer_accounts`' published surface this module runs
   * its member lifecycle over (feature 075, Phase C). Every route file and
   * three services named that module's entity before the cut.
   */
  readonly customerAccountReadPort: CustomerAccountReadPort;
  readonly customerAccountMemberWritePort: CustomerAccountMemberWritePort;
  readonly addressService: AddressServicePort;
  readonly customFieldValueService: CustomFieldValuePort;
  readonly dictionaryValidator: DictionaryValidator;
  readonly emailMailer: EmailMailerPort;
  readonly adminNotificationRecordPort: AdminNotificationRecordPort;
  /** `price_lists`' own answer to "which lists are active" (feature 075, Phase C). */
  readonly priceListReadPort: PriceListReadPort;
  /**
   * `transactional_emails`' own accessors since T120. The sender is late-bound
   * — that module publishes it at route registration — and the template adapter
   * is the one this module used to build for itself from a helper it owned.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  readonly templateEmailPort: TemplateEmailPort;
  readonly emailDefaultsPort: EmailDefaultsRegistryPort;
  /**
   * Deployment inputs. The storefront origin an invitation link points at is an
   * environment fact; the probe is a harness fact — a route that hands back the
   * last verification token must never exist in production.
   */
  readonly storefrontBaseUrl: string;
  readonly organizationsExposeTestProbe: boolean;
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
  /**
   * The two tax-ID adapters. **Both required**, unlike the service's own
   * optional constructor fields: this module always registers a default pair
   * and every composition that overrides them overrides both, so an optional
   * type here would only be a way for `vatValidatorPort` to hand out
   * `undefined` for a state no composition can produce (feature 076, D-86).
   */
  readonly organizationsTaxIdClients: {
    readonly vies: VatValidator;
    readonly mfPl: VatValidator;
  };
  readonly organizationReadPort: OrganizationReadPort;
  readonly organizationRestrictionPort: OrganizationRestrictionService;
  readonly organizationTreeService: OrganizationTreeService;
  /** Owned by `admin_roles`: whether this rep holds the roll-up capability. */
  readonly permissionService: {
    hasPermission(adminUserId: string, permission: string): Promise<boolean>;
  };
  /**
   * Which organizations a sales-rep admin may see, subtree-expanded when the
   * rep holds `organizations:rollup` (feature 056 / T143a).
   */
  readonly organizationSalesRepScopePort: SalesRepAssignmentPort;
  readonly organizationInheritancePort: OrganizationInheritanceService;
  readonly organizationModerationService: OrganizationModerationService;
  readonly organizationRegistrationNotifier: OrgRegistrationNotifier;
  readonly organizations: ReturnType<typeof organizationsModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): OrganizationsCradle => ctx.cradle<OrganizationsCradle>();

  /**
   * All three `organizations.*` settings are **platform-wide**: whether a new
   * Organization needs manual moderation, who is notified when one registers,
   * and how a parent's credit limit is inherited are properties of the
   * business, not of a storefront. So the read passes `null` (feature 072,
   * D-41 case c).
   *
   * It used to pass `organizationsSettingsChannelId`, a root-supplied name
   * carrying `ORGANIZATIONS_SETTINGS_CHANNEL_ID` — an undocumented env var
   * whose default was the string `'default'`, a channel **code** against a
   * `uuid` column. D-41 deleted the name rather than fixing its value, because
   * a DI name that carries a sentinel is one no static check can see.
   *
   * The reads degrade to the manifest's own default rather than failing a
   * registration; the `manual` fallback in particular is deliberate, so a
   * brand-new install never grants an unverified Organization transaction
   * rights by accident.
   */
  const readSetting = async <T>(
    code: string,
    schema: Parameters<SettingsService['get']>[2],
    fallback: T,
  ): Promise<T> => {
    try {
      return (await cradle().settingsReadPort.get(code, null, schema)) as T;
    } catch {
      return fallback;
    }
  };

  /**
   * The VAT-ID validator, published — feature 076, D-86.
   *
   * `customers` used to build its own `new ViesClient()` from an import of this
   * module's `integrations/` directory, over a contribution point of its own.
   * Its comment claimed the harness got "the same fake the organizations wiring
   * gets… that coupling is now structural rather than a note" while the
   * mechanism was two roots constructing two objects. Resolving one port makes
   * it structural for real, and it is one contribution point fewer for a root
   * to keep in step.
   *
   * It hands out whatever `organizationsTaxIdClients.vies` is, which is the
   * contribution point the harness already overrides — so the fake reaches both
   * consumers by construction rather than by two roots agreeing to pass it.
   *
   * The gate is unreachable, and that is fine: this module is
   * `nonDeactivatable`, so the port reads `OWNER LOCKED`. The ruling fixes the
   * ownership statement; the gate is not what was wrong.
   */
  ctx.di.providePort<VatValidator>(
    'vatValidatorPort',
    ctx
      .asFunction(
        ({ organizationsTaxIdClients }: OrganizationsCradle) => organizationsTaxIdClients.vies,
      )
      .singleton(),
  );

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
            lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
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
            adminNotificationService: lazyPort<AdminNotificationRecordPort>(
              ctx,
              'adminNotificationRecordPort',
            ),
            mailer: lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
            resolveRecipients: () =>
              readSetting<string[]>(
                ORGANIZATIONS_SETTING_CODES.NEW_REGISTRATION_RECIPIENTS,
                notificationRecipientsSchema,
                [],
              ),
            templateEmail: lazyPort<TemplateEmailPort>(ctx, 'templateEmailPort'),
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
            // Feature 075, Phase C (issue #195) — the record-mapping adapter,
            // not the `addressService` class registration beside it: `Address`
            // is structurally assignable to `AddressRecord`, so the old name
            // compiled while the entity crossed. Same reasoning as the two
            // `customer_accounts` ports below.
            addressService: lazyPort<AddressServicePort>(ctx, 'addressServicePort'),
            // Every one of these is another module's **gated** port, and this
            // registration is a singleton: reading one here would put a
            // transient gate inside a longer-lived object, which Awilix's
            // strict mode refuses outright — `Dependency has a shorter lifetime
            // than its ancestor`. `lazyPort` resolves per method call, so the
            // gate stays live and the lifetimes stay honest.
            // Feature 075, Phase C — `customerAuthPort` / `customerRolePort`
            // rather than the two same-named services beside them. Those hand
            // back `customer_accounts`' entity; these hand back the published
            // record, which is what stops the entity crossing.
            customerAuthService: lazyPort<CustomerAuthPort>(ctx, 'customerAuthPort'),
            passwordResetService: lazyPort<CustomerPasswordResetPort>(
              ctx,
              'passwordResetService',
            ),
            customerRoleService: lazyPort<CustomerRolePort>(ctx, 'customerRolePort'),
            totpEnrolmentService: lazyPort<CustomerTotpEnrolmentPort>(
              ctx,
              'totpEnrolmentService',
            ),
            customerAccountRead: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            customerAccountWrite: lazyPort<CustomerAccountMemberWritePort>(
              ctx,
              'customerAccountMemberWritePort',
            ),
            customFieldValues: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
            // Passed for the first time by any composition — see the note above
            // on `validateCountry`.
            dictionaryValidator: lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
            mailer: lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
            templateEmail: lazyPort<TemplateEmailPort>(ctx, 'templateEmailPort'),
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
              // D-48 — this was `?? 'default'`, a channel *code* landing in
              // `ResolutionContext.salesChannelId`, which the price-list
              // evaluator compares against channel **uuids**. On the fallback
              // branch every `salesChannel` criterion therefore evaluated false
              // and the panel reported channel-scoped lists as not applying.
              // The branch cannot be taken, so the fallback goes with it.
              resolveDefaultSalesChannelId: async () =>
                (await cradle().salesChannelResolutionPort.getSystemDefault()).id,
              // Feature 075, Phase C — `price_lists`' own `listActive`, where
              // this service used to run `em.find(PriceList, …)` against that
              // module's table and spell the status filter itself.
              priceListRead: lazyPort<PriceListReadPort>(ctx, 'priceListReadPort'),
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

  /**
   * Feature 075, Phase P — the row-level read model.
   *
   * A **second** port beside `organizationReadPort` above, not a replacement:
   * that one is the tenancy projection D-55 settled at `{ id, status }`, and
   * `organizationTaxProfilePort` already declined to widen it for the same
   * reason. Eleven modules read the row itself, and between them they touch
   * nearly every column; that is this port.
   */
  ctx.di.providePort<OrganizationDetailsPort>(
    'organizationDetailsPort',
    ctx
      .asFunction(({ emFactory }: OrganizationsCradle) => new OrganizationDetailsService(emFactory))
      .singleton(),
  );

  /**
   * Feature 075, Phase P — the personal-organization provisioner `customers`
   * calls on registration. It built its own `PersonalOrganizationService` in
   * `plugin.ts`; this is the one the module owns, and it takes the account id
   * rather than the entity.
   */
  ctx.di.providePort<PersonalOrganizationPort>(
    'personalOrganizationPort',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: OrganizationsCradle): PersonalOrganizationPort => {
          const service = new PersonalOrganizationService(
            emFactory,
            {
              // Feature 075, Phase C — `lazyPort` rather than a captured value:
              // the gates stay live inside this singleton, and the service reads
              // them per call.
              read: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
              write: lazyPort<CustomerAccountMemberWritePort>(
                ctx,
                'customerAccountMemberWritePort',
              ),
            },
            auditLogService,
          );
          return {
            ensureForCustomerAccount: async (customerAccountId) =>
              toOrganizationRecord(await service.ensureForCustomerAccountId(customerAccountId)),
            anonymizeIfOrphaned: async (customerAccountId) => {
              const org = await service.anonymizeIfOrphaned(customerAccountId);
              return org ? toOrganizationRecord(org) : null;
            },
          };
        },
      )
      .singleton(),
  );

  /**
   * Issue #175 — the cart-approval policy write.
   *
   * `carts` drives both surfaces that flip `requires_cart_approval` but the
   * column is this module's, and it was writing it by holding this module's
   * entity — the last entry in that module's cross-module import ledger. D-78
   * step 1 puts the operation with the owner, and publishing it settled the
   * question the direct write had been ducking: the flip had no audit row on
   * this side, and Constitution XIII says it must have one. Hence a Command,
   * whose actor the bus derives from the caller's ambient context.
   *
   * The cascade over `carts`' own rows stays with `carts`, keyed off `changed`.
   */
  ctx.di.providePort<OrganizationCartApprovalWritePort>(
    'organizationCartApprovalWritePort',
    ctx
      .asFunction(
        ({ commandBus }: OrganizationsCradle): OrganizationCartApprovalWritePort => ({
          setCartApprovalPolicy: (organizationId, requiresCartApproval) =>
            commandBus.run(
              makeSetCartApprovalPolicyCommand({ organizationId, requiresCartApproval }),
            ),
        }),
      )
      .singleton(),
  );

  ctx.di.providePort<OrganizationRestrictionPort>(
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

  /**
   * The two Organization facts a VAT rate depends on (T143c).
   *
   * Both roots spelled the same `em.findOne(Organization, …)` inside the Quote
   * Requests tax closure — a root loading this module's entity, and doing it
   * ungated, so the quote was priced from an Organization row with
   * `organizations` switched off. Refusing is the right answer there: the
   * closure deliberately carries no `catch` (issue #84), because quoting 0 % on
   * an operator's behalf is worse than failing.
   *
   * Deliberately not a widening of the kernel's `OrganizationSnapshot`. That
   * shape is the tenancy projection every module reads; a tax profile is one
   * consumer's question, and D-55 settled the snapshot at what its callers
   * actually use.
   */
  ctx.di.providePort(
    'organizationTaxProfilePort',
    ctx
      .asFunction(
        ({ emFactory }: OrganizationsCradle): OrganizationTaxProfilePort => ({
          taxProfileOf: async (organizationId: string) => {
            const org = await emFactory().findOne(Organization, { id: organizationId });
            if (!org) return null;
            return { vatStatus: org.vatStatus, country: org.registeredAddress?.country ?? null };
          },
        }),
      )
      .singleton(),
  );

  ctx.di.providePort<OrganizationInheritancePort>(
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

  /**
   * The visibility scope both roots used to build for themselves (T143a).
   *
   * A **port**, not a contribution point (D-39): it decides what an admin may
   * see, reading two tables and a capability to do it. A caller that reaches it
   * while the module is absent must get the 503 rather than an empty array,
   * because an empty array here reads as "this rep is assigned nothing" — a
   * plausible answer, and the wrong one.
   *
   * Both collaborators are read through `lazyPort`: the tree is this module's
   * own gated port and the permission check is `admin_roles`', and a singleton
   * may hold neither gate.
   *
   * Issue #108 widened it from one method to five. `customers` built its own
   * `SalesRepAssignmentService` **without** the subtree deps, so the roll-up was
   * skipped for every staff-authority decision, and `quote_requests` spelled the
   * same wiring out again. What kept them off this port was the methods it
   * did not carry — the visibility predicate, the per-organization rep list, and
   * the two writes this module's own admin routes make (routes `quote_requests`
   * hosts, because they count Quote Requests and moving them here would close a
   * manifest dependency cycle). So the port grew and the copies went.
   */
  ctx.di.providePort(
    'organizationSalesRepScopePort',
    ctx
      .asFunction(({ emFactory, auditLogService }: OrganizationsCradle): SalesRepAssignmentPort => {
        const assignments = new SalesRepAssignmentService(emFactory, auditLogService, {
          treeService: lazyPort<OrganizationTreeService>(ctx, 'organizationTreeService'),
          hasRollupCapability: (adminUserId: string) =>
            // `organizations:rollup` is a core `PERMISSION_CATALOGUE` code
            // rather than another module's private string, so naming it here
            // crosses no boundary — the same call `quote_requests` makes.
            lazyPort<OrganizationsCradle['permissionService']>(
              ctx,
              'permissionService',
            ).hasPermission(adminUserId, 'organizations:rollup'),
        });
        return {
          canSeeOrganization: (adminUserId, organizationId) =>
            assignments.canSeeOrganization(adminUserId, organizationId),
          listAssignedOrganizationIds: (adminUserId) =>
            assignments.listAssignedOrganizationIds(adminUserId),
          listForOrganization: (organizationId) => assignments.listForOrganization(organizationId),
          assign: (input) => assignments.assign(input),
          unassign: (input) => assignments.unassign(input),
        };
      })
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
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('email_verification', EMAIL_VERIFICATION_DEFAULT, 'organizations');
    defaults.register('organization_invitation', ORGANIZATION_INVITATION_DEFAULT, 'organizations');
    defaults.register('new_org_registration', NEW_ORG_REGISTRATION_DEFAULT, 'organizations');
  });


  /**
   * This module's rows carry a country code, so it answers "who still points at
   * this country?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `countryReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its country must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerOrganizationCountryReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'countryReferenceRegistry'),
      ctx.cradle<OrganizationsCradle>().emFactory,
    );
  });
}
