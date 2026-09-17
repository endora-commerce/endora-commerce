import type { AssetsLibraryCradle } from '../../../packages/modules/assets_library/src/backend/index.js';
import type { CartShoppingListBridge, CartsCradle } from '../../../packages/modules/carts/src/backend/index.js';
import type { ConfigurationTypeRegistry } from '../../../packages/modules/credentials/src/backend/services/configuration-type-registry.js';
import type { CredentialsService } from '../../../packages/modules/credentials/src/backend/services/credentials.service.js';
import type { AdminNotificationService } from '../../../packages/modules/admin_notifications/src/backend/services/admin-notification-service.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';

import { buildServer, type ModulePlugin } from '@endora-commerce/platform/composition';
import type { ApiInterceptorRegistry } from '@endora-commerce/platform/composition';
import { publishStateChanged, registryCache } from '@endora-commerce/platform/composition';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { type TenantContext } from '@endora-commerce/platform/tenancy';
// Feature 072 — the generated module list, composed in one pass exactly as
// `src/composition.ts` composes it (D-45). Issue #52 — and contributed into
// through the same `composedModules.contribute(…)` window, which is a method
// rather than a convention precisely because this pair kept drifting.
import { MODULES } from '../../src/composition.generated.js';
// The composition machinery, through `@endora-commerce/platform/composition`
// since feature 109's T011a (D-160.14): it is the host's surface and not the
// `./kernel` subpath's, and this is the second composition root rather than a
// module. `harness-parity.test.ts` holds the two roots to each other.
//
// It was a relative specifier into the platform's re-export shims until then —
// a path a published package does not have, which is what stopped this file
// from becoming the test kit. The subpath is declared by the host's `exports`
// map, carried by no public barrel, and nameable by **no module**, production
// source or test: a module's server-bound test composes through the kit's
// `composeTestServer`, never through `composeModules`.
import {
  platformLogger,
  resolveTenantContext,
  systemTenantContext,
  type DecorationRecord,
  type KernelContainer,
} from '@endora-commerce/platform/composition';
// Feature 109 (T030) — the kit composes the platform-shaped half of this
// harness. It is the same seam a module package's own server-bound test calls,
// which is the point: there is one composer, and each caller supplies the one
// composition only it can describe.
import {
  composeTestServer,
  teardownTestServer,
  type TestServerHandle,
} from '@endora-commerce/test-kit/server';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { assertServicesAvailable } from '../declared-services.js';
import type { EventBus } from '@endora-commerce/platform/events';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { SessionService } from '@endora-commerce/mod-auth/backend';
import type { AuditLogService } from '@endora-commerce/platform/composition';
import type { PermissionService } from '../../../packages/modules/admin_roles/src/backend/services/permission-service.js';
import type { PermissionCatalogueService } from '../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import type { AdminRoleService } from '../../../packages/modules/admin_roles/src/backend/services/admin-role-service.js';
import type { AuthCradle } from '@endora-commerce/mod-auth/backend';
import {
  REGISTERED_MANIFESTS,
  deploymentShippedEntries,
  resolvedManifestEntries,
} from '../../src/lifecycle/registered-manifests.js';
import { loadOverlayModuleEntries } from '../../src/overlay/overlay-runtime.js';
import { loadDivergenceDeclaration } from '../../src/overlay/divergence-loader.js';
import { loadPackageModuleEntries } from '../../src/packages/package-runtime.js';
import {
  buildStaticRegistry,
  type LoadedManifestRegistry,
} from '@endora-commerce/platform/lifecycle';
import { ERROR_CODES } from '@endora-commerce/contracts';
// Feature 080 (T052) — the contract types for the seven ports that replaced
// this root's five entity-class reads, spelled exactly as `composition.ts`
// spells them.
import type {
  AdminPasswordVerificationPort,
  AdminRolePort,
  AdminUserReadPort,
  AssetReadPort,
  CustomerAccountReadPort,
  CustomerPasswordVerificationPort,
  CustomerRollupScopePort,
  SettingsManifestCollectionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AdminI18nCradle } from '@endora-commerce/mod-i18n/backend';
// D-54 — injected into the error envelope, exactly as `composition.ts` does it:
// `src/http` may not name a module (D-52), a composition root may.
//
// Feature 090 Phase 2 — and derived from the resolved manifests here too, by the
// same call in the same place. The harness composes the same modules production
// does, so a second way of building this map would be a second answer to "which
// bundle holds this code's sentence" that only one of the two roots ever gives.
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
} from '../../src/kernel/i18n/error-translation.js';
// Type-only, and off the package's **source** rather than its `./backend`
// subpath, because the three service types below come from the same source
// files: `dist` and `src` are two nominal declarations of one class, so a
// cradle typed by one and a getter typed by the other is TS2322. It erases,
// so nothing is loaded twice (D-160.6.1) — `check:singleton-identity` asks
// about value reaches, and this is not one.
import type { OrganizationsCradle } from '../../../packages/modules/organizations/src/backend/index.js';
import type { OrganizationModerationService } from '../../../packages/modules/organizations/src/backend/services/organization-moderation-service.js';
import type { OrganizationContextService } from '../../../packages/modules/organizations/src/backend/services/organization-context-service.js';
import type { OrganizationRestrictionService } from '../../../packages/modules/organizations/src/backend/services/organization-restriction-service.js';
import type {
  VatValidator,
  VatValidationResult,
} from '../../../packages/modules/organizations/src/backend/services/vat-validator-port.js';
// Feature 072 (T079) — `email` composes through the kernel here too, from the
// generated list. The five hand-rolled `new ConsoleMailer()` fallbacks this
// replaced were the reason a conversion of `composition.ts` alone would have
// proved nothing: every mail-sending suite runs against this root.
import type { EmailCradle } from '../../../packages/modules/email/src/backend/index.js';
import type { AdminUsersCradle } from '@endora-commerce/mod-admin-users/backend';
import type { ShoppingListService } from '../../../packages/modules/shopping_lists/src/backend/services/shopping-list-service.js';
// `dist`, not `src`, and it is the type that matches the object (feature 080,
// T040b, batch four). The container holds the **composed** cradle, which the
// platform built out of `@endora-commerce/mod-invoices/backend` — i.e. out of
// `dist` — so typing it from the package's source was already describing a
// different class. It is usually harmless, because most of these shapes are
// structural; it stops being harmless where one has a private field, which makes
// it nominal: `InvoiceNumberGenerator` does, and handing `h.invoices.numberGenerator`
// to a `dist`-imported `CorrectiveInvoiceProvider` is TS2345 until this import
// names the same build the runtime does.
import type { InvoicesCradle } from '../../../packages/modules/invoices/dist/backend/index.js';
import type { CustomFieldsCradle } from '../../../packages/modules/custom_fields/src/backend/index.js';
import type { CustomFieldDefinitionService } from '../../../packages/modules/custom_fields/src/backend/services/custom-field-definition.service.js';
import type { CustomFieldValueService } from '../../../packages/modules/custom_fields/src/backend/services/custom-field-value.service.js';
import type { CustomFieldDefinitionsCache } from '../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js';
import type { ApiKeysCradle } from '../../../packages/modules/api_keys/src/backend/index.js';
import type { CmsCradle } from '../../../packages/modules/cms/src/backend/index.js';
import type { MegamenuCradle } from '@endora-commerce/mod-megamenu/backend';
// Feature 072 — the harness is a second composition root, so a module left
// hand-wired here would keep passing against wiring nobody changed. It composes
// the same generated list production does; only the host values differ.
import type { BlogCradle } from '../../../packages/modules/blog/src/backend/index.js';
import type { DictionariesCradle } from '../../../packages/modules/dictionaries/src/backend/index.js';
import type { CustomerAccountsCradle } from '@endora-commerce/mod-customer-accounts/backend';
import type { PromotionsCradle } from '@endora-commerce/mod-promotions/backend';
import type { SettingsKernel } from '@endora-commerce/platform/composition';
import type { SettingsCradle } from '../../../packages/modules/settings/src/backend/index.js';
import type { OAuthProviderPort } from '../../../packages/modules/mfa/src/backend/services/oauth-provider-service.js';
import type { SalesChannelsKernel } from '@endora-commerce/platform/composition';
import type { SalesChannelsCradle } from '../../../packages/modules/sales_channels/src/backend/index.js';
import type { SearchCradle } from '../../../packages/modules/search/src/backend/index.js';
import type { PromptActionsCradle } from '../../../packages/modules/prompt_actions/src/backend/index.js';
import type { PromptActionToolRegistry } from '../../../packages/modules/prompt_actions/src/backend/services/tool-registry.js';
import type { PromptRequestService } from '../../../packages/modules/prompt_actions/src/backend/services/prompt-request.service.js';
import type { LlmProviderFactory } from '../../../packages/modules/prompt_actions/src/backend/services/llm/provider-factory.js';
import type { FetchLike } from '../../../packages/modules/prompt_actions/src/backend/services/llm/provider.js';
import type { KsefCradle } from '../../../packages/modules/ksef/src/backend/index.js';
import type { ProductFeedsCradle } from '../../../packages/modules/product_feeds/src/backend/index.js';
import type {
  TaxonomyFetchResult,
  TaxonomySourceFetcherPort,
} from '../../../packages/modules/product_feeds/src/backend/services/taxonomy-source-fetcher.interface.js';
import type { FeedDeliveryAdapter } from '../../../packages/modules/product_feeds/src/backend/services/delivery/delivery-adapter.interface.js';
import { FeedDeliveryError, type FeedDeliveryProtocol } from '@endora-commerce/contracts';
import type { PimErgonodeCradle } from '@endora-commerce/mod-pim-ergonode/backend';
import type { PimUnopimCradle } from '@endora-commerce/mod-pim-unopim/backend';
import type { ComarchXlCradle } from '../../../packages/modules/comarch_xl/src/backend/index.js';
import type {
  ErpConnectorRegistryPort,
  InfaktHttpPort,
  InvoiceLedgerRegistryPort,
  PimConnectorRegistryPort,
  WfirmaHttpPort,
} from '@endora-commerce/contracts';
import type { LedgerActivationPresenceReader } from '../../../packages/modules/invoice_ledger/src/backend/services/invoice-ledger-registry.service.js';
import type { ErgonodeClientPort } from '../../../packages/modules/pim_ergonode/src/backend/services/ergonode-client.port.js';
import type { ErgonodeMediaFetcherPort } from '../../../packages/modules/pim_ergonode/src/backend/services/ergonode-media-fetcher.js';
import type { UnopimMediaFetcherPort } from '../../../packages/modules/pim_unopim/src/backend/services/unopim-media-fetcher.js';
import type { AkeneoMediaFetcherPort } from '../../../packages/modules/pim_akeneo/src/backend/services/akeneo-media-fetcher.js';
import { refusingErgonodeClient } from '@endora-commerce/mod-pim-ergonode/test-support';
import { refusingUnopimClient } from '@endora-commerce/mod-pim-unopim/test-support';
import { refusingXlClient } from '@endora-commerce/mod-comarch-xl/test-support';
import { ScriptedErgonodeMediaFetcher } from '@endora-commerce/mod-pim-ergonode/test-support';
import { ScriptedUnopimMediaFetcher } from '@endora-commerce/mod-pim-unopim/test-support';
import { ScriptedAkeneoMediaFetcher } from '@endora-commerce/mod-pim-akeneo/test-support';
import type { PimPimcoreCradle } from '@endora-commerce/mod-pim-pimcore/backend';
import type { KsefApiClientPort } from '../../../packages/modules/ksef/src/backend/integrations/ksef-client.interface.js';
import type { PwaCradle } from '../../../packages/modules/pwa/src/backend/index.js';
import { composeErrorEnvelopeOptions } from '@endora-commerce/platform/composition';
import type { ComparisonsCradle } from '../../../packages/modules/comparisons/src/backend/index.js';
// `catalog`'s service type names the package's **`dist`**, unlike the other
// packaged modules above, and the difference is not cosmetic: the value it
// annotates comes off the composed container, which is `dist`, and an
// integration test that constructs one of these services itself must name
// `dist` too — a source copy would build entity classes the ORM never
// discovered (D-160.6.1, measured on `bulk-undo.test.ts` when this module was
// packaged). Typing the harness against `src` while every consumer names `dist`
// makes the two structurally-identical declarations non-assignable, which is
// TS2345 rather than a silent divergence, so the spelling has to agree.
//
// It read *"two service types"* until `specs/110-instance-repository/` T118c:
// `CatalogQueryService` was named here only to type the cradle read this
// harness made on `product_feeds`' behalf, and that bridge is gone.
import type { CatalogAttributeReadService } from '../../../packages/modules/catalog/dist/backend/services/catalog-attribute-read.service.js';
import type { PricingServiceContract } from '../../../packages/modules/price_lists/src/backend/services/pricing-service.interface.js';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { ManifestReconciler } from '@endora-commerce/platform/composition';
import type { CartService } from '../../../packages/modules/carts/src/backend/services/cart-service.js';
import type { Mailer } from '../../../packages/modules/email/src/backend/services/mailer.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations, TEST_ORGANIZATION_TAX_ID } from './seed-organizations.js';
import { seedUs2Commerce } from './seed-commerce.js';
import { seedTestAdmins } from './seed-admins.js';
import { TRANSLATION_PROOF } from './translation-proof.js';
import {
  registerTestAuth,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';
import {
  collectVolatileTables,
  type TestSupportContribution,
} from '@endora-commerce/test-kit/support';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * What `composeTestServer` hands back as `composed` — the contribution window
 * and the module sink.
 *
 * Named through the kit's own handle rather than by importing `ComposedModules`
 * from the platform: `composeModules`' return type is on no barrel, this feature
 * widens none (R3.1), and taking it from the value that carries it keeps it
 * correct in the same compile.
 */
type ComposedTestModules = TestServerHandle['composed'];

export async function setupTestServer(): Promise<FastifyInstance> {
  return buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: {
      title: 'B2B Platform API (test)',
      version: 'test',
      serverUrl: 'http://localhost',
    },
    disableRateLimit: true,
  });
}

