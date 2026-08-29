import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrganizationDetailsPort } from '@endora-commerce/contracts';
import {
  registerCreditLimitsRoutes,
  type CreditLimitsDeps,
} from '../../../../packages/modules/credit_limits/src/backend/routes.js';
import type { CreditLimit } from '../../../../packages/modules/credit_limits/src/backend/entities/credit-limit.entity.js';
import type { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';

/**
 * Feature 080, T051 — who granted a credit limit is read from the
 * **production** actor, not from the test harness's decoration.
 *
 * The twin of `test/unit/api_keys/admin-actor-attribution.test.ts`; the reason
 * is written out in full there. `POST
 * /api/v1/admin/organizations/:id/credit-limit` read
 * `testAdminUserId(request)`, which answers from `request.testActor` — a field
 * only `test/helpers/test-actors.ts` writes — so `grantedByAdminUserId` was
 * null on every limit a production operator ever granted. This one is the
 * costliest of the three: the column is the audit trail for a financial grant.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';
const ORG_ID = '00000000-0000-4000-8000-0000000000aa';

const GRANTED = {
  id: '11111111-0000-4000-8000-000000000003',
  organizationId: ORG_ID,
  grantedAmount: '5000',
  currency: 'PLN',
  createdAt: new Date('2026-08-24T10:00:00.000Z'),
} as unknown as CreditLimit;

describe('POST /api/v1/admin/organizations/:id/credit-limit — the acting admin', () => {
  let app: FastifyInstance;
  let granted: { grantedByAdminUserId?: string } | null = null;

  beforeEach(async () => {
    granted = null;
    const creditLimitService = {
      getForOrganization: async () => null,
      listActiveReservations: async () => [],
      grant: async (input: { grantedByAdminUserId?: string }) => {
        granted = input;
        return GRANTED;
      },
    } as unknown as CreditLimitService;

    const organizationDetailsPort: OrganizationDetailsPort = {
      findById: async () => ({ id: ORG_ID, name: 'Nowa Firma' } as never),
      findByIds: async () => [{ id: ORG_ID, name: 'Nowa Firma' } as never],
      countByIds: async () => 1,
      searchByName: async () => [],
      searchIdsByName: async () => [],
    };

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // The production request shape: the auth plugin decorates `request.actor`
    // and nothing decorates `request.testActor`.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as unknown as { actor: { kind: string; adminUserId: string } }).actor = {
        kind: 'admin',
        adminUserId: ADMIN_ID,
      };
    });
    const deps: CreditLimitsDeps = {
      creditLimitService,
      organizationDetailsPort,
      requireCustomer: async () => {},
      requireAdmin: () => async () => {},
      resolveCustomerContext: () => ({ customerAccountId: '', organizationId: ORG_ID }),
      resolveAdminUserId: (request) =>
        (request as unknown as { actor: { adminUserId: string } }).actor.adminUserId,
    };
    await registerCreditLimitsRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('attributes the grant to the admin on `request.actor`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${ORG_ID}/credit-limit`,
      payload: { grantedAmount: 5000, currency: 'PLN' },
    });

    expect(res.statusCode).toBe(201);
    expect(granted).not.toBeNull();
    expect(granted?.grantedByAdminUserId).toBe(ADMIN_ID);
  });
});
