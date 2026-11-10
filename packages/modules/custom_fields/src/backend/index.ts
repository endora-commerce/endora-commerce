import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type {
  AdminI18nTranslatePort,
  CustomFieldCarryPort,
  CustomFieldDefinitionReadPort,
  CustomFieldListFilterPort,
  CustomFieldValuePort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { StorefrontRevalidator } from '@endora-commerce/platform/http';
import { CustomFieldDefinitionsCache } from './services/custom-field-definitions-cache.js';
import { CustomFieldDefinitionService } from './services/custom-field-definition.service.js';
import { CustomFieldValueService } from './services/custom-field-value.service.js';
import { CustomFieldDefinitionReadService } from './services/custom-field-read-port.js';
import { CustomFieldListFilterService } from './services/custom-field-list-filter.service.js';
import { CustomFieldCarryService } from './services/custom-field-carry.service.js';
import { registerCustomFieldsAdminRoutes } from './routes.admin.js';
import { registerCustomFieldsPublicRoutes } from './routes.public.js';
import { inputSurfaceRevalidation } from './services/input-surface-revalidation.js';
import { CustomFieldDefinition } from './entities/custom-field-definition.entity.js';
import { CustomFieldOption } from './entities/custom-field-option.entity.js';

/**
 * `custom_fields` — the module that cannot be switched off (feature 072, wave 1,
 * T087).
 *
 * Mechanically this is one of the plainer conversions: one factory call per
 * root, one admin route file, three services with a cycle between two of them.
 * What it forced was a decision the wave had so far been able to defer.
 *
 * **Why the activation control is `nonDeactivatable`.** Every other converted
 * module got a Setting an operator can flip. This one gets a locked control and
 * a reason, because the alternative is a switch that half-works. Custom-field
 * *values* live in the host's own JSONB column — `orders.custom_field_values`,
 * `products.attribute_values` — so switching the module off does not hide the
 * data; it removes the definitions that give the data meaning. `validateAndMerge`
 * with no definitions silently ignores every incoming key and `project` returns
 * an empty bag, so a host write would drop the operator's custom fields and a
 * host read would stop showing them, with a 200 either way. `catalog`,
 * `product_feeds` and `pim_ergonode` already declare this module a hard
 * dependency for exactly that reason; `catalog`'s manifest says outright that
 * it "must not hard-uninstall it under a live catalog". Declaring the reality
 * beats shipping a control whose off position corrupts.
 *
 * **The cache is the module's spine, and there is one.** `getForEntity` caches
 * per entity type for 5 s, invalidated across processes on a Redis channel. The
 * admin service publishes an invalidation after every definition write, and the
 * value service reads through the same instance — which is what makes a write
 * visible to the next validation instead of up to five seconds later. The two
 * registrations below therefore resolve one `CustomFieldDefinitionService`, and
 * `customFieldValueService` is built *from* it rather than beside it.
 *
 * **The hard-uninstall cleanup stays in `manifest.ts`.** That is the only place
 * the lifecycle orchestrator looks: it reads `uninstallHook` off the registry
 * entry the composer generates into the manifest index. There is no
 * container-side equivalent — `ctx.onInstall`/`ctx.onUninstall` existed, were
 * never run by anything, and were deleted by D-46 precisely because a hook
 * placed there would compile, pass every test, and quietly stop dropping
 * definitions on a hard uninstall.
 */

export interface CustomFieldsCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly redis: Redis;
  /** The shared subscriber connection; see the note on `onBoot` below. */
  readonly redisSubscriber: Redis;
  readonly customFieldDefinitionsCache: CustomFieldDefinitionsCache;
  readonly customFieldsStorefrontRevalidator: StorefrontRevalidator;
  readonly customFieldServices: CustomFieldServices;
  readonly customFieldDefinitionService: CustomFieldDefinitionService;
  readonly customFieldValueService: CustomFieldValueService;
}

interface CustomFieldServices {
  readonly definitionService: CustomFieldDefinitionService;
  readonly valueService: CustomFieldValueService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Internal: the definition and value services are the module's public
    // surface, and the cache is how they agree. Nothing outside resolves it.
    customFieldDefinitionsCache: ctx
      .asFunction(({ redis }: CustomFieldsCradle) => new CustomFieldDefinitionsCache(redis))
      .singleton(),