export interface BackendServerOptions {
  seed?: 'us1-catalog' | 'none';
  extraModules?: ModulePlugin[];
  /** When set, injected into `organizationsModule` so tests can assert outbound mail (verification + invitations). */
  organizationsMailer?: Mailer;
  /** Feature 043 — scripted LLM fetch + clock/TTL seams for prompt-action tests. */
  promptActionsLlmFetch?: FetchLike;
  promptActionsNow?: () => Date;
  promptActionsTtlMinutes?: number;
  /** Feature 059 — stub KSeF API client for submission/credential tests. */
  ksefClientFactory?: (baseUrl: string) => KsefApiClientPort;
  /**
   * Feature 067 Phase 11 — the taxonomy egress transport. Defaults to a stub
   * that FAILS the test if it is ever called, so "no test in this repository
   * reaches the network" is enforced rather than hoped for; the refresh tests
   * pass their own fixture-serving stub.
   */
  taxonomySourceFetcher?: TaxonomySourceFetcherPort;
  /**
   * Feature 070 — the delivery transports. Defaults to adapters that REFUSE
   * every send and every check, for the same reason the taxonomy fetcher does:
   * a code path that starts uploading a priced catalogue to somebody's server
   * without a test opting in has to fail loudly, not quietly succeed.
   */
  feedDeliveryAdapters?: Map<FeedDeliveryProtocol, FeedDeliveryAdapter>;
  /**
   * Feature 068 — the Ergonode source transport. Defaults to a client that
   * THROWS on every stream read, so a test that forgets to script the source
   * fails loudly instead of reaching a customer's PIM; `pim_ergonode` tests pass
   * a `ScriptedErgonodeClient` holding their fixtures.
   */
  ergonodeClient?: ErgonodeClientPort;
  /**
   * Feature 068 / US5 — the byte source for imported media. Defaults to a
   * fetcher that has nothing scripted and therefore answers `not_found`, so a
   * test never opens a socket; the media tests pass a
   * `ScriptedErgonodeMediaFetcher` holding their files.
   */
  ergonodeMediaFetcher?: ErgonodeMediaFetcherPort;
  /**
   * Feature 089 — the UnoPim source transport. Defaults to a client that throws
   * on every stream read so no test reaches the network without scripting fixtures.
   */
  unopimClient?: PimUnopimCradle['pimUnopimSourceOverrides']['unopimClient'];
  /**
   * Feature 089 / US5 — the byte source for imported media. Defaults to a
   * fetcher that has nothing scripted and therefore answers `not_found`.
   */
  unopimMediaFetcher?: UnopimMediaFetcherPort;
  /**
   * Feature 119 — the Comarch XL source transport. Defaults to a client that
   * refuses every call so no test reaches the network without scripting fixtures.
   */
  xlClient?: ComarchXlCradle['comarchXlSourceOverrides']['xlClient'];
  /**
   * Feature 094 / US5 — the byte source for imported media. Defaults to a
   * fetcher that has nothing scripted and therefore answers `not_found`.
   */
  akeneoMediaFetcher?: AkeneoMediaFetcherPort;
  /**
   * Feature 119 — Infakt HTTP. Defaults to the module's refusing port. US1
   * connection-test scripts pass a stub that answers account details.
   */
  infaktHttp?: InfaktHttpPort;
  /**
   * Feature 129 — wFirma HTTP. Defaults to the module's refusing port. US1
   * connection-test scripts pass a stub that answers company probes.
   */
  wfirmaHttp?: WfirmaHttpPort;
  /**
   * Feature 119 / US10 — extra invoice-ledger vendor ids for the mutex
   * registry. Production `INVOICE_LEDGER_MODULES` lists Infakt and wFirma;
   * mutex contract tests may still inject `ledger_fixture` here.
   */
  invoiceLedgerVendorModules?: readonly { id: string }[];
  /**
   * Feature 119 / US10 — presence reader for the mutex registry. Defaults
   * to `effectiveState` inside the module. Tests that mark a sibling
   * operator-active without a second module package pass a wrapper.
   */
  invoiceLedgerPresence?: LedgerActivationPresenceReader;
  /**
   * Feature 072 (T073) — arm the cross-process pub/sub path: subscribe the
   * second Redis client to the custom-field and module-state channels.
   *
   * **Off by default, and that is the design, not a shortcut.** Subscribing
   * costs roughly 10 MB per composition and a run performs 555 of them — it
   * added ~1 GB to the suite's live set and pushed it into a heap OOM when it
   * was armed everywhere. Arming it in the handful of tests that actually
   * assert cross-process invalidation exercises the same code and asserts
   * something, which is strictly more than arming it everywhere and asserting
   * nothing.
   */
  exercisePubSub?: boolean;
  /**
   * Feature 060 — contribute API interceptor registrations before the server
   * seals the registry on ready. Contract tests use this to register fixture
   * interceptors against real module endpoints.
   */
  configureInterceptors?: (registry: ApiInterceptorRegistry) => void;
  /**
   * Feature 057 / D-104 — compose this deployment's overlay modules as well as
   * core, exactly as a `DEPLOYMENT=<name>` build does.
   *
   * It is an option rather than the ambient `DEPLOYMENT` variable because a
   * suite has to be able to compose **both**: the same run proves that the
   * deployment's module is present with it selected and absent without it, and
   * an environment variable read at import time cannot answer both questions in
   * one process. Unset means bare core, which is what every other test gets.
   *
   * This is testable at all only because a deployment's modules are discovered
   * at runtime (D-104). Under the previous shape a test of overlay composition
   * had to regenerate `composition.generated.ts` with `DEPLOYMENT` set — that
   * is, mutate a committed core artefact — before it could run, which is why
   * nobody wrote one.
   */
  deployment?: string;
}

export interface BackendServerHandle {
  app: FastifyInstance;
  orm: MikroORM;
  em: () => EntityManager;
  eventBus: EventBus;
  /** Feature 060 — the sealed API interceptor registry (execution plan via `.list()`). */
  apiInterceptors: ApiInterceptorRegistry;
  redis: Redis;
  /** Feature 072 (T073) — the module-state pub/sub client, disconnected at teardown. */
  redisSubscriber: Redis;
  /** Whether `exercisePubSub` armed a subscription, so teardown knows to undo it. */
  pubSubArmed: boolean;
  sessionService: SessionService;
  auditLogService: AuditLogService;
  permissionService: PermissionService;
  permissionCatalogueService: PermissionCatalogueService;
  /**
   * Feature 004 — the universal getter and cache invalidator (kernel-composed
   * since T118), plus the module's admin services, resolved from the container.
   */
  settings: SettingsKernel & {
    adminService: SettingsCradle['settingsAdminService'];
    cacheAdminService: SettingsCradle['settingsCacheAdminService'];
  };
  /** Feature 043 — prompt assistant handle (registry + request service). */
  promptActions: {
    registry: PromptActionToolRegistry;
    requestService: PromptRequestService;
    providerFactory: LlmProviderFactory;
  };
  /** Feature 058 — credentials handle (config-type registry + service). */
  credentials: {
    service: CredentialsService;
    configurationTypeRegistry: ConfigurationTypeRegistry;
  };
  /** Feature 047 — invoices handle (issuance service, PDF renderer, number generator). */
  invoices: {
    invoiceService: InvoicesCradle['invoiceService'];
    numberGenerator: InvoicesCradle['invoiceNumberGenerator'];
    pdfRenderer: InvoicesCradle['invoicePdfRenderer'];
    /**
     * What turns the operator's logo asset into the bytes a PDF embeds —
     * projected so a test can assert the **wiring** and not only the mapping
     * (D-223).
     *
     * It was a bridge member, optional, and this root omitted it entirely, so
     * every invoice rendered in this suite took the "no logo bytes" branch while
     * production embedded the logo. T118c made the module resolve it and the
     * option required, so the type is no longer optional here either: the
     * "is it there at all" assertion is now `tsc`'s.
     */
    loadAssetImage: InvoicesCradle['invoices']['handle']['loadAssetImage'];
  };
  /** Feature 059 — KSeF handle (settings, auth, credentials, submissions). */
  ksef: KsefCradle['ksef']['handle'];
  /** Feature 119 — drive the Infakt delivery processor (no BullMQ in this harness). */
  infakt: { processDelivery: (deliveryId: string) => Promise<void> };
  /** Feature 129 — drive the wFirma delivery processor (no BullMQ in this harness). */
  wfirma: { processDelivery: (deliveryId: string) => Promise<void> };
  /** Feature 119 — shared invoice-ledger vendor mutex port. */
  invoiceLedgerRegistry: InvoiceLedgerRegistryPort;
  /** Feature 067 — Product Feed handle (feeds, generation, runs, token cache). */
  productFeeds: ProductFeedsCradle['productFeeds']['handle'];
  /** Feature 068 — Ergonode PIM handle (source client seam, queue gate). */
  pimErgonode: PimErgonodeCradle['pimErgonode']['handle'];
  /** Feature 089 — shared PIM connector registry port. */
  pimConnectorRegistry: PimConnectorRegistryPort;
  /** Feature 119 — shared ERP connector registry port. */
  erpConnectorRegistry: ErpConnectorRegistryPort;
  /** Feature 089 — UnoPim PIM handle (source client seam). */
  pimUnopim: PimUnopimCradle['pimUnopim']['handle'];
  /** Feature 092 — Pimcore PIM handle (source client seam, inline import). */
  pimPimcore: PimPimcoreCradle['pimPimcore']['handle'];
  /** Feature 046 — PWA handle (config resolver, push services, delivery queue). */
  pwa: PwaCradle['pwa']['handle'];
  /**
   * Feature 005 — the resolver and membership service (kernel-composed since
   * T110), plus the module's CRUD service, resolved from the container.
   */
  salesChannels: SalesChannelsKernel & {
    salesChannelsService: SalesChannelsCradle['salesChannelsService'];
  };
  /** Feature 062 — api-keys/webhooks handle (api-key gates). */
  integrations: {
    apiKeyService: ApiKeysCradle['apiKeyService'];
    requireApiKey: ApiKeysCradle['requireApiKey'];
    requireBoundApiKey: ApiKeysCradle['requireBoundApiKey'];
  };
  /** Feature 006 — exposes the indexer + suggest service for tests that
   *  want deterministic teardown or to exercise embedder attach/detach. */
  search: SearchCradle['searchHandle'];
  /** Feature 007 — exposes the ComparisonService for tests. */
  comparisons: { comparisonService: ComparisonsCradle['comparisonService'] };
  /** Feature 013 — Assets Library handle (service, folders, registry, adapters). */
  assetsLibrary: AssetsLibraryCradle['assetsLibrary']['handle'];
  /** Feature 014 — CMS module handle (page builder registry, services, resolver). */
  cms: CmsCradle['cms']['handle'];
  /** Feature 015 — Megamenu module handle (reference registry, cache). */
  megamenu: {
    referenceRegistry: MegamenuCradle['megamenuReferenceRegistry'];
    cache: MegamenuCradle['megamenuServices']['cache'];
  };
  /**
   * Feature 016 — Blog services, resolved out of the kernel container (feature
   * 072). Not a module handle any more: `blog` declares itself through
   * `registerModule`, so this is a projection of the container for the tests
   * that reach past HTTP.
   */
  blog: {
    cache: BlogCradle['blogCacheService'];
    storefrontResolver: BlogCradle['blogStorefrontResolver'];
  };
  /** Feature 072 — the composed kernel container, disposed at teardown. */
  container: KernelContainer;
  /**
   * The kit's own handle for this composition (feature 109, T030).
   *
   * `teardownBackendServer` delegates to `teardownTestServer` with it, so the
   * release sequence — the app, the container's disposers, both Redis clients
   * and the ORM — has one implementation, shared with every module package's own
   * server-bound test. A hand-written copy is frozen at the moment it was
   * copied, which is what `check:harness-teardown` refuses one file down.
   */
  composition: TestServerHandle;
  /**
   * Feature 072 (T065) — the override report: every decoration this composition
   * applied, in application order, innermost first.
   *
   * Exposed so a test can assert that a deployment's overlay module wrapped the
   * core registration it names. Empty means a bare-core build, and it means it
   * explicitly — which is the assertion the bare-core half needs.
   */
  composedDecorations: readonly DecorationRecord[];
  /** Feature 017 — Dictionary module handle (cache + future validator). */
  dictionaries: {
    validator: DictionariesCradle['dictionaryValidator'];
    cache: DictionariesCradle['dictionaryCache'];
  };
  /** Feature 021 — error-envelope i18n bridge. */
  adminI18n: { i18nService: AdminI18nCradle['adminI18nService'] };
  /** Feature 015+ — promotions module handle (exposes PromotionService). */
  promotions: {
    promotionService: PromotionsCradle['promotionService'];
    couponService: PromotionsCradle['promotionCouponService'];
    ruleStore: PromotionsCradle['promotionRuleStore'];
    statsService: PromotionsCradle['promotionStatsService'];
  };
  /** Feature 055 — custom fields (definition + value services). */
  customFields: {
    definitionService: CustomFieldDefinitionService;
    valueService: CustomFieldValueService;
    cache: CustomFieldDefinitionsCache;
  };
  /** Feature 061 — the composed attribute read model (definition + extension views). */
  catalogAttributeRead: CatalogAttributeReadService;
  /**
   * The `pricingService` port, for fixtures that construct a listing service by
   * hand (issue #132). Read off the container so a fixture prices through the
   * same engine the composed modules do.
   */
  pricingService: PricingServiceContract;
  /**
   * `assets_library`'s read port, for fixtures that construct a catalogue
   * listing or link service by hand (feature 075). Read off the container for
   * the same reason `pricingService` is: a fixture resolves the instance the
   * composed module resolves, not a second one built beside it.
   */
  assetRead: AssetReadPort;
  /** Feature 026 — moderation lifecycle, admin notifications, org context. */
  organizations: {
    moderationService: OrganizationModerationService;
    adminNotificationService: AdminNotificationService;
    organizationContextService: OrganizationContextService;
    /** Feature 026 US4 — per-org allow-list service. */
    restrictionService: OrganizationRestrictionService;
  };
  /**
   * Feature 037 — direct handle on the CartService for tests that exercise
   * `mergeAnonymousIntoCustomer` without going through the login route.
   * Available once the commerce module finishes wiring (after `setupBackendServer`).
   */
  cartService: () => CartService | null;
}

/**
 * Feature 042 US4/US5 — deterministic fake OIDC provider for tests. The
 * resolved email is the `code` query value; `unverified@example.com` → an
 * unverified email. The authorization URL echoes `state` so callback tests can
 * read it from the redirect Location.
 */
const fakeOAuthProvider: OAuthProviderPort = {
  isEnabled: () => true,
  buildAuthorizationUrl: async (provider, { state }) =>
    `https://oauth.test/${provider}/authorize?state=${encodeURIComponent(state)}`,
  exchangeCode: async (provider, { code }) => ({
    provider,
    sub: `sub-${code}`,
    email: code,
    emailVerified: code !== 'unverified@example.com',
  }),
};

/**
 * The default taxonomy egress transport for tests: one that cannot reach
 * anything (feature 067 Phase 11, FR-087).
 *
 * A test that really called Google would be a flake, a privacy leak and a
 * dependency on CI having outbound internet. So the shared harness hands the
 * module a fetcher that refuses every request the same way an air-gapped
 * installation's network would, and the refresh tests inject their own stub
 * serving fixtures. This is the transport half of the same precaution that
 * points `taxonomyDataRoot` at a path which does not exist.
 */
function refusingTaxonomyFetcher(): TaxonomySourceFetcherPort {
  return {
    async fetchFile(): Promise<TaxonomyFetchResult> {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'transport',
        detail: 'No taxonomy egress is configured in the test harness.',
        httpStatus: null,
        bytesRead: null,
      };
    },
  };
}

/**
 * Feature 070 — the delivery transport half of the same precaution.
 *
 * Every adapter refuses, with a reason that names the harness rather than a
 * network condition, so a test that reaches a transport without scripting one
 * reads as a configuration mistake instead of as a flaky partner server.
 */
function refusingDeliveryAdapters(): Map<FeedDeliveryProtocol, FeedDeliveryAdapter> {
  const refuse = (protocol: FeedDeliveryProtocol): FeedDeliveryAdapter => ({
    protocol,
    async send(): Promise<void> {
      throw new FeedDeliveryError(
        'connection_failed',
        'No delivery transport is configured in the test harness.',
      );
    },
    async check(): Promise<void> {
      throw new FeedDeliveryError(
        'connection_failed',
        'No delivery transport is configured in the test harness.',
      );
    },
  });
  return new Map<FeedDeliveryProtocol, FeedDeliveryAdapter>([
    ['sftp', refuse('sftp')],
    ['ftp', refuse('ftp')],
    ['http', refuse('http')],
  ]);
}

/** Pick a display label from a possibly-multilingual (jsonb) name value. */
function testAnyLabel(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const values = Object.values(name as Record<string, string>);
    return values[0] ?? '';
  }
  return '';
}

/**
 * The tables this root empties between tests, minus the ones their own module
 * now declares.
 *
 * **It is not the order of the truncate, and never was.** Every name here goes
 * into one `truncate table … cascade` statement, which PostgreSQL resolves
 * itself; the children-first annotations this list carried were a comment about
 * a mechanism that is not there. That is why a module's own `volatileTables` can
 * be a set (contract R4.2) and why the union below needs no derivation to be
 * deterministic.
 *
 * Feature 134 T014 took the first twenty out — `pim_pimcore`'s eight,
 * `pim_ergonode`'s ten and `ksef`'s two — into those packages'
 * `src/test-support/index.ts`, where a module that leaves this repository takes
 * its tables with it. The remaining 80 are 109 T060–T064's, and the end state of
 * this array is that it does not exist.
 */
