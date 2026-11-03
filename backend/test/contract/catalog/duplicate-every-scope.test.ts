import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScopedValuesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type Scope, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, FR-119 (round 8, T151) — duplicating a product copies its values at every scope:
 * Global, Channel and Channel × language, deliberately empty overrides and inherit states
 * included, for texts, attributes, gallery / attachment / packaging values, roles, hidden, MOQ,
 * audience, publication window and returnable — in one audited Command.
 *
 * Not copied: URL keys beyond the copy's fresh Global key, and status at any scope (163 Q1-d: a
 * duplicate starts `inactive` everywhere so the operator reviews it before it is sold).
 *
 * The comparison reads the source and the copy through `GET …/scoped-values` at every scope and
 * expects the same views once the copy's own identity (ids, SKU, slug, the "(copy)" Global name,
 * status, URL key) is set aside.
 */

type Data = ScopedValuesResponse['data'];

describe('170 FR-119 — duplicate copies every scope (T151)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let a: string;
  let b: string;
  let note: string;
  let colour: string;
  let source: string;
  let copy: string;
  let galleryItems: [string, string];
  const C = (channelId: string): Scope => ({ channelId });
  const CL = (channelId: string, languageCode: string): Scope => ({ channelId, languageCode });
  const scopes = (): Array<[string, Scope]> => [
    ['G', {}],
    ['C(a)', C(a)],
    ['CL(a, pl-PL)', CL(a, 'pl-PL')],
    ['CL(a, en-US)', CL(a, 'en-US')],
    ['C(b)', C(b)],
    ['CL(b, pl-PL)', CL(b, 'pl-PL')],
  ];

  /** The view with the copy's own identity set aside; child rows by position, roles by item position. */
  function comparable(data: Data): unknown {
    const position = new Map(data.gallery.items.map((item) => [item.id, item.position]));
    const role = (view: Data['gallery']['roles']['baseImage']) => ({
      ...view,
      value: view.value === null ? null : position.get(view.value),
      ownValue: view.ownValue === undefined || view.ownValue === null ? view.ownValue : position.get(view.ownValue),
    });
    const { name, status: _status, urlKey: _urlKey, ...fields } = data.fields;
    return {
      validScopes: data.validScopes,
      // The copy's Global name carries "(copy)": compared where it is an own value, by source where inherited.
      fields: data.scope.level === 'global' || name.source === 'inherited_global' ? { ...fields, nameSource: name.source } : { name, ...fields },
      attributes: data.attributes,
      gallery: {
        items: data.gallery.items.map(({ id: _id, ...item }) => item),
        roles: {
          baseImage: role(data.gallery.roles.baseImage),
          smallImage: role(data.gallery.roles.smallImage),
          thumbnail: role(data.gallery.roles.thumbnail),
        },
      },
      attachments: data.attachments.map(({ id: _id, ...attachment }) => attachment),
      packagingUnits: data.packagingUnits.map(({ id: _id, ...unit }) => unit),
      seo: data.seo,
      organizations: data.organizations,
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    a = await fx.channel(['pl-PL', 'en-US']);
    b = await fx.channel(['pl-PL']);
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
    colour = await fx.attribute({ key: 'colour', valueType: 'select', scopable: true, options: ['red', 'blue'] });

    source = await fx.product({ channels: [a, b], name: 'Drill X', attributeValues: { [note]: 'Note G', [colour]: 'blue' } });
    const media = await fx.media(source);
    galleryItems = media.items;
    const [first, second] = media.items;
    const { attachment, unit } = media;

    await fx.save(source, {}, {
      minOrderQuantity: 3,
      returnable: true,
      window: { from: '2026-01-01T00:00:00.000Z', until: null },
      gallery: { items: { [second]: { hidden: true } }, roles: { smallImage: second } },
      attachments: { [attachment]: { name: 'Sheet G' } },
      packagingUnits: { [unit]: { name: 'Box' } },
    });
    await fx.save(source, C(a), {
      name: 'Drill A',
      description: null,
      status: 'active',
      audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
      minOrderQuantity: 5,
      returnable: false,
      window: { from: null, until: '2027-01-01T00:00:00.000Z' },
      urlKey: `dup-a-${fx.run}`,
      attributes: { [colour]: 'red' },
      gallery: { items: { [first]: { altText: 'Alt (channel)' } }, roles: { baseImage: second, thumbnail: null } },
      attachments: { [attachment]: { hidden: true } },
      packagingUnits: { [unit]: { name: 'Box (channel)' } },
    });
    await fx.save(source, CL(a, 'pl-PL'), {
      name: 'Wiertarka',
      status: 'active',
      urlKey: `wiertarka-${fx.run}`,
      attributes: { [note]: 'Notatka' },
      gallery: { items: { [first]: { altText: null }, [second]: { hidden: false } } },
      attachments: { [attachment]: { description: null, name: 'Karta' } },
      packagingUnits: { [unit]: { name: null } },
    });
    // Channel b holds no own value anywhere: every field inherits there.

    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${source}/duplicate`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(201);
    copy = (res.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    if (h) {
      if (copy) await fx.sql(`delete from products where id = ?`, [copy]);
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('copies every family at G, C and C×L, empty overrides and inherit states included', async () => {
    for (const [label, scope] of scopes()) {
      const [from, to] = [await fx.read(source, scope), await fx.read(copy, scope)];
      expect(comparable(to), label).toEqual(comparable(from));
    }
  });

  it('keeps the explicit states: an empty description, an empty role, an empty packaging name, inherit at b', async () => {
    const atA = await fx.read(copy, C(a));
    expect(atA.fields.description).toMatchObject({ value: null, source: 'set_empty' });
    expect(atA.fields.audience).toMatchObject({ source: 'set', value: { visibility: 'logged_in_only' } });
    expect(atA.fields.minOrderQuantity).toMatchObject({ value: 5, source: 'set' });
    expect(atA.gallery.roles.thumbnail).toMatchObject({ value: null, source: 'set_empty' });
    const pl = await fx.read(copy, CL(a, 'pl-PL'));
    expect(pl.fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
    expect(pl.packagingUnits[0]!.name).toMatchObject({ value: null, source: 'set_empty' });
    expect(pl.attachments[0]!.description).toMatchObject({ value: null, source: 'set_empty' });
    expect(pl.attributes.find((x) => x.key === note)!.view).toMatchObject({ value: 'Notatka', source: 'set' });
    const atB = await fx.read(copy, CL(b, 'pl-PL'));
    expect(atB.fields.name).toMatchObject({ value: 'Drill X (copy)', source: 'inherited_global' });
    const global = await fx.read(copy);
    expect(global.fields.minOrderQuantity).toMatchObject({ value: 3, source: 'set' });
    expect(global.fields.returnable).toMatchObject({ value: true, source: 'set' });
    expect(global.gallery.items[1]!.hidden).toMatchObject({ value: true, source: 'set' });
    expect(global.gallery.items[0]!.altText).toMatchObject({ value: 'Alt 0', source: 'set' });
    // The Global small-image holder is hidden at Global, so the role resolves to none (FR-012); its row is copied.
    const labels = await fx.sql<{ label: string; gallery_item_id: string }>(
      `select label, gallery_item_id from gallery_item_labels where product_id = ? order by label`,
      [copy],
    );
    expect(labels).toEqual([
      { label: 'base_image', gallery_item_id: global.gallery.items[0]!.id },
      { label: 'small_image', gallery_item_id: global.gallery.items[1]!.id },
    ]);
    expect(global.gallery.items.map((item) => item.id)).not.toContain(galleryItems[0]);
  });

  it('starts inactive at every scope: status overrides are not copied (163 Q1-d)', async () => {
    expect((await fx.read(copy)).fields.status).toMatchObject({ value: 'inactive', source: 'set' });
    expect((await fx.read(copy, C(a))).fields.status.source).toBe('inherited_global');
    expect((await fx.read(copy, CL(a, 'pl-PL'))).fields.status.source).toBe('inherited_global');
  });

  it('copies no URL key and no redirect: the copy has its fresh Global key only', async () => {
    const keys = await fx.sql(`select * from product_url_keys where product_id = ?`, [copy]);
    expect(keys).toEqual([]);
    const redirects = await fx.sql(`select * from product_url_redirects where product_id = ?`, [copy]);
    expect(redirects).toEqual([]);
    const [row] = await fx.sql<{ slug: string }>(`select slug from products where id = ?`, [copy]);
    expect(row!.slug).toMatch(/-copy/);
    expect((await fx.read(copy, CL(a, 'pl-PL'))).fields.urlKey.source).not.toBe('set');
  });

  it('records one product.duplicate Command entry naming what it copied', async () => {
    const entries = await fx.sql<{ state_after: Record<string, unknown> }>(
      `select state_after from audit_log_entries
        where object_type = 'product' and object_id = ? and action = 'product.duplicate'
          and state_after -> 'copied' is not null`,
      [copy],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state_after).toMatchObject({
      sourceProductId: source,
      copied: {
        valueOverrides: 5,
        channelScopes: 1,
        galleryItems: 2,
        galleryItemOverrides: 3,
        galleryRoles: 2,
        galleryRoleOverrides: 2,
        attachments: 1,
        attachmentOverrides: 3,
        packagingUnits: 1,
        packagingUnitOverrides: 2,
      },
    });
  });

  /**
   * PENDING T121 (S2) — `seoProductMetaWritePort` is not provided yet, and the Global row needs
   * T118's CHECK. Un-skip when S2's seo backend lands: the copy's SEO rows at G, C and C×L equal
   * the source's, an empty override included, written through the port inside the Command.
   */
  it.skip('copies SEO values at every scope through seo’s write port (PENDING T121)', async () => {
    const id = await fx.product({ channels: [a] });
    await fx.save(id, {}, { seo: { title: 'SEO G' } });
    await fx.save(id, C(a), { seo: { title: 'SEO C', description: null } });
    await fx.save(id, CL(a, 'pl-PL'), { seo: { ogTitle: 'OG pl' } });
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${id}/duplicate`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(201);
    const dup = (res.json() as { data: { id: string } }).data.id;
    try {
      for (const scope of [{}, C(a), CL(a, 'pl-PL')]) {
        expect((await fx.read(dup, scope)).seo).toEqual((await fx.read(id, scope)).seo);
      }
      expect((await fx.read(dup, C(a))).seo!.description).toMatchObject({ source: 'set_empty' });
    } finally {
      await fx.sql(`delete from products where id = ?`, [dup]);
    }
  });
});
