import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { SessionService } from '../../src/modules/auth/services/session-service.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { quoteRequestsModule } from '../../src/modules/quote_requests/plugin.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { commerceModule } from '../../src/modules/orders/plugin.js';
import type { CartService } from '../../src/modules/carts/services/cart-service.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations } from './seed-organizations.js';
import { seedUs2Commerce } from './seed-commerce.js';
import {
  registerTestAuth,
  requireTestAdmin,
  requireTestCustomer,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';

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

// Table order matters — dependents first.
const SEEDED_TABLES = [
  'invoices',
  'payments',
  'order_items',
  'orders',
  'cart_items',
  'carts',
  'stock_levels',
  'payment_methods',
  'delivery_methods',
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
  const sessionKeys = await redis.keys('session:*');
  if (sessionKeys.length > 0) await redis.del(sessionKeys);

  const sessionService = new SessionService(em, redis);

  const conn = orm.em.getConnection();
  await conn.execute(`truncate table ${SEEDED_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);

  if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
    await seedUs1Catalog(em());
  }
  await seedTestOrganizations(em());
  await seedUs2Commerce(em());

  const eventBus = new EventBus();

  // The commerce module exposes its CartService via a side channel so the
  // organizations login handler can merge anonymous carts at sign-in time.
  let cartService: CartService | null = null;

  const modules: ModulePlugin[] = [
    async (app) => registerTestAuth(app, { sessionService, emFactory: em }),
    commerceModule({
      emFactory: em,
      eventBus,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(),
      resolveCustomerContext: customerResolver,
      resolveCartActor: (request) => {
        if (request.testActor?.kind === 'customer') {
          return {
            customer: {
              customerAccountId: request.testActor.customerAccountId,
              organizationId: request.testActor.organizationId,
            },
          };
        }
        const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
        const anon = cookies?.['b2b_cart_anon'];
        if (anon) return { anonymousToken: anon };
        return {};
      },
      exposeCartService: (cs) => {
        cartService = cs;
      },
    }),
    organizationsModule({
      emFactory: em,
      eventBus,
      sessionService,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: customerResolver,
      exposeTestProbe: true,
      onLogin: async (ctx) => {
        if (cartService && ctx.anonymousCartToken) {
          await cartService.mergeAnonymousIntoCustomer(ctx.anonymousCartToken, {
            customerAccountId: ctx.customerAccountId,
            organizationId: ctx.organizationId,
          });
        }
      },
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
      resolveCustomerContext: customerResolver,
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

function customerResolver(request: FastifyRequest): {
  customerAccountId: string;
  organizationId: string;
} {
  if (request.testActor?.kind !== 'customer') {
    return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  }
  return {
    customerAccountId: request.testActor.customerAccountId,
    organizationId: request.testActor.organizationId,
  };
}

export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {
  await h.app.close();
  h.redis.disconnect();
  await closeOrm();
}
