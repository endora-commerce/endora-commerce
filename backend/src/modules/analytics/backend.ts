import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { registerAnalyticsRoutes } from './routes.js';
import { AnalyticsIngestService } from './services/analytics-ingest.service.js';
import { AnalyticsQueryService } from './services/analytics-query.service.js';
import { buildForwarderFromEnv, type AnalyticsForwarder } from './services/ga4-forwarder.js';

/**
 * `analytics` — the first wave-1 module whose conversion is only a conversion
 * (feature 072, wave 1).
 *
 * No defect fell out of it and no other module had to move, which is worth
 * noting because the two before it both spilled: `auth` pulled `admin_roles`
 * in, and `currencies` pulled `dictionaries` and `languages`. This one owns its
 * routes, owns its services, and nothing outside reads its handle — the shape
 * the remaining sweep is hoping for.
 *
 * The GA4 forwarder is registered rather than defaulted inside the factory, so
 * a test overrides it by re-registering the name instead of by passing an
 * option through a factory it does not otherwise care about.
 */

export interface AnalyticsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly analyticsForwarder: AnalyticsForwarder;
  readonly analyticsIngestService: AnalyticsIngestService;
  readonly analyticsQueryService: AnalyticsQueryService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    analyticsForwarder: ctx.asFunction(() => buildForwarderFromEnv(process.env)).singleton(),

    analyticsIngestService: ctx
      .asFunction(
        ({ emFactory, analyticsForwarder }: AnalyticsCradle) =>
          new AnalyticsIngestService(emFactory, analyticsForwarder),
      )
      .singleton(),

    analyticsQueryService: ctx
      .asFunction(({ emFactory }: AnalyticsCradle) => new AnalyticsQueryService(emFactory))
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { analyticsIngestService, analyticsQueryService, requireAdmin } =
      ctx.cradle<AnalyticsCradle>();
    await registerAnalyticsRoutes(app, {
      ingestService: analyticsIngestService,
      queryService: analyticsQueryService,
      requireAdmin,
    });
  });
}
