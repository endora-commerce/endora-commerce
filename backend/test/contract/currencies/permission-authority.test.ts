import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CurrencyReadPort } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Currency } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '../../../src/seeds/seeded-role-permissions.js';

/**
 * `currencies` owns its own authority, and its own routes.
 *
 * `GET /api/v1/admin/currencies`, the upsert, the delete and
 * `POST /:code/default` were registered by **`languages`** and enforced
 * `catalog:write` — all four, the list read included. So whoever could edit a
 * product description could add a currency, deactivate one, delete one and
 * promote one to the shop's default, which is the denomination every price,
 * cart, order and invoice is stated in.
 *
 * Three things about the arrangement are worth stating precisely, because the
 * obvious explanation for it is wrong. `languages` did not host these routes
 * because it shares a screen with them: the admin currency screen is
 * `dictionaries`' `DictionaryPage`, and it calls
 * `/api/v1/admin/dictionary/currencies/*`, a different route set gated on
 * `dictionary.write`. Nothing in this repository — no admin screen, no
 * `@endora-commerce/api-client` method, no seed, no script — calls the four
 * routes this file is about. And the currency **half** of `languages`' i18n
 * surface is not gone: `GET /api/v1/i18n/config` still answers with both
 * catalogues, which is composition of a public read rather than ownership of a
 * write surface.
 *
 * Nothing could see the defect. `catalog:write` is real, declared and
 * enforced, so the permission inventory's two directions were clean over the
 * site; D-173's `foreign-gate` sweep passes it deliberately, because `catalog`
 * is `nonDeactivatable` and the availability coupling that sweep asks about can
 * never bite; and `check:action-route-permissions` never looked at all, neither
 * module declaring a manifest action. That last one was **measured** rather
 * than assumed, by injecting a throwaway action and removing it: an action
 * declaring `catalog:write` against these routes reports `mismatched` and the
 * same action declaring `currencies:read` reports `violations=0`. A check that
 * is silent because there is nothing to see is not the same as one that is
 * asleep. None of the three asks whether `catalog:write` is the right authority
 * for changing what a shop charges in, which is a judgement rather than a
 * derivation, so the answer is pinned here rather than in a new check.
 *
 * **The move also makes the module-presence gate structural.** In `languages`
 * it was a property of the two ports those routes happened to resolve, written
 * down in a comment; here it is `ctx.routes`, the registration seam
 * Constitution XVII item 1 asks for. `currencies` declares
 * `activation.nonDeactivatable`, so today the gate can never bite — which is
 * exactly why it should not rest on an author's memory.
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

const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000e7';
const CURRENCY_VIEWER_ID = '00000000-0000-4000-8000-0000000000e8';
const CURRENCY_EDITOR_ID = '00000000-0000-4000-8000-0000000000e9';

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-currencies-catalog-editor-session' } };
const CURRENCY_VIEWER = { cookies: { b2b_session: 'stub-currencies-viewer-session' } };
const CURRENCY_EDITOR = { cookies: { b2b_session: 'stub-currencies-editor-session' } };

/**
 * A code of this file's own, and never the default one: exactly one row carries
 * `is_default` (a partial unique index), so a fixture claiming it would be a
 * fixture reaching into every other file's resolution.
 */
const PROBE = 'XCA';

