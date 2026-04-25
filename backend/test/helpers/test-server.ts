import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { SessionService } from '../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../src/modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from '../../src/modules/admin_roles/services/permission-service.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { quoteRequestsModule } from '../../src/modules/quote_requests/plugin.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { commerceModule } from '../../src/modules/orders/plugin.js';
import { adminModule } from '../../src/modules/admin_users/plugin.js';
import { inventoryModule } from '../../src/modules/inventory/plugin.js';
import { creditLimitsModule } from '../../src/modules/credit_limits/plugin.js';
import { integrationsModule } from '../../src/modules/api_keys/plugin.js';
import { analyticsModule } from '../../src/modules/analytics/plugin.js';
import { importExportModule } from '../../src/modules/import_export/plugin.js';
import type { CartService } from '../../src/modules/carts/services/cart-service.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations } from './seed-organizations.js';
import { seedUs2Commerce } from './seed-commerce.js';
import { seedTestAdmins } from './seed-admins.js';
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
  auditLogService: AuditLogService;
  permissionService: PermissionService;
}

const SEEDED_TABLES = [
  'analytics_events',
  'audit_log_entries',
  'invoices',
  'payments',
  'order_items',
  'orders',
  'cart_items',
  'carts',
  'stock_levels',
  'payment_methods',
  'delivery_methods',
  'organization_invitations',
  'email_verification_tokens',
  'addresses',
  'customer_accounts',
  'admin_users',
  'admin_roles',
  'webhook_deliveries',
  'webhooks',
  'external_integrations',
  'api_keys',
  'credit_limit_reservations',
  'credit_limits',
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
  const auditLogService = new AuditLogService(em);
  const permissionService = new PermissionService(em);

  const conn = orm.em.getConnection();
  await conn.execute(`truncate table ${SEEDED_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);

  if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
    await seedUs1Catalog(em());
  }
  await seedTestOrganizations(em());
  await seedUs2Commerce(em());
  await seedTestAdmins(em());

  const eventBus = new EventBus();

  // CartService is exposed by the commerce module so the login handler in
  // organizations can merge anonymous baskets after sign-in.
  let cartService: CartService | null = null;

  // Build the admin module first so we can hand its handle (auditLogService,
  // permissionService) to other modules that need it.
  const admin = adminModule({
    emFactory: em,
    sessionService,
    auditLogService,
    permissionService,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Credit-limits module — its CreditLimitService is the driver passed into
  // commerceModule below so OrderService.placeOrder can reserve atomically.
  const creditLimits = creditLimitsModule({
    emFactory: em,
    eventBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    resolveCustomerContext: customerResolver,
  });

  // US7 — API keys, webhooks, external integrations. The handle exposes
  // requireApiKey, threaded into the catalog module's by-sku route so that
  // surface gets real bearer-token gating.
  const integrations = integrationsModule({
    emFactory: em,
    auditLogService,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Analytics (Phase 10 / T237). No GA4 forwarder in tests — the env vars
  // are unset by default so `buildForwarderFromEnv` returns a NoopForwarder.
  const analytics = analyticsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Import/Export (Phase 10 / T240).
  const importExport = importExportModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });

  const modules: ModulePlugin[] = [
    async (app) => registerTestAuth(app, { sessionService, emFactory: em }),
    admin.plugin,
    creditLimits.plugin,
    integrations.plugin,
    analytics.plugin,
    importExport.plugin,
    commerceModule({
      emFactory: em,
      eventBus,
      auditLogService,
      creditLimit: creditLimits.handle.creditLimitService,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
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
      requireAdmin: requireTestAdmin(permissionService),
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
      requireAdmin: requireTestAdmin(permissionService),
      auditLogService,
      requireApiKey: integrations.handle.requireApiKey,
      resolveAdminAuditContext: (request) => {
        if (request.testActor?.kind !== 'admin') {
          return { actorAdminUserId: TEST_ADMIN_ID };
        }
        return { actorAdminUserId: request.testActor.adminUserId };
      },
    }),
    quoteRequestsModule({
      emFactory: em,
      eventBus,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
      resolveCustomerContext: customerResolver,
      resolveAdminContext: (request) => {
        if (request.testActor?.kind !== 'admin') {
          return { adminUserId: TEST_ADMIN_ID };
        }
        return { adminUserId: request.testActor.adminUserId };
      },
    }),
    inventoryModule({
      emFactory: em,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: customerResolver,
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

  return {
    app,
    orm,
    em,
    eventBus,
    redis,
    sessionService,
    auditLogService,
    permissionService,
  };
}

function customerResolver(request: FastifyRequest): {
  customerAccountId: string;
  organizationId: string;
  impersonatorAdminUserId?: string | null;
} {
  if (request.testActor?.kind !== 'customer') {
    return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  }
  return {
    customerAccountId: request.testActor.customerAccountId,
    organizationId: request.testActor.organizationId,
    impersonatorAdminUserId: request.testActor.impersonatorAdminUserId,
  };
}

export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {
  await h.app.close();
  h.redis.disconnect();
  await closeOrm();
}
