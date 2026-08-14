import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { catalogModule, type CatalogModuleOptions } from './plugin.js';
import { CatalogAdminService } from './services/catalog-admin.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import { AttributeSetService } from './services/attribute-set.service.js';
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { CatalogAttributeReadService } from './services/catalog-attribute-read.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import type { CatalogEventBus } from './services/catalog-admin.service.js';
import { registerCatalogAssetReferences } from './services/asset-references.js';
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
  readonly adminNotificationService: NonNullable<CatalogModuleOptions['adminNotificationService']>;
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
  readonly catalogAttributeReadPort: CatalogAttributeReadService;
  readonly catalogQueryPort: CatalogQueryService;
  readonly catalogAdminService: CatalogAdminService;
  readonly categoryAdminService: CategoryAdminService;
  readonly attributeSetService: AttributeSetService;
  readonly galleryService: GalleryService;
  readonly attachmentService: AttachmentService;
  readonly productLinkService: ProductLinkService;
  readonly groupedService: GroupedService;
  readonly catalog: ReturnType<typeof catalogModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): CatalogCradle => ctx.cradle<CatalogCradle>();

  ctx.di.register({
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
            adminNotificationService: lazyPort<CatalogCradle['adminNotificationService']>(
              ctx,
              'adminNotificationService',
            ),
            mailer: lazyPort<CatalogCradle['emailMailer']>(ctx, 'emailMailer'),
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireApiKey: (...args: Parameters<CatalogCradle['requireApiKey']>) =>
              cradle().requireApiKey(...args),
            requireBoundApiKey: (...args: Parameters<CatalogCradle['requireBoundApiKey']>) =>
              cradle().requireBoundApiKey(...args),
            resolveAdminAuditContext: (req: FastifyRequest) =>
              cradle().catalogAdminAuditContext(req),
            resolveExternalAvailability: (productIds, salesChannelId) =>
              cradle().catalogExternalAvailability(productIds, salesChannelId),
            resolveProductImagePlaceholderUrl: (salesChannelCode) =>
              cradle().catalogImagePlaceholderUrl(salesChannelCode),
            reindexSearchIndexes: () => cradle().catalogSearchReindex(),
          }),
      )
      .singleton(),
  });

  // The nine ports. Seven of them were a second instance each root built for
  // `pim_ergonode`; the last two are the `CatalogQueryService` and attribute
  // read model that issue #44 recorded.
  ctx.di.providePort(
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

  ctx.di.providePort(
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

  ctx.di.providePort(
    'galleryService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new GalleryService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'attachmentService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new AttachmentService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'productLinkService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new ProductLinkService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort(
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

  ctx.routes(async (app) => {
    await cradle().catalog(app);
  });
}