const SEEDED_TABLES = [
  // Feature 119's twelve `xl_*` tables were here on `fix/master-red-baseline`
  // and are `comarch_xl`'s own `volatileTables` now (feature 134 T014): the wipe
  // that branch added is kept in full, one directory over, where a module that
  // leaves this repository takes it along. Nothing about the repair changed —
  // the same twelve names go into the same one `truncate … cascade`.
  // Feature 067 — product feeds. `product_feeds` itself and everything hanging
  // off it cascade from `sales_channels`, but five tables do not reach any
  // table below: `product_feed_templates` and its fields, and the three
  // taxonomy tables — `product_feed_taxonomies`, its nodes and its checks. The
  // module reinstalls all five at boot (`reconcileTemplates` /
  // `reconcileTaxonomies`, both idempotent, both after this truncate), so
  // wiping them hands every file the same bundled corpus instead of whatever
  // the previous file promoted, imported or marked checked. The other seven are
  // listed for the same reason as the Comarch XL block: a cascade is a property
  // of today's foreign keys, not a guarantee. Listed children-first; the
  // `product_feeds` ⇄ `product_feed_runs` cycle (`current_run_id` /
  // `product_feed_id`) is what one `truncate … cascade` statement is for.
  'product_feed_taxonomy_checks',
  'product_feed_taxonomy_mappings',
  'product_feed_taxonomy_nodes',
  'product_feed_taxonomies',
  'product_feed_delivery_attempts',
  'product_feed_deliveries',
  'product_feed_run_issues',
  'product_feed_artefacts',
  'product_feed_runs',
  'product_feeds',
  'product_feed_template_fields',
  'product_feed_templates',
  // Feature 058 — credentials. Platform-global; truncate so each test starts clean.
  'credential_configurations',
  // Feature 055 — custom fields. Options cascade from definitions.
  'custom_field_options',
  'custom_field_definitions',
  // Feature 042 — MFA. Recovery codes cascade from enrolments.
  'mfa_recovery_codes',
  'mfa_enrolments',
  'mfa_social_identities',
  'mfa_organization_policies',
  'price_list_assignments',
  'price_list_items',
  'price_lists',
  'customer_groups',
  'taxes',
  'promotions',
  'cms_pages',
  // Feature 016 — blog. Truncate before sales_channels so the scope
  // rows cascade deterministically.
  'blog_post_related_products',
  'blog_post_related_posts',
  'blog_post_tags',
  'blog_post_categories',
  'blog_post_languages',
  'blog_post_sales_channels',
  'blog_posts',
  'blog_category_languages',
  'blog_category_sales_channels',
  'blog_categories',
  'blog_tags',
  // Feature 015 — megamenu. Truncate before sales_channels so the
  // bindings cascade is deterministic.
  'megamenu_bindings',
  'megamenu_items',
  'megamenus',
  'analytics_events',
  'sitemap_cache',
  'seo_meta_overrides',
  'audit_log_entries',
  'invoice_ledger_webhook_receipts',
  'invoice_ledger_deliveries',
  'invoice_ledger_document_maps',
  'invoice_ledger_client_maps',
  'invoice_ledger_activation_lock',
  'invoices',
  'payments',
  'order_items',
  'orders',
  'cart_items',
  'carts',
  'stock_levels',
  'payment_methods',
  'delivery_methods',
  'organization_invitations',
  'email_verification_tokens',
  'addresses',
  'customer_accounts',
  'admin_users',
  'admin_roles',
  'webhook_deliveries',
  'webhooks',
  'api_keys',
  'credit_limit_reservations',
  'credit_limits',
  'organizations',
  'sales_channel_products',
  'product_assets',
  'product_categories',
  'availability_notifications',
  'product_variants',
  // Feature 002 — bridge tables truncate before products so FK CASCADE
  // cleanup is deterministic per-test.
  'attribute_set_attributes',
  'gallery_item_labels',
  'gallery_items',
  'product_attachments',
  'product_links',
  'bundle_slot_options',
  'bundle_slots',
  'grouped_items',
  'product_attributes',
  // attribute_sets is NOT truncated — its system Default row is created
  // by migration 017 and the contract tests rely on it being present.
  'products',
  'categories',
  'sales_channels',
  'assets',
  'quote_request_items',
  'quote_requests',
  'shopping_list_items',
  'shopping_lists',
  // Feature 006 — search analytics ingest. Append-only; clear between
  // tests so contract assertions ("exactly one row was inserted") are
  // deterministic.
  'search_phrase_records',
];

/**
 * The test-support contribution of every module this deployment resolved, from
 * the modules themselves (contract §4; feature 134 T014).
 *
 * **This is the inversion, and it is why nothing below spells a module id.** A
 * module that declares a `./test-support` subpath contributes; one that does not
 * contributes nothing; and a module that leaves this repository takes its
 * contribution out of every composition in the same commit that deletes its
 * directory. The wipe list above used to answer the same question by naming a
 * hundred tables belonging to thirty-nine packages, which is why the first
 * twenty could not leave.
 *
 * The walk is the **resolved registry's**, not a directory scan: a module's
 * entry carries the real location of the file its manifest was imported from,
 * which for a package module is that package's own `package.json`, and the
 * package's name is the specifier. A module that is not a package — an overlay
 * module, or one the platform host carries — has no subpath to declare and is
 * skipped by the same rule rather than by a list of exceptions.
 *
 * Two refusals and no blanket catch. A package whose manifest does not declare
 * the subpath answers `ERR_PACKAGE_PATH_NOT_EXPORTED`, which is *"this module
 * contributes nothing"* and is the only swallowed error; anything else — a
 * module whose contribution throws on import, a `dist` that was never built —
 * is raised, because a silently skipped contribution is a truncate that does
 * not happen and a test that passes on the previous test's rows.
 */
const testSupportByModule = new Map<string, TestSupportContribution | null>();

async function moduleTestSupport(
  registry: readonly { manifest: { id: string }; filePath: string }[],
): Promise<TestSupportContribution[]> {
  const contributions: TestSupportContribution[] = [];
  for (const entry of registry) {
    const moduleId = entry.manifest.id;
    if (!testSupportByModule.has(moduleId)) {
      testSupportByModule.set(moduleId, await loadTestSupport(moduleId, entry.filePath));
    }
    const contribution = testSupportByModule.get(moduleId) ?? null;
    if (contribution !== null) contributions.push(contribution);
  }
  return contributions;
}

async function loadTestSupport(
  moduleId: string,
  manifestFilePath: string,
): Promise<TestSupportContribution | null> {
  if (basename(manifestFilePath) !== 'package.json') return null;
  const packageName: unknown = (
    JSON.parse(readFileSync(manifestFilePath, 'utf8')) as Record<string, unknown>
  )['name'];
  if (typeof packageName !== 'string' || packageName === '') return null;

  let module: Record<string, unknown>;
  try {
    module = (await import(`${packageName}/test-support`)) as Record<string, unknown>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
    throw error;
  }
  const volatileTables = module['volatileTables'];
  const registrations = module['registrations'];
  return {
    moduleId,
    ...(Array.isArray(volatileTables) ? { volatileTables: volatileTables as string[] } : {}),
    ...(registrations !== null && typeof registrations === 'object'
      ? { registrations: registrations as Record<string, unknown> }
      : {}),
  };
}

/**
 * The manifest registry `_i18n` walks to reconcile every module's
 * `translation_bundles` rows (issue #158).
 *
 * The harness used to contribute `() => undefined` here, on the grounds that it
 * composes no `_lifecycle` and therefore has no registry to hand over. The
 * registry is not `_lifecycle`'s to begin with: it is the manifest set the
 * deployment resolved, which this root already registers as
 * `resolvedModuleRegistry`. Handing `_i18n` the same list is what production
 * does, one object later.
 *
 * The consequence of the absence was not that bundles were stale — it was that
 * `translation_bundles` was **empty** in every test, so the error envelope's
 * whole translation path (`preSerialization` → `translate` → the module's
 * bundle) ran in a composition where every lookup missed and fell back to the
 * original message. Issue #65 shipped through that gap: an envelope replacing a
 * written refusal with the generic family sentence on four transacting
 * surfaces, with a green suite.
 *
 * Built once per process, not once per composition. `translation_bundles` is
 * configuration rather than transactional state — it is not in `SEEDED_TABLES`
 * — and the registry is a pure function of the committed manifest index, so a
 * second build would produce an identical object. The *reconcile* still runs
 * per composition (`_i18n` runs it at plugin attach), which is what keeps a
 * file that edits a bundle from leaking into the next one.
 */
let cachedManifestRegistry: LoadedManifestRegistry | undefined;
function harnessManifestRegistry(): LoadedManifestRegistry {
  // Handed over unmapped (feature 080, T036a): this map dropped both install
  // hooks and, once it existed, would have dropped the lifecycle participant —
  // the seventh copy of one identity map, wrong in its own way like the other
  // six. The two types are structurally compatible so that there is nothing to
  // copy.
  cachedManifestRegistry ??= buildStaticRegistry(REGISTERED_MANIFESTS);
  return cachedManifestRegistry;
}

/**
 * Refuse to hand back a server whose error messages cannot be translated
 * (issue #158).
 *
 * This is the `withModuleOff` move, applied to a different substitution. That
 * helper asserts the flip actually took before the test body observes anything,
 * because a test that silently observed an un-flipped module would assert
 * nothing. The same hazard lived here in a quieter form: with
 * `translation_bundles` empty, `translateErrorMessage` missed on every key and
 * the composition root's translator answered with the **original message** — so
 * every error assertion in the suite passed while the translation path had never
 * run. Issue #65 shipped through that gap: an envelope replacing four transact
 * gates' written refusal with the generic `FORBIDDEN` sentence, green suite.
 *
 * A failure here is not a flaky test, it is the harness reporting that it stopped
 * being a platform. So it throws with the cause named rather than warning.
 */
async function assertErrorTranslationsInstalled(i18n: {
  translate(moduleId: string, key: string, language: 'en'): Promise<string>;
}): Promise<void> {
  const { moduleId, key } = TRANSLATION_PROOF;
  const resolved = await i18n.translate(moduleId, key, 'en');
  // `translate` answers a miss with `<moduleId>.<key>` — the placeholder that
  // makes the envelope keep the original message.
  if (resolved === `${moduleId}.${key}`) {
    throw new Error(
      `[test-server] "${moduleId}.${key}" did not resolve, so translation_bundles is ` +
        `empty or stale and no error message in this composition is translated. ` +
        `The harness contributes the manifest registry to \`lifecycleManifestRegistry\` ` +
        `precisely so \`_i18n\` reconciles the bundles from disk at plugin attach; ` +
        `check that contribution before treating this as a data problem.`,
    );
  }
}

/**
 * The Redis namespaces that key by a **stable business key** (a channel code, a
 * setting code) while storing the row's id.
 *
 * Every `setupBackendServer` truncates and reseeds with fresh random ids, so an
 * entry surviving that swap points at a row that no longer exists. CI gets an
 * ephemeral Redis per run; a developer's local Redis persists across runs, which
 * is why this is not merely a within-run concern.
 *
 * (`cms` / `megamenu` / `blog` / `dictionaries` clear their own caches further
 * down through their module handle's `invalidateAll()`, which also drops the
 * per-process LRU the composition holds.)
 */
