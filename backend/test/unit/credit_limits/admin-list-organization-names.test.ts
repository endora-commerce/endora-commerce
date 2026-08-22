import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrganizationDetailsPort, OrganizationRecord } from '@endora-commerce/contracts';
import {
  registerCreditLimitsRoutes,
  type CreditLimitsDeps,
} from '../../../src/modules/credit_limits/routes.js';
import type { CreditLimitService } from '../../../src/modules/credit_limits/services/credit-limit-service.js';
import type { CreditLimit } from '../../../src/modules/credit_limits/entities/credit-limit.entity.js';

/**
 * Feature 075, Phase C — the admin roster reads the organisation's name from
 * `organizations`' published port, not from an `em.find` on its entity.
 *
 * The name column is the only thing this module ever wanted from that table,
 * and reaching it through the entity class is what made `credit_limits`
 * un-removable: a build-time link into another module's directory for one
 * string per row. The port is resolved per call, so an operator switching
 * `organizations` off fails the request closed instead of rendering a roster
 * with every name silently missing.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000aa';

const LIMIT = {
  id: '11111111-0000-4000-8000-000000000001',
  organizationId: ORG_ID,
  grantedAmount: '5000',
  currency: 'PLN',
  createdAt: new Date('2026-08-17T10:00:00.000Z'),
} as unknown as CreditLimit;

function organizationRecord(id: string, name: string): OrganizationRecord {
  return { id, name } as OrganizationRecord;
}

describe('GET /api/v1/admin/credit-limits — the organisation name', () => {
  let app: FastifyInstance;
  let askedFor: readonly string[][] = [];

  beforeEach(async () => {
    askedFor = [];
    const organizationDetailsPort: OrganizationDetailsPort = {
      findById: async () => null,
      findByIds: async (ids) => {
        askedFor = [...askedFor, [...ids]];
        return [organizationRecord(ORG_ID, 'Nowa Firma')];
      },
      countByIds: async () => 0,
      searchByName: async () => [],
      searchIdsByName: async () => [],
    };

    const creditLimitService = {
      listAll: async () => [LIMIT],
      listActiveReservations: async () => [],
      getForOrganization: async () => null,
    } as unknown as CreditLimitService;

    const deps: CreditLimitsDeps = {
      creditLimitService,
      organizationDetailsPort,
      requireCustomer: async () => {},
      requireAdmin: () => async () => {},
      resolveCustomerContext: () => ({
        customerAccountId: '00000000-0000-4000-8000-0000000000bb',
        organizationId: ORG_ID,
      }),
    };

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await registerCreditLimitsRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('renders the name the port returned, and asks the port for it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string; organizationName: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.organizationName).toBe('Nowa Firma');
    expect(askedFor).toEqual([[ORG_ID]]);
  });
});
