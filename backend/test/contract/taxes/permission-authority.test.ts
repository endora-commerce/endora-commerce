import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type TaxServicePort } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Tax } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '../../../src/seeds/seeded-role-permissions.js';

/**
 * `taxes` owns its own authority.
 *
 * The module declared no permission code of its own and enforced
 * `catalog:write` on **all four** of its admin routes — the two reads
 * included. So whoever could edit a product could read the tax table, rewrite a
 * rate, move the default rule and delete a rule outright; and a rate is the
 * figure every price, every order total and every invoice is computed from, so
 * the write has no undo an operator can see. It is also the module the
 * platform refuses to switch off, on the ground that a shop that cannot compute
 * tax cannot state a lawful price — the authority to change that figure was the
 * catalogue's.
 *
 * Nothing could see it. `catalog:write` is real, declared and enforced, so the
 * permission inventory's two directions (*enforced ⇒ grantable*,
 * *grantable ⇒ enforced*) were clean over the site; D-173's `foreign-gate`
 * sweep passes it deliberately, because `catalog` is `nonDeactivatable` and the
 * availability coupling that sweep asks about can never bite; and
 * `check:action-route-permissions` never looked at all, this module declaring
 * no manifest action. None of them asks whether `catalog:write` is the right
 * authority for setting a VAT rate, which is a judgement rather than a
 * derivation. That is why the answer is pinned here rather than in a new check.
 *
 * **The pair is a change of model and not only of spelling**, and this module is
 * the first of the four where that is true. `payments`, `payment_methods` and
 * `delivery_methods` each had a `catalog:read` gate on their list route, so
 * their new read code replaced a read code. Here there was no read gate at all:
 * to see the tax table you had to hold the authority to rewrite it. So
 * `taxes:read` is a capability that did not exist before, and the assertions
 * below are in two groups — the ones that were red before this change, and the
 * one standing assertion (`sales_representative`, which holds `catalog:read`
 * alone and could not read the tax table before this change either).
 *
 * The four roles are created straight onto the entity rather than through
 * `PUT /api/v1/admin/admin-roles/:code`, deliberately: that route refuses a
 * code no manifest declares, so before the repair this file would have gone red
 * in `beforeAll` on the grantability guard and never reached the assertions the
 * defect is about. Grantability is not left unasserted — it is exactly what
 * `test/contract/admin_users/permission-inventory.test.ts` sweeps, in both
 * directions.
 *
 * Every refusal asserts the envelope, not merely a non-200: a 403 and a 500 are
 * different results, and a test that accepts either passes on a crash.
 */

const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000e3';
const TAX_VIEWER_ID = '00000000-0000-4000-8000-0000000000e4';
const TAX_EDITOR_ID = '00000000-0000-4000-8000-0000000000e5';
const SEEDED_SALES_REP_ID = '00000000-0000-4000-8000-0000000000e6';

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-tax-catalog-editor-session' } };
const TAX_VIEWER = { cookies: { b2b_session: 'stub-taxes-viewer-session' } };
const TAX_EDITOR = { cookies: { b2b_session: 'stub-taxes-editor-session' } };
const SEEDED_SALES_REP = { cookies: { b2b_session: 'stub-tax-seeded-sales-rep-session' } };

const PREVIEW_URL = '/api/v1/admin/taxes/preview?country=PL&productType=simple&vatStatus=vat_payer';

