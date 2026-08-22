import { describe, it, expect, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import {
  ModuleListResponseSchema,
  type ModuleListItem,
} from '@endora-commerce/contracts';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { registerLifecycleAdminRoutes } from '../../../src/modules/_lifecycle/routes.admin.js';
import type { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';

/**
 * Contract test for `GET /api/v1/admin/modules` (feature 018 / E-1).
 *
 * Isolates the route from the live ORM / Redis stack: a tiny Fastify
 * instance is built with the project's standard zod type provider and
 * error envelope, and the orchestrator is stubbed so the test
 * exercises only the route's behaviour (auth gate, query parsing,
 * filter application, response envelope shape).
 *
 * Live integration with the orchestrator's `status()` over a real DB
 * is covered by `test/integration/_lifecycle/status-mixed-states`.
 */

const sampleModules: ModuleListItem[] = [
  {
    id: 'auth',
    name: 'Auth',
    description: null,
    version: { registered: '1.0.0', onDisk: '1.0.0' },
    state: 'installed',
    dependencies: [],
    flags: [],
    license: null,
    installedAt: '2026-05-01T00:00:00.000Z',
    lastStateChangeAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'blog',
    name: 'Blog',
    description: null,
    version: { registered: '1.0.0', onDisk: '1.0.0' },
    state: 'disabled',
    dependencies: ['settings'],
    flags: [],
    license: null,
    installedAt: '2026-05-01T00:00:00.000Z',
    lastStateChangeAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'old_promotions',
    name: 'old_promotions',
    description: null,
    version: { registered: '1.0.0', onDisk: null },
    state: 'installed',
    dependencies: [],
    flags: ['orphan'],
    license: null,
    installedAt: '2026-05-01T00:00:00.000Z',
    lastStateChangeAt: '2026-05-01T00:00:00.000Z',
  },
];

function buildOrchestratorStub(
  rows: ModuleListItem[],
): ModuleLifecycleOrchestrator {
  return {
    status: async () => rows,
  } as unknown as ModuleLifecycleOrchestrator;
}

async function buildTestApp(opts: {
  orchestrator: ModuleLifecycleOrchestrator;
  authorize: boolean;
  permission?: string;
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorEnvelope(app);

  const requireAdmin = (perm?: string) => async (_req: unknown, reply: { code: (n: number) => unknown; send: (b: unknown) => unknown }) => {
    if (!opts.authorize) {
      reply.code(401);
      reply.send({
        error: { code: 'UNAUTHORIZED', message: 'Admin session required.' },
      });
      throw new Error('unauthorized');
    }
    if (opts.permission && perm !== opts.permission) {
      reply.code(403);
      reply.send({
        error: { code: 'FORBIDDEN', message: `Missing permission: ${perm}.` },
      });
      throw new Error('forbidden');
    }
  };

  await registerLifecycleAdminRoutes(app, {
    orchestrator: opts.orchestrator,
    requireAdmin: requireAdmin as never,
  });
  await app.ready();
  return app;
}

describe('GET /api/v1/admin/modules — admin HTTP contract (E-1)', () => {
  let allowedApp: FastifyInstance;
  let unauthorizedApp: FastifyInstance;

  beforeAll(async () => {
    const orch = buildOrchestratorStub(sampleModules);
    allowedApp = await buildTestApp({ orchestrator: orch, authorize: true });
    unauthorizedApp = await buildTestApp({ orchestrator: orch, authorize: false });
  });

  it('returns the validated response envelope for an admin caller', async () => {
    const res = await allowedApp.inject({
      method: 'GET',
      url: '/api/v1/admin/modules',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const parsed = ModuleListResponseSchema.parse(body);
    expect(parsed.modules).toHaveLength(3);
    expect(parsed.modules.map((m) => m.id).sort()).toEqual([
      'auth',
      'blog',
      'old_promotions',
    ]);
  });

  it('filters by ?state=installed (excludes disabled)', async () => {
    const res = await allowedApp.inject({
      method: 'GET',
      url: '/api/v1/admin/modules?state=installed',
    });
    expect(res.statusCode).toBe(200);
    const parsed = ModuleListResponseSchema.parse(res.json());
    expect(parsed.modules.every((m) => m.state === 'installed')).toBe(true);
    expect(parsed.modules.map((m) => m.id).sort()).toEqual(['auth', 'old_promotions']);
  });

  it('filters by ?flag=orphan', async () => {
    const res = await allowedApp.inject({
      method: 'GET',
      url: '/api/v1/admin/modules?flag=orphan',
    });
    expect(res.statusCode).toBe(200);
    const parsed = ModuleListResponseSchema.parse(res.json());
    expect(parsed.modules.map((m) => m.id)).toEqual(['old_promotions']);
  });

  it('returns 400 for an unknown ?state value', async () => {
    const res = await allowedApp.inject({
      method: 'GET',
      url: '/api/v1/admin/modules?state=bogus',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without admin session', async () => {
    const res = await unauthorizedApp.inject({
      method: 'GET',
      url: '/api/v1/admin/modules',
    });
    expect(res.statusCode).toBe(401);
  });
});
