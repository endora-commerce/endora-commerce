import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AnalyticsIngestService } from './services/analytics-ingest.service.js';
import { AnalyticsQueryService } from './services/analytics-query.service.js';
import {
  buildForwarderFromEnv,
  type AnalyticsForwarder,
} from './services/ga4-forwarder.js';
import { registerAnalyticsRoutes } from './routes.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface AnalyticsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Override for tests; defaults to the env-driven build. */
  forwarder?: AnalyticsForwarder;
  /** Override for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface AnalyticsModuleHandle {
  ingestService: AnalyticsIngestService;
  queryService: AnalyticsQueryService;
  forwarder: AnalyticsForwarder;
}

export function analyticsModule(options: AnalyticsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: AnalyticsModuleHandle;
} {
  const forwarder =
    options.forwarder ?? buildForwarderFromEnv(options.env ?? process.env);
  const ingestService = new AnalyticsIngestService(options.emFactory, forwarder);
  const queryService = new AnalyticsQueryService(options.emFactory);

  return {
    handle: { ingestService, queryService, forwarder },
    plugin: async (app: FastifyInstance) => {
      await registerAnalyticsRoutes(app, {
        ingestService,
        queryService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
