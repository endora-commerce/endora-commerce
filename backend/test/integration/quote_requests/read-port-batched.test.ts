import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuoteRequestReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmOrganization, submitCrmQuoteRequest } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { tapStatements } from '../../helpers/statement-tap.js';

/**
 * Issue #457 — `quoteRequestReadPort.findByIds` and `amountsOf`, the batched
 * twins of `findById` and `amountOf` that `projects` reads its linked Quote
 * Requests through. Same answers, same tenant scope (Constitution XI), and a
 * fixed number of statements whatever the number of ids.
 */
describe('quoteRequestReadPort — batched reads (issue #457) [integration]', () => {
  let h: BackendServerHandle;
  let otherOrganization: string;
  const quotes: Array<{ id: string; businessId: string }> = [];

  const port = () => h.container.resolve<QuoteRequestReadPort>('quoteRequestReadPort');

  const asPlatform = <T>(body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, { allowAll: true, allowedOrganizationIds: [] }),
      body,
    );
  const confinedTo = <T>(organizationIds: string[], body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId: TEST_ADMIN_ID },
        { allowAll: false, allowedOrganizationIds: organizationIds },
      ),
      body,
    );

  async function statements<T>(run: () => Promise<T>): Promise<{ result: T; queries: number }> {
    let queries = 0;
    const onQuery = (): void => {
      queries += 1;
    };
    const untap = tapStatements(h.em(), onQuery);
    try {
      return { result: await run(), queries };
    } finally {
      untap();
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    otherOrganization = await seedCrmOrganization(h.em(), 'quote read port batched other');
    for (const [index, price] of [11, 12.5, 7, 3].entries()) {
      quotes.push(await submitCrmQuoteRequest(h, { quantity: index + 1, desiredUnitPrice: price }));
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('findByIds answers what findById answers for each id; a missing or malformed id is absent', async () => {
    const ids = quotes.map((quote) => quote.id);
    await asPlatform(async () => {
      const batched = await port().findByIds([...ids, '00000000-0000-4000-8000-0000000004f7', 'not-a-uuid', ids[0]!]);
      expect(batched.map((record) => record.id).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        expect(batched.find((record) => record.id === id)).toEqual(await port().findById(id));
      }
      expect(await port().findByIds([])).toEqual([]);
    });
  });

  it('amountsOf answers what amountOf answers for each id; a missing or malformed id is absent', async () => {
    const ids = quotes.map((quote) => quote.id);
    await asPlatform(async () => {
      const amounts = await port().amountsOf([...ids, '00000000-0000-4000-8000-0000000004f7', 'not-a-uuid']);
      expect([...amounts.keys()].sort()).toEqual([...ids].sort());
      for (const id of ids) expect(amounts.get(id)).toEqual(await port().amountOf(id));
      // 3 × 7.00
      expect(amounts.get(quotes[2]!.id)).toEqual({ amount: '21.00', currency: expect.any(String), agreement: 'none' });
      expect((await port().amountsOf([])).size).toBe(0);
    });
  });

  it('reads under the caller’s tenant scope: another Organization’s Quote Requests are not there', async () => {
    const ids = quotes.map((quote) => quote.id);
    await confinedTo([otherOrganization], async () => {
      expect(await port().findByIds(ids)).toEqual([]);
      expect((await port().amountsOf(ids)).size).toBe(0);
    });
  });

  it('issues the same number of statements for one id as for four', async () => {
    const ids = quotes.map((quote) => quote.id);
    await asPlatform(async () => {
      const oneRecord = await statements(() => port().findByIds(ids.slice(0, 1)));
      const allRecords = await statements(() => port().findByIds(ids));
      expect(allRecords.result).toHaveLength(ids.length);
      expect(allRecords.queries).toBe(oneRecord.queries);

      const oneAmount = await statements(() => port().amountsOf(ids.slice(0, 1)));
      const allAmounts = await statements(() => port().amountsOf(ids));
      expect(allAmounts.result.size).toBe(ids.length);
      expect(allAmounts.queries).toBe(oneAmount.queries);
      // The quotes, then their lines.
      expect(allAmounts.queries).toBeLessThanOrEqual(2);
    });
  });
});
