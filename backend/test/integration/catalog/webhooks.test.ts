import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOG_WEBHOOK_EVENTS,
  CATALOG_WEBHOOK_EVENT_SCHEMAS,
  CATALOG_WEBHOOK_EVENT_TYPES,
  ProductArchivedEventV1Schema,
  ProductCreatedEventV1Schema,
  ProductUpdatedEventV1Schema,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  captureWebhookJobs,
  clearWebhookSubscriptions,
  createWebhookSubscription,
  eventsDispatchedBy,
  offeredWebhookEventTypes,
  storeWebhookSubscription,
  whenEventDelivered,
  type WebhookJobCapture,
} from '../../helpers/webhook-deliveries.js';
import type { CatalogAdminService } from '../../../../packages/modules/catalog/src/backend/services/catalog-admin.service.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const { PRODUCT_CREATED, PRODUCT_UPDATED, PRODUCT_ARCHIVED } = CATALOG_WEBHOOK_EVENTS;

/**
 * `catalog` offers three of its events to outbound webhooks:
 * `product.created.v1`, `product.updated.v1` and `product.archived.v1`.
 *
 * It pushes the names into `webhookEventRegistry`; `webhooks` names none of
 * them. Every case below causes the event through the admin API (or, for the
 * unaudited path, the composed service) and observes the job the delivery
 * bridge hands to its queue.
 *
 * A product belongs to the catalogue and not to an Organization, so none of
 * the three carries an `organizationId` and a subscription bound to one
 * Organization receives none of them.
 */
