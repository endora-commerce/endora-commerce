/**
 * Feature 160 (FR-044, SC-007, US8) — the demo shows the owner's scenarios.
 *
 * `endora demo seed` writes base prices for every demo product straight into
 * the PLN base book and seeds the books of `specs/pricing/worked-examples.md`
 * §10.2–§10.4 on the demo channel, against the demo's own organization
 * (*Acme B2B (demo)*, in the customer group *VIP*), the category *Screws*, the
 * attribute value `color = red` and the product *Screws 0200*. The scenarios
 * are alternatives (owner, answer A): after a reset and a seed E3's books are
 * active and E1's and E2's are drafts; activating one scenario's books alone
 * reproduces that scenario's literal numbers; and the next reset and seed puts
 * the demo back.
 *
 * The vectors' other buyers — *Beta* (VIP), *Gamma* (no group) and *AcmeW*
 * (a child of Acme, VIP) — are buyers, not demo data, so this file creates them
 * around the demo and removes them before each reset. P2 and P3 of the vectors
 * are the demo's *Screws 0032* (blue, 50 PLN) and *Bolts 0025* (red, 30 PLN),
 * priced so by the demo's own base rows.
 *
 * In process, for the reason `demo/demo-reset-after-use.test.ts` gives: the
 * pricing engine has to read the database the demo was just written to, so the
 * CLI dispatcher runs over the harness's composition.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoComposition } from '@endora-commerce/demo-composition';
import { cliFailureExitCode, dispatchCli, type CliComposition } from '@endora-commerce/platform/cli';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import type { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import type { PriceBookService } from '../../../../packages/modules/price_lists/src/backend/services/price-book-service.js';
import { DEMO_PRICE_BOOKS } from '../../../../packages/modules/price_lists/src/backend/demo/rows.js';

const SUITE_TIMEOUT_MS = 900_000;
const DEMO_ORG_TAX_ID = 'PL5210000099';

interface DemoProduct {
  id: string;
  attributeValues: Record<string, unknown>;
}

type Buyer = 'guest' | { id: string; customerGroupId: string | null };

describe('the demo reproduces E1–E3, one scenario at a time (SC-007)', () => {
  let h: BackendServerHandle;
  let pricing: PricingService;
  let books: PriceBookService;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const system = <T>(work: () => Promise<T>) => withSystemScope('feature 160 demo scenarios', work);

  async function demo(verb: 'seed' | 'reset'): Promise<void> {
    let out = '';
    let err = '';
    const composition = {
      container: h.container,
      contextFor: () => ({ cradle: () => h.container.cradle }),
      resolvedModules: [],
      orm: h.orm,
      dispose: async () => {},
    } as unknown as CliComposition;
    let code: number;
    try {
      code = await dispatchCli({
        deploymentRoot: deploymentRoot(),
        argv: ['demo', verb],
        resolveEntries: resolvedManifestEntries,
        compose: async () => composition,
        demoComposition: async (input) => ({ found: true, composition: createDemoComposition(input) }),
        out: (chunk) => (out += chunk),
        err: (chunk) => (err += chunk),
      });
    } catch (thrown) {
      code = cliFailureExitCode(thrown, (chunk) => (err += chunk));
    }
    expect(code, `demo ${verb}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`).toBe(0);
  }

  let channel: { id: string; defaultCurrency: string };
  let acme: { id: string; customerGroupId: string | null };
  let vip: string;
  let P1: DemoProduct;
  let P2: DemoProduct;
  let P3: DemoProduct;
  const others: { Beta?: Buyer; Gamma?: Buyer; AcmeW?: Buyer } = {};

  async function product(sku: string): Promise<DemoProduct> {
    const [row] = await sql<{ id: string; attribute_values: Record<string, unknown> }>(
      `select "id", "attribute_values" from "products" where "sku" = ?`,
      [sku],
    );
    if (!row) throw new Error(`demo product ${sku} is missing`);
    return { id: row.id, attributeValues: row.attribute_values };
  }

  /** The demo's natural keys, re-read after every seed (a reset and a seed mint new ids). */
  async function readDemo(): Promise<void> {
    const [ch] = await sql<{ id: string; default_currency: string }>(
      `select "id", "default_currency" from "sales_channels" where "system_default" = true`,
    );
    channel = { id: ch!.id, defaultCurrency: ch!.default_currency.trim() };
    const [org] = await sql<{ id: string; customer_group_id: string | null }>(
      `select "id", "customer_group_id" from "organizations" where "tax_id" = ?`,
      [DEMO_ORG_TAX_ID],
    );
    acme = { id: org!.id, customerGroupId: org!.customer_group_id };
    const [group] = await sql<{ id: string }>(`select "id" from "customer_groups" where "code" = 'demo-vip'`);
    vip = group!.id;
    P1 = await product('DEMO-SCREWS-0200');
    P2 = await product('DEMO-SCREWS-0032');
    P3 = await product('DEMO-BOLTS-0025');
  }

  /** Beta (VIP), Gamma (no group) and AcmeW (Acme's child, VIP), around the demo. */
  async function createOtherBuyers(): Promise<void> {
    const insert = async (name: string, groupId: string | null, parent?: string) => {
      const id = randomUUID();
      const [parentRow] = parent
        ? await sql<{ path: string }>(`select "path" from "organizations" where "id" = ?`, [parent])
        : [];
      await sql(
        `insert into "organizations" ("id", "name", "tax_id", "status", "vat_status", "customer_group_id",
                                      "registered_address", "parent_id", "path", "created_at", "updated_at")
         values (?, ?, ?, 'active', 'vat_payer', ?, ?::jsonb, ?, ?, now(), now())`,
        [
          id,
          `${name} (demo scenarios)`,
          `PL160DEMO${name.toUpperCase()}`,
          groupId,
          JSON.stringify({ street: 'Test 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' }),
          parent ?? null,
          parentRow ? `${parentRow.path}${id}/` : `/${id}/`,
        ],
      );
      return { id, customerGroupId: groupId };
    };
    others.Beta = await insert('Beta', vip);
    others.Gamma = await insert('Gamma', null);
    others.AcmeW = await insert('AcmeW', vip, acme.id);
  }

  async function removeOtherBuyers(): Promise<void> {
    await sql(`delete from "organizations" where "tax_id" like 'PL160DEMO%' and "parent_id" is not null`);
    await sql(`delete from "organizations" where "tax_id" like 'PL160DEMO%'`);
  }

  async function freshDemo(): Promise<void> {
    await removeOtherBuyers();
    await demo('reset');
    await demo('seed');
    await readDemo();
    await createOtherBuyers();
  }

  async function amount(buyer: Buyer, target: DemoProduct): Promise<string | null> {
    const answer = await pricing.resolveLinePrices({
      lines: [{ key: 'k', product: target, variantId: null, quantity: 1 }],
      context: {
        salesChannel: channel,
        ...(buyer === 'guest' ? {} : { organization: buyer }),
      },
    });
    return answer.get('k')?.amount ?? null;
  }

  async function statusOf(bookId: string): Promise<string> {
    const [row] = await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [bookId]);
    return row!.status;
  }

  const scenarioBooks = {
    E1: [DEMO_PRICE_BOOKS.e1.id],
    E2: [DEMO_PRICE_BOOKS.e2.id],
    E3: [DEMO_PRICE_BOOKS.e3Vip.id, DEMO_PRICE_BOOKS.e3Acme.id],
  } as const;

  /** Only this scenario's books active. */
  async function only(scenario: keyof typeof scenarioBooks): Promise<void> {
    await system(async () => {
      for (const [name, ids] of Object.entries(scenarioBooks)) {
        if (name === scenario) continue;
        for (const id of ids) if ((await statusOf(id)) !== 'draft') await books.draftify(id);
      }
      for (const id of scenarioBooks[scenario]) if ((await statusOf(id)) === 'draft') await books.activate(id);
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const container = h.container as unknown as { resolve<T>(name: string): T };
    const handle = container.resolve<{ handle: { pricingEngine: PricingService; priceBookService: PriceBookService } }>(
      'priceLists',
    ).handle;
    pricing = handle.pricingEngine;
    books = handle.priceBookService;
    await freshDemo();
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (h) {
      await removeOtherBuyers().catch(() => undefined);
      await teardownBackendServer(h);
    }
  });

  it('a fresh demo holds base prices, E3 active, E1 and E2 drafts, on the demo channel', async () => {
    expect(acme.customerGroupId).toBe(vip);
    expect(await amount('guest', P1)).toBe('100.0000');
    expect(await amount('guest', P2)).toBe('50.0000');
    expect(await amount('guest', P3)).toBe('30.0000');
    expect(await statusOf(DEMO_PRICE_BOOKS.e3Vip.id)).toBe('active');
    expect(await statusOf(DEMO_PRICE_BOOKS.e3Acme.id)).toBe('active');
    expect(await statusOf(DEMO_PRICE_BOOKS.e1.id)).toBe('draft');
    expect(await statusOf(DEMO_PRICE_BOOKS.e2.id)).toBe('draft');
    const channels = await sql<{ price_list_id: string; sales_channel_id: string }>(
      `select "price_list_id", "sales_channel_id" from "sales_channel_price_lists" where "price_list_id" = any(?::uuid[])`,
      [`{${Object.values(DEMO_PRICE_BOOKS).map((b) => b.id).join(',')}}`],
    );
    expect(channels).toHaveLength(4);
    expect(new Set(channels.map((c) => c.sales_channel_id))).toEqual(new Set([channel.id]));
    // The demo product carries no price of its own any more (FR-042).
    expect(P1.attributeValues).not.toHaveProperty('defaultPrice');
  });

  it('E3 holds after a reset (E3.1–E3.6)', async () => {
    expect(await amount(acme, P1), 'E3.1').toBe('95.0000');
    expect(await amount(others.Beta!, P1), 'E3.2').toBe('90.0000');
    expect(await amount(acme, P2), 'E3.3').toBe('42.5000');
    expect(await amount(others.Gamma!, P1), 'E3.5 Gamma').toBe('100.0000');
    expect(await amount('guest', P1), 'E3.5 guest').toBe('100.0000');
    expect(await amount(others.AcmeW!, P1), 'E3.6').toBe('95.0000');
    // E3.4 — plus e3b, VIP × P2 −10 %: the organization's category deal still wins under HY.
    const e3b = await system(() =>
      books.replaceRows(DEMO_PRICE_BOOKS.e3Vip.id, {
        upsert: [{ selection: { productId: P2.id }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-10' } }],
        delete: [],
      }),
    );
    try {
      expect(await amount(acme, P2), 'E3.4').toBe('42.5000');
    } finally {
      const added = e3b.rows.filter((r) => r.productId === P2.id).map((r) => r.id);
      await system(() => books.replaceRows(DEMO_PRICE_BOOKS.e3Vip.id, { upsert: [], delete: added }));
    }
  });

  it('E1 holds with only its books active (E1.1–E1.4)', async () => {
    await only('E1');
    expect(await amount('guest', P1), 'E1.1').toBe('120.0000');
    expect(await amount('guest', P2), 'E1.2').toBe('50.0000');
    expect(await amount('guest', P3), 'E1.3').toBe('30.0000');
    expect(await amount(acme, P1), 'E1.4').toBe('120.0000');
  });

  it('E2 holds with only its books active (E2.1–E2.4)', async () => {
    await only('E2');
    expect(await amount(acme, P1), 'E2.1').toBe('80.0000');
    expect(await amount(acme, P2), 'E2.2').toBe('45.0000');
    expect(await amount(acme, P3), 'E2.3').toBe('30.0000');
    expect(await amount(others.Beta!, P1), 'E2.4').toBe('100.0000');
  });

  it('the next reset and seed put the demo back: E3 active, E1 and E2 drafts', async () => {
    await freshDemo();
    expect(await statusOf(DEMO_PRICE_BOOKS.e3Vip.id)).toBe('active');
    expect(await statusOf(DEMO_PRICE_BOOKS.e3Acme.id)).toBe('active');
    expect(await statusOf(DEMO_PRICE_BOOKS.e1.id)).toBe('draft');
    expect(await statusOf(DEMO_PRICE_BOOKS.e2.id)).toBe('draft');
    expect(await amount(acme, P1), 'E3.1').toBe('95.0000');
    expect(await amount(acme, P2), 'E3.3').toBe('42.5000');
    // A second seed changes nothing (idempotent).
    await demo('seed');
    const [count] = await sql<{ n: string }>(
      `select count(*) as "n" from "price_list_matrix_entries" where "price_list_id" = any(?::uuid[])`,
      [`{${Object.values(DEMO_PRICE_BOOKS).map((b) => b.id).join(',')}}`],
    );
    expect(Number(count!.n)).toBe(6);
    expect(await amount(acme, P1), 'E3.1').toBe('95.0000');
  });
});
