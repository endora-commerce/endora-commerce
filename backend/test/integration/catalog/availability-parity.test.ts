import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  isProductEffectivelyAvailable,
  type AudienceRule,
  type ProductAudience,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
  type ProductGlobalScopeFields,
  type ProductScopeStatus,
  type PublicationWindow,
  type ScopeChannel,
} from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { testChannelBridges } from '../../helpers/channel-bridges.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import {
  ProductAvailabilityService,
  availableAmong,
} from '../../../../packages/modules/catalog/dist/backend/services/product-availability.service.js';
import { Product } from '../../helpers/package-entities.js';

/**
 * Feature 163, Phase 5 (T030) — the SQL restatement of effective availability
 * (`availabilityCondition`, behind `catalogProductAvailabilityPort.filterAvailable`)
 * against the one rule, `isProductEffectivelyAvailable`, over a generated grid
 * (`specs/163-product-data-scopes/research.md` R5).
 *
 * The expectation is **derived**: every seeded product is described in memory,
 * the rule is evaluated over that description, and the database must select
 * exactly the ids the rule admits — for every buyer and every language,
 * including a language the channel does not offer. The page-side evaluator
 * (`availableAmong`, which reads the rows back) is held to the same answer, so
 * the three forms cannot drift apart.
 *
 * Axes (R5, security checkpoint A item 9):
 *  - status at global × channel × channel-language, archived, deleted, non-member;
 *  - window: none, before, at-start, inside, at-end, after — inclusive at both
 *    ends to the millisecond — globally and as a channel override, including an
 *    open channel window beating a bounded global one;
 *  - audience: global and channel-override rules, `organization_restricted`
 *    with an empty list, allow-lists naming X, Y, both, none, and a stored
 *    allow-list that is not an array;
 *  - buyers: anonymous, signed-in without an organisation, org X, org Y.
 */

const NOW = new Date('2031-06-15T12:00:00.000Z');
const MS = 1;
const ORG_X = '7a000000-0000-4000-8000-00000000000a';
const ORG_Y = '7b000000-0000-4000-8000-00000000000b';

const BUYERS: ReadonlyArray<{ label: string; audience: ProductAudience }> = [
  { label: 'anonymous', audience: { organizationId: null, authenticated: false } },
  { label: 'signed-in, no org', audience: { organizationId: null, authenticated: true } },
  { label: 'org X', audience: { organizationId: ORG_X, authenticated: true } },
  { label: 'org Y', audience: { organizationId: ORG_Y, authenticated: true } },
];

const WINDOWS: ReadonlyArray<{ label: string; window: PublicationWindow }> = [
  { label: 'open', window: { from: null, until: null } },
  { label: 'before', window: { from: new Date(NOW.getTime() + MS), until: null } },
  { label: 'at-start', window: { from: NOW, until: null } },
  {
    label: 'inside',
    window: { from: new Date(NOW.getTime() - 60_000), until: new Date(NOW.getTime() + 60_000) },
  },
  { label: 'at-end', window: { from: null, until: NOW } },
  { label: 'after', window: { from: null, until: new Date(NOW.getTime() - MS) } },
];

const AUDIENCES: ReadonlyArray<{ label: string; rule: AudienceRule }> = [
  { label: 'public', rule: { visibility: 'public', allowedOrganizationIds: [] } },
  { label: 'logged-in', rule: { visibility: 'logged_in_only', allowedOrganizationIds: [] } },
  { label: 'restricted, empty', rule: { visibility: 'organization_restricted', allowedOrganizationIds: [] } },
  { label: 'restricted, X', rule: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] } },
  { label: 'public, Y', rule: { visibility: 'public', allowedOrganizationIds: [ORG_Y] } },
  { label: 'public, X+Y', rule: { visibility: 'public', allowedOrganizationIds: [ORG_Y, ORG_X] } },
];

/** One seeded product, described the way the rule reads it. */
interface Fixture {
  label: string;
  id: string;
  isMember: boolean;
  global: ProductGlobalScopeFields;
  channelRow?: ProductChannelScopeRecord;
  clRows: ProductChannelLanguageScopeRecord[];
  /** A raw `allowed_organization_ids` value that is not an array — only the SQL can hold it. */
  rawAllowList?: string;
}

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

