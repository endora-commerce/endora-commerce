import type { FastifyInstance } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { seedUs1Catalog } from './seed-catalog.js';

/**
 * Boots an in-process Fastify instance for contract tests.
 * Rate limiting is disabled so tests are not flaky; session cookie secret is stable.
 *
 * Usage — HTTP-only (no DB):
 *   const app = await setupTestServer();
 *   const res = await app.inject({ method: 'GET', url: '/api/v1/_health' });
 *   afterAll(() => app.close());
 *
 * Usage — with the DB-backed catalog module + seed:
 *   const { app, orm } = await setupBackendServer({ seed: 'us1-catalog' });
 *   ...
 *   afterAll(async () => { await app.close(); await orm.close(true); });
 */

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
  /** Which seed pack to apply after truncating business tables. */
  seed?: 'us1-catalog' | 'none';
  /** Additional module plugins — e.g. quote_requests wiring in Phase 3.5. */
  extraModules?: ModulePlugin[];
}

export interface BackendServerHandle {
  app: FastifyInstance;
  orm: MikroORM;
  em: () => EntityManager;
  eventBus: EventBus;
}

// Tables whose rows are cleared before seeding. Kept narrow — sessions and
// audit_log_entries are not cleared so any concurrent auth tests keep their
// data. Extend as new modules land.
const SEEDED_TABLES = [
  'sales_channel_products',
  'product_assets',
  'product_categories',
  'availability_notifications',
  'product_variants',
  'product_attributes',
  'products',
  'categories',
  'sales_channels',
  'assets',
];

export async function setupBackendServer(
  options: BackendServerOptions = {},
): Promise<BackendServerHandle> {
  const orm = await initOrm();
  const em = (): EntityManager => orm.em.fork() as EntityManager;

  // Truncate business tables so every suite starts clean.
  const conn = orm.em.getConnection();
  await conn.execute(`truncate table ${SEEDED_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);

  if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
    await seedUs1Catalog(em());
  }

  const eventBus = new EventBus();
  const modules: ModulePlugin[] = [catalogModule({ emFactory: em, eventBus })];
  if (options.extraModules) modules.push(...options.extraModules);

  const app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: {
      title: 'B2B Platform API (test)',
      version: 'test',
      serverUrl: 'http://localhost',
    },
    disableRateLimit: true,
    modules,
  });
  await app.ready();

  return { app, orm, em, eventBus };
}

export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {
  await h.app.close();
  await closeOrm();
}
