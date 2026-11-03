import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSeoRoutes, type SeoRoutesDeps } from './routes.js';

/**
 * Feature 163, checkpoint F (S-5) — `seo_meta_overrides.entity_id` is a `uuid` column,
 * so a malformed `:entityId` handed to PostgreSQL fails as a 500. A value that is not a
 * UUID names no entity: the three meta editor routes answer `404 NOT_FOUND` before the
 * resolver is asked anything.
 */
const metaResolver = {
  readScoped: vi.fn(async () => ({})),
  resolveWithSources: vi.fn(async () => ({ resolved: {}, sources: {} })),
  getOverride: vi.fn(async () => null),
  upsertOverride: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000009' })),
  deleteOverride: vi.fn(async () => undefined),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  // Route bodies are Zod schemas the handlers parse themselves; the host's Zod
  // compiler is not needed for these cases.
  app.setValidatorCompiler(() => (data) => ({ value: data }));
  // The envelope's essentials: an HttpError's status and code (the host's full
  // envelope is not on a module-facing subpath).
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({ error: { code: err.code ?? 'INTERNAL', message: err.message } });
  });
  await registerSeoRoutes(app, {
    metaResolver,
    sitemap: {},
    crawlerFilePreview: { preview: vi.fn() },
    requireAdmin: () => async () => undefined,
    settings: {},
  } as unknown as SeoRoutesDeps);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

const URL = '/api/v1/admin/seo/meta/product';

describe('SEO meta editor — a malformed entity id (163 S-5)', () => {
  it.each([
    ['GET', `${URL}/not-a-uuid`, undefined],
    ['PUT', `${URL}/not-a-uuid`, { title: 'x' }],
    ['DELETE', `${URL}/12345`, undefined],
  ] as const)('%s answers 404 NOT_FOUND and asks the resolver nothing', async (method, url, payload) => {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(metaResolver.resolveWithSources).not.toHaveBeenCalled();
    expect(metaResolver.getOverride).not.toHaveBeenCalled();
    expect(metaResolver.upsertOverride).not.toHaveBeenCalled();
    expect(metaResolver.deleteOverride).not.toHaveBeenCalled();
  });

  it('a well-formed id still reaches the resolver', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/admin/seo/meta/category/00000000-0000-4000-8000-000000000001` });
    expect(res.statusCode, res.body).toBe(200);
    expect(metaResolver.getOverride).toHaveBeenCalledTimes(1);
  });
});

/**
 * Feature 170 (T120, FR-093) — route order: the static product GET answers a product, never the
 * parametric route; a category still reaches the parametric one. The generic product writes are
 * refused before the resolver is asked anything.
 */
describe('SEO meta editor — the static product route (170)', () => {
  const ID = '00000000-0000-4000-8000-000000000001';

  it('answers GET …/product/:id from the static route', async () => {
    const res = await app.inject({ method: 'GET', url: `${URL}/${ID}?channelId=00000000-0000-4000-8000-000000000002` });
    expect(res.statusCode, res.body).toBe(200);
    expect(metaResolver.readScoped).toHaveBeenCalledWith(ID, { level: 'channel', channelId: '00000000-0000-4000-8000-000000000002' });
    expect(metaResolver.getOverride).not.toHaveBeenCalled();
  });

  it('refuses a language without a channel on the static route', async () => {
    const res = await app.inject({ method: 'GET', url: `${URL}/${ID}?languageCode=pl-PL` });
    expect(res.statusCode, res.body).toBe(422);
    expect(metaResolver.readScoped).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', { title: 'x' }],
    ['DELETE', undefined],
  ] as const)('refuses the generic product %s with 422 VALIDATION_FAILED', async (method, payload) => {
    const res = await app.inject({ method, url: `${URL}/${ID}`, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(metaResolver.upsertOverride).not.toHaveBeenCalled();
    expect(metaResolver.deleteOverride).not.toHaveBeenCalled();
  });
});
