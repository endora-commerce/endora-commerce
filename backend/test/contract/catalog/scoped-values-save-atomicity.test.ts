import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CatalogAttributeView } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { scopedValuesSaveCommand } from '../../../../packages/modules/catalog/dist/backend/commands/scoped-values.commands.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US7 (T104; FR-071, FR-073, FR-076, SC-007) — a Save is all or nothing. A failure
 * injected before each family writer (through the Command's test seam), a late `URL_KEY_TAKEN`
 * from the URL-key step, and a refuse-mode completeness gate each leave the product exactly as it
 * was: no row written, no audit entry, no `product.updated.v1`.
 */
describe('172 US7 — the Save is atomic (T104)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let required: string;
  const SETTING = 'catalog.scope_completeness_gate';

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    required = await fx.attribute({ key: 'grade', valueType: 'string', scopable: true, isRequired: true });
  });

  afterEach(async () => {
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/settings/${SETTING}/values`, ...ADMIN });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  /** Every store the save writes, for one product. */
  const snapshot = async (productId: string) => ({
    product: await fx.sql(`select name, description, status, returnable, attribute_values, slug, scope_version::text from products where id = ?`, [productId]),
    overrides: await fx.sql(`select attribute_key, channel_id::text, language_code, value from product_value_overrides where product_id = ? order by 1, 2, 3`, [productId]),
    channelRows: await fx.sql(`select sales_channel_id::text, status, returnable from product_channel_scopes where product_id = ?`, [productId]),
    languageRows: await fx.sql(`select sales_channel_id::text, language_code, status from product_channel_language_scopes where product_id = ?`, [productId]),
    gallery: await fx.sql(`select gallery_item_id::text, field, value from gallery_item_scope_overrides where product_id = ? order by 1, 2`, [productId]),
    attachments: await fx.sql(`select attachment_id::text, field, value from product_attachment_scope_overrides where product_id = ?`, [productId]),
    units: await fx.sql(`select packaging_unit_id::text, value from product_packaging_unit_scope_overrides where product_id = ?`, [productId]),
    keys: await fx.sql(`select key from product_url_keys where product_id = ?`, [productId]),
    audits: await fx.sql(`select id from audit_log_entries where action = 'product.scoped_values.save' and object_id = ?`, [productId]),
  });

  function captureEvents(productId: string) {
    const seen: unknown[] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      if ((payload as unknown as { productId: string }).productId === productId) seen.push(payload);
    });
    return { seen, off };
  }

  it.each(['product', 'channelRow', 'value', 'gallery', 'attachment', 'packagingUnit', 'urlKey'])(
    'a failure before the %s writer writes nothing, audits nothing and announces nothing',
    async (family) => {
      const id = await fx.product({ channels: [channel], attributeValues: { [required]: 'A' } });
      const { items, attachment, unit } = await fx.media(id);
      const before = await snapshot(id);
      const events = captureEvents(id);
      const cradle = h.container.cradle as unknown as {
        commandBus: CommandBus;
        salesChannelMembershipPort: never;
        catalogAttributeReadPort: { listAll: () => Promise<CatalogAttributeView[]> };
      };
      const urlKeyCalls: string[] = [];
      const command = scopedValuesSaveCommand(
        {
          membership: cradle.salesChannelMembershipPort,
          listAttributes: () => cradle.catalogAttributeReadPort.listAll(),
          writeUrlKey: async () => {
            urlKeyCalls.push('called');
            return { before: {}, after: {} };
          },
          probe: (at) => {
            if (at === family) throw new Error(`injected failure before ${family}`);
          },
        },
        id,
        {
          scope: { channelId: channel },
          version: (await fx.read(id)).version,
          changes: {
            name: 'Channel name',
            returnable: true,
            urlKey: `t104-${fx.run}-${family.toLowerCase()}`,
            gallery: { items: { [items[0]]: { altText: 'Alt' } } },
            attachments: { [attachment]: { name: 'Doc' } },
            packagingUnits: { [unit]: { name: 'Box' } },
          },
        },
        undefined,
      );
      await expect(cradle.commandBus.run(command)).rejects.toThrow(`injected failure before ${family}`);
      events.off();
      expect(await snapshot(id)).toEqual(before);
      expect(events.seen).toEqual([]);
      // The URL-key step runs after the probe of its family, so an earlier failure never reaches it.
      expect(urlKeyCalls).toEqual([]);
    },
  );

  it('a late URL_KEY_TAKEN rolls the whole save back', async () => {
    const holder = await fx.product({ channels: [channel], attributeValues: { [required]: 'A' } });
    await fx.save(holder, { channelId: channel }, { urlKey: `t104-taken-${fx.run}` });
    const id = await fx.product({ channels: [channel], attributeValues: { [required]: 'A' } });
    const before = await snapshot(id);
    const events = captureEvents(id);
    const res = await fx.put(id, { channelId: channel }, { name: 'Would be written', returnable: true, urlKey: `t104-taken-${fx.run}` });
    events.off();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.URL_KEY_TAKEN } });
    expect(await snapshot(id)).toEqual(before);
    expect(events.seen).toEqual([]);
  });

  it('a refuse-mode gate refuses the whole save (FR-076)', async () => {
    const id = await fx.product({ channels: [channel] });
    const scope = { channelId: channel, languageCode: 'pl-PL' };
    await fx.save(id, scope, { status: 'inactive' });
    const mode = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/settings/${SETTING}/value`, ...ADMIN, payload: { scope: 'all', value: 'refuse' } });
    expect(mode.statusCode, mode.body).toBe(200);
    const before = await snapshot(id);
    const events = captureEvents(id);
    const res = await fx.put(id, scope, { status: 'active', name: 'Wiertarka' });
    events.off();
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INCOMPLETE } });
    expect(await snapshot(id)).toEqual(before);
    expect(events.seen).toEqual([]);
  });
});