async function dropStaleCaches(redis: Redis): Promise<void> {
  // `sales-channels:*` covers every cache version (feature 053 bumped it to v2).
  for (const pattern of ['session:*', 'sales-channels:*', 'settings:v1:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(keys);
  }
}

export async function setupBackendServer(
  options: BackendServerOptions = {},
): Promise<BackendServerHandle> {
  // Issue #211 — before anything dials Postgres or Redis. A run that declared
  // it has no services gets one sentence naming the ledger it is missing from,
  // not an ECONNREFUSED against the unreachable stand-in URL.
  assertServicesAvailable('setupBackendServer');

  // Feature 109 (T030) — everything from here down to `composeTestServer` is
  // the half of this composition only **this repository** can answer: which
  // modules a deployment ships, how its ORM opens, what its manifest registry
  // resolved to, what its deployment declares about decoration order. The
  // platform-shaped half — the container, the two Redis clients, the event and
  // command buses, the settings and sales-channel kernels, `composeModules`,
  // the contribution window, the request scope, the one boot phase and
  // `buildServer` — is `@endora-commerce/test-kit/server`'s, and this function
  // is its first caller.
  //
  // That is the same inversion the platform already applies to every other host
  // value (AGENTS.md § Composition item 8): the composition is one more thing a
  // root supplies rather than something a composer goes looking for. It is what
  // lets a module package's own server-bound test compose the same platform
  // without naming `backend/`.
  //
  // D-104 — the deployment-resolved manifest set, from the one implementation
  // of it. Bare core when no deployment is selected, which is every test but
  // the overlay ones.
  const overlayEnv = (
    options.deployment === undefined ? {} : { DEPLOYMENT: options.deployment }
  ) as NodeJS.ProcessEnv;
  const resolvedRegistry = await resolvedManifestEntries(overlayEnv);
  const overlayModuleEntries = await loadOverlayModuleEntries(overlayEnv);
  // Feature 107 — mirrors `composition.ts`: this deployment's own declaration,
  // read once. `harness-parity.test.ts` is why "both roots" is not optional —
  // a decoration order production honours and the harness does not is a
  // composition no test can reproduce.
  const divergenceDeclaration = await loadDivergenceDeclaration(overlayEnv);
  // Feature 080 (T031) — mirrors `composition.ts`. Empty in every test run,
  // because a checkout installs no Endora module package; it is here so the two
  // roots compose the same list, which `harness-parity.test.ts` is the ledger
  // for. `overlayEnv` carries no `ENDORA_INSTANCE_ROOT`, so discovery reads the
  // chain above the running platform and finds this repository's own
  // `packages/*` linked out of `node_modules` — which is exactly what it
  // refuses.
  const packageModuleEntries = await loadPackageModuleEntries(overlayEnv);
  // Feature 134 T014 / contract §4 — what the modules this composition resolved
  // say about their own test support, collected by the caller because discovery
  // is a fact about this process and never the kit's (R2.2).
  const moduleTestSupportContributions = await moduleTestSupport(resolvedRegistry);

  // Feature 090 — mirrors `composition.ts`: the error-code routing map,
  // derived from the manifests this run resolved, with the collisions reported
  // out of the same call (D-100). A collision is a `warn` and never a refused
  // boot, here for the same reason as in production — the harness's job is to be
  // the composition production is.
  const errorTranslation = buildErrorTranslationTargets(resolvedRegistry);
  if (errorTranslation.collisions.length > 0) {
    platformLogger().warn(
      { collisions: errorTranslation.collisions.length },
      'error codes are claimed by more than one module and therefore route to none of ' +
        `them:\n${describeErrorCodeCollisions(errorTranslation.collisions)}`,
    );
  }

  // The platform values the kit builds. Bound here rather than threaded through
  // six callbacks because every closure below — the port accessors, the request
  // plugin, the tenant-context builder, the error envelope and the returned
  // handle — reads one of them, and each of those runs after `prepareDatabase`,
  // which is the first hook the kit calls and where they are assigned.
  let container!: KernelContainer;
  let orm!: MikroORM;
  let em!: () => EntityManager;
  let redis!: Redis;
  let eventBus!: EventBus;
  let commandBus!: CommandBus;
  let auditLogService!: AuditLogService;
  let apiInterceptors!: ApiInterceptorRegistry;
  let settings!: SettingsKernel;
  let salesChannels!: SalesChannelsKernel;
  let composedModules!: ComposedTestModules;
  // The module services this root resolves once, at composition, and hands back
  // on the handle. They are `let` for the reason the platform values above are:
  // the container that answers them does not exist until the kit has composed,
  // and the handle is built after it has. Phase 2 (T050) replaces every one of
  // them with a `handle.container` resolution at the reader.
  let sessionService!: SessionService;
  let permissionService!: PermissionService;
  let permissionCatalogueService!: PermissionCatalogueService;
  let adminNotificationService!: AdminNotificationService;
  let customFieldsCradle!: CustomFieldsCradle;
  let customFieldDefinitionService!: CustomFieldsCradle['customFieldDefinitionService'];
  let customFieldValueService!: CustomFieldsCradle['customFieldValueService'];
  let apiKeysCradle!: ApiKeysCradle;
  let cmsCradle!: CmsCradle;
  let promotionsCradle!: PromotionsCradle;
  let adminI18nCradle!: AdminI18nCradle;
  let credentialsService!: CredentialsService;
  let assetsLibrary!: AssetsLibraryCradle['assetsLibrary'];
  let pwaCradle!: PwaCradle;
  let megamenuCradle!: MegamenuCradle;
  let blogCradle!: BlogCradle;
  let dictionariesCradle!: DictionariesCradle;
  let comparisonsCradle!: ComparisonsCradle;
  let invoicesCradle!: InvoicesCradle;
  let ksefCradle!: KsefCradle;

  // Feature 080 (T052) — the identity, order and asset ports, mirroring
  // `composition.ts` name for name. This harness read the same five entity
  // classes production did, so the repair is one applied twice: a module
  // package publishes `entities` and no named entity class (D-168), and a root
  // that names one stops compiling the day its owner moves.
  const identityPorts = (): {
    adminUserReadPort: AdminUserReadPort;
    adminRolePort: AdminRolePort;
    adminPasswordVerificationPort: AdminPasswordVerificationPort;
    customerAccountReadPort: CustomerAccountReadPort;
    customerPasswordVerificationPort: CustomerPasswordVerificationPort;
  } => container.cradle as never;

  // `orderReadPort` had an accessor here until `specs/110-instance-repository/`
  // T118c, and `pwaBridge`'s `resolveOrderTarget` was its **only** reader in
  // either root. `pwa` resolves the port itself now and declares `orders` in its
  // manifest, so the read is gone from both compositions rather than moved. That
  // is the `mfa` target's `adminActorPromotion` shape again: a root accessor
  // whose last consumer was the bridge it existed for.

  // `assetReadPort` had an accessor here until T118c, and `invoicesBridge`'s
  // `loadAssetImage` was its **only** reader in this root — a member that was
  // itself only one day old (D-223). `invoices` resolves the port itself now,
  // so the read is gone from this composition rather than moved. The `assetRead`
  // getter on the handle below is a different thing and stays: it is what a
  // fixture resolves to read the port directly.

  // Feature 080 (T040b) — the roll-up and settings-collection ports, again
  // mirroring `composition.ts` name for name. Both roots imported the two
  // derivations out of a module's own sources, which is the spelling that ends
  // the day the owner becomes a package (D-160.6.1).
  const customerRollupScopePort = (): CustomerRollupScopePort =>
    (container.cradle as never as { customerRollupScopePort: CustomerRollupScopePort })
      .customerRollupScopePort;

  const settingsManifestCollectionPort = (): SettingsManifestCollectionPort =>
    (
      container.cradle as never as {
        settingsManifestCollectionPort: SettingsManifestCollectionPort;
      }
    ).settingsManifestCollectionPort;

  // `inventoryCradle` mirrored `composition.ts`' forward of `inventory`'s
  // availability port into `catalogExternalAvailability`. Both are gone since
  // `specs/117-instance-bring-up/` Phase 6: `catalog` resolves the port itself.

  // T143a — `customer_accounts`' social-login port, read lazily (see the note
  // on `mfaSocialAccountResolvers` below).
  const customerSocialLogin = (): {
    resolveByEmail(email: string): Promise<{ id: string } | null>;
    autoCreate(email: string): Promise<{ id: string } | null>;
  } =>
    (
      container.cradle as never as {
        customerSocialLoginPort: {
          resolveByEmail(email: string): Promise<{ id: string } | null>;
          autoCreate(email: string): Promise<{ id: string } | null>;
        };
      }
    ).customerSocialLoginPort;

  const salesRepScope = (): {
    listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
  } =>
    (
      container.cradle as never as {
        organizationSalesRepScopePort: {
          listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
        };
      }
    ).organizationSalesRepScopePort;

  /**
   * Feature 026 US6 — admin orders/RFQ scope for the test harness. Mirrors
   * the composition.ts resolver but reads `request.testActor` (the test
   * harness's decoration).
   */
  const resolveTestAdminOrdersScope = async (
    request: FastifyRequest,
  ): Promise<{ allowAll: true } | { allowAll: false; allowedOrganizationIds: string[] }> => {
    const actor = request.testActor;
    if (!actor || actor.kind !== 'admin') return { allowAll: true };
    const knex = em().getKnex();
    const roleRow = (await knex.raw(
      `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ code: string | null }> };
    const roleCode = roleRow.rows[0]?.code ?? null;
    if (roleCode !== 'sales_representative') return { allowAll: true };
    return {
      allowAll: false,
      allowedOrganizationIds: await salesRepScope().listAssignedOrganizationIds(actor.adminUserId),
    };
  };

  const promptActionsCradle = (): PromptActionsCradle =>
    container.cradle as unknown as PromptActionsCradle;

  /**
   * This root's own request plugin (feature 109, T030).
   *
   * The kit mounts, in order: every module's route contribution, the modules'
   * root plugins, the entries in this array, and last the platform's own
   * request-scope hook. That is the same four-step order this function has
   * always had — what changed is that the first two and the last are the kit's
   * rather than three more entries here.
   *
   * `auth`'s root plugin therefore still registers **before** `registerTestAuth`,
   * so its `onRequest` hook runs first and the harness's synthetic actor still
   * wins: `auth` decorates `actor` and seeds it from the real session cookies,
   * and `registerTestAuth` then assigns the test actor over the top through the
   * same decorator.
   *
   * There are two arrays because the request-scope hook sits in the **middle**
   * of the chain rather than at its end, exactly as it does in production
   * (`authModulePlugin`, `tenantContextModulePlugin`, `salesChannels.plugin`).
   * `registerTestAuth` has to be ahead of it, because the scope is built from
   * the actor that hook resolves; the sales-channel resolver has to be behind
   * it, because it writes the resolved channel into the open scope and refuses
   * when there is none.
   *
   * Both are **mutable** on purpose, and the kit reads them after the
   * contribution window closes: `salesChannels.plugin` and a caller's
   * `extraModules` are pushed from inside `contribute`, where the values they
   * need exist.
   */
  const harnessPlugins: ModulePlugin[] = [
    async (app) => {
      registerTestAuth(app, {
        sessionService,
        emFactory: em,
        // Feature 062 — mirror production: Bearer sk_live_* resolves to an
        // api_key actor (incl. distributor binding) before the tenant hook
        // and the sales-channel resolver run.
        // The presence probe mirrors `auth/backend.ts` and is load-bearing for
        // the same reason (D-44): `apiKeyService` is a **gated port** read off
        // the live cradle, so with `api_keys` switched off the resolution
        // throws — and this hook runs on every request carrying an
        // `Authorization: Bearer` header, whatever the route. Without it the
        // harness answers 503 to requests production answers normally, and the
        // degradation `auth` declares is untestable here.
        apiKeyResolver: async (token) => {
          if (!effectiveState.isPresent('api_keys')) return null;
          return apiKeysCradle.apiKeyService.authenticate(token);
        },
      });
    },
  ];

  /** The half of the chain that runs with the request scope already open. */
  const harnessScopedPlugins: ModulePlugin[] = [];

  /**
   * Feature 050 — the ambient `TenantContext`, established from the resolved
   * test actor after `registerTestAuth` has set it.
   *
   * Handed to the kit, which installs it through the **same**
   * `registerRequestScopeHook` factory the production composition root uses. Two
   * hand-written copies is how the request seam gets a leak no test can see, and
   * there is no path through `composeTestServer` that leaves the hook off: a
   * server composed without it is one under which every tenant-scope assertion
   * passes for the wrong reason (Principle XI).
   */
  const buildTestTenantContext = async (
    request: FastifyRequest,
  ): Promise<TenantContext> => {
    const actor = request.testActor;
    if (actor?.kind === 'customer') {
      const orgId =
        actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
      // Feature 056 (T032) — mirror production: a roll-up-enabled customer
      // widens to its org subtree (server-derived from the account flag).
      // T143c — the module's one tree service, resolved per request as
      // production resolves it. This harness built a **second** one here,
      // per request, and being its own it walked the subtree with
      // `organizations` switched off — the roll-up rule answering out of a
      // module the platform was refusing to serve.
      const rollupSubtree = await customerRollupScopePort().resolveSubtreeIds(
        actor.customerAccountId,
        orgId,
        (id) =>
          (
            container.cradle as never as {
              organizationTreeService: { subtreeIds(id: string): Promise<string[]> };
            }
          ).organizationTreeService.subtreeIds(id),
      );
      return resolveTenantContext({
        kind: 'customer',
        customerAccountId: actor.customerAccountId,
        organizationId: orgId,
        impersonatorAdminUserId:
          (actor as { impersonatorAdminUserId?: string | null }).impersonatorAdminUserId ??
          null,
        ...(rollupSubtree && rollupSubtree.length > 0
          ? { rollupSubtreeOrganizationIds: rollupSubtree }
          : {}),
      });
    }
    if (actor?.kind === 'admin') {
      const scope = await resolveTestAdminOrdersScope(request);
      return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
    }
    // Feature 062 — mirror production: a bound api key derives single-org
    // scope from its binding; an unbound key keeps trusted system scope.
    if (actor?.kind === 'api_key') {
      return resolveTenantContext({
        kind: 'api_key',
        apiKeyId: actor.apiKeyId,
        organizationId: actor.organizationId ?? null,
        customerAccountId: actor.customerAccountId ?? null,
      });
    }
    return systemTenantContext(`test-actor:${actor?.kind ?? 'anonymous'}`);
  };

  const handle = await composeTestServer({
    // Contract R2.1 — the four things only the caller knows.
    composition: {
      // Feature 072 — the generated module list, composed in one pass at the
      // same point in the boot order `composition.ts` composes it.
      // D-103/D-104 — the deployment's overlay modules are appended to this one
      // list rather than composed by a second path, which is what preserves
      // D-45's single pass; T031 — and the instance's installed packages after
      // them, same list, same reason. `harness-parity.test.ts` pins the array
      // literal in both roots.
      modules: [...MODULES, ...overlayModuleEntries, ...packageModuleEntries],
      // The application's ORM configuration, which merges installed packages'
      // entities. A pair rather than an instance because the configuration
      // captures `DATABASE_URL` at import, so *when* it opens is the caller's.
      orm: { open: initOrm, close: closeOrm },
      manifests: resolvedRegistry,
      // Contract §4 — exactly the modules in `modules`, because it is the same
      // resolved registry both are derived from.
      testSupport: moduleTestSupportContributions,
    },
    // Feature 107 (FR-040/FR-041) — mirrors `composition.ts`: the wrapping order
    // this deployment declares, from `backend/src/apps/<deployment>/divergence.ts`.
    // **Checked, never applied** — the composer emits in its own order and
    // drains decorations once; this asserts the resulting order was the intended
    // one and refuses when the two disagree.
    decorationOrder: divergenceDeclaration.decorationOrder,
    // Feature 072 (T073) — the real subscriber client only where a test asks for
    // it. One armed subscription per composition, across ~225 files, is how this
    // harness accumulated ~1 GB of retention (task #32); the kit registers an
    // inert stand-in otherwise, which keeps a module's code identical in both
    // compositions and the count of *real* subscriptions at "only where a test
    // asks".
    exercisePubSub: options.exercisePubSub === true,
    // Presence, from the deployment-resolved set. The kit would default to the
    // manifests it was handed, which is the same list; it is spelled because the
    // resolution is this repository's and not the kit's.
    enabledModuleIds: resolvedRegistry.map((entry) => entry.manifest.id),
    // Host values **no module defaults**, registered before the modules do, so
    // there is nothing to overwrite and therefore no contribution window
    // (AGENTS.md § Composition item 8). The kit registers the platform's own —
    // `redis`, `redisSubscriber`, `eventBus`, `commandBus`, `auditLogService`,
    // `apiInterceptors` and `resolvedModuleRegistry`; these are this harness's.
    values: {
      // The module's `ctx.onBoot` schedule reconcile resolves this (T131).
      pimErgonodeRunWorkers: false,
      pimPimcoreRunWorkers: false,
      pimUnopimRunWorkers: false,
      comarchXlRunWorkers: false,
      pimAkeneoRunWorkers: false,
      pimAkeneoPublicBaseUrl: 'http://localhost',
      productFeedsRunWorkers: false,
      productFeedsPublicBaseUrl: 'http://feeds.test.local',
      productFeedsTokenEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      // Feature 072 (T138) — mirrors `composition.ts`, reading this harness's own
      // actor property. Soft by contract: `null` for anonymous traffic and for a
      // Customer with no Organization.
      customerOrganizationIdResolver: (request: FastifyRequest): string | null =>
        request.testActor?.kind === 'customer' ? (request.testActor.organizationId ?? null) : null,
      storefrontBaseUrl: 'http://localhost:3000',
      // `specs/117-instance-bring-up/` Phase 6 — the key newsletter
      // confirmation and unsubscribe links are signed with. Pinned here for the
      // reason the old `newsletterBridge` pinned it: a token is signed on one
      // request and verified on another, so a run needs one stable key.
      // Production takes `NEWSLETTER_TOKEN_SECRET`, falling back to the session
      // key, and `composeApp` registers the resolved value under this name.
      newsletterTokenSecret: 'test-newsletter-secret',
      // The one composition allowed to serve `/api/v1/_test/latest-verification-token`.
      organizationsExposeTestProbe: true,
    },
    // Truncate, seed and drop the stale caches, after the ORM is open and before
    // the first module registers — a module's registration may not observe a
    // half-seeded database.
    prepareDatabase: async (platform) => {
      ({
        container,
        orm,
        em,
        redis,
        eventBus,
        commandBus,
        auditLogService,
        apiInterceptors,
        settings,
        salesChannels,
      } = platform);

      // Redis cache that keys by a STABLE business key (channel code, setting code)
      // but stores the now-deleted row's id goes stale and causes FK violations on
      // the next insert. CI gets an ephemeral Redis per run; a developer's local
      // Redis persists across runs, so we must clear the cross-run-stale namespaces
      // here. (cms/megamenu/blog/dictionaries clear their own caches further down
      // via their module handle's `invalidateAll()`, which also drops the LRU.)
      // `sales-channels:*` covers every cache version (feature 053 bumped it to v2).
      //
      // Done **twice**, here and again after the reseed (`dropStaleCaches` below).
      // This call is the one the seeding needs: it stops a seed insert from reading
      // a dead id through the cache and failing on the foreign key. But a drop that
      // happens *before* the rows it protects against are deleted leaves a window —
      // every statement from the `truncate` to the last seed — in which a read
      // re-pins a pre-truncate id under a code that survives the reseed. You drop a
      // cache after invalidating its source, not before, and the second call is that
      // drop.
      await dropStaleCaches(redis);

      const conn = orm.em.getConnection();
      // One statement over the union of what this root still writes down and
      // what the composed modules declared for themselves (contract R4.2). The
      // `cascade` resolves the order, which is what makes the second half a set
      // rather than a sequence — and `Set` is what keeps a module that declares
      // a table this root has not yet given up from emitting it twice.
      const volatileTables = [
        ...new Set([...SEEDED_TABLES, ...collectVolatileTables(moduleTestSupportContributions)]),
      ];
      await conn.execute(
        `truncate table ${volatileTables.map((t) => `"${t}"`).join(', ')} cascade`,
      );
      // Feature 002: keep the system Default Attribute Set, drop everything
      // else so contract tests start from a clean slate. (`attribute_sets`
      // isn't in SEEDED_TABLES because the truncate-cascade would drop the
      // Default seed too.)
      await conn.execute('delete from "attribute_sets" where "is_system" = false');
      // Feature 002 (US3): keep the 4 standard attachment_types seeded by
      // migration 021; drop any custom ones the previous test may have
      // added. attachment_types isn't in SEEDED_TABLES for the same reason
      // as attribute_sets — truncate-cascade would drop the seed.
      await conn.execute(
        `delete from "attachment_types" where "code" not in ('certificate', 'tech_spec', 'product_card', 'pdf')`,
      );

      // Drop every platform-wide setting override, for the same reason and in
      // the same spirit as the config resets below: `settings` rows are
      // declarations the manifest reconciler owns, so the table is not
      // truncated — but `global_value` on those rows is operator state, and an
      // operator write by one test file was standing for every file that ran
      // after it in the same run database.
      //
      // Two families of failure came out of that, and neither is visible to a
      // targeted run because both need a particular neighbour to have run
      // first. `invoice_ledger.ksef.routing` and `invoice_ledger.numbering.mode`
      // are written globally by the routing contract test and by several KSeF
      // integration files, and a leaked `vendor` silently changes what every
      // later invoice does — a delivery routed to the vendor, native KSeF
      // submission skipped. And `<module>.activation` is a Setting like any
      // other, so a leaked `wfirma.activation = true` makes the invoice-ledger
      // vendor mutex refuse the next file's Infakt activation with a 409.
      //
      // **Do not remove this statement because it looks like per-file cost the
      // suite could do without.** It is cheap — one indexed update over a table
      // with no rows to change in the common case — and what it buys is not
      // tidiness. `InvoiceLedgerRoutingService.nativeKsefActionFor` answers
      // `skip` when the routing reads `vendor`, so a leaked `vendor` does not
      // make a later file's invoice fail to submit to KSeF: it makes that file
      // **not enqueue the submission at all**. The reds this reset was written
      // for are the visible half. The half worth naming is the other one — a
      // test that **passes because the work was skipped**, which is a green
      // result that is evidence of nothing. That is the shape to fear from any
      // state that survives the file that wrote it, and it is why the answer
      // here is to reset the state rather than to teach each test to restore
      // what it wrote: a file that forgets costs the next file its meaning, not
      // its colour, and nothing in a suite result says so.
      //
      // NULL is not a value here: it means "no global override", so every
      // setting resolves to its manifest `defaultValue` again — the state a
      // fresh install is in, which is what the reconcile below re-asserts.
      // `setting_values`, the per-channel overrides, needs no statement: every
      // row points at a `sales_channels` row, and that table is truncated with
      // cascade above.
      await conn.execute(
        'update "settings" set "global_value" = null where "global_value" is not null',
      );

      // Reset the i18n + dictionary config tables to a known state so
      // parallel-running tests don't inherit each other's mutations. We don't
      // truncate them in SEEDED_TABLES because they're configuration, not
      // transactional state.
      await conn.execute('delete from "dictionary_translations"');
      await conn.execute('delete from "language_countries"');
      await conn.execute('delete from "countries"');
      await conn.execute('delete from "languages"');
      await conn.execute('delete from "currencies"');
      await conn.execute(
        `insert into "languages" ("code", "label", "is_default", "is_active", "sort_order", "created_at", "updated_at")
         values ('en-US', 'English (US)', true, true, 0, now(), now()),
                ('pl-PL', 'Polski', false, true, 1, now(), now())`,
      );
      await conn.execute(
        `insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
         values ('PLN', 'Polish zloty', U&'z\\0142', true, true, 0, now(), now()),
                ('EUR', 'Euro', U&'\\20AC', false, true, 1, now(), now())`,
      );

      // Feature 005 — guarantee the system-default Sales Channel exists before
      // any seed runs. Test-server uses 'en-US' / 'PLN' to match the language /
      // currency seed above (production uses the 'en' / 'EUR' fallback).
      await new DefaultChannelReconciler(em, undefined, {
        bootstrapDefaults: { code: 'default', language: 'en-US', currency: 'PLN' },
      }).run();

      if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
        await seedUs1Catalog(em());
      }
      await seedTestOrganizations(em());
      await seedUs2Commerce(em());
      await seedTestAdmins(em());

      // The second drop — the one the composition below needs. Every row the caches
      // key by now exists with the id it will have for the rest of this file, so
      // nothing read from here on can be a pre-truncate id wearing a code that
      // survived the reseed.
      //
      // That is the shape issue #154 reported: `public-ignores-bearer.test.ts`
      // failed once in a 67-file run with the anonymous body `data: []` and the
      // bearer body carrying three products. The two requests resolve their channel
      // differently — anonymous by **code** through this cache, a bound api key by
      // **id** from its binding — so a cached `pl_retail` pointing at a dead id
      // produces exactly that asymmetry, 200 and all. It has not been reproduced,
      // so this is not filed as the fix; the drop order was wrong on its own terms
      // and is worth correcting whether or not it was the cause.
      await dropStaleCaches(redis);
    },
    // The contribution window (D-45, issue #52) — the one slot where a value a
    // module defaults may be overwritten. Both edges are the platform's rather
    // than this root's memory: `ComposedModules` does not exist until every
    // module has registered, and `contribute` throws once the boot phase has
    // started.
    contribute: async (composed) => {
      composedModules = composed.composed;

      // Feature 072 (T094) — one `CustomerAuthService` for the composition.
      // `customers` and `organizations` each built their own and the MFA argument
      // differed between them; there is one now, and it can always reach the port.

      // Feature 072 (T095/T097) — `payment_methods` and `delivery_methods` own
      // their registries, eligibility services and routes now. `orders` resolves
      // them itself, so nothing is read here.
      //
      // T143a — the built-in payment adapters are seeded by `payments`, from its
      // own boot hook. Both roots ran the loop, and this copy carried the same
      // `isRegistered` guard for a reason neither stated: the registry is a
      // process-wide singleton, so several hundred compositions in one suite were
      // all writing the same instance.

      // Feature 072 (T078) — `auth` owns these. Resolved from the same registration
      // production resolves, which is the whole point of converging the roots: the
      // harness no longer builds its own SessionService.
      sessionService = (container.cradle as unknown as AuthCradle).sessionService;

      // Feature 072 (wave 1) — `admin_roles` owns these three. Resolved from the
      // same registration production resolves, which is how the roots stop being
      // able to differ: T074 found the harness building AdminRoleService without
      // its audit writer, and a registration cannot be built two ways.
      const rolesCradle = container.cradle as unknown as {
        permissionService: PermissionService;
        permissionCatalogueService: PermissionCatalogueService;
        adminRoleService: AdminRoleService;
      };
      permissionService = rolesCradle.permissionService;
      permissionCatalogueService = rolesCradle.permissionCatalogueService;

      // `currencyService` is resolved from the container where it is needed —
      // `pim_ergonode` reads it as a port since T131, and nothing else here did.

      // Feature 072 (wave 1) — `admin_notifications` provides this as a port, so a
      // cross-module write answers on its effective state rather than succeeding
      // into a module the operator switched off.
      adminNotificationService = (
        container.cradle as unknown as { adminNotificationService: AdminNotificationService }
      ).adminNotificationService;

      // The mailer this composition sends through. A test that asserts on sent mail
      // supplies its own; otherwise it is the one the `email` module registered.
      //
      // Feature 072 (T120) — **registered back into the container**, not just held
      // as a local. The comment here used to say this was "the one seam that stays,
      // because the modules that take it are not converted yet"; every module is
      // converted now, and each resolves `emailMailer` as a port. Holding the spy
      // in a variable and passing it to two module factories was what kept it
      // reachable, and as those factories disappeared the spy went blind one path
      // at a time — silently, because the mail was still being sent, just to the
      // container's `ConsoleMailer`.
      //
      // `emailMailer` is a `ctx.di.register` contribution point rather than a
      // `providePort`, so overwriting it is the sanctioned move rather than a root
      // shadowing a module's port. It is registered after `composeModules`, in the
      // one contribution slot, so this overrides `email`'s default rather than being
      // overwritten by it.
      //
      // D-59 — `emailMailer` is now the *recording* mailer: the driver plus the
      // delivery record. A spy supplied here replaces both, so a test that injects
      // one asserts on messages and writes no `email_deliveries` row. That is
      // deliberate — the alternative is every mail-sending suite in the tree
      // acquiring a database write it never asked for — and the composed path is
      // covered directly by `test/integration/email/delivery-record.test.ts`, which
      // sends through the container's own mailer.
      const emailMailer = (container.cradle as unknown as EmailCradle).emailMailer;
      const injectedMailer = options.organizationsMailer ?? emailMailer;
      if (options.organizationsMailer) {
        composedModules.contribute({ emailMailer: injectedMailer });
      }

      // CartService is exposed by the commerce module so the login handler in
      // organizations can merge anonymous baskets after sign-in.
      let shoppingListServiceRef:
        | import('../../../packages/modules/shopping_lists/src/backend/services/shopping-list-service.js').ShoppingListService
        | null = null;
      // Feature 039 — late-bound OrderService for the quick_order one-click flow.
      let orderServiceForOneClick:
        | import('../../../packages/modules/orders/src/backend/services/order-service.js').OrderService
        | null = null;
      // Feature 040 — late-bound OrderListService for the customers module.
      // Feature 026 US4 / 056 — which organizations a sales-rep admin may see.
      // T143a — `organizations`' port, read lazily, where this harness used to
      // build its own `SalesRepAssignmentService` **without** the subtree deps
      // production passed, and then not use even that: the scope resolver below ran
      // raw SQL over `organization_sales_rep_assignments`. Two divergences from
      // production in one seam, and between them feature 056's roll-up was
      // exercised by nothing.

      // Feature 042 / D-96 — the MFA login port is **not** contributed here any
      // more, and that removal is the precondition for every `mfa` off-state
      // assertion in the tree.
      //
      // This harness used to resolve `mfaLoginPort` off the cradle once, at
      // composition, and hand both login consumers a getter returning the captured
      // value. A captured gate goes on answering after an operator switches the
      // module off, so the harness failed **open** where production failed closed:
      // an off-state test written against it passed while measuring a module that
      // was still running (the shape issue #141 found four times). `admin_users`
      // and `customer_accounts` resolve the port for themselves now, through
      // `lazyPort` behind an `effectiveState.isPresent('mfa')` probe, so both
      // composition roots contribute nothing for this name and the harness observes
      // exactly what production does.

      // Feature 056 — organization tree + inheritance resolution, built here for
      // the same reason production builds it (`composition.ts`): three consumers
      // read it, and without it all three run a shape no deployment runs.
      //
      // The credit-mode closure reads Settings at **call** time, so it may be
      // written before the settings module exists further down — which is exactly
      // how production orders it. Feature 072 (T072).

      // Credit-limits module — its CreditLimitService is the driver passed into
      // commerceModule below so OrderService.placeOrder can reserve atomically.
      // Feature 072 (T101) — `credit_limits` owns its service and routes now, and
      // since T143c the return-settlement top-up as well, so this harness reads
      // nothing of the module.

      // Feature 055 — Custom Fields Layer, converted in feature 072 (T087). The
      // module owns its services and its cache subscription now; the harness reads
      // the two ports host modules consume, exactly as `composition.ts` does.
      //
      // The subscription is no longer conditional on `exercisePubSub`. That flag
      // existed because a fire-and-forget `subscribe` could land after teardown and
      // make ioredis reconnect, pinning the composition; the module arms it from an
      // **awaited** `onBoot` during setup instead, so there is no late landing to
      // guard against, and it adds no connection — `redisSubscriber` is one the
      // harness already opens.
      customFieldsCradle = container.cradle as unknown as CustomFieldsCradle;
      customFieldDefinitionService = customFieldsCradle.customFieldDefinitionService;
      customFieldValueService = customFieldsCradle.customFieldValueService;

      // Feature 061 — the composed attribute read model (mirrors composition.ts):
      // product-host custom-field definitions + catalog extension rows, threaded
      // into catalog, search, quick_order, and comparisons.

      // US7 — API keys + webhooks. The handle exposes
      // requireApiKey, threaded into the catalog module's by-sku route so that
      // surface gets real bearer-token gating.
      // Feature 072 (T100) — `api_keys` owns its service, its two gates and its
      // routes now, and provides `apiKeyResolver` itself.
      apiKeysCradle = container.cradle as unknown as ApiKeysCradle;

      // Analytics (Phase 10 / T237). No GA4 forwarder in tests — the env vars
      // are unset by default so `buildForwarderFromEnv` returns a NoopForwarder.

      // Import/Export (Phase 10 / T240).
      // Feature 072 (T122) — `import_export` owns its service and routes now.

      // SEO meta + sitemap (Phase 10 / T235). Stale-window dropped to zero in
      // tests so each test that calls regenerate sees a fresh payload.
      // Feature 072 (T117) — `seo` owns its services and routes now.

      // Languages + currencies (Phase 10 / T238). Static config, bootstrapped
      // by migration 012 with en-US + pl-PL languages and PLN + EUR currencies.
      // Feature 072 (T105) — `languages` owns its services and routes now.

      // Feature 072 (T112) — `dictionaries` owns its services, its cache
      // invalidation listeners and its routes now.

      // Registered here rather than with the other host values further down:
      // `addresses` reads it to build the one `AddressService`, and both `orders`
      // and `organizations` are constructed before that block runs.
      // Feature 072 (T090) — one `AddressService` for the whole composition.
      // `orders` and `organizations` used to build their own, and the constructor's
      // validator and audit writer are optional, so the instances were free to
      // disagree — and one did.

      // Feature 072 (wave 1) — `dictionaries` reacts to a currency change instead
      // of `currencies` calling into it. The direction matters: declaring the call
      // as a dependency produced a real cycle, and the cycle was the design saying
      // a currency must not know a dictionary cache exists.
      // Feature 072 (T105) — the language half of the same drop. `languages` used
      // to pass a hard-coded `undefined` for its invalidator, so a deactivated
      // language kept validating for up to the validator's 60 s TTL and kept being
      // served from the Redis dictionary cache for up to an hour, while a currency
      // change dropped both immediately.

      // Feature 072 (T110) — the channel-resolution names. The kernel itself is
      // composed above `composeModules`, for the subscriber ordering; what belongs
      // here is the registration, in the one contribution slot.
      composedModules.contribute({
        salesChannelsCache: salesChannels.cache,
        // Feature 120 (FR-015) — mirrors `compose-app.ts`. Without it every
        // module's bridge contribution hook would resolve an unregistered name
        // and the harness would compose a platform that can serve no
        // membership call at all.
        salesChannelBridgeRegistry: salesChannels.bridgeRegistry,
        salesChannelMembershipPort: salesChannels.membershipService,
        // Mirrors `composition.ts`: the real resolver, so a test can reach the
        // channel-scoped stock read at all. Registering it only in production is
        // what let the missing registration survive — see the note there.
        salesChannelResolutionPort: salesChannels.resolver,
      });

      // Feature 014 — CMS module. Reconcile seeded Hooks once; the storefront
      // resolver wraps Redis as a read-through cache.
      // Feature 072 (T093) — `cms` owns its services, resolvers, reconciliation
      // and routes now. Notably it also owns the four late-bound resolvers this
      // harness never wired: the colour-palette writer was absent here, so
      // `PUT /admin/cms/page-builder/color-palette` answered 500 in every test run.
      cmsCradle = container.cradle as unknown as CmsCradle;
      // Tests rely on writes being immediately visible. Wipe the namespace
      // before each backend boot so a previous run's keys don't bleed in.
      if (cmsCradle.cms.handle.cache) await cmsCradle.cms.handle.cache.invalidateAll();

      // Pricing (T127 / FR-050).
      // Feature 072 (T127) — `price_lists` owns its services and routes now. The
      // harness drives the status worker through `internal/sweep`, so a wall-clock
      // interval would only add spurious writes mid-run, and it disables the
      // pricing LRU because a test writes a price and reads it back in the same
      // breath. Production keeps the sweeper on and takes the module's own default
      // TTL, which it stopped restating in T143a — so the 0 below is now the only
      // opinion either composition holds about this cache.
      composedModules.contribute({
        priceListsEnableStatusSweeper: false,
        priceListsPricingCacheTtlMs: 0,
        priceListsAdminAuditContext: (request: FastifyRequest) => ({
          actorAdminUserId:
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
        }),
      });

      // Taxes (T128 / FR-051) + Promotions (T129 / FR-052).
      // Feature 072 (T119) — `taxes` owns its service and routes now.
      // Feature 072 (T115) — `promotions` owns its services and routes now.
      // These three stay here: the org-status gate and the Rule Builder picker
      // sources read `organizations`, `categories`, `payment_methods` and
      // `delivery_methods` directly, and the catalog read port is `catalog`'s.
      // Registered after `composeModules`, where the module declares its defaults.
      composedModules.contribute({
        organizationStatusResolver: async (orgId: string) => {
          const row = (await em()
            .getKnex()
            .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [
              orgId,
            ])) as { rows: Array<{ status: string }> };
          return row.rows[0]?.status ?? null;
        },
        promotionRuleTargets: {
          salesChannels: async () => {
            const { items } = await (
              container.cradle as unknown as SalesChannelsCradle
            ).salesChannelsService.list({});
            return items.map((c) => ({ id: c.id, code: c.code, name: testAnyLabel(c.name) }));
          },
          customerGroups: async () => {
            const groups = await (
              container.cradle as unknown as CustomerAccountsCradle
            ).customerGroupService.list();
            return groups.map((g) => ({ id: g.id, code: g.code, name: g.name }));
          },
          organizations: async () => {
            const res = (await em()
              .getKnex()
              .raw(
                `select "id", "name", "tax_id" from "organizations" where "deleted_at" is null order by "name" asc limit 200`,
              )) as { rows: Array<{ id: string; name: string; tax_id: string | null }> };
            return res.rows.map((r) => ({ id: r.id, name: r.name, taxId: r.tax_id ?? null }));
          },
          categories: async () => {
            const res = (await em()
              .getKnex()
              .raw(
                `select "id", "slug", "name", "parent_category_id" from "categories" where "deleted_at" is null order by "sort_order" asc`,
              )) as {
              rows: Array<{
                id: string;
                slug: string;
                name: unknown;
                parent_category_id: string | null;
              }>;
            };
            return res.rows.map((r) => ({
              id: r.id,
              slug: r.slug,
              name: testAnyLabel(r.name),
              parentCategoryId: r.parent_category_id ?? null,
            }));
          },
          paymentMethods: async () => {
            const res = (await em()
              .getKnex()
              .raw(
                `select "id", "code", "name" from "payment_methods" where "status" = 'active' order by "code" asc`,
              )) as { rows: Array<{ id: string; code: string; name: unknown }> };
            return res.rows.map((r) => ({ id: r.id, code: r.code, name: testAnyLabel(r.name) }));
          },
          deliveryMethods: async () => {
            const res = (await em()
              .getKnex()
              .raw(
                `select "id", "code", "name" from "delivery_methods" where "status" = 'active' order by "code" asc`,
              )) as { rows: Array<{ id: string; code: string; name: unknown }> };
            return res.rows.map((r) => ({ id: r.id, code: r.code, name: testAnyLabel(r.name) }));
          },
        },
      });
      promotionsCradle = container.cradle as unknown as PromotionsCradle;

      // Feature 047 — late-bound transactional-email sender (mirrors composition).
      // Feature 072 (T120) — `transactional_emails` owns the binding now and
      // publishes both services as accessor ports; this root reads them like any
      // other consumer instead of holding the variables its callbacks filled in.
      const emailCradle = (): {
        transactionalEmailSenderAccessor: () =>
          | import('@endora-commerce/contracts').TransactionalEmailSender
          | undefined;
        emailBrandingAccessor: () => { resolve(salesChannelId: string): Promise<unknown> } | undefined;
      } => container.cradle as never;

      // Feature 062 — read-only inventory accessors backing the external catalog
      // namespace's availability indication (mirrors composition.ts).


      // Feature 072 (T118) — the settings names. The kernel itself is composed
      // above `composeModules`, for the subscriber ordering; what belongs here is
      // the registration, in the one contribution slot.
      composedModules.contribute({
        settingsSecretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
        // Mirrors composition.ts: the effective-state reader that classifies each
        // setting and refuses writes an absent module owns.
        settingsModulePresence: {
          presenceOf: (moduleId: string) => effectiveState.presenceOf(moduleId),
          activationControlOwner: (code: string) => effectiveState.activationControlOwner(code),
        },
      });
      // Feature 042 — MFA module (mirrors composition.ts). Built after `settings`
      // so it can read MFA settings; its login port is resolved by the two login
      // consumers themselves (D-96), so nothing is captured here.
      // Feature 072 (T096) — `mfa` owns its services, routes and configuration.
      //
      // **T118c retired `mfaActorBridge` in both roots.** The block that stood
      // here spelled the actor half a second time — `resolveCustomerActor` was
      // byte-identical to the `customerActorResolver` this harness contributes
      // below, and `resolveAdminActor` was `adminContextResolver` with a stricter
      // refusal for a caller `requireAdmin` had already turned away. The account
      // half was four identity ports the module resolves itself now. The comment
      // that closed this block — *"Deliberately omitted, as this harness always
      // omitted them: with no password verifier, disabling 2FA requires a current
      // code"* — is what the drain corrects: it described a divergence from
      // production, not a decision, and no test in the tree could reach it.
      composedModules.contribute({
        // D-48 — the system-default channel, which always exists.
        mfaDefaultChannelIdResolver: async () => (await salesChannels.resolver.getSystemDefault()).id,
        mfaBaseUrls: {
          backend: 'http://localhost',
          storefront: 'http://localhost:3000',
          admin: 'http://localhost:3002',
        },
        // Feature 042 US4/US5 — deterministic fake provider. `exchangeCode` derives
        // the identity from the `code` query so tests control the resolved email;
        // `unverified@example.com` simulates an unverified provider email.
        mfaOauthProvider: fakeOAuthProvider,
        // T143a — the two customer-side resolvers forward to `customer_accounts`'
        // port, as production's do. What this harness wrote instead was the
        // degraded copy of the pair: no system scope on the read, no
        // `customers.allow_registration_without_organization` gate on the create
        // (so federated sign-in auto-created an account here whatever the operator
        // had configured), and one fixed password hash for every account it made.
        mfaSocialAccountResolvers: {
          resolveCustomerByEmail: (email: string) => customerSocialLogin().resolveByEmail(email),
          autoCreateCustomer: (email: string) => customerSocialLogin().autoCreate(email),
          resolveAdminByEmail: async (email: string) => {
            // T052 — the same port production reads, rather than a second copy of
            // the read. The comment that stood here argued for the copy on the
            // grounds that a divergence would be invisible; the divergence it
            // guarded against is what a shared owner removes, and the fold
            // (issue #249) is `findByEmail`'s now.
            const a = await identityPorts().adminUserReadPort.findByEmail(email, {
              activeOnly: true,
            });
            return a !== null && a.status === 'active' ? { id: a.id } : null;
          },
        },
      });
      harnessScopedPlugins.push(salesChannels.plugin);

      // Feature 019 — Admin UI i18n. Feature 072 (T089) — `_i18n` owns its service,
      // reconciler and routes now. Issue #158 — and it is handed the resolved
      // manifest registry (`harnessManifestRegistry`), so the boot-time reconciler
      // runs here exactly as it does in production and every module's bundles are
      // installed. This block used to say the opposite, and the emptiness it
      // described was the reason no test in the tree exercised a translated error
      // message.
      adminI18nCradle = container.cradle as unknown as AdminI18nCradle;

      // Feature 020 — Admin Command Palette actions registry. Mounts the
      // GET /api/v1/admin/admin-actions read endpoint. Tests that need
      // module_actions rows seed them directly via `h.em()`.
      // Feature 072 (T099) — `admin_actions` owns its service, its reconcile and
      // its routes now. The operator presence axis stays a root's to supply:
      // which modules a deployment ships is not this module's business.
      composedModules.contribute({
        // Issue #225 — the reading and its generation, contributed as one value.
        // The palette memoises what the reading produced, so a root that handed
        // over the reading alone would hand over a cache nothing can drop: the
        // pub/sub message that announces a flip arrives while `refreshFromDb` is
        // still in flight, and the snapshot rebuilt on it is built from the
        // presence before the flip.
        modulePresenceProbe: {
          // Issue #187 — the platform axis, which the palette used to read by
          // joining `module_registrations` itself. `?? false` where the operator
          // axis defaults `true`, and the asymmetry is the tri-state rather than an
          // oversight: `presence()` answers `undefined` only for an id neither the
          // registry nor the manifests know, and an action row naming one is an
          // orphan the join had no row to match either.
          //
          // Read this one twice if a palette test surprises you: this harness never
          // populates `module_registrations` (see `__setEnabledForTesting`'s note in
          // the registry cache), so the platform axis here is the **seeded** enabled
          // set and not the table. A test that inserts a registration row for a
          // fixture module has to seed the set too.
          isPlatformAvailable: (moduleId: string): boolean =>
            effectiveState.presence(moduleId)?.platformAvailable ?? false,
          isActivated: (moduleId: string): boolean =>
            effectiveState.presence(moduleId)?.operatorActivated ?? true,
          version: (): number => effectiveState.presenceVersion(),
        },
      });

      // Feature 058 — Credentials module.
      //
      // Feature 072 (T143a) — the four configuration-type registrations are gone
      // from here, and with them the `isRegistered` guards each one needed. This
      // harness mirrored `composition.ts` by hand, and the mirror was **worse than
      // the original in two ways**: it re-registered core descriptors on a
      // process-wide singleton once per composition, guarding each one so the
      // duplicate did not warn, and the comments record two features (068, 070)
      // where a type registered only in production made every write against it fail
      // misleadingly until somebody added the mirroring line here. Each type is
      // declared by the module that owns it now, from that module's boot hook, so
      // there is one registration and both compositions get it.
      //
      // What stays is how an admin actor is resolved from a request, which the two
      // compositions genuinely answer differently.
      composedModules.contribute({
        adminContextResolver: (request: FastifyRequest) => ({
          adminUserId:
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
        }),
        credentialsSettingsPort: settings.settingsService,
      });
      credentialsService = (
        container.cradle as unknown as { credentialsService: CredentialsService }
      ).credentialsService;

      // Feature 013 — Assets Library. Routes mount under /api/v1/admin/assets/*
      // and /assets/file/:assetId.
      // Feature 072 (T092) — the module owns its plugin and its registry now.
      // T143a — and each of `catalog`, `cms` and `megamenu` pushes its own
      // reference descriptors from its boot hook, so neither root decides which
      // edges block an asset delete.
      assetsLibrary = (container.cradle as unknown as AssetsLibraryCradle).assetsLibrary;

      // Feature 046 — PWA module. **`pwaBridge` is gone**
      // (`specs/110-instance-repository/` T118c). This root's copy was the
      // divergent one in a place nothing could see: its `resolveAuditContext`
      // answered `TEST_ADMIN_ID` for a non-admin caller where production
      // answered `null`, so a push message created outside the admin gate was
      // attributed to an administrator here and to nobody there. The module
      // resolves the platform's own `adminAuditActorResolver` now, which this
      // file contributes a few hundred lines above with production's fallback.
      //
      // What stays is the worker flag, and only that: whether a composition
      // runs the push-delivery consumer is a deployment decision, and these two
      // deployments genuinely differ. `composeApp` contributes it for
      // production; this harness composes through `composeTestServer`, which
      // does not, so the name is registered here.
      composedModules.contribute({
        // The harness has a producer and no consumer: it enqueues so the routes
        // can assert the queued ack, and starting a delivery worker per test
        // file would be a BullMQ consumer nothing ever closes.
        pwaRunWorkers: false,
      });
      pwaCradle = container.cradle as unknown as PwaCradle;

      // Feature 015 — Megamenu module. **Nothing is contributed for it any more**
      // (`specs/110-instance-repository/` T118c). This root's copy of
      // `megamenuValidatorDeps` / `megamenuStorefrontDeps` was the divergent one
      // in two places, and no test in the tree read either: it resolved a
      // category URL as `/catalog/<slug>`, which the storefront serves from
      // nowhere, and it applied no `is_active` / `deleted_at` narrowing, so a
      // deactivated category kept its menu item here and lost it in production.
      // The module resolves the five published ports itself now.
      // T143a — `megamenu` cross-registers into `cms`' reference registry from its
      // own boot hook now, so this root only drops the cache a previous
      // composition in the same process may have left in Redis.
      megamenuCradle = container.cradle as unknown as MegamenuCradle;
      if (megamenuCradle.megamenuServices.cache) {
        await megamenuCradle.megamenuServices.cache.invalidateAll();
      }

      // Feature 072 — the host names, mirroring `composition.ts`. They are the only
      // thing this root knows about the modules it composes.
      composedModules.contribute({
        // `requireAdmin` is NOT here: `auth` provides it as a port (T078).
        // `apiKeyResolver` is NOT here either: `api_keys` provides it as a gated
        // port (T100), and re-registering the name replaced that gate with a plain
        // closure — API-key authentication kept working after the module was
        // switched off. Both roots carried the entry until the root-registration
        // check started reading them (T118).
        // `redis` is registered further up, where the client is created.
        settingsReadPort: settings.settingsService,
        // Issue #45 — the same cache, seen from the writing side. Mirrors the root.
        settingsCache: settings.cache,
        // Feature 072 (T093) — `composition.ts` has registered this since T086;
        // the harness passed the same object to `searchModule` as an option but
        // never registered it, so `cms`' colour-palette writer had nothing to
        // resolve. Mirroring the root is the point of this block.
        // `requireCustomer` is NOT here any more: `auth` provides it as a port
        // (issue #43). This harness contributed `requireTestCustomer()` — a second
        // implementation that read `request.testActor` where the root read
        // `request.actor`, so every customer route was gated by one guard in
        // production and a different one under test. `registerTestAuth` mirrors
        // each resolved actor onto both properties, which is why the surviving
        // implementation answers correctly here without reading `testActor`.
        // Feature 072 (wave 2) — mirrors `composition.ts`.
        customerContextResolver: customerResolver,
        // Feature 072 (wave 3) — how this composition names the calling customer as
        // an id. The four payment gateways read it; before their conversion this
        // harness composed none of them, which `harness-parity` recorded as an
        // accepted divergence.
        customerAccountIdResolver: (req: FastifyRequest) =>
          req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : TEST_CUSTOMER_ID,
        // Feature 072 (wave 2) — mirrors `composition.ts`, reading this harness's
        // own actor property. The ad modules resolve one name instead of each
        // taking its own identically-shaped `resolveAuditContext` option.
        adminAuditActorResolver: (request: FastifyRequest) => ({
          actorAdminUserId: request.testActor?.kind === 'admin' ? request.testActor.adminUserId : null,
        }),
        // Feature 072 (wave 2) — **undefined on purpose.** A BullMQ queue built per
        // `setupBackendServer()` is never closed and this harness is constructed
        // once per test file inside a single fork, so the ad modules must get no
        // queue here. `/collect` therefore degrades to 503 and is contract-tested
        // against its own bare instance instead. `redis` is registered above; this
        // is the name that says "but not for queues".
        moduleQueueRedis: undefined,
        // Feature 072 (wave 2) — mirrors `composition.ts`.
        salesChannelCodeIdPort: {
          idByCode: async (code: string) => (await salesChannels.resolver.getByCode(code))?.id ?? null,
          codeById: async (id: string) => {
            const { items } = await (
              container.cradle as unknown as SalesChannelsCradle
            ).salesChannelsService.list({});
            return items.find((c) => c.id === id)?.code ?? null;
          },
        },
        // Mirrors the production root exactly (feature 072, D-41/D-48): the
        // system-default channel's id. Both used to fall back to `'default'`, a
        // channel *code* that cannot address a `setting_values` row, and then to
        // `?? null` on a branch the platform guarantees against.
        settingsChannelResolver: async (): Promise<string | null> =>
          (await salesChannels.resolver.getSystemDefault()).id,
        blogStorefrontDeps: undefined,
      });
      // `audit_logs` registers its own empty default for `auditActorResolver`, so a
      // value written before `composeModules` would be overwritten by it (the same
      // trap `prompt_actions` hit).
      composedModules.contribute({
        // Feature 072 (T117) — composition-specific sitemap tuning: regeneration is
        // deterministic with no staleness window, and a fixed base URL gives the
        // assertions something stable. Production contributes nothing and takes the
        // module's own `{}`.
        //
        // Registered **after `composeModules`** on purpose. `seo` registers its own
        // `{}` default there, so contributing earlier would have the module
        // overwrite the root — which is exactly what happened, and the sitemap
        // silently fell through to `http://localhost:3000`.
        sitemapOptions: { staleAfterMs: 0, baseUrl: 'http://test.local' },
        lifecycleManifestRegistry: () => harnessManifestRegistry(),
        // Feature 072 (T121) — the gate is the port's own now: `adminUserService`
        // is provided by `admin_users` and raises `ModuleDisabledError` when that
        // module is off, so no root hard-codes `isPresent('admin_users')` here.
        // The contribution itself stays a root's: `audit_logs` owns the name and
        // defaults it absent, and it composes after `admin_users`, so a
        // registration from the module would be overwritten by that default.
        auditActorResolver: async (ids: string[]) => {
          const users = await (
            container.cradle as unknown as AdminUsersCradle
          ).adminUserService.listByIds(ids);
          return users.map((u) => ({
            id: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
          }));
        },
      });
      // Feature 072 (T137) — contributed in the one slot, between `composeModules`
      // and `runBootHooks()`. Before `composeModules` is too early (the module
      // registers its own `{}` default when it composes, and overwrites this);
      // after `runBootHooks()` is too late (the boot reconcile has already
      // constructed the module and read the default).
      //
      // What it substitutes: `taxonomyDataRoot` is deliberately a path that does not
      // exist, so the boot reconcile never reads the shipped ~1.5 MB taxonomy files;
      // the fetcher and delivery adapters refuse by default, so a code path that
      // starts reaching outward without a test opting in shows up as a failed check
      // rather than a real request.
      composedModules.contribute({
        // Same window, same reason, and here it is a latent *outbound request*
        // rather than a file read: `pim_ergonode`'s boot hook only skips
        // constructing the module because `pimErgonodeRunWorkers` is false in this
        // harness. The day a non-worker reconcile is added there, or one suite
        // flips that flag, a contribution registered after boot would be silently
        // discarded and a test would open a real socket to Ergonode.
        pimErgonodeSourceOverrides: {
          ergonodeClient: options.ergonodeClient ?? refusingErgonodeClient(),
          mediaFetcher: options.ergonodeMediaFetcher ?? new ScriptedErgonodeMediaFetcher(),
        },
        pimUnopimSourceOverrides: {
          unopimClient: options.unopimClient ?? refusingUnopimClient(),
          mediaFetcher: options.unopimMediaFetcher ?? new ScriptedUnopimMediaFetcher(),
        },
        comarchXlSourceOverrides: {
          xlClient: options.xlClient ?? refusingXlClient(),
        },
        pimAkeneoSourceOverrides: {
          mediaFetcher: options.akeneoMediaFetcher ?? new ScriptedAkeneoMediaFetcher(),
        },
        productFeedsTestOverrides: {
          taxonomyDataRoot: '/nonexistent/product-feeds-taxonomies',
          taxonomySourceFetcher: options.taxonomySourceFetcher ?? refusingTaxonomyFetcher(),
          deliveryAdapters: options.feedDeliveryAdapters ?? refusingDeliveryAdapters(),
        },
        // Feature 119 / 129 — `invoice_ledger`, `infakt` and `wfirma` compose
        // through MODULES. These contributions only replace vendor HTTP when a
        // test scripts it.
        ...(options.infaktHttp ? { infaktHttp: options.infaktHttp } : {}),
        ...(options.wfirmaHttp ? { wfirmaHttp: options.wfirmaHttp } : {}),
        // US10 — mutex extras stay off the production table. Tests that need
        // a sibling inject it here (`ledger_fixture` / `other_ledger_vendor`).
        ...(options.invoiceLedgerPresence
          ? { invoiceLedgerPresence: options.invoiceLedgerPresence }
          : {}),
        ...(options.invoiceLedgerVendorModules
          ? { invoiceLedgerVendorModules: options.invoiceLedgerVendorModules }
          : {}),
      });

      // Feature 072 (T136) — `carts` owns its thirteen services and three route
      // files now. What stays a composition's: who is asking (production reads
      // `request.actor`, the harness `request.testActor`), and the bridge into
      // `shopping_lists`, which points outward and so cannot be a port.
      // Feature 072 (T120) — how an asset id becomes a public URL inside an
      // e-mail, mirroring `composition.ts`.
      //
      // **This was `async () => null` until D-223**, with a note saying the
      // harness deliberately resolved no asset URLs. The cost of that decision
      // was not visible from it: the module's own default is the same `null`,
      // so contributing it changed nothing and the production closure — the one
      // an operator's branded e-mail actually runs through — was exercised by no
      // test in the tree. A logo that renders as a broken image in every mail
      // client is exactly the defect this contribution exists to prevent, so the
      // harness composes the real thing now.
      composedModules.contribute({
        transactionalEmailAssetUrl: async (assetId: string): Promise<string | null> => {
          try {
            return (await assetsLibrary.handle.service.resolveUrl(assetId)).url;
          } catch {
            return null;
          }
        },
      });

      // Feature 072 (T142) — mirrors `composition.ts`. The harness runs no
      // bulk-operation consumer and must not reindex Meilisearch, which is exactly
      // what these two say; the other three are the same adapters, reading this
      // harness's own actor property where one is involved.
      composedModules.contribute({
        catalogRunBulkOperationWorker: false,
        // T143a — deliberately **not** forwarded to `searchReindexPort`, which is
        // what production does now. A `searchable` flag flips in a good number of
        // catalog tests, and forwarding would push every product of every channel
        // into Meilisearch each time. The reindex itself is exercised where it
        // belongs, against the module's own route:
        // `test/contract/search/admin-reindex.contract.test.ts`.
        catalogSearchReindex: async () => ({ documentCount: 0 }),
        catalogAdminAuditContext: (request: FastifyRequest) => ({
          actorAdminUserId:
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
          impersonatedCustomerAccountId: null,
        }),
        // `catalogExternalAvailability` and `catalogImagePlaceholderUrl` were
        // contributed here and are `catalog`'s own since
        // `specs/117-instance-bring-up/` Phase 6. Both bodies were reproduced
        // in this harness byte-for-byte — including D-61's presence probe,
        // which had to be identical or an off-state test would have asserted
        // against a composition production does not run — which is the clearest
        // statement there is that neither was a composition's answer to give.
        // `catalogSearchReindex` above stays, because it genuinely is one.
      });

      // Feature 072 (T141) — the sales-rep admin scope, reading this harness's
      // own actor property. `orders` defaults the name itself since
      // `specs/117-instance-bring-up/` Phase 6, so this is an override rather
      // than the only supply, which is what `contribute` is for.
      composedModules.contribute({
        ordersAdminScopeResolver: resolveTestAdminOrdersScope,
      });

      composedModules.contribute({
        // The organization transact guard used to be a no-op here, named
        // explicitly so the divergence stayed visible. T138 removed it: the guard
        // is `organizationReadPort.assertCanTransact` now, provided by the module
        // and resolved identically by both compositions.
        cartActorResolver: (request: FastifyRequest) => {
          if (request.testActor?.kind === 'customer') {
            return {
              customer: {
                customerAccountId: request.testActor.customerAccountId,
                organizationId: request.testActor.organizationId,
              },
            };
          }
          const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
          const anon = cookies?.['b2b_cart_anon'];
          if (anon) return { anonymousToken: anon };
          return {};
        },
        cartShoppingListBridge: {
          pushLineToShoppingList: async (input) => {
            if (!shoppingListServiceRef) {
              throw new Error('shopping_lists module not initialized');
            }
            await shoppingListServiceRef.addItem(
              {
                customerAccountId: input.customerAccountId,
                organizationId: input.organizationId ?? '',
              },
              input.shoppingListId,
              {
                productId: input.productId,
                ...(input.variantId ? { variantId: input.variantId } : {}),
                quantity: input.quantity,
              },
            );
          },
          appendShoppingListToCart: async (input) => {
            if (!shoppingListServiceRef) {
              throw new Error('shopping_lists module not initialized');
            }
            const res = await shoppingListServiceRef.convertToCart(
              {
                customerAccountId: input.customerAccountId,
                organizationId: input.organizationId ?? '',
              },
              input.shoppingListId,
              undefined,
            );
            return {
              cartId: '',
              appendedLineCount: res.added,
              droppedLines: res.skipped.map((it) => ({
                productId: it.productId,
                productName: it.productId,
                reason: 'not_purchasable',
              })),
            };
          },
        } satisfies CartShoppingListBridge,
      });

      // Feature 043 / 072 — the assistant's contribution points, mirroring
      // `composition.ts`. They are registered **after `composeModules`** because the
      // module registers its own empty defaults there; a value written before
      // composition would be overwritten by them.
      //
      // The tools themselves are no longer here: since D-44 each contributing module
      // pushes its own from its own boot hook, which is also how the `orders` tools
      // — production-only until then — came to be composed in this harness at all.
      // Nor is the bulk-progress reader, since D-72 point 4 turned the single name
      // it was written over into a registry keyed by contributing module. What is
      // left is three test seams, which are this harness's own.
      composedModules.contribute({
        ...(options.promptActionsLlmFetch === undefined
          ? {}
          : { promptActionsLlmFetch: options.promptActionsLlmFetch }),
        ...(options.promptActionsNow === undefined
          ? {}
          : { promptActionsNow: options.promptActionsNow }),
        ...(options.promptActionsTtlMinutes === undefined
          ? {}
          : { promptActionsTtlMinutes: options.promptActionsTtlMinutes }),
      });

      blogCradle = container.cradle as unknown as BlogCradle;
      if (blogCradle.blogCacheService) await blogCradle.blogCacheService.invalidateAll();

      dictionariesCradle = container.cradle as unknown as DictionariesCradle;
      if (dictionariesCradle.dictionaryCache) await dictionariesCradle.dictionaryCache.invalidateAll();

      // Feature 006 — Search module. Owns the Meilisearch indexer + event
      // subscriber lifecycle. Wires the same settings-aware path the
      // production composition uses so contract tests can exercise the
      // LLM-toggle wrapper end-to-end. Foundation tests don't need
      // Meilisearch up; the subscriber's handlers swallow Meilisearch
      // errors so a missing backend doesn't break catalog writes.
      // Feature 072 (T123) — `search` owns its services and routes now. The
      // harness runs no reindex sweep: it has no worker role, and a periodic
      // Meilisearch pass per test file is exactly what `enableReindexScheduler`
      // exists to keep out.
      composedModules.contribute({
        searchRunWorkers: false,
        // T143a — the same statement for `webhooks`' delivery consumer, which the
        // harness has never run: production built it in `composition.ts` and this
        // file simply did not, so the difference was an omission rather than a
        // decision. It is a decision now, and it is the same one every other
        // `*RunWorkers` flag makes here — a BullMQ consumer per test file would
        // hold a Redis connection ~555 times over.
        webhooksRunWorkers: false,
      });

      // Feature 072 (T129) — mirrors `composition.ts`. The harness used to pass no
      // event bus, channel resolver or settings reader to this module at all, so
      // three of its behaviours were exercised by nothing; the module reads all
      // three from the container now.
      composedModules.contribute({
        // Feature 072 (T138) — the admin-editable sender `organizations` sends its
        // verification, invitation and new-registration emails through. A getter
        // because `transactional_emails` announces the sender well after this
        // point; same shape and owner as `inventoryTemplateEmail`.
        inventoryAdminAuditContext: (request: FastifyRequest) => ({
          actorAdminUserId:
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
        }),
      });

      // Feature 007 — Comparisons module. Customer-facing CRUD endpoints
      // exercised by US1 contract + integration tests; share/PDF/admin land
      // in subsequent stories.
      // Feature 072 (T111) — `comparisons` owns its services and routes now.
      comparisonsCradle = container.cradle as unknown as ComparisonsCradle;

      // Feature 008 — Quote Requests workflow.
      // Feature 072 (T132) — `quote_requests` owns its services, routes and the
      // four settings reads now. What stays is a composition's answer to who is
      // asking, the organization's tax rate, and the subtree the RFQ admin scope
      // rolls up over.
      composedModules.contribute({
        rfqCustomerContextResolver: async (request: FastifyRequest) => {
          const ctx = customerResolver(request);
          const account = await identityPorts().customerAccountReadPort.findById(
            ctx.customerAccountId,
          );
          return {
            customerAccountId: ctx.customerAccountId,
            organizationId: ctx.organizationId,
            isOrgAdmin: account?.role === 'organization_admin',
          };
        },
        rfqAdminContextResolver: async (request: FastifyRequest) => {
          const adminUserId =
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID;
          const ports = identityPorts();
          const adminUser = await ports.adminUserReadPort.findById(adminUserId);
          // `getById` cannot 404 here: `admin_users_admin_role_fk` is
          // `on delete restrict`, so a non-null `adminRoleId` names a row.
          const role = adminUser?.adminRoleId
            ? await ports.adminRolePort.getById(adminUser.adminRoleId)
            : null;
          return {
            adminUserId,
            isPlatformAdmin: role?.code === 'platform_admin' || true,
            roleLabel:
              role?.code === 'platform_admin' ? 'Platform administrator' : 'Sales representative',
          };
        },
        // `rfqTaxRateResolver` was contributed here and is `quote_requests`'
        // own since `specs/117-instance-bring-up/` Phase 6. This copy was the
        // production closure reproduced over the same two ports, down to
        // having no `catch` — so composing it here meant every RFQ test
        // exercised this file's copy rather than the module's.
      });

      // Feature 072 (T138) — the two `organizations` contributions this harness
      // makes, registered after `composeModules` so they overwrite the module's
      // defaults rather than being overwritten by them. Both are read lazily — the
      // clients when the tax-ID service is first constructed, the hook at login — so
      // this placement is safe.
      composedModules.contribute({
        // No test may open a socket to VIES or Ministerstwo Finansow. The fake
        // returns `validated` for any taxId ending in `00000` and `failed` /
        // `deferred` otherwise, giving three deterministic branches.
        organizationsTaxIdClients: {
          vies: new FakeVatValidator('vies'),
          mfPl: new FakeVatValidator('mf_pl'),
        },
        organizationsLoginHook: async (loginCtx: {
          customerAccountId: string;
          organizationId: string | null;
          anonymousCartToken?: string;
          anonymousCompareToken?: string;
        }) => {
          let result: Record<string, unknown> = {};
          if (loginCtx.anonymousCartToken && loginCtx.organizationId) {
            const cartMerge = await (
              container.cradle as unknown as CartsCradle
            ).cartService.mergeAnonymousIntoCustomer(loginCtx.anonymousCartToken, {
              customerAccountId: loginCtx.customerAccountId,
              organizationId: loginCtx.organizationId,
            });
            result = { cartMerge };
          }
          // Feature 007 — adopt an anonymous comparison carried by the
          // compare_token cookie. Mirrors composition.ts, D-70 included: the
          // presence question is decided here, and the port is resolved **per
          // login** rather than bound once at composition time. The old shape
          // captured `adoptAnonymousComparison` off the cradle while every module
          // was still on, so the gate this harness composed answered `yes` for the
          // rest of the process — the one thing an off-state test of this seam has
          // to be able to see.
          if (loginCtx.anonymousCompareToken && effectiveState.isPresent('comparisons')) {
            await (
              container.cradle as unknown as ComparisonsCradle
            ).comparisonService.adoptAnonymousComparison(
              loginCtx.customerAccountId,
              loginCtx.anonymousCompareToken,
            );
          }
          return result;
        },
      });

      // Feature 040 — Customers module (mirrors composition.ts wiring).
      // Feature 072 (T140) — mirrors `composition.ts`: two names stay this
      // composition's, both actor-shaped.
      //
      // Feature 076 (D-86) — `customersVatValidator` left this contribution. The
      // fake above, contributed once over `organizationsTaxIdClients`, now reaches
      // `customers` through `vatValidatorPort`, so there is no second name for the
      // two roots to keep in step and no way for the two consumers to disagree
      // about the same tax id.
      composedModules.contribute({
        customerActorResolver: (request: FastifyRequest) => {
          if (request.testActor?.kind !== 'customer') {
            throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
          }
          return {
            customerAccountId: request.testActor.customerAccountId,
            organizationId: request.testActor.organizationId ?? null,
          };
        },
        customerModerationActorResolver: async (request: FastifyRequest) => {
          const adminUserId =
            request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID;
          const ports = identityPorts();
          const adminUser = await ports.adminUserReadPort.findById(adminUserId);
          const role = adminUser?.adminRoleId
            ? await ports.adminRolePort.getById(adminUser.adminRoleId)
            : null;
          const isPlatformAdmin = role?.code !== 'sales_representative';
          const allowedOrganizationIds = isPlatformAdmin
            ? []
            : await salesRepScope().listAssignedOrganizationIds(adminUserId);
          return { adminUserId, isPlatformAdmin, allowedOrganizationIds };
        },
      });

      // Feature 046 — Returns & Complaints (Refunds, RMA).
      // Feature 072 (T109) — `returns` owns its services and routes now. T143c
      // made the four settlement adapters their owners' ports and this harness
      // went on forwarding to them through a `returnsBridge` object, mirroring
      // the production root.
      //
      // **T118c retired the bridge in both roots and this harness contributes
      // nothing for `returns` at all.** The module resolves the four settlement
      // ports itself and declares the edges; the recipient's address is
      // `customer_accounts`' published record and the channel's language a read
      // of the platform's entity, both moved into the module. The two actor
      // resolvers are the harness's own `customerAccountIdResolver` and
      // `adminContextResolver`, contributed above — the same testActor answers
      // this block used to spell a second time, which is the divergence the
      // bridge kept alive: two copies of one answer, one per root, agreeing by
      // hand.

      // Feature 047 — Invoices. **`invoicesBridge` is gone**
      // (`specs/110-instance-repository/` T118c) and this harness contributes
      // nothing for the module at all.
      //
      // Its six members were the divergence a bridge keeps alive, and this root
      // held two halves of it. `loadAssetImage` was **absent entirely** until
      // D-223 — optional on the bridge, so the omission compiled, and every
      // invoice rendered in this suite took the "no logo bytes" branch while
      // production embedded the operator's logo. And the two actor members
      // spelled `adminContextResolver` and `customerContextResolver` a second
      // time, a few hundred lines below the contributions that already answer
      // both questions with the same `testActor` reads.
      //
      // The module resolves all six itself now: the platform's two actor
      // resolvers, `transactional_emails`' sender accessor, and
      // `customer_accounts`', the platform's and `assets_library`' published
      // reads for the recipient, the language and the logo bytes.

      invoicesCradle = container.cradle as unknown as InvoicesCradle;

      // Feature 059 — KSeF. No redis queue in tests (submissions are processed by
      // driving `submissions.process(...)` directly); the sweep interval is off.
      // Feature 072 (T104) — `ksef` owns its services and routes now.
      // `ksefSellerNipResolver` was contributed here and is `ksef`'s own since
      // `specs/117-instance-bring-up/` Phase 6 — this copy read the same
      // setting through the same port and normalised the NIP the same way.
      //
      // `ksefTestOverrides` is **not** that, and went with it by accident in
      // Phase 6 (8e86e55b5). The module registers the name with an empty
      // default so that production takes its own cadence against the real API;
      // this is the only composition that fills it, and without it every KSeF
      // integration test built the **real** client and drove it at production
      // polling — every submission reached `failed` carrying
      // `KSEF_AUTH_REJECTED` from a live 400, rather than the fake's outcome.
      composedModules.contribute({
        // The harness substitutes a deterministic client, drives sweeps itself
        // and polls three times at 5 ms.
        ksefTestOverrides: {
          ...(options.ksefClientFactory ? { clientFactory: options.ksefClientFactory } : {}),
          sweepIntervalMs: 0,
          pollAttempts: 3,
          pollIntervalMs: 5,
        },
      });
      ksefCradle = container.cradle as unknown as KsefCradle;

      // Feature 067 — Product Feed. Deliberately NO `redis` and NO `runWorkers`:
      // `setupBackendServer()` runs once per test file in a single fork, and adding
      // BullMQ connections here has previously taken ~225 files down with "too many
      // clients" (research §R18). Tests drive `productFeeds.generation.generateNow`
      // directly, exactly as the KSeF tests drive `submissions.process`.
      //
      // **This root contributes nothing to it either** (T118c). `productFeedsBridge`
      // was four members written twice, and the drain that deleted the interface
      // deleted both copies in the same merge request. The module resolves
      // `objectStoragePort`, `inventoryAvailabilityPort`,
      // `catalogCategoryReadPort` and `assetReadPort` for itself, so this harness
      // and production now compose the identical four — which is the property the
      // copies could never have, and the reason the image-URL divergence D-223
      // repaired was invisible for as long as it was.
      // Feature 072 (T137) — the template reconcile moved into the module's own
      // `ctx.onBoot`, which runs for both compositions.

      // Feature 068 — Ergonode PIM. Deliberately NO `redis` and NO `runWorkers`,
      // for the same reason product_feeds above has neither: one fork per test file
      // cannot afford a BullMQ connection per module. Integration tests drive the
      // import pipeline directly rather than through a job.
      //
      // The catalogue write surface is constructed here exactly as production
      // composition builds it, so what a test exercises is the path a real import
      // takes — Command Bus, channel binding and all.
      // Feature 072 (T131) — the eight services `pim_ergonode` reads across a
      // module boundary. Seven are `catalog`'s and were constructed here a
      // second time, purely for this module, while `catalog` built its own;
      // registering them means one instance each per composition.
      //
      // All eight are gone. `assetsLibraryService` was the last, and T118c
      // retired it in both roots rather than moving it: `assets_library`
      // provides `assetsLibraryPort`, `pim_ergonode` resolves that port, and the
      // name was read by nobody.

      // Feature 047 — Transactional Emails.
      // Feature 072 (T126) — `payments` owns the payment-status notifier now and
      // subscribes through `ctx.subscribe`, so it stops when the module does. The
      // sender stays a contribution: `transactional_emails` announces it through a
      // callback this root holds, later than the module composes.
      composedModules.contribute({
        paymentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
      });
      // Feature 072 (T124) — `shipments` owns the shipment-created notifier now and
      // subscribes through `ctx.subscribe`, so it stops when the module does. The
      // sender stays a contribution: `transactional_emails` announces it through a
      // callback this root holds, later than the module composes.
      composedModules.contribute({
        shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
      });


      // Feature 072 (T114) — `newsletter` owns its services and routes now,
      // and `newsletterBridge` is gone since `specs/117-instance-bring-up/`
      // Phase 6: nine members, all of them ports, platform contributions or
      // environment inputs the module reads itself. `emailMailer` above is
      // already the injected recording mailer, `customerAccountIdResolver` is
      // this harness's own actor read, and `storefrontBaseUrl` is in `values`.
      // What is left to pin is the one member that genuinely has to be
      // predictable — the signing key, because a token is signed on one request
      // and verified on another — and it is in `values` beside the others,
      // since nothing defaults it.

      // Feature 049 — Google Analytics. No redis wired here, so /collect degrades
      // to 503 (queue producer absent); config + admin CRUD are fully exercised.

      // Feature 063 — LinkedIn Ads. Config + mapping CRUD are fully exercised.

      // Feature 064 — Meta Ads. Config + custom-event CRUD are fully exercised.

      // Feature 066 — Google Tag Manager. No redis wired here: a BullMQ queue built
      // per `setupBackendServer()` is never closed, and this harness is constructed
      // once per test file inside a single fork. /collect therefore degrades to 503
      // here (queue producer absent) and is contract-tested against its own bare
      // instance in test/contract/google_tag_manager/collect.test.ts.

      // Feature 072 (T133) — mirrors `composition.ts`. The harness passed no
      // `settingsService` here, so the quick-order import cap fell back to its
      // manifest default in every test while production read it per channel.
      composedModules.contribute({
        oneClickOrderServiceGetter: () => orderServiceForOneClick,
        shoppingListServiceSink: (svc: ShoppingListService) => {
          shoppingListServiceRef = svc;
        },
      });

      if (options.extraModules) harnessScopedPlugins.push(...options.extraModules);

      // Feature 072 (T125) — `_lifecycle` registers these routes itself now,
      // through `ctx.ungatedRoutes`. What stays here is the one thing that
      // genuinely differs: local refresh goes through the *cache seam* rather than
      // a database read, because this harness never populates
      // `module_registrations` and refreshing from the database would blank the
      // seeded enabled-set and take every gated route down mid-run. No
      // `lifecycleOrchestrator` is contributed, so the module list is not served —
      // which is exactly the composition this harness has always been.
      composedModules.contribute({
        lifecycleActivationPropagation: {
          commandBus,
          propagation: {
            refreshLocalState: () => registryCache.__refreshActivationForTesting(em),
            publishStateChanged: (payload: Parameters<typeof publishStateChanged>[1]) =>
              publishStateChanged(redis, payload),
            revalidateStorefront: async () => undefined,
          },
        },
      });
      // Feature 060 — the caller's fixture interceptors, registered **once**, in
      // the composition window and after every module registered its own. That
      // is where this call sat until the harness composed through the kit
      // (feature 109, Phase 1c) and the split copied it into `beforeBoot` too:
      // one composition, one registry, two invocations, and the registry's
      // duplicate-(module, id) guard refused the second — correctly. Keep it
      // here and nowhere else. Registration is a composition-time act, sealed at
      // `app.ready()` (specs/060-api-interceptor/contracts/interceptor-registry.md);
      // the kit's `beforeBoot` is the later slot, for a reconcile or a settings
      // write a boot hook will read.
      options.configureInterceptors?.(apiInterceptors);
    },
    plugins: harnessPlugins,
    scopedPlugins: harnessScopedPlugins,
    buildTenantContext: buildTestTenantContext,
    beforeBoot: async () => {
      // Feature 004 — boot-time manifest reconciliation. Runs before
      // app.ready() so contract tests start from a consistent settings
      // catalog.
      //   - settingsModuleManifest: built-in `general` group.
      //   - searchManifest:         feature-006 search group + 6 settings.
      // Same derivation the production composition uses, so the harness cannot
      // drift from it — it previously carried its own hand-maintained copy, which
      // is why tests saw KSeF/MFA settings that production never created.
      //
      // Feature 080 (T046) — and the same **population**, which is the half that had
      // drifted: `deploymentShippedEntries(resolvedRegistry)` is core plus this
      // deployment's overlay and never an installed package. Both roots passed
      // bare-core `REGISTERED_MANIFESTS`, so an overlay module's activation Setting
      // was created by nothing, here or in production.
      await new ManifestReconciler(em()).apply(
        settingsManifestCollectionPort().collect(deploymentShippedEntries(resolvedRegistry)),
      );
    },
    afterReady: async () => {
      // `_i18n` reconciles from its `ctx.routes` callback, so the bundles are on
      // disk-truth by the line above. Prove it before any test observes anything —
      // see the note on `assertErrorTranslationsInstalled`.
      await assertErrorTranslationsInstalled(adminI18nCradle.adminI18nService);
    },
    server: {
      openApi: {
        title: 'B2B Platform API (test)',
        version: 'test',
        serverUrl: 'http://localhost',
      },
      // `specs/110-instance-repository/` T118 — the same assembly production
      // calls, and now literally the same code rather than the same twenty
      // lines written twice. What stood here was byte-identical to the
      // production root's, which is the drift this file's own
      // `harness-parity.test.ts` exists to refuse: the `request.testActor` read
      // it once carried was the residual difference between the two roots, and
      // issue #234 is what a shared *defect* in the pair costs — both spelled
      // `if (request.actor.kind !== 'admin') return null`, so no test could see
      // it. `registerTestAuth` mirrors every resolved actor onto `request.actor`
      // (`test-actors.ts`), so the shared ladder answers correctly here.
      errorEnvelope: composeErrorEnvelopeOptions({
        errorTranslationTargets: errorTranslation.targets,
        adminUserReadPort: () => identityPorts().adminUserReadPort,
        translate: () => adminI18nCradle.adminI18nService,
      }),
    },
  });

  const app = handle.app;

  return {
    app,
    orm,
    em,
    eventBus,
    apiInterceptors,
    redis,
    redisSubscriber: handle.redisSubscriber,
    pubSubArmed: handle.pubSubArmed,
    composition: handle,
    sessionService,
    auditLogService,
    promptActions: {
      registry: promptActionsCradle().promptActionToolRegistry,
      requestService: promptActionsCradle().promptRequestService,
      providerFactory: promptActionsCradle().llmProviderFactory,
    },
    credentials: {
      service: credentialsService,
      // Resolved from the container rather than imported: `credentials`
      // declares the registry it owns since T143a.
      configurationTypeRegistry: (
        container.cradle as unknown as { configurationTypeRegistry: ConfigurationTypeRegistry }
      ).configurationTypeRegistry,
    },
    invoices: {
      invoiceService: invoicesCradle.invoiceService,
      numberGenerator: invoicesCradle.invoiceNumberGenerator,
      pdfRenderer: invoicesCradle.invoicePdfRenderer,
      loadAssetImage: invoicesCradle.invoices.handle.loadAssetImage,
    },
    ksef: ksefCradle.ksef.handle,
    infakt: {
      processDelivery: (deliveryId: string) =>
        (
          container.cradle as unknown as {
            infaktDeliveryProcessor: { process: (id: string) => Promise<void> };
          }
        ).infaktDeliveryProcessor.process(deliveryId),
    },
    wfirma: {
      processDelivery: (deliveryId: string) =>
        (
          container.cradle as unknown as {
            wfirmaDeliveryProcessor: { process: (id: string) => Promise<void> };
          }
        ).wfirmaDeliveryProcessor.process(deliveryId),
    },
    invoiceLedgerRegistry: (
      container.cradle as unknown as { invoiceLedgerRegistryPort: InvoiceLedgerRegistryPort }
    ).invoiceLedgerRegistryPort,
    productFeeds: (container.cradle as unknown as ProductFeedsCradle).productFeeds.handle,
    pimErgonode: (container.cradle as unknown as PimErgonodeCradle).pimErgonode.handle,
    pimConnectorRegistry: (
      container.cradle as unknown as { pimConnectorRegistryPort: PimConnectorRegistryPort }
    ).pimConnectorRegistryPort,
    erpConnectorRegistry: (
      container.cradle as unknown as { erpConnectorRegistryPort: ErpConnectorRegistryPort }
    ).erpConnectorRegistryPort,
    pimUnopim: (container.cradle as unknown as PimUnopimCradle).pimUnopim.handle,
    pimPimcore: (container.cradle as unknown as PimPimcoreCradle).pimPimcore.handle,
    pwa: pwaCradle.pwa.handle,
    permissionService,
    permissionCatalogueService,
    settings: {
      ...settings,
      adminService: (container.cradle as unknown as SettingsCradle).settingsAdminService,
      cacheAdminService: (container.cradle as unknown as SettingsCradle).settingsCacheAdminService,
    },
    salesChannels: {
      ...salesChannels,
      salesChannelsService: (container.cradle as unknown as SalesChannelsCradle)
        .salesChannelsService,
    },
    integrations: {
      apiKeyService: apiKeysCradle.apiKeyService,
      requireApiKey: apiKeysCradle.requireApiKey,
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
    },
    search: (container.cradle as unknown as SearchCradle).searchHandle,
    comparisons: { comparisonService: comparisonsCradle.comparisonService },
    assetsLibrary: assetsLibrary.handle,
    cms: cmsCradle.cms.handle,
    megamenu: {
      referenceRegistry: megamenuCradle.megamenuReferenceRegistry,
      cache: megamenuCradle.megamenuServices.cache,
    },
    blog: {
      cache: blogCradle.blogCacheService,
      storefrontResolver: blogCradle.blogStorefrontResolver,
    },
    container,
    composedDecorations: composedModules.decorations,
    dictionaries: {
      validator: dictionariesCradle.dictionaryValidator,
      cache: dictionariesCradle.dictionaryCache,
    },
    adminI18n: { i18nService: adminI18nCradle.adminI18nService },
    promotions: {
      promotionService: promotionsCradle.promotionService,
      couponService: promotionsCradle.promotionCouponService,
      ruleStore: promotionsCradle.promotionRuleStore,
      statsService: promotionsCradle.promotionStatsService,
    },
    customFields: {
      definitionService: customFieldDefinitionService,
      valueService: customFieldValueService,
      cache: customFieldsCradle.customFieldDefinitionsCache,
    },
    // Feature 061 — the composed attribute read model for test fixtures.
    // T143a — the port `catalog` provides, so a fixture reads the same instance
    // the module does rather than a second one built here.
    get catalogAttributeRead(): CatalogAttributeReadService {
      return (
        container.cradle as never as { catalogAttributeReadPort: CatalogAttributeReadService }
      ).catalogAttributeReadPort;
    },
    // Issue #132 — the same port the listing paths resolve, so a hand-built
    // fixture prices the way the composed catalogue does.
    get pricingService(): PricingServiceContract {
      return (container.cradle as never as { pricingService: PricingServiceContract })
        .pricingService;
    },
    // Feature 075 — the asset read port the catalogue's image resolution goes
    // through. A getter, not a captured value: the registration is gated, so
    // holding it would be holding a gate that keeps answering.
    get assetRead(): AssetReadPort {
      return (container.cradle as never as { assetReadPort: AssetReadPort }).assetReadPort;
    },
    // Feature 072 (T138) — read off the container rather than off a handle the
    // module block used to fill in. The `?? null as unknown as …` fallbacks are
    // gone with it: they existed because the block was conditional, and a test
    // reaching for a service that was never built got `null` masquerading as
    // one rather than a resolution error.
    organizations: {
      get moderationService(): OrganizationModerationService {
        return (container.cradle as never as OrganizationsCradle).organizationModerationService;
      },
      adminNotificationService,
      get organizationContextService(): OrganizationContextService {
        return (container.cradle as never as OrganizationsCradle)
          .organizationReadPort as OrganizationContextService;
      },
      get restrictionService(): OrganizationRestrictionService {
        return (container.cradle as never as OrganizationsCradle).organizationRestrictionPort;
      },
    },
    cartService: () => (container.cradle as unknown as CartsCradle).cartService,
  };
}


