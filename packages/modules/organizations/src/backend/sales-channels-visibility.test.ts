import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #515 — `GET` / `PUT /api/v1/admin/organizations/:id/sales-channels`
 * refuse an Organization outside the acting administrator's reach with the
 * answer a nonexistent one gets, `404 NOT_FOUND`, before the Organization is
 * read and before anything is written. The reach is the request's tenant scope
 * (`isOrgInScope`), mocked here; the contract test
 * `backend/test/contract/organizations/admin-sales-channels-visibility.contract.test.ts`
 * drives it with a real sales representative.
 */

const scope = vi.hoisted(() => ({ reachable: new Set<string>() }));

vi.mock('@endora-commerce/platform/tenancy', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/platform/tenancy')>(
    '@endora-commerce/platform/tenancy',
  );
  return { ...actual, isOrgInScope: (organizationId: string) => scope.reachable.has(organizationId) };
});

const { registerOrganizationsAdminRoutes } = await import('./routes.admin.js');

const OWN = '00000000-0000-4000-8000-0000000000a1';
const FOREIGN = '00000000-0000-4000-8000-0000000000a2';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';

describe('admin Organization sales channels — Organization visibility (#515)', () => {
  let app: FastifyInstance;
  const findOne = vi.fn(async (_entity: unknown, where: { id: string }) => ({ id: where.id }));
  const listChannelsForEntity = vi.fn(async () => [{ id: CHANNEL, active: true }]);
  const replaceChannelsForEntity = vi.fn(async () => undefined);

  beforeEach(async () => {
    scope.reachable = new Set([OWN]);
    findOne.mockClear();
    listChannelsForEntity.mockClear();
    replaceChannelsForEntity.mockClear();
    const em = {
      findOne,
      find: async () => [{ id: CHANNEL, code: 'b2b', name: { en: 'B2B' }, active: true, systemDefault: true }],
      count: async () => 1,
    };
    const passThrough = () => async () => {};
    app = Fastify();
    app.setValidatorCompiler(() => (data) => ({ value: data }));
    app.setSerializerCompiler(() => (data) => JSON.stringify(data));
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof HttpError) {
        void reply.code(err.statusCode).send({ error: { code: err.code } });
        return;
      }
      void reply.code(500).send({ error: { code: 'UNEXPECTED', message: String(err) } });
    });
    await registerOrganizationsAdminRoutes(app, {
      requireAdmin: passThrough,
      requireAdminAny: passThrough,
      emFactory: () => em,
      auditLogService: { record: async () => undefined },
      salesChannelMembership: { listChannelsForEntity, replaceChannelsForEntity },
    } as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const url = (id: string) => `/api/v1/admin/organizations/${id}/sales-channels`;

  it('GET answers for an Organization in reach', async () => {
    const res = await app.inject({ method: 'GET', url: url(OWN) });
    expect(res.statusCode, res.body).toBe(200);
    expect(listChannelsForEntity).toHaveBeenCalledWith('organization', OWN);
  });

  it('GET answers 404 NOT_FOUND outside reach, reading nothing', async () => {
    const res = await app.inject({ method: 'GET', url: url(FOREIGN) });
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(findOne).not.toHaveBeenCalled();
    expect(listChannelsForEntity).not.toHaveBeenCalled();
  });

  it('PUT answers 404 NOT_FOUND outside reach, writing nothing', async () => {
    const res = await app.inject({ method: 'PUT', url: url(FOREIGN), payload: { salesChannelIds: [CHANNEL] } });
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(replaceChannelsForEntity).not.toHaveBeenCalled();
  });
});
