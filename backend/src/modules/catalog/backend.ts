import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES, type ListingPricePort } from '@b2b/contracts';
import type {
  CatalogAttachmentPort,
  CatalogAttributeReadPort,
  CatalogAttributeSetPort,
  CatalogBulkImportPort,
  PromptActionBulkProgressRegistryPort,
  PromptActionToolRegistryPort,
  CatalogCategoryReadPort,
  CatalogCategoryWritePort,
  CatalogGalleryPort,
  CatalogGroupedPort,
  CatalogProductFilterPort,
  CatalogProductLinkPort,
  CatalogProductReadPort,
  CatalogProductWritePort,
  CatalogPromoAttributePort,
  CatalogQuickSearchPort,
  SearchQueryPort,
} from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import { HttpError } from '../../http/error-envelope.js';
import { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { catalogModule, type CatalogModuleOptions } from './plugin.js';
import { CatalogAdminService } from './services/catalog-admin.service.js';
import { CatalogBulkImportService } from './services/catalog-bulk-import.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import { AttributeSetService } from './services/attribute-set.service.js';
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { CatalogAttributeReadService } from './services/catalog-attribute-read.service.js';
import { CatalogCategoryReadService } from './services/catalog-category-read.service.js';
import { CatalogProductFilterService } from './services/catalog-product-filter.service.js';
import { CatalogProductReadService } from './services/catalog-product-read.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogQuickSearchService } from './services/catalog-quick-search.service.js';
import {
  createCatalogCategoryWritePort,
  createCatalogProductWritePort,
  createCatalogPromoAttributePort,
} from './services/catalog-write-ports.js';
import type { CatalogEventBus } from './services/catalog-admin.service.js';
import { registerCatalogAssetReferences } from './services/asset-references.js';
import {
  presenceAwareBulkRecorder,
  type BulkNotificationPort,
} from './services/bulk-operation.service.js';
import {
  catalogBulkProgressReader,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
  type CatalogPromptToolsDeps,
} from './prompt-tools.js';
import type { AssetReferenceRegistry } from '../assets_library/services/reference-registry.js';

/**
 * `catalog` — seven services each composition built **twice** (feature 072,
 * wave 4, T142; the last module in the sweep).
 *
 * `catalogAdmin`, `categoryAdmin`, `attributeSets`, `gallery`, `attachments`,
 * `productLinks` and `grouped` were written out as `new X(...)` in each root
 * purely to hand to `pim_ergonode`, while this module constructed its own set
 * inside its plugin. Two live instances of each, per composition, differing by
 * whichever constructor arguments a root happened to repeat — the T131 note
 * called it "issue #44's shape in a second module and at seven times the size",
 * and this is where it drains. They are ports now, so there is one of each and
 * the Ergonode importer writes through the same instance the admin API does.
 *
 * `catalogQueryPort` is the other half of #44. Each composition built a
 * `CatalogQueryService` for `promotions` with two constructor arguments left
 * `undefined`, and this module built its own; the note in `promotions/backend.ts`
 * predicted it would drain here. It does.
 *
 * **Two options only production passed.** `adminNotificationService` and
 * `mailer` were absent from the harness, so the bulk-operation completion
 * notice and its e-mail were exercised by nothing — the shape this wave has
 * removed a dozen times. Both are ports the module resolves now.
 *
 * `runBulkOperationWorker` stays root-supplied and stays a value (Principle X):
 * whether this process runs the BullMQ consumer is a deployment decision, read
 * at construction because it decides whether the consumer is built at all.
 * `reindexSearchIndexes` stays contributed for the reason `ksef` and
 * `product_feeds` keep theirs — production runs a real Meilisearch reindex and
 * the harness must not, so what a test composition substitutes is information
 * about the seam rather than boilerplate to normalise away.
 */

/** What `catalog` resolves from the container, and the names it owns. */
export interface CatalogCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditLogService;
  readonly moduleQueueRedis: Redis | undefined;
  /**
   * The process connection, distinct from `moduleQueueRedis`: the assistant's
   * bulk tools delegate over the same queue in both compositions, which is a
   * property the harness asserts.
   */
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService;
  readonly customFieldValueService: NonNullable<CatalogModuleOptions['customFieldValues']>;
  readonly customFieldDefinitionService: NonNullable<CatalogModuleOptions['customFieldDefinitions']>;
  /**
   * The apply seam. Both roots passed `customFieldDefinitionService` for this
   * and for `customFieldDefinitions` — one service satisfies both shapes — so
   * there is one name, not a second registration nobody makes.
   */
  readonly pricingService: NonNullable<CatalogModuleOptions['pricingService']>;
  readonly languageService: NonNullable<CatalogModuleOptions['languageService']>;
  /** `admin_notifications`' gated port — wrapped below, never handed on raw. */
  readonly adminNotificationService: BulkNotificationPort;
  readonly emailMailer: NonNullable<CatalogModuleOptions['mailer']>;
  readonly requireApiKey: NonNullable<CatalogModuleOptions['requireApiKey']>;
  readonly requireBoundApiKey: NonNullable<CatalogModuleOptions['requireBoundApiKey']>;
  /** Root-supplied (Principle X): the harness runs no bulk-operation consumer. */
  readonly catalogRunBulkOperationWorker: boolean;
  /** Root-shaped: how this deployment names the acting admin on an audit record. */
  readonly catalogAdminAuditContext: NonNullable<CatalogModuleOptions['resolveAdminAuditContext']>;
  /**
   * Contributed: how a stock availability band is resolved for the external
   * catalog namespace, and the storefront image placeholder. Each reaches a
   * module `catalog` must not read through directly.
   */
  readonly catalogExternalAvailability: NonNullable<
    CatalogModuleOptions['resolveExternalAvailability']
  >;
  readonly catalogImagePlaceholderUrl: NonNullable<
    CatalogModuleOptions['resolveProductImagePlaceholderUrl']
  >;
  /** Contributed: production runs a real Meilisearch reindex; the harness must not. */
  readonly catalogSearchReindex: NonNullable<CatalogModuleOptions['reindexSearchIndexes']>;
  /**
   * Owned by `assets_library`: the registry that refuses to delete an asset a
   * product gallery, attachment, virtual download or category image points at.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistry;
  /**
   * Owned by `prompt_actions`: the assistant's tool catalogue. An ungated
   * registration this module pushes into once, from a boot hook — declared as a
   * `contributes-to` edge rather than a dependency (D-44).
   */
  readonly promptActionToolRegistry: PromptActionToolRegistryPort;
  /**
   * Owned by `prompt_actions`: where a delegated bulk request reads its live
   * progress from. The same shape as the tool catalogue above, and new for the
   * same reason (D-72 point 4) — until it existed, `promptActionsBulkProgressResolver`
   * was a single name `prompt_actions` defaulted and a composition root
   * overwrote with this module's resolver, which is the one thing a module may
   * not do. A table it can push into, so the contribution moves here with the
   * other five.
   */
  readonly promptActionBulkProgressRegistry: PromptActionBulkProgressRegistryPort;
  readonly catalogAttributeReadPort: CatalogAttributeReadService;
  readonly catalogQueryPort: CatalogQueryService;
  readonly catalogAdminService: CatalogAdminService;
  readonly categoryAdminService: CategoryAdminService;
  readonly attributeSetService: AttributeSetService;
  readonly galleryService: GalleryService;
  readonly attachmentService: AttachmentService;
  readonly productLinkService: ProductLinkService;
  readonly groupedService: GroupedService;
  readonly catalogCategoryRevalidator: StorefrontRevalidator;
  readonly catalog: ReturnType<typeof catalogModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): CatalogCradle => ctx.cradle<CatalogCradle>();

  /**
   * The two API-key gates, with the presence probe D-44 requires of a
   * `degrades-without` edge.
   *
   * The manifest withdraws the flip-time refusal on these, so `api_keys` may be
   * absent while these routes are mounted — route *registration* runs whatever
   * any module's effective state is. `requireApiKey` is a gated port, and a
   * closed gate **throws** rather than resolving to `undefined`, so optional
   * chaining defends against nothing here: the probe has to come first.
   *
   * Per request rather than per registration, because the operator flips
   * between the two. The absent answer is the same 401 an unauthenticated
   * caller gets — the door is shut, not broken.
   *
   * Written out twice rather than parameterised by the port name: a computed
   * cradle read is a name `check-port-dependencies.ts` cannot verify, and it
   * refuses the shape rather than guessing at it.
   */
  const apiKeysPresent = (): void => {
    if (!effectiveState.isPresent('api_keys')) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'API key required.');
    }
  };

  const requireApiKeyGate =
    (scope: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      apiKeysPresent();
      return cradle().requireApiKey(scope)(request, reply);
    };

  const requireBoundApiKeyGate =
    (scope: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      apiKeysPresent();
      return cradle().requireBoundApiKey(scope)(request, reply);
    };

  ctx.di.register({
    /**
     * Feature 068 — the storefront serves the category tree from a fetch cache
     * tagged `catalog:categories`, flushed on every category write so an
     * activation toggle shows immediately. A no-op unless STOREFRONT_BASE_URL
     * and REVALIDATE_SECRET are configured.
     *
     * Registered here rather than built in the plugin body because the
     * subscription that drives it belongs in this file (issue #107); the plugin
     * still hands it `app.log` when the Fastify instance exists.
     */
    catalogCategoryRevalidator: ctx
      .asFunction(
        () =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }),
      )
      .singleton(),

    catalog: ctx
      .asFunction(
        ({
          emFactory,
          eventBus,
          commandBus,
          auditLogService,
          moduleQueueRedis,
          catalogRunBulkOperationWorker,
        }: CatalogCradle) =>
          catalogModule({
            emFactory,
            eventBus,
            commandBus,
            auditLogService,
            ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
            runBulkOperationWorker: catalogRunBulkOperationWorker,
            customFieldValues: lazyPort<CatalogCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            customFieldDefinitions: lazyPort<CatalogCradle['customFieldDefinitionService']>(
              ctx,
              'customFieldDefinitionService',
            ),
            customFieldsPort: lazyPort<NonNullable<CatalogModuleOptions['customFieldsPort']>>(
              ctx,
              'customFieldDefinitionService',
            ),
            attributeReadService: lazyPort<CatalogAttributeReadService>(
              ctx,
              'catalogAttributeReadPort',
            ),
            pricingService: lazyPort<CatalogCradle['pricingService']>(ctx, 'pricingService'),
            salesChannelMembership: lazyPort<SalesChannelMembershipService>(
              ctx,
              'salesChannelMembershipPort',
            ),
            languageService: lazyPort<CatalogCradle['languageService']>(ctx, 'languageService'),
            // Absent from the harness before T142, so the bulk-operation
            // completion notice and its e-mail ran in no test.
            //
            // D-60 — the bell's absence is decided here, in front of the gate,
            // and reaches the bulk-operation service as `not-present` in the
            // return type. A `catch` at the call site fused "the operator
            // switched notifications off" with "the write failed".
            adminNotificationService: presenceAwareBulkRecorder(
              lazyPort<BulkNotificationPort>(ctx, 'adminNotificationService'),
            ),
            mailer: lazyPort<CatalogCradle['emailMailer']>(ctx, 'emailMailer'),
            // Issue #153 — `search`'s listing backend, resolved rather than
            // constructed. `plugin.ts` used to `new SearchQueryService(...)`
            // out of `search`'s class, so a composition held two Meilisearch
            // clients and the public product list reached the index through no
            // gate at all. Whether the listing uses it is still decided before
            // the call by `effectiveState.isPresent('search')`.
            searchQueryService: lazyPort<SearchQueryPort>(ctx, 'searchQueryPort'),
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireApiKey: requireApiKeyGate,
            requireBoundApiKey: requireBoundApiKeyGate,
            resolveAdminAuditContext: (req: FastifyRequest) =>
              cradle().catalogAdminAuditContext(req),
            resolveExternalAvailability: (productIds, salesChannelId) =>
              cradle().catalogExternalAvailability(productIds, salesChannelId),
            resolveProductImagePlaceholderUrl: (salesChannelCode) =>
              cradle().catalogImagePlaceholderUrl(salesChannelCode),
            reindexSearchIndexes: () => cradle().catalogSearchReindex(),
            categoryRevalidator: cradle().catalogCategoryRevalidator,
          }),
      )
      .singleton(),
  });

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `catalog` is the heaviest provider in the tree: 107 inbound import sites
  // across fourteen modules, sixty of them on the `Product` and `Category`
  // entity classes. The nine ports below this block hand out *services*, which
  // is what the sweep's consumers type themselves against; these five are what
  // they rewire to, and none of them lets an entity across the boundary.
  //
  // The two read ports replace the sixty entity reads. The three adapters
  // narrow three large admin services to the methods `pim_ergonode` and
  // `promotions` measurably call — ten of `CatalogAdminService`'s hundred, two
  // of `CatalogQueryService`'s.
  //
  // `product_feeds`' predicate-driven product scan was deliberately unmet here
  // and escalated to the `product_feeds` cut, which ruled it: the module keeps
  // its selection DSL and compiles it to `CatalogProductFilter` — a grammar
  // narrower than MikroORM, published in `@b2b/contracts` — and this module
  // translates and runs it, with the eligibility floor and the keyset cursor
  // inside `catalogProductFilterPort` rather than in the caller's conjunction.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<CatalogProductReadPort>(
    'catalogProductReadPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogProductReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<CatalogCategoryReadPort>(
    'catalogCategoryReadPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogCategoryReadService(emFactory))
      .singleton(),
  );

  /**
   * The selection scan `product_feeds` walks a channel with. Separate from
   * `catalogProductReadPort` because it answers a different question: that port
   * resolves rows a caller can already name, this one *finds* them — and it is
   * the only place the sellable floor and the keyset cursor are applied, so
   * neither can be composed away by a caller.
   */
  ctx.di.providePort<CatalogProductFilterPort>(
    'catalogProductFilterPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogProductFilterService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<CatalogProductWritePort>(
    'catalogProductWritePort',
    ctx
      .asFunction(() =>
        createCatalogProductWritePort(() => ctx.cradle<CatalogCradle>().catalogAdminService),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogCategoryWritePort>(
    'catalogCategoryWritePort',
    ctx
      .asFunction(() =>
        createCatalogCategoryWritePort(() => ctx.cradle<CatalogCradle>().categoryAdminService),
      )
      .singleton(),
  );

  /**
   * D-74 — the bulk import surface. `import_export` parses the spreadsheet;
   * this module owns the validation, the within-run slug index, the transaction
   * and the audit row, because every row a catalogue import writes lands in this
   * module's tables and in nobody else's.
   */
  ctx.di.providePort<CatalogBulkImportPort>(
    'catalogBulkImportPort',
    ctx
      .asFunction(
        ({ commandBus }: CatalogCradle) =>
          new CatalogBulkImportService(
            commandBus,
            lazyPort<SalesChannelMembershipService>(ctx, 'salesChannelMembershipPort'),
          ),
      )
      .singleton(),
  );

  /**
   * Issue #174 — the buyer's type-ahead, which `quick_order` was answering
   * with its own knex `select` against `products`.
   *
   * There was no import specifier, so `check:module-boundary` read clean over
   * it and no ledger shard could key it; and the query filtered
   * `status = 'active'` and nothing else, so a signed-in buyer saw every active
   * product on the platform whatever channel they were shopping. The predicate
   * is a catalogue question in every part — which rows are active, which are on
   * the channel, and which attribute values are searchable — so it is published
   * from here, scoped by `sales_channel_products` like every other
   * customer-facing read in this module.
   */
  ctx.di.providePort<CatalogQuickSearchPort>(
    'catalogQuickSearchPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogQuickSearchService(
            emFactory,
            lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogPromoAttributePort>(
    'catalogPromoAttributePort',
    ctx
      .asFunction(() =>
        createCatalogPromoAttributePort(() => ctx.cradle<CatalogCradle>().catalogQueryPort),
      )
      .singleton(),
  );

  // The nine ports. Seven of them were a second instance each root built for
  // `pim_ergonode`; the last two are the `CatalogQueryService` and attribute
  // read model that issue #44 recorded.
  //
  // Six of them gain a Phase-P contract type as their `providePort` parameter,
  // which is the compile-time proof that the class still satisfies what was
  // published. All six already returned contract DTOs, so none needed an
  // adapter — the two that returned entities did, and are above.
  ctx.di.providePort<CatalogAttributeReadPort>(
    'catalogAttributeReadPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogAttributeReadService(
            emFactory,
            lazyPort<CatalogCradle['customFieldDefinitionService']>(
              ctx,
              'customFieldDefinitionService',
            ),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'catalogQueryPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogQueryService(
            emFactory,
            undefined,
            undefined,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
            lazyPort<ListingPricePort>(ctx, 'pricingService'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'catalogAdminService',
    ctx
      .asFunction(
        ({ emFactory, eventBus, auditLogService, commandBus }: CatalogCradle) =>
          new CatalogAdminService(
            emFactory,
            eventBus as unknown as CatalogEventBus,
            auditLogService,
            lazyPort<SalesChannelMembershipService>(ctx, 'salesChannelMembershipPort'),
            commandBus,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
            // The apply seam, not the definition source — `CatalogAdminService`
            // takes `CatalogCustomFieldsPort`, and both roots passed
            // `customFieldDefinitionService` for both arguments because the one
            // service satisfies both shapes.
            lazyPort<NonNullable<CatalogModuleOptions['customFieldsPort']>>(
              ctx,
              'customFieldDefinitionService',
            ),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'categoryAdminService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new CategoryAdminService(
            emFactory,
            lazyPort<SalesChannelMembershipService>(ctx, 'salesChannelMembershipPort'),
            commandBus,
            lazyPort<CatalogCradle['customFieldValueService']>(ctx, 'customFieldValueService'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogAttributeSetPort>(
    'attributeSetService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new AttributeSetService(
            emFactory,
            commandBus,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogGalleryPort>(
    'galleryService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new GalleryService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogAttachmentPort>(
    'attachmentService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new AttachmentService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogProductLinkPort>(
    'productLinkService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new ProductLinkService(
            emFactory,
            commandBus,
            lazyPort<ListingPricePort>(ctx, 'pricingService'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogGroupedPort>(
    'groupedService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new GroupedService(emFactory, commandBus),
      )
      .singleton(),
  );

  /**
   * FR-030 — the four edges that block deleting an asset this module points at
   * (T143a): a gallery item, a product attachment, a virtual download and a
   * category's main image.
   *
   * Both roots pushed these descriptors into `assets_library`' registry, so the
   * "in use by" answer an operator got was assembled from whichever modules the
   * *root* had been taught about — and `catalog` being switched off did not
   * remove its four edges, because a root's registration passes through no
   * lifecycle seam.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read*, once per
   * delete, by the module that owns it. Boot hooks run after every module has
   * registered and before any request is served, so the edges are in place from
   * the first delete on.
   */
  ctx.onBoot(() => {
    const { assetReferenceRegistry, emFactory } = cradle();
    registerCatalogAssetReferences(assetReferenceRegistry, emFactory);
  });

  /**
   * The assistant tools this module contributes, and the bulk-progress reader
   * that goes with them (D-44; D-72 point 4 for the second half).
   *
   * Both roots built these from `catalog`'s own services and pushed them into
   * `prompt_actions`' registry, because pushing from here would have made
   * `prompt_actions` a declared dependency — and that declaration is what would
   * have made an optional assistant undeactivatable for as long as `catalog` is
   * present. `nonBindingDependencies` is the declaration without that claim, so
   * the contribution moves to the module whose services it is built from.
   *
   * The progress reader was the one of the five D-44 could not move, and not
   * for a presence reason: `promptActionsBulkProgressResolver` was a single
   * name `prompt_actions` defaulted, and a module may not write a name another
   * module owns. Now that the host keeps a table instead, it pushes from here
   * like everything else, and neither composition root names
   * `catalog/prompt-tools.js`.
   *
   * A push, not a pull: nothing is read back out of either registry here. Both
   * are plain `ctx.di.register`, so the resolution cannot ask a gate, and both
   * drop an entry whose recorded owner is not effectively present — so a
   * switched-off `catalog` contributes tools nobody can see and progress
   * nobody folds in, and a switched-off `prompt_actions` holds two tables
   * nobody walks.
   */
  ctx.onBoot(() => {
    // `redis`, not `moduleQueueRedis`: this is the connection both roots handed
    // these tools, and the harness deliberately registers the first while
    // withholding the second. Switching to the queue-shaped name here would
    // quietly stop the > 50-selection delegation in every test that exercises
    // it, which is a behaviour change this move has no business making.
    const deps: CatalogPromptToolsDeps = {
      emFactory: cradle().emFactory,
      events: cradle().eventBus,
      auditLogService: cradle().auditLogService,
      salesChannelMembership: cradle().salesChannelMembershipPort,
      redis: cradle().redis,
    };
    const registry = cradle().promptActionToolRegistry;
    for (const tool of [
      ...catalogPromptResolverTools(deps),
      ...catalogPromptMutationTools(deps),
    ]) {
      registry.register(tool);
    }
    cradle().promptActionBulkProgressRegistry.register('catalog', catalogBulkProgressReader(deps));
  });

  /**
   * Feature 068's cache flush (issue #107).
   *
   * It was a bare `eventBus.on` in the plugin body, so a switched-off `catalog`
   * still posted revalidation requests at the storefront on every category
   * write. `ctx.subscribe` stops it with the module — and the storefront's own
   * category surface is gone at that point anyway.
   */
  ctx.subscribe('category.updated.v1', () => {
    void cradle().catalogCategoryRevalidator.revalidate(['catalog:categories']);
  });

  ctx.routes(async (app) => {
    await cradle().catalog(app);
  });
}