function customerResolver(request: FastifyRequest): {
  customerAccountId: string;
  organizationId: string;
  impersonatorAdminUserId?: string | null;
} {
  if (request.testActor?.kind !== 'customer') {
    return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  }
  // The test actor carries an optional organisation, so a test that names none
  // falls back to the shared TEST_ORGANIZATION_ID. This is the harness's
  // deliberate divergence from `composition.ts`'s resolver, which refuses
  // instead — and since D-178 that refusal is a 500 asserting an invariant
  // rather than a 422 describing a business state. Substituting here is still
  // right: the actor is a fixture, not a row, and a test that wants the
  // invariant's refusal drives the composed resolver.
  return {
    customerAccountId: request.testActor.customerAccountId,
    organizationId: request.testActor.organizationId ?? TEST_ORGANIZATION_ID,
    impersonatorAdminUserId: request.testActor.impersonatorAdminUserId,
  };
}

export async function teardownBackendServer(h: BackendServerHandle | undefined): Promise<void> {
  if (!h) return;
  // Feature 109 (T030) — one release sequence, the kit's. It closes the app,
  // runs every registration's disposer and drops the resolution cache, then
  // unsubscribes and drops listeners **before** disconnecting either client — a
  // subscribed client that is merely disconnected keeps its subscription set and
  // ioredis re-establishes it on any reconnect, which is how one armed
  // subscription per composition became ~1 GB of retention — and finally closes
  // the ORM. Every step is now shared with a module package's own test rather
  // than being a second copy that cannot learn about a new resource.
  await teardownTestServer(h.composition);
}

