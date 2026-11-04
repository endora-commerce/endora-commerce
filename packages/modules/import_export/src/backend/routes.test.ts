import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@endora-commerce/platform/kernel')>();
  return { ...actual, effectiveState: { isPresent: () => true } };
});

const { ImportExportService } = await import('./services/import-export-service.js');
const { registerImportExportRoutes } = await import('./routes.js');

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

interface Registered {
  preHandler: Guard | Guard[];
  handler: Handler;
  bodyLimit?: number;
}

/**
 * The routes registered against a recording app, with guards that answer from
 * a fixed set of held codes the way the real ones do: 403 `FORBIDDEN` for a
 * code not held.
 */
async function harness(held: readonly string[]) {
  const routes = new Map<string, Registered>();
  const record =
    (method: string) =>
    (url: string, options: { preHandler: Guard | Guard[]; bodyLimit?: number }, handler: Handler) => {
      routes.set(`${method} ${url}`, {
        preHandler: options.preHandler,
        handler,
        ...(options.bodyLimit !== undefined ? { bodyLimit: options.bodyLimit } : {}),
      });
    };
  const app = {
    get: record('GET'),
    post: record('POST'),
    patch: record('PATCH'),
    delete: record('DELETE'),
  } as unknown as FastifyInstance;
  const anyOf: string[][] = [];
  const forbidden = (message: string) => new HttpError(403, ERROR_CODES.FORBIDDEN, message);
  const service = new ImportExportService({} as ConstructorParameters<typeof ImportExportService>[0]);
  await registerImportExportRoutes(app, {
    service,
    profiles: {} as Parameters<typeof registerImportExportRoutes>[1]['profiles'],
    requireAdmin: (code) => async () => {
      if (code !== undefined && !held.includes(code)) throw forbidden(code);
    },
    requireAdminAny: (codes) => {
      anyOf.push([...codes]);
      return async () => {
        if (!codes.some((code) => held.includes(code))) throw forbidden(codes.join(','));
      };
    },
  });

  async function gate(route: string, entity: string): Promise<number> {
    const registered = routes.get(route);
    if (!registered) throw new Error(`no route ${route}`);
    const chain = Array.isArray(registered.preHandler)
      ? registered.preHandler
      : [registered.preHandler];
    const request = { params: { entity } } as unknown as FastifyRequest;
    try {
      for (const guard of chain) await guard(request, {} as FastifyReply);
      return 200;
    } catch (err) {
      if (err instanceof HttpError) return err.statusCode;
      throw err;
    }
  }

  async function listed(): Promise<unknown> {
    const registered = routes.get('GET /api/v1/admin/import-export/entities');
    if (!registered) throw new Error('no listing route');
    return registered.handler({} as FastifyRequest, {} as FastifyReply);
  }

  return { anyOf, gate, listed, service, routes };
}

const EXPORT = 'GET /api/v1/admin/export/:entity.csv';
const IMPORT = 'POST /api/v1/admin/import/:entity';

describe('import_export routes — gates', () => {
  it('requires one of exactly the codes the adapters declare to reach the centre', async () => {
    const h = await harness([]);
    expect(h.anyOf).toHaveLength(1);
    expect([...h.anyOf[0]!].sort()).toEqual(h.service.permissionCodes());
  });

  it('refuses a catalogue-only caller the customers, orders and stock entities', async () => {
    const h = await harness(['catalog:read', 'catalog:write']);
    expect(await h.gate(EXPORT, 'customers')).toBe(403);
    expect(await h.gate(EXPORT, 'orders')).toBe(403);
    expect(await h.gate(EXPORT, 'stock')).toBe(403);
    expect(await h.gate(IMPORT, 'stock')).toBe(403);
    expect(await h.gate(IMPORT, 'orders')).toBe(403);
    expect(await h.gate(EXPORT, 'products')).toBe(200);
    expect(await h.gate(IMPORT, 'categories')).toBe(200);
  });

  it('lets the owning modules’ codes through to their entities', async () => {
    const h = await harness(['customers:read', 'orders:read', 'inventory:read', 'inventory:write']);
    expect(await h.gate(EXPORT, 'customers')).toBe(200);
    expect(await h.gate(EXPORT, 'orders')).toBe(200);
    expect(await h.gate(EXPORT, 'stock')).toBe(200);
    expect(await h.gate(IMPORT, 'stock')).toBe(200);
    expect(await h.gate(EXPORT, 'products')).toBe(403);
    expect(await h.gate(IMPORT, 'products')).toBe(403);
  });

  it('separates the catalogue read code from the write code', async () => {
    const h = await harness(['catalog:read']);
    expect(await h.gate(EXPORT, 'products')).toBe(200);
    expect(await h.gate(IMPORT, 'products')).toBe(403);
  });

  it('leaves an unknown entity to the handler once the caller holds any centre code', async () => {
    expect(await (await harness(['orders:read'])).gate(EXPORT, 'nonexistent')).toBe(200);
    expect(await (await harness(['settings:read'])).gate(EXPORT, 'nonexistent')).toBe(403);
  });

  it('lists only the entities the caller may use', async () => {
    const h = await harness(['orders:read']);
    const body = (await h.listed()) as { data: { entities: Array<{ name: string }> } };
    expect(body.data.entities.map((entity) => entity.name)).toEqual(['orders']);
  });
});

/**
 * C2/C3 code review (warn 2) — feature 172 raised the import body cap to 10 MiB for the products
 * file. It is the products route's alone: every other entity keeps the server's default limit,
 * as before 172.
 */
describe('import body limit', () => {
  it('is 10 MiB on the products import and the server default on every other entity', async () => {
    const { routes } = await harness(['catalog:write']);
    expect(routes.get('POST /api/v1/admin/import/products')?.bodyLimit).toBe(10 * 1024 * 1024);
    const other = routes.get('POST /api/v1/admin/import/:entity');
    expect(other).toBeDefined();
    expect(other?.bodyLimit).toBeUndefined();
  });
});
