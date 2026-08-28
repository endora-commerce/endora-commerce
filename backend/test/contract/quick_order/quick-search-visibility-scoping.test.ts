import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Issue #174, the two arms the channel fix left open.
 *
 * `catalogQuickSearchPort` closed the channel arm: a buyer shopping `pl_retail`
 * stopped seeing products bound only to `pl_b2b_vip`. It deliberately left
 * `visibility` and `allowed_organization_ids` unfiltered, on the ground that no
 * read path in `catalog` enforced either. That ground does not survive the
 * surface: this endpoint requires a signed-in buyer and discloses SKU, slug and
 * name for anything it returns, and the id it returns is accepted by
 * `POST /quick-order/build`. A restriction the operator set on the product is
 * therefore bypassed by typing three characters.
 *
 * The port applies the restrictive reading now, and this file is the proof.
 * Both restricting cases are red against the port as it shipped — it returned
 * the product for every organisation — and both restoration halves are green
 * either way, which is why the restricting cases have to exist.
 *
 * The three fixtures differ in exactly one column each:
 *
 *   - `ORG_RESTRICTED_SKU`   `visibility = 'organization_restricted'`,
 *                            allow-list empty → visible to nobody.
 *   - `OTHER_ORG_SKU`        `visibility = 'public'`, allow-list naming an
 *                            organisation that is not the buyer's → the
 *                            allow-list restricts on its own, whatever the
 *                            visibility column says.
 *   - `ALLOWED_ORG_SKU`      `visibility = 'organization_restricted'`,
 *                            allow-list naming the buyer's organisation →
 *                            still findable.
 *
 * plus `LOGGED_IN_SKU`, which pins the reading of `logged_in_only`: this
 * surface has no anonymous caller, so a signed-in buyer sees it.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const OTHER_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000ab';

const ORG_RESTRICTED_SKU = 'QO-VIS-RESTRICTED-0001';
const OTHER_ORG_SKU = 'QO-VIS-OTHERORG-0001';
const ALLOWED_ORG_SKU = 'QO-VIS-ALLOWED-0001';
const LOGGED_IN_SKU = 'QO-VIS-LOGGEDIN-0001';

async function search(h: BackendServerHandle, q: string): Promise<string[]> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}`,
    headers: { 'x-sales-channel': 'pl_retail' },
    cookies: COOKIE,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Array<{ sku: string }> }).data.map((r) => r.sku);
}

describe('GET /api/v1/quick-order/search — visibility and organisation scoping', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
    expect(retail, 'the harness seeds pl_retail').not.toBeNull();

    const fixtures: Array<{
      sku: string;
      visibility: 'public' | 'logged_in_only' | 'organization_restricted';
      allowedOrganizationIds: string[];
    }> = [
      { sku: ORG_RESTRICTED_SKU, visibility: 'organization_restricted', allowedOrganizationIds: [] },
      {
        sku: OTHER_ORG_SKU,
        visibility: 'public',
        allowedOrganizationIds: [OTHER_ORGANIZATION_ID],
      },
      {
        sku: ALLOWED_ORG_SKU,
        visibility: 'organization_restricted',
        allowedOrganizationIds: [TEST_ORGANIZATION_ID],
      },
      { sku: LOGGED_IN_SKU, visibility: 'logged_in_only', allowedOrganizationIds: [] },
    ];

    for (const fixture of fixtures) {
      const product = em.create(Product, {
        sku: fixture.sku,
        slug: fixture.sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Quick-order visibility probe ${fixture.sku}` },
        description: { 'en-US': 'Bound to pl_retail.' },
        visibility: fixture.visibility,
        allowedOrganizationIds: fixture.allowedOrganizationIds,
        attributeValues: { defaultPrice: 10 },
      });
      await em.persistAndFlush(product);

      // Bound to the channel the buyer is shopping, so the channel filter
      // cannot be what excludes any of these rows.
      await em
        .getConnection()
        .execute(
          `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
          [retail!.id, product.id],
        );
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('does not disclose an organization_restricted product the buyer is not allowed', async () => {
    expect(
      await search(h, ORG_RESTRICTED_SKU),
      'an organisation-restricted product with an empty allow-list is visible to nobody',
    ).not.toContain(ORG_RESTRICTED_SKU);
  });

  it('does not disclose a product whose allow-list names another organization', async () => {
    expect(
      await search(h, OTHER_ORG_SKU),
      'a non-empty allowed_organization_ids restricts on its own, whatever visibility says',
    ).not.toContain(OTHER_ORG_SKU);
  });

  it('discloses a restricted product to an organization on its allow-list', async () => {
    expect(await search(h, ALLOWED_ORG_SKU)).toContain(ALLOWED_ORG_SKU);
  });

  it('discloses a logged_in_only product to a signed-in buyer', async () => {
    expect(await search(h, LOGGED_IN_SKU)).toContain(LOGGED_IN_SKU);
  });

  it('still finds an unrestricted product on the channel being shopped', async () => {
    // The restoration half: scoping must narrow, not empty, the result set.
    expect(await search(h, 'EXAMPLE-SIMPLE')).toContain('EXAMPLE-SIMPLE-001');
  });
});
