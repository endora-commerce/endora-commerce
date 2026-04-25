import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CmsPageService } from './services/cms-page-service.js';
import { registerCmsRoutes } from './routes.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface CmsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export interface CmsModuleHandle {
  service: CmsPageService;
}

export function cmsPagesModule(options: CmsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: CmsModuleHandle;
} {
  const service = new CmsPageService(options.emFactory);
  return {
    handle: { service },
    plugin: async (app: FastifyInstance) => {
      await registerCmsRoutes(app, {
        service,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
