import { afterEach, describe, expect, it } from 'vitest';
import type { HttpError } from '../http/error-envelope.js';
import { mergeFreezeState, mergeWriteRefusal, refuseMergingTenantWrite } from './merge-freeze.js';
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

/**
 * `specs/192-organization-merge/` US6, T083 — the Project host's merged code:
 * a write naming an archived Project answers `PROJECT_MERGED` with its
 * survivor, a frozen one `RECORD_MERGE_IN_PROGRESS` outside its own merge.
 */
describe('mergeWriteRefusal for a Project', () => {
  afterEach(() => mergeFreezeState.clear());

  it('answers PROJECT_MERGED with the survivor for an archived Project', () => {
    mergeFreezeState.archive('project', LOSER, MERGE, SURVIVOR);
    const error = mergeWriteRefusal('project', LOSER, admin);
    expect(error?.statusCode).toBe(409);
    expect(error?.code).toBe('PROJECT_MERGED');
    expect(error?.details).toMatchObject({ survivorId: SURVIVOR, mergeId: MERGE });
  });

  it('names the last survivor of a chain: C into A, then A into D', () => {
    const c = '00000000-0000-4000-8000-0000000002e0';
    const d = '00000000-0000-4000-8000-0000000002f0';
    mergeFreezeState.archive('project', c, MERGE, LOSER);
    mergeFreezeState.archive('organization', '00000000-0000-4000-8000-000000000300', MERGE, LOSER);
    mergeFreezeState.archive('project', LOSER, SURVIVOR, d);
    expect(mergeWriteRefusal('project', c, admin)?.details).toMatchObject({ survivorId: d, mergeId: MERGE });
    // Another host type's record merged into an id that happens to match is not re-pointed.
    expect(mergeFreezeState.archivedInto('organization', '00000000-0000-4000-8000-000000000300')).toBe(LOSER);
  });

  it('refuses a frozen Project outside its merge, and lets its own merge scope write', () => {
    mergeFreezeState.freeze('project', LOSER, MERGE);
    expect(mergeWriteRefusal('project', LOSER, admin)?.code).toBe('RECORD_MERGE_IN_PROGRESS');
    expect(
      mergeWriteRefusal('project', LOSER, { mode: 'system', actor: { kind: 'system' }, reason: `record-merge:${MERGE}` }),
    ).toBeNull();
    expect(mergeWriteRefusal('organization', LOSER, admin)).toBeNull();
  });
});
