import { describe, it, expect } from 'vitest';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../../../src/tenancy/resolve-tenant-context.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { customerFilterCond, orgFilterCond } from '../../../src/tenancy/filters.js';

/**
 * The refusal explains itself (feature 087, owner decision of 2026-08-29).
 *
 * `customerFilterCond`'s `allowed-set` arm refuses every row of a table with no
 * organization column, and that refusal is correct. What was wrong is that it
 * was **indistinguishable from an empty table** at every layer above it, so an
 * operator read `[]` as a fact about the data. These cases assert the record
 * the filter now leaves, which is the only thing that can tell the two apart.
 *
 * Every case reads the observation off the ambient context — the same object
 * the host reads in `preSerialization` — and never off a value handed to the
 * filter, so a fixture cannot pass by entering below the thing it checks.
 */

const scopedAdmin = () =>
  resolveTenantContext(
    { kind: 'admin', adminUserId: 'rep-1' },
    { allowAll: false, allowedOrganizationIds: ['org-A'] },
  );

describe('the allowed-set refusal records itself', () => {
  it('marks the context when the filtered entity carries no organization column', async () => {
    const ctx = scopedAdmin();
    expect(ctx.notices?.organizationAttributionRefused).toBe(false);

    const where = await runWithTenantContext(ctx, async () => customerFilterCond('absent'));

    // The predicate is the one !1105 shipped, unchanged.
    expect(where).toEqual({ customerAccountId: { $in: [] } });
    expect(ctx.notices?.organizationAttributionRefused).toBe(true);
  });

  it('leaves the context unmarked when the entity carries the column', async () => {
    const ctx = scopedAdmin();

    const where = await runWithTenantContext(ctx, async () => customerFilterCond('present'));

    expect(where).toEqual({ organizationId: { $in: ['org-A'] } });
    // The arm granted, so there is nothing to explain: a screen over `Cart`
    // shows the representative their own rows and must say nothing about
    // records it can see perfectly well.
    expect(ctx.notices?.organizationAttributionRefused).toBe(false);
  });

  it('says nothing for a viewer whose reach is not restricted', async () => {
    const platformAdmin = resolveTenantContext({ kind: 'admin', adminUserId: 'admin-1' });
    expect(platformAdmin.mode).toBe('all');
    // No sink at all: `all` refuses nothing, so there is no emptiness of this
    // kind for it to explain, and the absent sink is what makes that structural
    // rather than a check somebody has to write.
    expect(platformAdmin.notices).toBeUndefined();

    const where = await runWithTenantContext(platformAdmin, async () =>
      customerFilterCond('absent'),
    );
    expect(where).toEqual({});
    expect(platformAdmin.notices?.organizationAttributionRefused).toBeUndefined();
  });

  it('says nothing for a customer confined to one organization', async () => {
    const customer = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
    });
    expect(customer.mode).toBe('single-org');
    expect(customer.notices).toBeUndefined();

    const where = await runWithTenantContext(customer, async () => customerFilterCond('absent'));
    // A `single-org` customer is confined per row, not per table — they see
    // their own rows and always did.
    expect(where).toEqual({ customerAccountId: 'cust-1' });
  });

  it('says nothing for system scope', async () => {
    const system = systemTenantContext('unit-test');
    expect(system.notices).toBeUndefined();
    await runWithTenantContext(system, async () => customerFilterCond('absent'));
    expect(system.notices?.organizationAttributionRefused).toBeUndefined();
  });

  it('is not raised by the org filter, which refuses row by row', async () => {
    const ctx = scopedAdmin();
    const where = await runWithTenantContext(ctx, async () => orgFilterCond());
    expect(where).toEqual({ organizationId: { $in: ['org-A'] } });
    // `@OrgScoped` rows carry the column by classification, so an empty result
    // there really does mean "none of these belong to your organizations" —
    // a true statement about the data, needing no explanation.
    expect(ctx.notices?.organizationAttributionRefused).toBe(false);
  });

  it('gives the roll-up customer actor a sink too', () => {
    const rollup = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-A',
      rollupSubtreeOrganizationIds: ['org-A', 'org-A1'],
    });
    expect(rollup.mode).toBe('allowed-set');
    // The second producer of an `allowed-set` context (feature 056). It is
    // latent in production, and a disclosure attached to the mode rather than
    // to the actor kind is one thing fewer to remember when it is wired.
    expect(rollup.notices?.organizationAttributionRefused).toBe(false);
  });

  it('gives each request its own sink', async () => {
    const first = scopedAdmin();
    const second = scopedAdmin();
    await runWithTenantContext(first, async () => customerFilterCond('absent'));
    expect(first.notices?.organizationAttributionRefused).toBe(true);
    expect(second.notices?.organizationAttributionRefused).toBe(false);
  });
});