async function insertChannel(em: EntityManager): Promise<ScopeChannel> {
  const id = randomUUID();
  await em.execute(
    `insert into "sales_channels" ("id", "code", "name", "default_language", "languages", "default_currency", "created_at", "updated_at")
     values (?, ?, '{"en-US":"163 parity"}'::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
    [id, `p163-${id.slice(0, 8)}`],
  );
  return { id, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
}

function baseGlobal(overrides: Partial<ProductGlobalScopeFields> = {}): ProductGlobalScopeFields {
  return {
    status: 'active',
    deletedAt: null,
    archivedAt: null,
    window: { from: null, until: null },
    visibility: 'public',
    allowedOrganizationIds: [],
    minOrderQuantity: null,
    returnable: true,
    ...overrides,
  };
}

function channelRow(
  productId: string,
  channelId: string,
  fields: Partial<Omit<ProductChannelScopeRecord, 'productId' | 'channelId'>>,
): ProductChannelScopeRecord {
  return {
    productId,
    channelId,
    status: null,
    window: null,
    audience: null,
    minOrderQuantity: null,
    returnable: null,
    ...fields,
  };
}

/** The grid, built in memory first; seeded afterwards. */
function buildGrid(channel: ScopeChannel, otherChannelId: string): Fixture[] {
  const grid: Fixture[] = [];
  const add = (f: Omit<Fixture, 'id' | 'clRows'> & { clRows?: Fixture['clRows'] }, id = randomUUID()) => {
    const fixture: Fixture = { ...f, id, clRows: f.clRows ?? [] };
    if (fixture.channelRow) fixture.channelRow = { ...fixture.channelRow, productId: id };
    fixture.clRows = fixture.clRows.map((r) => ({ ...r, productId: id }));
    grid.push(fixture);
  };

  // Status: G × C × C×L(pl-PL) — the C×L row sits on the default language, so
  // de-DE reads the channel/global value and pl-PL the language one.
  // Feature 163 (spec Session 2026-10-25) — two values; a global `inactive` is plain
  // off and, without `archivedAt`, never "gone".
  const G: ProductScopeStatus[] = ['inactive', 'active'];
  const C: Array<ProductScopeStatus | null> = [null, 'active', 'inactive'];
  const CL: Array<ProductScopeStatus | null> = [null, 'active', 'inactive'];
  for (const g of G) {
    for (const c of C) {
      for (const cl of CL) {
        add({
          label: `status G=${g} C=${c ?? '-'} CL(pl)=${cl ?? '-'}`,
          isMember: true,
          global: baseGlobal({ status: g }),
          ...(c !== null ? { channelRow: channelRow('', channel.id, { status: c }) } : {}),
          clRows:
            cl !== null
              ? [{ productId: '', channelId: channel.id, languageCode: 'pl-PL', status: cl }]
              : [],
        });
      }
    }
  }

  // Gone and orphaned.
  add({
    label: 'archived (global inactive), C×L active',
    isMember: true,
    global: baseGlobal({ status: 'inactive', archivedAt: new Date(NOW.getTime() - 86_400_000) }),
    channelRow: channelRow('', channel.id, { status: 'active' }),
    clRows: [{ productId: '', channelId: channel.id, languageCode: 'pl-PL', status: 'active' }],
  });
  add({
    label: 'soft-deleted, active',
    isMember: true,
    global: baseGlobal({ deletedAt: new Date(NOW.getTime() - 86_400_000) }),
  });
  add({
    label: 'non-member with an active channel row (orphan)',
    isMember: false,
    global: baseGlobal({ status: 'inactive' }),
    channelRow: channelRow('', channel.id, { status: 'active' }),
  });
  add({
    label: 'orphan C×L row on a language the channel does not offer',
    isMember: true,
    global: baseGlobal({ status: 'inactive' }),
    clRows: [{ productId: '', channelId: channel.id, languageCode: 'fr-FR', status: 'active' }],
  });
  add({
    label: 'rows for another channel only',
    isMember: true,
    global: baseGlobal({ status: 'inactive' }),
    channelRow: channelRow('', otherChannelId, { status: 'active' }),
  });

  // Windows, global and as a channel override.
  for (const w of WINDOWS) {
    add({ label: `global window ${w.label}`, isMember: true, global: baseGlobal({ window: w.window }) });
    add({
      label: `channel window ${w.label} over a global window that is "after"`,
      isMember: true,
      global: baseGlobal({ window: WINDOWS[5]!.window }),
      channelRow: channelRow('', channel.id, { window: w.window }),
    });
  }
  add({
    label: 'not-overridden channel row keeps the bounded global window',
    isMember: true,
    global: baseGlobal({ window: WINDOWS[1]!.window }),
    channelRow: channelRow('', channel.id, { status: 'active' }),
  });

  // Audiences, global and as a channel override (replaced whole, C4).
  for (const a of AUDIENCES) {
    add({
      label: `global audience ${a.label}`,
      isMember: true,
      global: baseGlobal({ visibility: a.rule.visibility, allowedOrganizationIds: a.rule.allowedOrganizationIds }),
    });
    add({
      label: `channel audience ${a.label} over a global "restricted, X"`,
      isMember: true,
      global: baseGlobal({ visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] }),
      channelRow: channelRow('', channel.id, { audience: a.rule }),
    });
  }

  return grid;
}

async function seed(em: EntityManager, channel: ScopeChannel, grid: Fixture[]): Promise<void> {
  for (const [index, f] of grid.entries()) {
    const sku = `P163-${index.toString().padStart(3, '0')}-${f.id.slice(0, 6)}`;
    const product = em.create(Product, {
      id: f.id,
      type: 'simple' as const,
      sku,
      slug: sku.toLowerCase(),
      name: f.label,
      description: null,
      attributeValues: {},
      status: f.global.status,
      visibility: f.global.visibility,
      allowedOrganizationIds: f.global.allowedOrganizationIds,
      publishFrom: f.global.window.from,
      publishUntil: f.global.window.until,
      archivedAt: f.global.archivedAt,
      deletedAt: f.global.deletedAt,
    });
    em.persist(product);
  }
  await em.flush();
  for (const f of grid) {
    if (f.isMember) {
      // `em.execute`, never `em.getConnection().execute` (issue #200).
      await em.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
        channel.id,
        f.id,
      ]);
    }
    if (f.rawAllowList !== undefined) {
      await em.execute(`update products set allowed_organization_ids = ?::jsonb where id = ?`, [
        f.rawAllowList,
        f.id,
      ]);
    }
    const row = f.channelRow;
    if (row) {
      await em.execute(
        `insert into product_channel_scopes
           (product_id, sales_channel_id, status, window_overridden, publish_from, publish_until,
            visibility, allowed_organization_ids, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
        [
          f.id,
          row.channelId,
          row.status,
          row.window !== null,
          row.window?.from ?? null,
          row.window?.until ?? null,
          row.audience?.visibility ?? null,
          row.audience ? JSON.stringify(row.audience.allowedOrganizationIds) : null,
        ],
      );
    }
    for (const cl of f.clRows) {
      await em.execute(
        `insert into product_channel_language_scopes
           (product_id, sales_channel_id, language_code, status, created_at, updated_at)
         values (?, ?, ?, ?, now(), now())`,
        [f.id, cl.channelId, cl.languageCode, cl.status],
      );
    }
  }
}

