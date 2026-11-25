import { afterEach, describe, expect, it } from 'vitest';
import type { HttpError } from '../http/error-envelope.js';
import { mergeFreezeState, refuseMergingTenantWrite } from './merge-freeze.js';
import type { TenantContext } from './tenant-context.js';

/**
 * `specs/192-organization-merge/` T017 (R-6 seam 1): tenant resolution. A
 * customer or bound API-key request pinned to a frozen or archived
 * Organization may read and is refused on every unsafe method; an
 * administrator's context is never pinned, so this seam leaves it to the
 * guard and the host's routes.
 */

const LOSER = '00000000-0000-4000-8000-0000000002a0';
const SURVIVOR = '00000000-0000-4000-8000-0000000002b0';
const MERGE = '00000000-0000-4000-8000-0000000002c0';

const customer: TenantContext = {
  mode: 'single-org',
  organizationId: LOSER,
  customerAccountId: '00000000-0000-4000-8000-0000000002d0',
  actor: { kind: 'customer', id: 'c' },
};
const apiKey: TenantContext = { mode: 'single-org', organizationId: LOSER, actor: { kind: 'api_key', id: 'k' } };
const admin: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'a' } };

function refusal(run: () => void): HttpError | null {
  try {
    run();
    return null;
  } catch (error) {
    return error as HttpError;
  }
}

describe('refuseMergingTenantWrite', () => {
  afterEach(() => mergeFreezeState.clear());

  it('lets every request through when nothing is merging', () => {
    expect(refusal(() => refuseMergingTenantWrite(customer, 'POST'))).toBeNull();
  });

  it('refuses unsafe methods of a customer and of a bound API key on a frozen Organization, and lets reads pass', () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    for (const tenant of [customer, apiKey]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const error = refusal(() => refuseMergingTenantWrite(tenant, method));
        expect(error?.statusCode).toBe(409);
        expect(error?.code).toBe('RECORD_MERGE_IN_PROGRESS');
      }
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        expect(refusal(() => refuseMergingTenantWrite(tenant, method))).toBeNull();
      }
    }
  });

  it('answers ORGANIZATION_MERGED with the survivor for an archived Organization', () => {
    mergeFreezeState.archive('organization', LOSER, MERGE, SURVIVOR);
    const error = refusal(() => refuseMergingTenantWrite(apiKey, 'POST'));
    expect(error?.code).toBe('ORGANIZATION_MERGED');
    expect(error?.details).toMatchObject({ survivorId: SURVIVOR });
  });

  it('leaves an administrator to the guard and the host routes', () => {
    mergeFreezeState.freeze('organization', LOSER, MERGE);
    expect(refusal(() => refuseMergingTenantWrite(admin, 'POST'))).toBeNull();
  });
});