describe('taxes permission authority', () => {
  let h: BackendServerHandle;

  async function createRole(
    code: string,
    name: string,
    permissions: readonly string[],
  ): Promise<string> {
    const em = h.em();
    const role = em.create(AdminRole, { code, name, permissions: [...permissions] });
    await em.persistAndFlush(role);
    return role.id;
  }

  async function createAdmin(id: string, email: string, adminRoleId: string): Promise<void> {
    const em = h.em();
    em.create(AdminUser, {
      id,
      email,
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Tax',
      lastName: 'Authority',
      adminRoleId,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // Holds *both* catalogue codes and neither tax code: the role the old gates
    // handed the whole tax surface to, reads included.
    const catalogRoleId = await createRole('tax_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    // The read half of the new pair, alone, so "can read" and "cannot write"
    // are two facts about one role rather than two roles.
    const viewerRoleId = await createRole('tax_rates_viewer', 'Tax viewer', ['taxes:read']);
    const editorRoleId = await createRole('tax_rates_editor', 'Tax editor', [
      'taxes:read',
      'taxes:write',
    ]);
    // The shipped role, verbatim from the seed's own constant.
    const salesRepRoleId = await createRole(
      'tax_seeded_sales_rep',
      'Sales representative',
      SALES_REPRESENTATIVE_PERMISSIONS,
    );

    await createAdmin(CATALOG_EDITOR_ID, 'tax-catalog-editor@example.com', catalogRoleId);
    await createAdmin(TAX_VIEWER_ID, 'tax-rates-viewer@example.com', viewerRoleId);
    await createAdmin(TAX_EDITOR_ID, 'tax-rates-editor@example.com', editorRoleId);
    await createAdmin(SEEDED_SALES_REP_ID, 'tax-seeded-sales-rep@example.com', salesRepRoleId);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * A rule of this file's own, never the default one: `isDefault` is a
   * single-row invariant across the whole table (a partial unique index), so a
   * fixture claiming it would be a fixture reaching into every other file's
   * resolution.
   */
  async function seedRule(): Promise<{ id: string; code: string }> {
    const em = h.em();
    const rule = em.create(Tax, {
      code: `authority_${randomUUID().slice(0, 8)}`,
      name: 'Authority rule',
      rate: '0.2300',
      country: 'PL',
      isDefault: false,
      priority: 0,
    });
    await em.persistAndFlush(rule);
    return { id: rule.id, code: rule.code };
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  it('refuses the configuration read to a role holding the catalogue codes and not taxes:read', async () => {
    await seedRule();

    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/taxes', ...CATALOG_EDITOR }),
    );
    // The preview is a read of the same configuration, one resolution further
    // on: it answers what rate a given order line would be charged.
    expectForbidden(await h.app.inject({ method: 'GET', url: PREVIEW_URL, ...CATALOG_EDITOR }));
  });

  it('refuses the configuration write to a role holding catalog:write and not taxes:write', async () => {
    const { id, code } = await seedRule();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/taxes/${code}`,
        ...CATALOG_EDITOR,
        payload: { code, name: 'Rewritten', rate: 0.05, country: 'PL' },
      }),
    );
    expectForbidden(
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/taxes/${id}`, ...CATALOG_EDITOR }),
    );

    // And the refusal is total, not merely an error status: the rate still says
    // what it said, and the rule is still there.
    const em = h.em();
    em.clear();
    const row = await em.findOne(Tax, { id });
    expect(row).not.toBeNull();
    expect(Number(row!.rate)).toBeCloseTo(0.23);
    expect(row!.name).toBe('Authority rule');
  });

  it('serves the configuration to a role holding taxes:read', async () => {
    await seedRule();

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/taxes', ...TAX_VIEWER });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const preview = await h.app.inject({ method: 'GET', url: PREVIEW_URL, ...TAX_VIEWER });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { data: { source: string } }).data.source).toBeTypeOf('string');
  });

  it('refuses every write to a role holding taxes:read alone', async () => {
    const { id, code } = await seedRule();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/taxes/${code}`,
        ...TAX_VIEWER,
        payload: { code, name: 'Rewritten', rate: 0.05, country: 'PL' },
      }),
    );
    expectForbidden(
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/taxes/${id}`, ...TAX_VIEWER }),
    );
  });

  it('completes the write for a role holding the taxes pair', async () => {
    // The other half of the authority claim: the new codes are *sufficient*,
    // and not merely newly required on top of the catalogue's.
    const { id, code } = await seedRule();

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/taxes/${code}`,
      ...TAX_EDITOR,
      payload: { code, name: 'Rewritten', rate: 0.05, country: 'PL' },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as { data: { rate: number; name: string } };
    expect(body.data.rate).toBeCloseTo(0.05);
    expect(body.data.name).toBe('Rewritten');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/taxes/${id}`,
      ...TAX_EDITOR,
    });
    expect(del.statusCode).toBe(204);
  });

  /**
   * A **standing** assertion, and the one place this module differs from its
   * three predecessors: `sales_representative` holds `catalog:read` and not
   * `catalog:write`, and every tax route was gated on the write code, so this
   * role was refused the tax table before this change as well.
   *
   * It is asserted anyway because the repair could have got it wrong in the
   * other direction — `taxes:read` is a *new* capability, and a repair that
   * granted it by way of a catalogue code, or that left one of the four routes
   * on the old gate, would show up here. What it is not is red-before evidence,
   * and saying so is the difference between a test that measures the change and
   * one that decorates it.
   */
  it('refuses the configuration to the seeded sales_representative', async () => {
    // Guard the premise rather than assume it: the case is only about tax
    // access if the seeded list genuinely grants neither code.
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('taxes:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');

    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/taxes', ...SEEDED_SALES_REP }),
    );
    expectForbidden(await h.app.inject({ method: 'GET', url: PREVIEW_URL, ...SEEDED_SALES_REP }));
  });

  /**
   * The readers that are not the configuration screen.
   *
   * Tax data reaches `orders`, `carts`, `product_feeds` and `quote_requests`
   * through the `taxService` **port**, in process — not through these routes,
   * which nothing but the admin tax screen calls. So moving the HTTP gates
   * cannot degrade a price, a cart total or a feed line, and this asserts the
   * premise rather than leaving it as a claim in a commit message: the resolver
   * answers for a caller holding no admin permission at all.
   */
  it('leaves the in-process resolver reachable, which is how every other module reads a rate', async () => {
    const { taxService } = h.container.cradle as unknown as { taxService: TaxServicePort };
    const resolved = await taxService.taxRateFor({
      country: 'PL',
      productType: 'simple',
      vatStatus: 'vat_payer',
    });
    expect(['rule', 'default', 'none']).toContain(resolved.source);
  });
});