describe('currencies permission authority', () => {
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
      firstName: 'Currency',
      lastName: 'Authority',
      adminRoleId,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // Holds *both* catalogue codes and neither currency code: the role the old
    // gates handed the whole currency surface to, the list read included.
    const catalogRoleId = await createRole('currency_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    const viewerRoleId = await createRole('currency_viewer', 'Currency viewer', [
      'currencies:read',
    ]);
    const editorRoleId = await createRole('currency_editor', 'Currency editor', [
      'currencies:read',
      'currencies:write',
    ]);

    await createAdmin(CATALOG_EDITOR_ID, 'currency-catalog-editor@example.com', catalogRoleId);
    await createAdmin(CURRENCY_VIEWER_ID, 'currency-viewer@example.com', viewerRoleId);
    await createAdmin(CURRENCY_EDITOR_ID, 'currency-editor@example.com', editorRoleId);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedProbe(): Promise<void> {
    const em = h.em();
    em.clear();
    const existing = await em.findOne(Currency, { code: PROBE });
    if (existing) return;
    em.create(Currency, {
      code: PROBE,
      label: 'Authority probe',
      symbol: 'X',
      symbolPosition: 'prefix',
      decimalPlaces: 2,
      isDefault: false,
      isActive: true,
      sortOrder: 900,
    });
    await em.flush();
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  it('refuses the currency list to a role holding the catalogue codes', async () => {
    await seedProbe();
    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/currencies', ...CATALOG_EDITOR }),
    );
  });

  it('refuses every currency write to a role holding catalog:write', async () => {
    await seedProbe();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/currencies/${PROBE}`,
        ...CATALOG_EDITOR,
        payload: { label: 'Rewritten', symbol: 'Z' },
      }),
    );
    // The one that decides what the shop charges in. It was the same code as
    // "edit a product description" until this change.
    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/currencies/${PROBE}/default`,
        ...CATALOG_EDITOR,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/currencies/${PROBE}`,
        ...CATALOG_EDITOR,
      }),
    );

    // And the refusal is total, not merely an error status: the row still says
    // what it said, and it is still not the default.
    const em = h.em();
    em.clear();
    const row = await em.findOne(Currency, { code: PROBE });
    expect(row).not.toBeNull();
    expect(row!.label).toBe('Authority probe');
    expect(row!.isDefault).toBe(false);
  });

  it('serves the currency list to a role holding currencies:read', async () => {
    await seedProbe();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/currencies',
      ...CURRENCY_VIEWER,
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ code: string }> }).data.map((c) => c.code);
    expect(codes).toContain(PROBE);
  });

  it('refuses every write to a role holding currencies:read alone', async () => {
    // The capability the pair creates: a currency can now be shown to someone
    // who may not change it. Before this change the list route carried the
    // write code, so there was no such role to have.
    await seedProbe();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/currencies/${PROBE}`,
        ...CURRENCY_VIEWER,
        payload: { label: 'Rewritten', symbol: 'Z' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/currencies/${PROBE}/default`,
        ...CURRENCY_VIEWER,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/currencies/${PROBE}`,
        ...CURRENCY_VIEWER,
      }),
    );
  });

  it('completes the write for a role holding the currencies pair', async () => {
    // The other half of the authority claim: the new codes are *sufficient*,
    // and not merely newly required on top of the catalogue's.
    await seedProbe();

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/currencies/${PROBE}`,
      ...CURRENCY_EDITOR,
      payload: { label: 'Rewritten', symbol: 'Z' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { data: { label: string } }).data.label).toBe('Rewritten');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/currencies/${PROBE}`,
      ...CURRENCY_EDITOR,
    });
    expect(del.statusCode).toBe(204);
  });

  /**
   * A **standing** assertion rather than red-before evidence, and saying so is
   * the difference between a test that measures the change and one that
   * decorates it: the seeded `sales_representative` holds `catalog:read` and
   * not `catalog:write`, and every currency route carried the write code, so it
   * was refused this surface before as well. It is asserted because the repair
   * could have got it wrong in the other direction — `currencies:read` is a
   * *new* capability, and a repair that granted it by way of a catalogue code
   * would show up here.
   */
  it('refuses the currency surface to the seeded sales_representative', async () => {
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('currencies:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');
  });

  /**
   * The readers that are not this admin surface.
   *
   * Every other module reads currency data through `currencyReadPort` in
   * process — `languages`' own `GET /api/v1/i18n/config` among them, which is
   * why that route stayed where it is. So moving these four gates cannot
   * degrade a price, a config payload or a picker, and this asserts the premise
   * through the container rather than leaving it as a claim in a commit
   * message: the port answers for a caller holding no admin permission at all.
   */
  it('leaves the in-process read port reachable, which is how every other module reads a currency', async () => {
    const { currencyReadPort } = h.container.cradle as unknown as {
      currencyReadPort: CurrencyReadPort;
    };
    const rows = await currencyReadPort.list();
    expect(rows.length).toBeGreaterThan(0);
  });

  /**
   * The public aggregate `languages` kept, asserted here because this merge
   * request is what could have broken it: the currency half of
   * `GET /api/v1/i18n/config` is served over the same port whose *admin* twin
   * moved out of that module.
   */
  it('keeps the public i18n config answering with both catalogues', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/i18n/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { currencies: unknown[]; languages: unknown[]; defaultCurrencyCode: string | null };
    };
    expect(body.data.currencies.length).toBeGreaterThan(0);
    expect(body.data.languages.length).toBeGreaterThan(0);
    expect(body.data.defaultCurrencyCode).toBeTypeOf('string');
  });
});
