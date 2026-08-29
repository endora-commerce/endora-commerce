import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization, type CategoryRow, type ProductRow } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../helpers/package-entities.js';
import { Category } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US7 — Price display mode chain (T079).
 *
 * Verifies:
 *   - FR-037: settings keys default to 'gross_only'.
 *   - FR-038: per-Org / per-Category / per-Product overrides settable.
 *   - FR-039: chain Product → Category → Organization → Settings(default |
 *     unauthenticated) — most-specific override wins.
 *   - FR-042: changes propagate (within the test, immediately).
 */
describe('Feature 011 / US7 — display-mode chain (T079)', () => {
  let h: BackendServerHandle;
  let product: ProductRow;
  let category: CategoryRow;
  let salesChannel: SalesChannel;
  let organization: Organization;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists", "price_display_mode_overrides" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    const em = h.em();
    product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    salesChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });

    const rows = await em
      .getConnection()
      .execute<
        Array<{ category_id: string }>
      >(`select category_id from product_categories where product_id = ?`, [SEED_PRODUCT_101_ID]);
    category = await em.findOneOrFail(Category, { id: rows[0]!.category_id });

    const org = em.create(Organization, {
      name: 'US7 Org',
      taxId: `US7-${Date.now() % 10_000_000}-${Math.floor(Math.random() * 1000)}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'X', city: 'X', postalCode: 'X', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organization = org;

    // Reset pricing.* settings so each test starts from a known state —
    // clear both the per-channel SettingValue rows and the global tier
    // (settings.global_value) so a global override set by one test can't
    // leak into the next.
    const pricingSettings = await em.find(Setting, { code: { $like: 'pricing.%' } });
    if (pricingSettings.length > 0) {
      const sv = await em.find(SettingValue, {
        setting: { $in: pricingSettings.map((s) => s.id) },
      });
      for (const v of sv) em.remove(v);
      for (const s of pricingSettings) s.globalValue = null;
      await em.flush();
    }

    // Seed Default with a bracket so resolveEngine returns a base.
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
    });
  });

  it('FR-039: defaults to settings.default_display_mode for signed-in customers when no override', async () => {
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.displayMode).toBe('gross_only');
  });

  it('FR-039: defaults to settings.unauthenticated_display_mode for guests when no override', async () => {
    // Set unauthenticated mode = 'none' via the service.
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.setSettingsDisplayMode('unauthenticated_display_mode', 'none');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.displayMode).toBe('none');
  });

  it('FR-039: honours the global settings tier (admin "All channels") when there is no per-channel value', async () => {
    // Simulate the admin setting default_display_mode = 'both' at the global
    // tier (settings.global_value) via the "All channels" editor — no
    // per-channel SettingValue row is written. The resolver must surface it
    // instead of silently falling back to the manifest default 'gross_only'.
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'pricing.default_display_mode' });
    setting.globalValue = 'both';
    await em.flush();

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.displayMode).toBe('both');
  });

  it('FR-038/039: Organization override beats Settings for signed-in customers', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('organization', organization.id, 'both');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.displayMode).toBe('both');
  });

  it('FR-039: Organization override is ignored for guests; Settings.unauthenticated wins', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('organization', organization.id, 'both');
    await svc.setSettingsDisplayMode('unauthenticated_display_mode', 'none');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.displayMode).toBe('none');
  });

  it('FR-039: Category override beats Organization', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('organization', organization.id, 'both');
    await svc.upsertDisplayModeOverride('category', category.id, 'net_only');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.displayMode).toBe('net_only');
  });

  it('FR-039: Product override beats Category and Organization', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('organization', organization.id, 'both');
    await svc.upsertDisplayModeOverride('category', category.id, 'net_only');
    await svc.upsertDisplayModeOverride('product', product.id, 'none');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.displayMode).toBe('none');
  });

  it('FR-039 + Category: Product override applies for guests too (no Organization step)', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('product', product.id, 'gross_only');

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization: null, salesChannel },
    });
    expect(out.displayMode).toBe('gross_only');
  });

  it('FR-038: setting an override to "inherit" deletes the override row', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.upsertDisplayModeOverride('product', product.id, 'none');
    expect(await svc.listDisplayModeOverrides()).toHaveLength(1);

    await svc.upsertDisplayModeOverride('product', product.id, 'inherit');
    expect(await svc.listDisplayModeOverrides()).toHaveLength(0);
  });

  it('FR-038: rejects an override targeting a non-existent row', async () => {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await expect(
      svc.upsertDisplayModeOverride('product', '00000000-0000-4000-8000-000000ffff00', 'none'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
