import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRequestScopeHook } from './request-scope-hook.js';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../tenancy/resolve-tenant-context.js';
import { customerFilterCond } from '../tenancy/filters.js';
import { withScopeNotice } from './request-scope-hook.js';
import { runWithTenantContext } from '../tenancy/tenant-context.js';

/**
 * The host discloses the refusal on the way out (feature 087, owner decision of
 * 2026-08-29).
 *
 * The first block enters where a browser does — a real Fastify lifecycle, the
 * real hook, a handler that runs the real filter — because the property under
 * test is precisely that the observation the filter writes during the handler
 * is still readable when the reply is serialised. A fixture that handed
 * `withScopeNotice` a pre-marked context would assert the merge and prove
 * nothing about the wire, and the wire is the part that can silently stop
 * working (`preSerialization` outside the store answers `undefined` and says
 * nothing about it).
 *
 * The second block is the decision function on its own, for the shapes a route
 * cannot conveniently produce.
 */

const scopedViewer = () =>
  resolveTenantContext(
    { kind: 'admin', adminUserId: 'rep-1' },
    { allowAll: false, allowedOrganizationIds: ['org-A'] },
  );

async function appFor(tenant: () => ReturnType<typeof scopedViewer>): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRequestScopeHook(app, { buildTenantContext: async () => tenant() });
  app.get('/refused', async () => {
    // Exactly what a listing over one of the fifteen column-less
    // `@CustomerScoped` classes runs, and then finds nothing.
    customerFilterCond('absent');
    return { data: [], meta: { limit: 50, nextCursor: null } };
  });
  app.get('/granted', async () => {
    customerFilterCond('present');
    return { data: [{ id: 'row-1' }], meta: { limit: 50, nextCursor: null } };
  });
  app.get('/csv', async (_req, reply) => {
    customerFilterCond('absent');
    reply.header('content-type', 'text/csv; charset=utf-8');
    return 'email\n';
  });
  app.get('/refused-but-broken', async (_req, reply) => {
    customerFilterCond('absent');
    reply.status(404);
    return { error: { code: 'NOT_FOUND', message: 'no' } };
  });
  await app.ready();
  return app;
}

describe('a scoped viewer is told why the list is empty', () => {
  it('puts the notice on the envelope of a listing the filter refused wholesale', async () => {
    const app = await appFor(scopedViewer);
    const res = await app.inject({ method: 'GET', url: '/refused' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      // The pagination `meta` the route already returns is kept; the notice
      // joins it rather than replacing it.
      meta: { limit: 50, nextCursor: null, scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING' },
    });
  });

  it('says nothing when the same viewer is shown rows', async () => {
    const app = await appFor(scopedViewer);
    const res = await app.inject({ method: 'GET', url: '/granted' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [{ id: 'row-1' }],
      meta: { limit: 50, nextCursor: null },
    });
  });

  it('says nothing to a viewer whose reach is not restricted', async () => {
    const app = Fastify();
    await registerRequestScopeHook(app, {
      buildTenantContext: async () => resolveTenantContext({ kind: 'admin', adminUserId: 'a' }),
    });
    app.get('/refused', async () => {
      customerFilterCond('absent');
      return { data: [{ id: 'row-1' }] };
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/refused' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 'row-1' }] });
  });

  it('leaves a non-object body alone', async () => {
    const app = await appFor(scopedViewer);
    const res = await app.inject({ method: 'GET', url: '/csv' });
    await app.close();

    // The newsletter CSV export is a string. There is no envelope to put a
    // notice on, and a merge would corrupt the download.
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('email\n');
  });

  it('leaves an error body alone', async () => {
    const app = await appFor(scopedViewer);
    const res = await app.inject({ method: 'GET', url: '/refused-but-broken' });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'no' } });
  });
});

describe('withScopeNotice', () => {
  const refused = async <T>(fn: () => T): Promise<T> => {
    const ctx = scopedViewer();
    return runWithTenantContext(ctx, async () => {
      customerFilterCond('absent');
      return fn();
    });
  };

  it('creates `meta` on a body that has none', async () => {
    const out = await refused(() =>
      withScopeNotice({ items: [], total: 0, page: 1, pageSize: 200 }, 200),
    );
    expect(out).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 200,
      meta: { scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING' },
    });
  });

  it('leaves an array body alone', async () => {
    const out = await refused(() => withScopeNotice([1, 2], 200));
    expect(out).toEqual([1, 2]);
  });

  it('leaves a Buffer alone', async () => {
    const buf = Buffer.from('x');
    const out = await refused(() => withScopeNotice(buf, 200));
    expect(out).toBe(buf);
  });

  it('leaves a body alone outside any tenant context', () => {
    // Not a silence to fix: nothing established a context, so nothing was
    // refused, so there is nothing to explain.
    expect(withScopeNotice({ data: [] }, 200)).toEqual({ data: [] });
  });

  it('leaves a body alone under system scope', async () => {
    const out = await runWithTenantContext(systemTenantContext('unit-test'), async () => {
      customerFilterCond('absent');
      return withScopeNotice({ data: [] }, 200);
    });
    expect(out).toEqual({ data: [] });
  });
});