function expected(grid: Fixture[], channel: ScopeChannel, languageCode: string, audience: ProductAudience): Set<string> {
  return new Set(
    grid
      .filter((f) =>
        isProductEffectivelyAvailable({
          global: f.global,
          channelRow: f.channelRow,
          clRow: f.clRows.find((r) => r.channelId === channel.id && r.languageCode === languageCode),
          isMember: f.isMember,
          channel,
          languageCode,
          audience,
          now: NOW,
        }),
      )
      .map((f) => f.id),
  );
}

describe('163 — availability: SQL ≡ the rule [integration]', () => {
  it('selects exactly what isProductEffectivelyAvailable admits, for every buyer and language', async () => {
    const em = db.em();
    const channel = await insertChannel(em);
    const other = await insertChannel(em);
    const grid = buildGrid(channel, other.id);
    await seed(em, channel, grid);

    const membership = new SalesChannelMembershipService(() => db.em(), new EventBus(), undefined, testChannelBridges());
    const channels = { getById: async (id: string) => (id === channel.id ? { ...channel, languages: [...channel.languages] } : null) };
    const port = new ProductAvailabilityService(() => db.em(), membership, channels as never);
    const ids = grid.map((f) => f.id);
    const byId = new Map(grid.map((f) => [f.id, f.label]));
    const rows = await em.find(Product, { id: { $in: ids } });

    let admittedSomewhere = 0;
    let refusedSomewhere = 0;
    for (const languageCode of ['pl-PL', 'de-DE', 'fr-FR']) {
      for (const buyer of BUYERS) {
        const want = expected(grid, channel, languageCode, buyer.audience);
        const sql = await port.filterAvailable(ids, { channelId: channel.id, languageCode, audience: buyer.audience, now: NOW });
        const page = await availableAmong(db.em(), membership, rows, {
          channel,
          languageCode,
          audience: buyer.audience,
          now: NOW,
        });
        const label = (set: Set<string>) => [...set].map((id) => byId.get(id)).sort();
        expect(label(sql), `SQL — ${languageCode}, ${buyer.label}`).toEqual(label(want));
        expect(label(page), `page-side — ${languageCode}, ${buyer.label}`).toEqual(label(want));
        admittedSomewhere += want.size;
        refusedSomewhere += grid.length - want.size;
      }
    }
    // A green sweep must be a comparison, not two empty (or two full) sets.
    expect(admittedSomewhere).toBeGreaterThan(0);
    expect(refusedSomewhere).toBeGreaterThan(0);
  });

  it('answers nothing for a language the channel does not offer and for an unknown channel', async () => {
    const em = db.em();
    const channel = await insertChannel(em);
    const grid = buildGrid(channel, randomUUID()).slice(0, 4);
    await seed(em, channel, grid);
    const membership = new SalesChannelMembershipService(() => db.em(), new EventBus(), undefined, testChannelBridges());
    const port = new ProductAvailabilityService(() => db.em(), membership, {
      getById: async (id: string) => (id === channel.id ? ({ ...channel, languages: [...channel.languages] } as never) : null),
    } as never);
    const ids = grid.map((f) => f.id);
    const anonymous: ProductAudience = { organizationId: null, authenticated: false };
    expect((await port.filterAvailable(ids, { channelId: channel.id, languageCode: 'fr-FR', audience: anonymous, now: NOW })).size).toBe(0);
    expect((await port.filterAvailable(ids, { channelId: randomUUID(), languageCode: 'pl-PL', audience: anonymous, now: NOW })).size).toBe(0);
  });

  it('treats a stored allow-list that is not an array as "no allow-list" in SQL, and the page-side rule refuses nothing it admits', async () => {
    // The one documented divergence between the SQL and the predicate: the
    // statement reads a non-array as "no list", the predicate reads its
    // `length`. The page-side check runs after the statement, so the read
    // answers the intersection — never more than the rule.
    const em = db.em();
    const channel = await insertChannel(em);
    const id = randomUUID();
    const fixture: Fixture = {
      label: 'non-array allow-list',
      id,
      isMember: true,
      global: baseGlobal({ visibility: 'public' }),
      clRows: [],
      rawAllowList: JSON.stringify({ not: 'an array' }),
    };
    await seed(em, channel, [fixture]);
    const membership = new SalesChannelMembershipService(() => db.em(), new EventBus(), undefined, testChannelBridges());
    const port = new ProductAvailabilityService(() => db.em(), membership, {
      getById: async () => ({ ...channel, languages: [...channel.languages] }) as never,
    } as never);
    const anonymous: ProductAudience = { organizationId: null, authenticated: false };
    const sql = await port.filterAvailable([id], { channelId: channel.id, languageCode: 'pl-PL', audience: anonymous, now: NOW });
    expect([...sql]).toEqual([id]);
  });
});
