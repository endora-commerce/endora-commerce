/**
 * A9's tenant seed, held to the `organizations` invariant it has to satisfy.
 *
 * `organizations_tax_id_presence` (#1034) is `is_personal = (tax_id is null)`:
 * a company carries a tax ID and a personal organization does not. The probe
 * writes its two tenants from the required properties alone, so `tax_id`,
 * being nullable, was left out while `is_personal` took its `false` default —
 * a row the check refuses, and A9 reported `unmeasured` on every run.
 */

import { describe, it, expect } from 'vitest';

import { companyTenantSeed } from '../../../scripts/acceptance/instance-tenant-seed.js';

describe('companyTenantSeed', () => {
  it('gives a company tenant a tax ID when the entity maps one', () => {
    const seed = companyTenantSeed({ name: 'a9-1' }, { taxId: { name: 'taxId', persist: true } });
    expect(typeof seed['taxId']).toBe('string');
    expect((seed['taxId'] as string).length).toBeGreaterThan(0);
    expect((seed['taxId'] as string).length).toBeLessThanOrEqual(32);
    expect(seed['name']).toBe('a9-1');
  });

  it('writes a different tax ID for each tenant, so a unique scope cannot refuse the second', () => {
    const properties = { taxId: { name: 'taxId' } };
    const first = companyTenantSeed({}, properties)['taxId'];
    const second = companyTenantSeed({}, properties)['taxId'];
    expect(first).not.toBe(second);
  });

  it('marks the tenant as a company even where the entity has no default for that', () => {
    const seed = companyTenantSeed({}, { taxId: { name: 'taxId' }, isPersonal: { name: 'isPersonal' } });
    expect(seed['isPersonal']).toBe(false);
  });

  it('leaves the seed alone when the entity maps no tax ID, or does not persist it', () => {
    expect(companyTenantSeed({ name: 'x' }, { name: { name: 'name' } })).toEqual({ name: 'x' });
    expect(
      companyTenantSeed({ name: 'x' }, { taxId: { name: 'taxId', persist: false } }),
    ).toEqual({ name: 'x' });
  });

  it('keeps a tax ID the seed already carries', () => {
    expect(companyTenantSeed({ taxId: 'given' }, { taxId: { name: 'taxId' } })['taxId']).toBe(
      'given',
    );
  });
});
