import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateProductRequest } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 068 (T034) — `product.create` is a Command, not a hand-written audit
 * call (Constitution Principle XIII).
 *
 * The forthcoming `pim_ergonode` importer creates products from a BullMQ worker,
 * i.e. from a system-scoped context with no admin actor and no request-derived
 * audit context. Before this feature such a create produced NO audit row at all,
 * because `createProduct` audited by hand after commit and only when the caller
 * supplied an optional `auditCtx`. The Command Bus is now the guaranteed writer:
 * one audit row per committed create, none on a rollback, and never two on the
 * admin path (FR-010, no double-audit).
 */
describe('CatalogAdminService.createProduct — audited via Command Bus [real DB]', () => {
  let h: BackendServerHandle;
  let service: CatalogAdminService;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    // A service instance wired exactly like production composition, so the test
    // can call it OUTSIDE an HTTP request — the way a worker would.
    const commandBus = new CommandBus(h.orm, h.auditLogService, h.eventBus);
    service = new CatalogAdminService(
      h.em,
      h.eventBus as unknown as CatalogEventBus,
      h.auditLogService,
      h.salesChannels.membershipService,
      commandBus,
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function productRequest(sku: string, name = `Product ${sku}`): CreateProductRequest {
    return {
      sku,
      type: 'simple',
      name: { 'en-US': name },
      description: { 'en-US': 'desc' },
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
    };
  }

  it('records exactly one system-actor audit row for a worker-style create', async () => {
    const events: string[] = [];
    const off = h.eventBus.on('product.created.v1', (payload) => {
      events.push((payload as unknown as { productId: string }).productId);
    });

    const created = await withSystemScope('feature 068 test — importer-style create', () =>
      service.createProduct(productRequest('CMD-CREATE-SYS-1')),
    );
    off();

    const rows = await h
      .em()
      .find(AuditLogEntry, { action: 'product.create', objectId: created.id });
    expect(rows).toHaveLength(1);
    // System actor: no admin id, no impersonation (Principle XIII — the actor is
    // server-derived from the ambient TenantContext, never from a caller argument).
    expect(rows[0]?.actorAdminUserId ?? null).toBeNull();
    expect(rows[0]?.impersonatedCustomerAccountId ?? null).toBeNull();
    expect((rows[0]?.stateAfter as { sku?: string } | null)?.sku).toBe('CMD-CREATE-SYS-1');

    // The domain event still fires exactly once on commit …
    expect(events.filter((id) => id === created.id)).toHaveLength(1);
    // … and the sales-channel default binding still runs on the create path.
    const links = (await h
      .em()
      .getConnection()
      .execute('select sales_channel_id from sales_channel_products where product_id = ?', [
        created.id,
      ])) as Array<{ sales_channel_id: string }>;
    expect(links).toHaveLength(1);
  });

  it('a rolled-back create records no audit row and emits no event', async () => {
    await withSystemScope('feature 068 test — seed the SKU collision', () =>
      service.createProduct(productRequest('CMD-CREATE-DUP')),
    );

    const events: string[] = [];
    const off = h.eventBus.on('product.created.v1', (payload) => {
      events.push((payload as unknown as { productId: string }).productId);
    });
    const auditRowsBefore = await h.em().count(AuditLogEntry, { action: 'product.create' });

    await expect(
      withSystemScope('feature 068 test — colliding create rolls back', () =>
        service.createProduct(productRequest('CMD-CREATE-DUP', 'A different name')),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SKU_ALREADY_EXISTS' });
    off();

    expect(await h.em().count(AuditLogEntry, { action: 'product.create' })).toBe(auditRowsBefore);
    expect(events).toHaveLength(0);
    expect(await h.em().find(Product, { sku: 'CMD-CREATE-DUP' })).toHaveLength(1);
  });

  it('an admin create records exactly one audit row with the admin actor (no double-audit)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: productRequest('CMD-CREATE-ADMIN-1'),
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;

    const rows = await h.em().find(AuditLogEntry, { action: 'product.create', objectId: id });
    expect(rows).toHaveLength(1); // exactly one — the manual post-commit call is gone
    expect(rows[0]?.actorAdminUserId).toBeTruthy(); // server-derived admin actor
  });

  /**
   * Feature 068 (T036) — `products.slug` is `@Unique()`, so a second product
   * sharing a name used to hit the unique constraint and be reported as
   * `SKU_ALREADY_EXISTS`. Create now allocates a free slug the same way the
   * duplication path does.
   */
  it('allocates a distinct slug when two products share a name', async () => {
    const first = await withSystemScope('feature 068 test — slug allocation', () =>
      service.createProduct(productRequest('CMD-SLUG-1', 'Slug collision product')),
    );
    const second = await withSystemScope('feature 068 test — slug allocation', () =>
      service.createProduct(productRequest('CMD-SLUG-2', 'Slug collision product')),
    );

    expect(first.slug).toBe('slug-collision-product');
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug).toMatch(/^slug-collision-product-\d+$/);
  });

  /**
   * Issues #240 / #245 — the slug is folded, and the private one-liner
   * `CatalogAdminService.slugify` used to carry did not fold `ł`: U+0142 has no
   * canonical decomposition, so NFKD left it standing and the `[^a-z0-9]+`
   * collapse deleted it. A Polish product name lost a letter, silently, in the
   * one value that becomes a storefront URL.
   *
   * The fixtures are names this repository ships: `Łączniki` and `Wiertła` are
   * catalog labels from `backend/src/seeds/dev-catalog-seed.ts`.
   */
  it('folds Polish letters in the slug instead of deleting them', async () => {
    // `łaczniki` before the strip; the leading `ł` became a separator and the
    // trim then removed it, so the slug read `aczniki`.
    const fasteners = await withSystemScope('issue #245 test — Polish slug', () =>
      service.createProduct(productRequest('PL-SLUG-1', 'Łączniki')),
    );
    expect(fasteners.slug).toBe('laczniki');

    // A non-leading `ł`: `wierta` before the repair, a letter short in the
    // middle of the word rather than at its start.
    const drills = await withSystemScope('issue #245 test — Polish slug', () =>
      service.createProduct(productRequest('PL-SLUG-2', 'Wiertła')),
    );
    expect(drills.slug).toBe('wiertla');
  });

  /**
   * The NFKD-for-NFD trade in the one place it could bite: two names that NFKD
   * kept apart can now fold together, because a compatibility character maps to
   * the `-` separator instead of into `[a-z0-9]`.
   *
   * It is not a unique-constraint failure and cannot become one — the slug goes
   * through `allocateUniqueSlug`, which probes `products.slug` and appends
   * `-2`, `-3`, … until the table is clear. The second product gets a suffixed
   * slug rather than a collision, which is exactly what two products sharing a
   * plain name already get. Asserted here so the trade is a decision on the
   * record rather than a surprise (see `slugify`'s doc block).
   */
  it('disambiguates rather than colliding when a compatibility character folds away', async () => {
    const squared = await withSystemScope('issue #245 test — compatibility fold', () =>
      service.createProduct(productRequest('PL-SLUG-3', 'Kabel² miedziany')),
    );
    const cubed = await withSystemScope('issue #245 test — compatibility fold', () =>
      service.createProduct(productRequest('PL-SLUG-4', 'Kabel³ miedziany')),
    );

    // NFKD produced `kabel2-miedziany` and `kabel3-miedziany`; NFD sends both
    // superscripts to the separator, so the second is suffixed instead.
    expect(squared.slug).toBe('kabel-miedziany');
    expect(cubed.slug).toMatch(/^kabel-miedziany-\d+$/);
  });
});