describe('catalog outbound webhooks — product.created / updated / archived', () => {
  let h: BackendServerHandle;
  let capture: WebhookJobCapture;

  const jobsFor = (productId: string, eventType?: string) =>
    capture.jobs.filter(
      (job) =>
        (job.payload as { productId?: string }).productId === productId &&
        (eventType === undefined || job.eventType === eventType),
    );

  const productRequest = (sku: string, type: 'simple' | 'configurable' = 'simple') => ({
    sku,
    type,
    name: { 'en-US': `Webhook product ${sku}` },
    description: { 'en-US': 'Never in a payload' },
    categoryIds: [],
    attributeValues: {},
    visibility: 'public',
  });

  const newSku = () => `WH-${randomUUID().slice(0, 12)}`;

  const createProduct = async (
    sku = newSku(),
    type: 'simple' | 'configurable' = 'simple',
  ): Promise<{ id: string; sku: string }> => {
    const response = await whenEventDelivered(
      h,
      PRODUCT_CREATED,
      (payload) => payload['sku'] === sku,
      () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/catalog/products',
          payload: productRequest(sku, type),
          cookies: ADMIN,
        }),
    );
    expect(response.statusCode, response.body).toBe(201);
    return { id: (response.json() as { data: { id: string } }).data.id, sku };
  };

  /** PATCH the product and wait until the bridge has handled the last event the write announces. */
  const patchProduct = async (id: string, payload: Record<string, unknown>, last: string = PRODUCT_UPDATED) => {
    const response = await whenEventDelivered(
      h,
      last,
      (event) => event['productId'] === id,
      () => h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/products/${id}`, payload, cookies: ADMIN }),
    );
    expect(response.statusCode, response.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    capture = captureWebhookJobs(h);
  }, 60_000);

  beforeEach(async () => {
    await clearWebhookSubscriptions(h);
    capture.clear();
  });

  afterAll(async () => {
    capture?.restore();
    await teardownBackendServer(h);
  });

  it('contributes exactly its three event types, as their owner', async () => {
    const registry = h.container.resolve<WebhookEventRegistryPort>('webhookEventRegistry');
    expect(registry.owners()).toContain('catalog');
    expect(
      registry
        .list()
        .filter((descriptor) => descriptor.ownerModuleId === 'catalog')
        .map((descriptor) => descriptor.eventType),
    ).toEqual(['product.created.v1', 'product.updated.v1', 'product.archived.v1']);
    expect((await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'catalog')).toEqual(
      CATALOG_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'catalog', eventType })),
    );
  });

  it('the API accepts a subscription to each of the three', async () => {
    const response = await createWebhookSubscription(h, CATALOG_WEBHOOK_EVENT_TYPES);
    expect(response.statusCode, response.body).toBe(201);
  });

  it('creating a product enqueues one product.created.v1 delivery carrying the documented payload', async () => {
    const subscription = await storeWebhookSubscription(h, [PRODUCT_CREATED]);
    const product = await createProduct();

    const delivered = jobsFor(product.id).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(PRODUCT_CREATED);
    const payload = ProductCreatedEventV1Schema.parse(delivered[0]?.payload);
    expect(payload).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      productId: product.id,
      sku: product.sku,
    });
    expect(delivered[0]?.eventId).toBe(payload.eventId);
    // What is posted is the JSON of the payload: it parses after the round trip too.
    ProductCreatedEventV1Schema.parse(JSON.parse(JSON.stringify(delivered[0]?.payload)));
  });

  it('duplicating a product enqueues product.created.v1 for the duplicate', async () => {
    const source = await createProduct();
    const subscription = await storeWebhookSubscription(h, [PRODUCT_CREATED]);
    capture.clear();

    const response = await whenEventDelivered(
      h,
      PRODUCT_CREATED,
      (payload) => payload['productId'] !== source.id,
      () =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/catalog/products/${source.id}/duplicate`,
          cookies: ADMIN,
        }),
    );
    expect(response.statusCode, response.body).toBe(201);
    const duplicate = (response.json() as { data: { id: string; sku: string } }).data;

    const delivered = jobsFor(duplicate.id, PRODUCT_CREATED).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(ProductCreatedEventV1Schema.parse(delivered[0]?.payload)).toMatchObject({
      productId: duplicate.id,
      sku: duplicate.sku,
    });
  });

  it('updating a product enqueues one product.updated.v1 delivery naming the fields, never their values', async () => {
    const product = await createProduct();
    const subscription = await storeWebhookSubscription(h, [PRODUCT_UPDATED]);
    capture.clear();

    await patchProduct(product.id, { name: { 'en-US': 'A renamed product, not in the payload' } });

    const delivered = jobsFor(product.id).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(PRODUCT_UPDATED);
    expect(ProductUpdatedEventV1Schema.parse(delivered[0]?.payload)).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      productId: product.id,
      changedFields: ['name'],
    });
    expect(JSON.stringify(delivered[0]?.payload)).not.toContain('renamed');
  });

  it('a variant write enqueues product.updated.v1 for the parent with changedFields ["variants"]', async () => {
    const product = await createProduct(newSku(), 'configurable');
    const subscription = await storeWebhookSubscription(h, [PRODUCT_UPDATED]);
    capture.clear();

    const response = await whenEventDelivered(
      h,
      PRODUCT_UPDATED,
      (payload) => payload['productId'] === product.id,
      () =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/catalog/products/${product.id}/variants`,
          payload: { sku: newSku(), variantAttributeValues: {} },
          cookies: ADMIN,
        }),
    );
    expect(response.statusCode, response.body).toBe(201);

    const delivered = jobsFor(product.id).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(ProductUpdatedEventV1Schema.parse(delivered[0]?.payload).changedFields).toEqual(['variants']);
  });

  it('moving a product to inactive enqueues product.updated.v1 and then product.archived.v1 — once, on the transition only', async () => {
    const product = await createProduct();
    const subscription = await storeWebhookSubscription(h, [PRODUCT_UPDATED, PRODUCT_ARCHIVED]);
    capture.clear();

    await patchProduct(product.id, { status: 'inactive' }, PRODUCT_ARCHIVED);

    const delivered = jobsFor(product.id).filter((job) => job.webhookId === subscription);
    expect(delivered.map((job) => job.eventType)).toEqual([PRODUCT_UPDATED, PRODUCT_ARCHIVED]);
    expect(ProductUpdatedEventV1Schema.parse(delivered[0]?.payload).changedFields).toEqual(['status']);
    expect(ProductArchivedEventV1Schema.parse(delivered[1]?.payload)).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      productId: product.id,
    });

    // Already inactive: neither a further edit nor the same status again archives it a second time.
    capture.clear();
    await patchProduct(product.id, { name: { 'en-US': 'Edited while inactive' } });
    await patchProduct(product.id, { status: 'inactive' });
    expect(jobsFor(product.id, PRODUCT_ARCHIVED)).toEqual([]);

    // Back to active and inactive again is a second transition, and a second event.
    await patchProduct(product.id, { status: 'active' });
    expect(jobsFor(product.id, PRODUCT_ARCHIVED)).toEqual([]);
    await patchProduct(product.id, { status: 'inactive' }, PRODUCT_ARCHIVED);
    expect(jobsFor(product.id, PRODUCT_ARCHIVED).filter((job) => job.webhookId === subscription)).toHaveLength(1);
  });

  it('the unaudited update path archives too — the composed service outside an HTTP request', async () => {
    const product = await createProduct();
    const subscription = await storeWebhookSubscription(h, [PRODUCT_ARCHIVED]);
    capture.clear();
    const service = h.container.resolve<CatalogAdminService>('catalogAdminService');

    await whenEventDelivered(
      h,
      PRODUCT_ARCHIVED,
      (payload) => payload['productId'] === product.id,
      () => withSystemScope('catalog webhooks test — worker-style update', () => service.updateProduct(product.id, { status: 'inactive' })),
    );

    const delivered = jobsFor(product.id, PRODUCT_ARCHIVED).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    ProductArchivedEventV1Schema.parse(delivered[0]?.payload);
  });

  it('a subscription bound to an Organization receives no product event; a platform-wide one does', async () => {
    const bound = await storeWebhookSubscription(h, CATALOG_WEBHOOK_EVENT_TYPES, TEST_ORGANIZATION_ID);
    const platformWide = await storeWebhookSubscription(h, CATALOG_WEBHOOK_EVENT_TYPES);

    const product = await createProduct();
    await patchProduct(product.id, { status: 'inactive' }, PRODUCT_ARCHIVED);

    const receivers = jobsFor(product.id).map((job) => job.webhookId);
    expect(receivers).not.toContain(bound);
    expect(receivers.filter((id) => id === platformWide)).toHaveLength(3);
  });

  it('an event type no subscription names enqueues nothing', async () => {
    const product = await createProduct();
    // Subscribed to creation only: the update below is emitted and bridged, and has no receiver.
    await storeWebhookSubscription(h, [PRODUCT_CREATED]);
    capture.clear();

    await patchProduct(product.id, { name: { 'en-US': 'Nobody is told' } });

    expect(jobsFor(product.id)).toEqual([]);
  });

  it('a write that is refused announces nothing and enqueues nothing', async () => {
    const existing = await createProduct();
    const other = await createProduct();
    await storeWebhookSubscription(h, CATALOG_WEBHOOK_EVENT_TYPES);
    capture.clear();

    // A create whose SKU collides fails inside its transaction, at the flush.
    const created = await eventsDispatchedBy(h, PRODUCT_CREATED, () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        payload: productRequest(existing.sku),
        cookies: ADMIN,
      }),
    );
    expect(created.result.statusCode, created.result.body).toBe(409);
    expect(created.seen).toEqual([]);

    // An update that is refused after the status was already set on the entity.
    const updated = await eventsDispatchedBy(h, PRODUCT_UPDATED, () =>
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${other.id}`,
        payload: { status: 'inactive', attributeValues: { 'no-such-attribute-key': 'x' } },
        cookies: ADMIN,
      }),
    );
    expect(updated.result.statusCode, updated.result.body).toBeGreaterThanOrEqual(400);
    expect(updated.seen.filter((payload) => payload['productId'] === other.id)).toEqual([]);

    expect(capture.jobs).toEqual([]);
  });

  it('every offered event the module emits parses under its strict schema', async () => {
    const seen: Array<{ eventType: string; payload: unknown }> = [];
    const offs = CATALOG_WEBHOOK_EVENT_TYPES.map((eventType) =>
      h.eventBus.on(eventType as never, (payload: unknown) => {
        seen.push({ eventType, payload });
      }),
    );
    try {
      const product = await createProduct();
      await patchProduct(product.id, { name: { 'en-US': 'Renamed' }, visibility: 'logged_in_only' });
      await patchProduct(product.id, { status: 'inactive' }, PRODUCT_ARCHIVED);
    } finally {
      offs.forEach((off) => off());
    }
    expect(seen.map((event) => event.eventType)).toEqual([
      PRODUCT_CREATED,
      PRODUCT_UPDATED,
      PRODUCT_UPDATED,
      PRODUCT_ARCHIVED,
    ]);
    for (const { eventType, payload } of seen) {
      const schema = CATALOG_WEBHOOK_EVENT_SCHEMAS[eventType as keyof typeof CATALOG_WEBHOOK_EVENT_SCHEMAS];
      const parsed = schema.safeParse(payload);
      expect(parsed.success, `${eventType}: ${JSON.stringify(parsed.error?.issues)} — ${JSON.stringify(payload)}`).toBe(true);
      expect(JSON.stringify(payload)).not.toContain('Never in a payload');
    }
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with webhooks %s the product write succeeds and nothing is enqueued',
    async (axis) => {
      await storeWebhookSubscription(h, CATALOG_WEBHOOK_EVENT_TYPES);
      const product = await createProduct();
      capture.clear();
      await withModuleOff('webhooks', axis, async () => {
        await patchProduct(product.id, { name: { 'en-US': 'While webhooks is off' } });
        expect(capture.jobs).toEqual([]);
      });
      // Not delivered later either: what was emitted meanwhile is gone.
      expect(jobsFor(product.id)).toEqual([]);
      // Back on, the next change is delivered.
      await patchProduct(product.id, { name: { 'en-US': 'After webhooks is back' } });
      expect(jobsFor(product.id, PRODUCT_UPDATED).length).toBeGreaterThan(0);
    },
  );

  // `catalog` declares itself `nonDeactivatable`, so it has no operator axis:
  // the one way it is absent is a deployment that does not install it.
  it('with catalog platform-unavailable its three types are not offered and not accepted, and are again after', async () => {
    await withModuleOff('catalog', 'platform-unavailable', async () => {
      expect((await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'catalog')).toEqual(
        [],
      );
      const refused = await createWebhookSubscription(h, [PRODUCT_UPDATED]);
      expect(refused.statusCode, refused.body).toBe(422);
      expect((refused.json() as { error: { code: string } }).error.code).toBe('WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE');
    });
    expect(
      (await offeredWebhookEventTypes(h))
        .filter((descriptor) => descriptor.ownerModuleId === 'catalog')
        .map((descriptor) => descriptor.eventType),
    ).toEqual([...CATALOG_WEBHOOK_EVENT_TYPES]);
    expect((await createWebhookSubscription(h, [PRODUCT_UPDATED])).statusCode).toBe(201);
  });
});
