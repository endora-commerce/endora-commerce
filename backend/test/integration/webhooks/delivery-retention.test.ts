import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Webhook, WebhookDelivery } from '../../helpers/package-entities.js';
import { WebhookDeliveryRetentionService } from '../../../../packages/modules/webhooks/src/backend/services/delivery-retention.js';

const DAY_MS = 86_400_000;

/**
 * Issue #928 — `webhook_deliveries` gets a retention window instead of a scrub.
 *
 * A delivery row keeps the event's payload verbatim (a block event's reason, an
 * order's buyer) and the receiver's response. Past
 * `webhooks.delivery_retention_days` a finished row — succeeded, failed or
 * dead-lettered — is deleted; a `pending` or `in_flight` row is work, not
 * history, and is kept however old it is. Every row is the shape
 * `WebhookService.recordDelivery` writes; `createdAt` is back-dated after the
 * insert, because the entity stamps it on create.
 */
describe('webhooks — finished deliveries past the retention window are deleted (issue #928)', () => {
  let db: TestDb;
  let em: EntityManager;
  let webhookId: string;
  const NOW = new Date();

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    const webhook = em.create(Webhook, {
      name: 'Retention probe',
      url: 'https://example.invalid/hook',
      secret: 'shhh',
      eventTypes: ['organization.blocked.v1'],
      status: 'active',
    });
    await em.persistAndFlush(webhook);
    webhookId = webhook.id;
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  async function delivery(status: 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered', daysAgo: number): Promise<string> {
    const row = em.create(WebhookDelivery, {
      webhookId,
      eventId: `evt-${status}-${daysAgo}-${Math.random()}`,
      eventType: 'organization.blocked.v1',
      payload: { organizationId: 'org-1', reason: 'Jan Kowalski forged his registration documents' },
      status,
      attemptCount: 1,
    });
    await em.persistAndFlush(row);
    await em.nativeUpdate(WebhookDelivery, { id: row.id }, { createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS) });
    return row.id;
  }

  const remaining = async (ids: string[]): Promise<string[]> => {
    em.clear();
    return (await em.find(WebhookDelivery, { id: { $in: ids } })).map((row) => row.id).sort();
  };

  const serviceAt = (retentionDays: number) => new WebhookDeliveryRetentionService(() => em, async () => retentionDays);

  it('deletes every finished row older than the window, and answers how many', async () => {
    const old = [await delivery('succeeded', 31), await delivery('failed', 40), await delivery('dead_lettered', 400)];

    const result = await serviceAt(30).purge(NOW);

    expect(result.retentionDays).toBe(30);
    expect(result.deleted).toBeGreaterThanOrEqual(old.length);
    expect(await remaining(old)).toEqual([]);
  });

  it('keeps a finished row inside the window', async () => {
    const recent = [await delivery('succeeded', 29), await delivery('dead_lettered', 1)];

    await serviceAt(30).purge(NOW);

    expect(await remaining(recent)).toEqual([...recent].sort());
  });

  it('never deletes a pending or in-flight row, however old', async () => {
    const work = [await delivery('pending', 400), await delivery('in_flight', 400)];

    await serviceAt(30).purge(NOW);

    expect(await remaining(work)).toEqual([...work].sort());
  });

  it('reads the window on every purge: raising it keeps what a shorter one would delete', async () => {
    const row = await delivery('succeeded', 100);

    await serviceAt(365).purge(NOW);
    expect(await remaining([row])).toEqual([row]);

    await serviceAt(90).purge(NOW);
    expect(await remaining([row])).toEqual([]);
  });

  it('is idempotent: a second purge finds nothing more to delete', async () => {
    await delivery('succeeded', 31);
    await serviceAt(30).purge(NOW);

    expect((await serviceAt(30).purge(NOW)).deleted).toBe(0);
  });
});
