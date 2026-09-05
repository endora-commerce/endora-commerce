import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { MissingTenantContextError, withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  composeTestServer,
  teardownTestServer,
  type TestServerHandle,
} from '@endora-commerce/test-kit/server';

import {
  ORGANIZATION_HEADER,
  ROWS_ROUTE,
  TestKitOrgRow,
  fixtureComposition,
} from './fixture-platform.js';

/**
 * T025 / Principle XI — a server the **kit** composed applies the tenancy
 * global-filter guard.
 *
 * ## Why this proof exists at all
 *
 * A harness is not judged by what it asserts, it is judged by what it makes
 * assertable. A kit that composed a server without the guard — a plain
 * `orm.em.fork()` where the platform forks through `forkScopedEm`, or a
 * `buildServer` with no request-scope hook — would leave every tenant-scope
 * test in every module package passing for the wrong reason, silently and
 * forever: the rows would simply all be visible, and a test asserting "the
 * customer sees their own row" would still see it.
 *
 * So the two directions are asserted separately, because only the pair is
 * evidence:
 *
 *  - **fail-closed** — a query with no ambient context raises
 *    `MissingTenantContextError`. This says the filter is *attached*: an
 *    unattached filter answers such a query happily.
 *  - **scoped** — a request bound to one organization reads that
 *    organization's row and not the other's. This says the request seam
 *    *establishes* a context, and that the filter reads it.
 *
 * The first alone would pass on a server with no request hook at all; the
 * second alone would pass on a server with no filter, because the fixture only
 * ever writes rows the scope happens to allow. Together they do not.
 */

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const CUSTOMER = randomUUID();

let handle: TestServerHandle;

beforeAll(async () => {
  handle = await composeTestServer({
    composition: fixtureComposition(),
    // The one thing a request-bound test has to supply: who this request is.
    // Everything else about the seam — the hook, the storage, the fork — is the
    // platform's, installed by the kit whether or not this is passed.
    buildTenantContext: async (request: FastifyRequest) => {
      const organizationId = request.headers[ORGANIZATION_HEADER];
      return resolveTenantContext({
        kind: 'customer',
        customerAccountId: CUSTOMER,
        organizationId: typeof organizationId === 'string' ? organizationId : null,
      });
    },
    prepareDatabase: async ({ em }) => {
      // Seeding is a cross-tenant write by definition, so it is the one place
      // the sanctioned widening belongs.
      await withSystemScope('test-kit fixture seed', async () => {
        const seed = em();
        await seed.nativeDelete(TestKitOrgRow, {});
        seed.persist(seed.create(TestKitOrgRow, { organizationId: ORG_A, label: 'a' }));
        seed.persist(seed.create(TestKitOrgRow, { organizationId: ORG_B, label: 'b' }));
        await seed.flush();
      });
    },
  });
});

afterAll(async () => {
  if (handle !== undefined) await teardownTestServer(handle);
});

describe('a kit-composed server applies the tenant guard', () => {
  it('refuses a tenant-scoped read with no ambient context', async () => {
    // No `withSystemScope`, no request: the fail-closed guarantee. If the
    // filter were not attached to the entity this read would simply return both
    // rows.
    await expect(handle.em().find(TestKitOrgRow, {})).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('shows a request only its own organization’s rows', async () => {
    const mine = await handle.app.inject({
      method: 'GET',
      url: ROWS_ROUTE,
      headers: { [ORGANIZATION_HEADER]: ORG_A },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ data: { label: string }[] }>().data.map((row) => row.label)).toEqual(['a']);

    // The other side of the same request seam, so the first result cannot be
    // "there happened to be one row".
    const theirs = await handle.app.inject({
      method: 'GET',
      url: ROWS_ROUTE,
      headers: { [ORGANIZATION_HEADER]: ORG_B },
    });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json<{ data: { label: string }[] }>().data.map((row) => row.label)).toEqual(['b']);
  });
});
