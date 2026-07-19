import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { CommandBus } from '../../commands/index.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import { CustomFieldDefinitionsCache } from './services/custom-field-definitions-cache.js';
import { CustomFieldDefinitionService } from './services/custom-field-definition.service.js';
import { CustomFieldValueService } from './services/custom-field-value.service.js';
import { registerCustomFieldsAdminRoutes } from './routes.admin.js';

export interface CustomFieldsModuleOptions {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  requireAdmin: RequireAdminFactory;
  /** Publisher used to fan definition changes across processes. Optional in tests. */
  redis?: Redis;
}

export interface CustomFieldsModuleHandle {
  definitionService: CustomFieldDefinitionService;
  /** Host modules call this to validate + read custom-field values (Principle XIV). */
  valueService: CustomFieldValueService;
  cache: CustomFieldDefinitionsCache;
}

/**
 * Custom Fields module (feature 055). Exposes the definition/value services as a
 * handle host modules consume, and registers the admin definition/option API.
 */
export function customFieldsModule(options: CustomFieldsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: CustomFieldsModuleHandle;
} {
  const cache = new CustomFieldDefinitionsCache(options.redis);
  const definitionService = new CustomFieldDefinitionService(
    options.emFactory,
    cache,
    options.commandBus,
  );
  const valueService = new CustomFieldValueService(definitionService);
  // Break the definition⇄value cycle used by definition-change guards.
  definitionService.setValueService(valueService);

  return {
    handle: { definitionService, valueService, cache },
    plugin: async (app) => {
      await registerCustomFieldsAdminRoutes(app, {
        definitionService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