/**
 * Deterministic VAT validator stub used by the test harness (feature 026 US7).
 *
 *   - taxId ending in `00000` → `validated` with legalName "Test Legal Co"
 *   - taxId ending in `99999` → `deferred` (simulates provider outage)
 *   - everything else → `failed` / `not_found`
 *
 * No real HTTP traffic; lets tests cover all three branches deterministically.
 */
/**
 * The one VAT validator fake (feature 072, T071).
 *
 * There used to be two, and they **disagreed**: this class answered `failed`
 * for `PL0000000099` while an inline object literal in the customers wiring
 * answered `validated` for the same input. Same port, same tax id, two answers
 * — decided by which module happened to be called. That is the failure mode
 * T071 is about: a hand-rolled fake per call site is a second wiring, and two
 * wirings of one port drift the moment either is touched.
 *
 * `PL0000000099` is the seeded organization's tax id and the seed marks that
 * row a VAT payer, so it validates here. A fake that failed it would contradict
 * the fixture it is validating.
 */
class FakeVatValidator implements VatValidator {
  constructor(public readonly provider: 'vies' | 'mf_pl') {}

  async validate(input: { taxId: string }): Promise<VatValidationResult> {
    const cleaned = input.taxId.replace(/[\s-]+/g, '').toUpperCase();
    if (cleaned === TEST_ORGANIZATION_TAX_ID) {
      return {
        outcome: 'validated',
        legalName: 'Test Organization',
        address: null,
        errorKind: null,
      };
    }
    if (cleaned.endsWith('00000')) {
      return {
        outcome: 'validated',
        legalName: 'Test Legal Co',
        address: { line1: 'ul. Testowa 1', city: 'Warszawa', countryCode: 'PL' },
        errorKind: null,
      };
    }
    if (cleaned.endsWith('99999')) {
      return {
        outcome: 'deferred',
        legalName: null,
        address: null,
        errorKind: 'network_timeout',
      };
    }
    return {
      outcome: 'failed',
      legalName: null,
      address: null,
      errorKind: 'not_found',
    };
  }
}
