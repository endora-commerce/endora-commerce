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
import { registerErrorEnvelope } from '@endora-commerce/platform/composition';
import {
  type ModuleLifecycleOrchestrator,
  registerLifecycleAdminRoutes,
} from '@endora-commerce/platform/lifecycle';

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
  translate?: (moduleId: string, key: string, language: 'en' | 'pl') => Promise<string>;
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // The reader's language, as the admin ladder would answer it: here, the header's first tag.
  registerErrorEnvelope(app, {
    resolvePreferredLanguage: async (request) =>
      String(request.headers['accept-language'] ?? '').startsWith('pl') ? 'pl' : 'en',
  });

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
    ...(opts.translate ? { translate: opts.translate } : {}),
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

/**
 * Issue #1809 — the module list in the reader's language: each module's name,
 * description and lock reason from its own bundle, the manifest's English when
 * the bundle has none, and the id beside them unchanged.
 */
describe('GET /api/v1/admin/modules — in the reader’s language (issue #1809)', () => {
  const PL: Record<string, string> = {
    'auth.module.name': 'Uwierzytelnianie',
    'auth.module.description': 'Podstawy uwierzytelniania.',
    'auth.module.nonDeactivatableReason': 'Rozpoznaje aktora każdego żądania.',
  };
  const rows: ModuleListItem[] = [
    {
      ...sampleModules[0]!,
      description: 'Authentication primitives.',
      nonDeactivatableReason: 'Resolves the actor for every request.',
    },
    sampleModules[1]!,
  ];

  async function list(acceptLanguage: string): Promise<ModuleListItem[]> {
    const app = await buildTestApp({
      orchestrator: buildOrchestratorStub(rows),
      authorize: true,
      translate: async (moduleId, key, language) =>
        (language === 'pl' ? PL[`${moduleId}.${key}`] : undefined) ?? `${moduleId}.${key}`,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/modules',
      headers: { 'accept-language': acceptLanguage },
    });
    expect(res.statusCode).toBe(200);
    return ModuleListResponseSchema.parse(res.json()).modules;
  }

  it('names, describes and explains a module in Polish for a Polish reader', async () => {
    const [auth, blog] = await list('pl-PL');
    expect(auth).toMatchObject({
      id: 'auth',
      name: 'Uwierzytelnianie',
      description: 'Podstawy uwierzytelniania.',
      nonDeactivatableReason: 'Rozpoznaje aktora każdego żądania.',
    });
    // No Polish entry: the manifest's English.
    expect(blog?.name).toBe('Blog');
  });

  it('answers the manifest English for an English reader', async () => {
    const [auth] = await list('en-US');
    expect(auth).toMatchObject({ name: 'Auth', nonDeactivatableReason: 'Resolves the actor for every request.' });
  });
});