    // Internal (feature 175): drops the storefront's cached copy of an input
    // surface's open fields after a definition change (research R-7). Read
    // from the environment when first resolved, as a deployment's process
    // does; a no-op where `STOREFRONT_BASE_URL` / `REVALIDATE_SECRET` are unset
    // (the feature-173 registration-options shape).
    customFieldsStorefrontRevalidator: ctx
      .asFunction(
        () =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }),
      )
      .singleton(),

    // The two services are **one registration** because they are one object
    // graph: the definition service holds the value service to run its
    // change-guards, and the value service reads definitions back through it.
    // Registering them separately means the guard's value service and the one
    // hosts validate against are different instances — harmless today, since
    // the value service is a stateless wrapper, and exactly the divergence that
    // stops being harmless the first time one of them gains state.
    customFieldServices: ctx
      .asFunction(
        ({
          emFactory,
          customFieldDefinitionsCache,
          commandBus,
          customFieldsStorefrontRevalidator,
        }: CustomFieldsCradle): CustomFieldServices => {
          const definitionService = new CustomFieldDefinitionService(
            emFactory,
            customFieldDefinitionsCache,
            commandBus,
            inputSurfaceRevalidation(customFieldsStorefrontRevalidator),
          );
          // Feature 175 — a buyer's refusals are worded in this module's own
          // bundle, in the request's language (`specs/conventions/module-i18n.md`,
          // case 1). Resolved per call, so the gate stays live; a key the
          // bundle lacks comes back as `custom_fields.<key>` and reads as a miss.
          const valueService = new CustomFieldValueService(definitionService, async (key, language) => {
            const sentence = await lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService').translate(
              'custom_fields',
              key,
              language,
            );
            return sentence === `custom_fields.${key}` ? null : sentence;
          });
          definitionService.setValueService(valueService);
          return { definitionService, valueService };
        },
      )
      .singleton(),
  });

  /**
   * The module's own CRUD surface — its admin routes resolve it, and `catalog`
   * reaches it for one thing only: the transactional apply seam
   * (`CustomFieldDefinitionApplyApi`, declared in this module's `ports/`
   * directory), whose every `apply*` method takes the caller's `EntityManager`
   * so that a product attribute and its definition are written under one
   * transaction. D-77 ruled that seam permanent and FR-034 keeps a MikroORM
   * type out of `@endora-commerce/contracts`, so it is the one name this module publishes
   * no contract for; it is ledgered as such in
   * `RESOLUTIONS_OF_UNPUBLISHED_NAMES`. Every definition **read** goes through
   * `customFieldDefinitionReadPort` below — the per-entity lists since issue
   * #209, and the single definition by id since feature 080's T053(b).
   */
  ctx.di.providePort(
    'customFieldDefinitionService',
    ctx
      .asFunction(({ customFieldServices }: CustomFieldsCradle) => customFieldServices.definitionService)
      .singleton(),
  );

  ctx.di.providePort<CustomFieldValuePort>(
    'customFieldValueService',
    ctx
      .asFunction(({ customFieldServices }: CustomFieldsCradle) => customFieldServices.valueService)
      .singleton(),
  );

  /**
   * Feature 075, Phase P — the definition read model, without the two ORM
   * entities `CachedDefinition` carries.
   *
   * `customFieldDefinitionService` above stays for the reason its own note
   * gives. This is the read seven modules actually make — `catalog`'s composed
   * attribute read model most of all, because since feature 061 the definition
   * half of a product attribute *is* a custom-field definition, and since issue
   * #209 that read names this port rather than the CRUD registration.
   */
  ctx.di.providePort<CustomFieldDefinitionReadPort>(
    'customFieldDefinitionReadPort',
    ctx
      .asFunction(
        ({ customFieldServices }: CustomFieldsCradle) =>
          new CustomFieldDefinitionReadService(customFieldServices.definitionService),
      )
      .singleton(),
  );

  /**
   * Feature 157 — the admin lists' custom-field filters: which fields a list
   * offers, and a request's filters as one bound condition over the entity's
   * host table (`specs/157-custom-fields-list-filters/contracts/list-filter-api.md`
   * §1.4). Reads through the same per-entity cache as every definition read.
   */
  ctx.di.providePort<CustomFieldListFilterPort>(
    'customFieldListFilterPort',
    ctx
      .asFunction(
        ({ customFieldServices }: CustomFieldsCradle) =>
          new CustomFieldListFilterService(customFieldServices.definitionService),
      )
      .singleton(),
  );

  /**
   * Feature 162 — which custom-field values carry from one record into another
   * of a type the definition names in `carryTo`
   * (`specs/162-custom-fields-value-carry/contracts/carry-api.md` §4.1). It
   * computes and never writes: the module owning the target record persists
   * the answer in its own write. Reads through the same per-entity cache, so a
   * committed definition change reaches the next plan without waiting for the
   * TTL.
   */
  ctx.di.providePort<CustomFieldCarryPort>(
    'customFieldCarryPort',
    ctx
      .asFunction(
        ({ customFieldServices }: CustomFieldsCradle) =>
          new CustomFieldCarryService(customFieldServices.definitionService),
      )
      .singleton(),
  );

  ctx.onBoot(async () => {
    // The subscriber is one connection shared by the whole composition —
    // ioredis puts a connection in subscriber mode, so a per-module one would
    // cost a socket per module for no benefit. `start` is idempotent and only
    // adds a listener for this module's channel.
    const { customFieldDefinitionsCache, redisSubscriber } = ctx.cradle<CustomFieldsCradle>();
    await customFieldDefinitionsCache.start(redisSubscriber);
  });

  ctx.routes(async (app) => {
    const { customFieldDefinitionService, requireAdmin } = ctx.cradle<CustomFieldsCradle>();
    await registerCustomFieldsAdminRoutes(app, {
      definitionService: customFieldDefinitionService,
      requireAdmin,
    });
  });

  /**
   * Feature 175 — the anonymous read of the fields open on a buyer input
   * surface (`GET /api/v1/custom-fields/input-surfaces/:surface`), answered
   * from the same per-entity cache every definition read rides.
   */
  ctx.routes(async (app) => {
    const { customFieldDefinitionService, customFieldsStorefrontRevalidator } = ctx.cradle<CustomFieldsCradle>();
    customFieldsStorefrontRevalidator.setLogger(app.log);
    await registerCustomFieldsPublicRoutes(app, { definitions: customFieldDefinitionService });
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
  CustomFieldDefinition,
  CustomFieldOption,
];
