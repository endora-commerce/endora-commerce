import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { CustomFieldDefinitionReadPort, CustomFieldValuePort } from '@b2b/contracts';
import type { CommandBus } from '../../commands/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { CustomFieldDefinitionsCache } from './services/custom-field-definitions-cache.js';
import { CustomFieldDefinitionService } from './services/custom-field-definition.service.js';
import { CustomFieldValueService } from './services/custom-field-value.service.js';
import { CustomFieldDefinitionReadService } from './services/custom-field-read-port.js';
import { registerCustomFieldsAdminRoutes } from './routes.admin.js';

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
        }: CustomFieldsCradle): CustomFieldServices => {
          const definitionService = new CustomFieldDefinitionService(
            emFactory,
            customFieldDefinitionsCache,
            commandBus,
          );
          const valueService = new CustomFieldValueService(definitionService);
          definitionService.setValueService(valueService);
          return { definitionService, valueService };
        },
      )
      .singleton(),
  });

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
   * `customFieldDefinitionService` above stays: it is the module's own CRUD
   * surface and its admin routes use it. This is the read seven modules
   * actually make — `catalog`'s composed attribute read model most of all,
   * because since feature 061 the definition half of a product attribute *is*
   * a custom-field definition.
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
}
