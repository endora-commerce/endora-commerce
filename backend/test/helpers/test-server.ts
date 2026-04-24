import type { FastifyInstance } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { SessionService } from '../../src/modules/auth/services/session-service.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { quoteRequestsModule } from '../../src/modules/quote_requests/plugin.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations } from './seed-organizations.js';
import {
  registerTestAuth,
  requireTestAdmin,
  requireTestCustomer,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';

/**
 * Boots an in-process Fastify instance for contract tests.
 * Rate limiting is disabled; session cookie secret is stable.
 *
 * Usage — HTTP-only (no DB):
 *   const app = await setupTestServer();
 *   afterAll(() => app.close());
 *
 * Usage — full DB-backed server (catalog + quote_requests + organizations):
 *   const h = await setupBackendServer();
 *   afterAll(() => teardownBackendServer(h));
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
  seed?: 'us1-catalog' | 'none';
  extraModules?: ModulePlugin[];
}

export interface BackendServerHandle {
  app: FastifyInstance;
  orm: MikroORM;
  em: () => EntityManager;
  eventBus: EventBus;
  redis: Redis;
  sessionService: SessionService;
}

// Tables cleared by truncate before each suite. Order follows FK edges —
// dependent tables first.
const SEEDED_TABLES = [
  'email_verification_tokens',
  'addresses',
  'customer_accounts',
  'organizations',
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
  'quote_request_items',
  'quote_requests',
];

export async function setupBackendServer(
  options: BackendServerOptions = {},
): Promise<BackendServerHandle> {
  const orm = await initOrm();
  const em = (): EntityManager => orm.em.fork() as EntityManager;

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // Flush only the test keyspace — in practice we share db 0 with everything,
  // so we only clear session keys to stay polite to any other local process.
  const sessionKeys = await redis.keys('session:*');
  if (sessionKeys.length > 0) await redis.del(sessionKeys);

  const sessionService = new SessionService(em, redis);

  const conn = orm.em.getConnection();
  await conn.execute(`truncate table ${SEEDED_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);

  if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
    await seedUs1Catalog(em());
  }
  // Always seed the test organizations + customer accounts — they back the
  // stub-session cookies and the real login flow both relies on them.
  await seedTestOrganizations(em());

  const eventBus = new EventBus();

  const modules: ModulePlugin[] = [
    // Test auth hook MUST run before any module plugin's guards.
    async (app) => registerTestAuth(app, { sessionService, emFactory: em }),
    organizationsModule({
      emFactory: em,
      eventBus,
      sessionService,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: (request) => {
        if (request.testActor?.kind !== 'customer') {
          return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
        }
        return {
          customerAccountId: request.testActor.customerAccountId,
          organizationId: request.testActor.organizationId,
        };
      },
      exposeTestProbe: true,
    }),
    catalogModule({
      emFactory: em,
      eventBus,
      requireAdmin: requireTestAdmin(),
    }),
    quoteRequestsModule({
      emFactory: em,
      eventBus,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(),
      resolveCustomerContext: (request) => {
        if (request.testActor?.kind !== 'customer') {
          return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
        }
        return {
          customerAccountId: request.testActor.customerAccountId,
          organizationId: request.testActor.organizationId,
        };
      },
      resolveAdminContext: (request) => {
        if (request.testActor?.kind !== 'admin') {
          return { adminUserId: TEST_ADMIN_ID };
        }
        return { adminUserId: request.testActor.adminUserId };
      },
    }),
  ];
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

  return { app, orm, em, eventBus, redis, sessionService };
}

export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {
  await h.app.close();
  h.redis.disconnect();
  await closeOrm();
}
