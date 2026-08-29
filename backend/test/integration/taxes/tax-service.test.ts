import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TaxService } from '../../../../packages/modules/taxes/src/backend/services/tax-service.js';
import { Tax } from '../../helpers/package-entities.js';

/**
 * T131 — TaxService resolution:
 *   - most-specific narrowed rule wins
 *   - default rule applies when nothing else matches
 *   - no default + no match → source='none', carrying no rate (issue #124)
 */

describe('TaxService.taxRateFor', () => {
  let h: BackendServerHandle;
  let svc: TaxService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new TaxService(h.em);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table taxes cascade');
  });

  it('answers with no rate at all when no rule matches and no default exists', async () => {
    const result = await svc.taxRateFor({
      country: 'PL',
      productType: 'simple',
      vatStatus: 'vat_payer',
    });
    // Issue #124 — `{ source: 'none' }` and nothing else. The arm used to carry
    // `rate: 0`, and every consumer spent it as a rate.
    expect(result).toEqual({ source: 'none' });
    expect(result).not.toHaveProperty('rate');
  });

  it('answers a configured 0% rate as a rate, not as an absence', async () => {
    const zeroRated = await svc.upsertByCode({
      code: 'zero_rated',
      name: 'Zero-rated supply',
      rate: 0,
      isDefault: true,
    });
    const result = await svc.taxRateFor({
      country: 'PL',
      productType: 'simple',
      vatStatus: 'vat_payer',
    });
    expect(result).toEqual({ source: 'default', rate: 0, taxId: zeroRated.id });
  });

  it('falls back to the default rule when nothing matches', async () => {
    const def = await svc.upsertByCode({
      code: 'fallback',
      name: 'Default 23%',
      rate: 0.23,
      isDefault: true,
    });
    const result = await svc.taxRateFor({
      country: 'DE',
      productType: 'virtual',
      vatStatus: 'vat_payer',
    });
    expect(result).toEqual({ source: 'default', rate: 0.23, taxId: def.id });
  });

  it('picks the most specific rule', async () => {
    await svc.upsertByCode({
      code: 'broad-pl',
      name: 'PL broad',
      rate: 0.23,
      country: 'PL',
    });
    const narrow = await svc.upsertByCode({
      code: 'pl-virtual-exempt',
      name: 'PL virtual + exempt',
      rate: 0,
      country: 'PL',
      productType: 'virtual',
      appliesToVatStatuses: ['vat_exempt'],
    });

    const broadResult = await svc.taxRateFor({
      country: 'PL',
      productType: 'simple',
      vatStatus: 'vat_payer',
    });
    expect(broadResult).toMatchObject({ source: 'rule', rate: 0.23 });

    const narrowResult = await svc.taxRateFor({
      country: 'PL',
      productType: 'virtual',
      vatStatus: 'vat_exempt',
    });
    expect(narrowResult).toEqual({ source: 'rule', rate: 0, taxId: narrow.id });
  });

  it('breaks specificity ties by priority desc', async () => {
    await svc.upsertByCode({
      code: 'pl-low',
      name: 'PL low',
      rate: 0.05,
      country: 'PL',
      priority: 1,
    });
    const high = await svc.upsertByCode({
      code: 'pl-high',
      name: 'PL high',
      rate: 0.23,
      country: 'PL',
      priority: 99,
    });
    const result = await svc.taxRateFor({
      country: 'PL',
      productType: 'simple',
      vatStatus: 'vat_payer',
    });
    expect(result).toEqual({ source: 'rule', rate: 0.23, taxId: high.id });
  });

  it('demoting a default leaves the unique invariant intact', async () => {
    await svc.upsertByCode({ code: 'a', name: 'A', rate: 0.1, isDefault: true });
    await svc.upsertByCode({ code: 'b', name: 'B', rate: 0.2, isDefault: true });
    const defaults = await h.em().find(Tax, { isDefault: true });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe('b');
  });
});
