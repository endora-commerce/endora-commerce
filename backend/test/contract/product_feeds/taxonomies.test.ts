import { fileURLToPath } from 'node:url';
import { AdminUser } from '../../helpers/package-entities.js';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { TaxonomyReconcilerService } from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-reconciler.service.js';
import { FeedTaxonomyMapping } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T051 — the taxonomy and mapping admin surface
 * (FR-079, FR-081, FR-082, FR-085).
 *
 * Fixture-backed, like every taxonomy test: the shipped data files are never
 * read and the network is never touched. The refresh surfaces this namespace
 * also carries (revisions, impact, promote, checks) are covered by
 * `taxonomy-revisions.test.ts`.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-taxonomy-reader-session' } };
const READER_ID = '00000000-0000-4000-8000-0000000000f2';
const BASE = '/api/v1/admin/feed-taxonomies';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../../fixtures/product_feeds/taxonomies-v1');

describe('feed taxonomies [contract]', () => {
  let h: BackendServerHandle;
  let rootId: string;
  let childId: string;
  let grandchildId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    await new TaxonomyReconcilerService({
      emFactory: () => h.em(),
      dataRoot: FIXTURE,
    }).reconcile();

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/product_feeds_taxonomy_reader',
      ...ADMIN,
      payload: {
        code: 'product_feeds_taxonomy_reader',
        name: 'Feed taxonomy reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);
    em.create(AdminUser, {
      id: READER_ID,
      email: 'taxonomy-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Taxonomy',
      lastName: 'Reader',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });

    const suffix = Math.random().toString(36).slice(2, 8);
    const root = em.create(Category, {
      name: { 'en-US': 'Pets', 'pl-PL': 'Zwierzęta' },
      slug: `tax-pets-${suffix}`,
      sortOrder: 0,
    });
    await em.persistAndFlush(root);
    const child = em.create(Category, {
      parentCategoryId: root.id,
      name: { 'en-US': 'Pet supplies', 'pl-PL': 'Artykuły dla zwierząt' },
      slug: `tax-supplies-${suffix}`,
      sortOrder: 0,
    });
    await em.persistAndFlush(child);
    const grandchild = em.create(Category, {
      parentCategoryId: child.id,
      name: { 'en-US': 'Bird supplies', 'pl-PL': 'Artykuły dla ptaków' },
      slug: `tax-birds-${suffix}`,
      sortOrder: 0,
    });
    await em.persistAndFlush(grandchild);
    rootId = root.id;
    childId = child.id;
    grandchildId = grandchild.id;

    ADMIN_COOKIES['stub-taxonomy-reader-session'] = { adminUserId: READER_ID };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-taxonomy-reader-session'];
    await teardownBackendServer(h);
  });

  it('lists the installed taxonomies with their revision and install date (FR-078)', async () => {
    const res = await h.app.inject({ method: 'GET', url: BASE, ...ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    const google = body.data.find((t) => t['providerCode'] === 'google_merchant')!;
    expect(google['revision']).toBe('2020-01-01');
    expect(google['nodeCount']).toBe(4);
    expect(typeof google['installedAt']).toBe('string');
  });

  it('exposes no route that uploads a taxonomy file, and none that makes a revision current except the audited promote Command (FR-086)', async () => {
    // The claim this used to make — "no route installs, uploads or refreshes a
    // taxonomy" — is no longer true and must not be asserted: `POST /checks`
    // exists, and it may install a revision. What is still true, and is what
    // actually protects a feed, is narrower and stronger: no route accepts a
    // taxonomy file, and no route makes a revision current in one step.
    // Installation and activation are separate by design (contract §7.1).
    for (const [method, url] of [
      ['POST', BASE],
      ['POST', `${BASE}/install`],
      ['POST', `${BASE}/upload`],
      ['PUT', BASE],
    ] as const) {
      const res = await h.app.inject({ method, url, ...ADMIN, payload: {} });
      expect([404, 400], `${method} ${url} answered ${res.statusCode}`).toContain(
        res.statusCode,
      );
    }
  });

  describe('node search (FR-079)', () => {
    it('searches the localized full path', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/nodes?providerCode=google_merchant&q=Bird&lang=en`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]!['externalId']).toBe('3');
      expect(rows[0]!['label']).toBe('Bird Supplies');
      expect(rows[0]!['fullPath']).toBe(
        'Animals & Pet Supplies > Pet Supplies > Bird Supplies',
      );
      expect(rows[0]!['depth']).toBe(2);
    });

    it('searches the Polish path when asked, returning the same node id (FR-085)', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/nodes?providerCode=google_merchant&q=ptak&lang=pl`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
      expect(rows).toHaveLength(1);
      // Same identity, different label — which is exactly why a mapping stores
      // the external id and not a path.
      expect(rows[0]!['externalId']).toBe('3');
      expect(rows[0]!['label']).toBe('Artykuły dla ptaków');
    });

    it('returns an empty list rather than failing for an uninstalled provider', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/nodes?providerCode=meta&q=nothing-matches-this`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: unknown[] }).data).toEqual([]);
    });
  });

  describe('mappings and inheritance (FR-080, FR-081)', () => {
    it('returns one row per shop category, with origin none before anything is mapped', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/mappings?providerCode=google_merchant&lang=en&limit=200`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
      const row = rows.find((r) => r['categoryId'] === grandchildId)!;
      expect(row['origin']).toBe('none');
      expect(row['nodeExternalId']).toBeNull();
      expect(row['categoryName']).toBe('Bird supplies');
    });

    it('sets a mapping, and descendants inherit it', async () => {
      const set = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/mappings`,
        ...ADMIN,
        payload: {
          providerCode: 'google_merchant',
          categoryId: childId,
          nodeExternalId: '2',
        },
      });
      expect(set.statusCode).toBe(200);

      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/mappings?providerCode=google_merchant&lang=en&limit=200`,
        ...ADMIN,
      });
      const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;

      const explicit = rows.find((r) => r['categoryId'] === childId)!;
      expect(explicit['origin']).toBe('explicit');
      expect(explicit['nodeExternalId']).toBe('2');

      const inherited = rows.find((r) => r['categoryId'] === grandchildId)!;
      expect(inherited['origin']).toBe('inherited');
      expect(inherited['nodeExternalId']).toBe('2');
      expect(inherited['inheritedFromCategoryId']).toBe(childId);
      expect(inherited['inheritedFromCategoryName']).toBe('Pet supplies');

      // The ancestor is untouched — inheritance flows down, never up.
      const ancestor = rows.find((r) => r['categoryId'] === rootId)!;
      expect(ancestor['origin']).toBe('none');
    });

    it('lets a descendant override its inherited value', async () => {
      const set = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/mappings`,
        ...ADMIN,
        payload: {
          providerCode: 'google_merchant',
          categoryId: grandchildId,
          nodeExternalId: '3',
        },
      });
      expect(set.statusCode).toBe(200);
      expect((set.json() as { data: Record<string, unknown> }).data['origin']).toBe('explicit');
      expect((set.json() as { data: Record<string, unknown> }).data['nodeExternalId']).toBe('3');
    });

    it('clears an explicit mapping with null, so the category inherits again', async () => {
      const cleared = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/mappings`,
        ...ADMIN,
        payload: {
          providerCode: 'google_merchant',
          categoryId: grandchildId,
          nodeExternalId: null,
        },
      });
      expect(cleared.statusCode).toBe(200);
      const row = (cleared.json() as { data: Record<string, unknown> }).data;
      expect(row['origin']).toBe('inherited');
      expect(row['nodeExternalId']).toBe('2');

      // The ancestor's own decision survives clearing the override.
      const em = h.em();
      em.clear();
      const ancestorRow = await em.findOne(FeedTaxonomyMapping, {
        taxonomyProviderCode: 'google_merchant',
        categoryId: childId,
      });
      expect(ancestorRow?.nodeExternalId).toBe('2');
    });

    it('refuses a node that is not in the installed revision', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/mappings`,
        ...ADMIN,
        payload: {
          providerCode: 'google_merchant',
          categoryId: childId,
          nodeExternalId: '999999',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('nodeExternalId');
    });

    it('offers no per-feed or per-template mapping variant (FR-081)', async () => {
      // One installation-wide set per provider: an id-bearing variant of the
      // route must simply not exist.
      for (const url of [
        `${BASE}/mappings/by-feed/00000000-0000-4000-8000-000000000001`,
        `${BASE}/mappings/by-template/00000000-0000-4000-8000-000000000001`,
      ]) {
        const res = await h.app.inject({ method: 'GET', url, ...ADMIN });
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe('coverage (FR-079)', () => {
    it('reports counts that add up to the category total', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/coverage?providerCode=google_merchant`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const c = (res.json() as { data: Record<string, number> }).data;
      expect(c['explicitlyMapped']! + c['coveredByInheritance']! + c['uncovered']!).toBe(
        c['totalCategories'],
      );
      expect(c['explicitlyMapped']).toBeGreaterThanOrEqual(1);
      expect(c['coveredByInheritance']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('stale mappings (FR-085)', () => {
    it('lists a stale mapping for review', async () => {
      const em = h.em();
      await em
        .getConnection()
        .execute(
          `update "product_feed_taxonomy_mappings" set "stale" = true where "category_id" = ?`,
          [childId],
        );
      em.clear();

      const res = await h.app.inject({
        method: 'GET',
        url: `${BASE}/stale-mappings?providerCode=google_merchant`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]!['categoryId']).toBe(childId);
      expect(rows[0]!['stale']).toBe(true);

      // Restore for any later case.
      await em
        .getConnection()
        .execute(
          `update "product_feed_taxonomy_mappings" set "stale" = false where "category_id" = ?`,
          [childId],
        );
      em.clear();
    });
  });

  describe('permissions (FR-057)', () => {
    it('lets a :read administrator read every surface', async () => {
      for (const url of [
        BASE,
        `${BASE}/nodes?providerCode=google_merchant`,
        `${BASE}/mappings?providerCode=google_merchant`,
        `${BASE}/coverage?providerCode=google_merchant`,
        `${BASE}/stale-mappings?providerCode=google_merchant`,
      ]) {
        const res = await h.app.inject({ method: 'GET', url, ...READER });
        expect(res.statusCode, url).toBe(200);
      }
    });

    it('refuses a mapping write for a :read administrator', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: `${BASE}/mappings`,
        ...READER,
        payload: {
          providerCode: 'google_merchant',
          categoryId: childId,
          nodeExternalId: '1',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await h.app.inject({ method: 'GET', url: BASE });
      expect(res.statusCode).toBe(401);
    });
  });
});
