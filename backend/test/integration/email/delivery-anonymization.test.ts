import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ANONYMIZED_EMAIL_RECIPIENT } from '@endora-commerce/contracts';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EmailDelivery } from '../../helpers/package-entities.js';
import { EmailDeliveryAnonymizationService } from '../../../../packages/modules/email/src/backend/services/email-delivery-anonymization-service.js';
import { PersistentEmailDeliveryRecorder } from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';

/**
 * Issue #928 — `email`'s step in the customer-account anonymisation sweep.
 *
 * A delivery record keeps the address a message went to, its subject, the
 * sender's `meta` envelope (a moderation e-mail's can carry the rejection
 * reason) and the transport's error text (an SMTP refusal quotes the address).
 * When the account is anonymised, `customers` hands its address to
 * `emailDeliveryAnonymizationPort`, and every record addressed to it loses
 * those four; what answers "did this leave the building" — message id, kind,
 * status, reason, channel, document, time — stays.
 */
describe('email — the delivery records of an anonymised address are scrubbed (issue #928)', () => {
  let db: TestDb;
  let em: EntityManager;
  let audit: AuditLogService;
  let service: EmailDeliveryAnonymizationService;

  const unique = (): string => `${Date.now()}-${Math.floor(performance.now() * 1000)}-${Math.random()}`;
  const REJECTION_REASON = 'Jan Kowalski sent us forged registration documents';

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    audit = new AuditLogService(() => em);
    service = new EmailDeliveryAnonymizationService(() => em, audit);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  /** One record, written the way every send writes it: through the recorder. */
  async function delivery(recipient: string, overrides: { status?: 'sent' | 'failed'; detail?: string } = {}) {
    const recorder = new PersistentEmailDeliveryRecorder(() => em);
    const id = await recorder.record({
      messageId: `organization.rejected.${randomUUID()}`,
      recipient,
      kind: 'organization_rejected',
      status: overrides.status ?? 'sent',
      ...(overrides.status === 'failed' ? { reason: 'transport_error' as const } : {}),
      ...(overrides.detail !== undefined ? { detail: overrides.detail } : {}),
      subject: `Jan, your registration was rejected`,
      documentType: 'organization',
      documentId: 'org-4711',
      context: { organizationId: randomUUID(), reason: REJECTION_REASON },
    });
    expect(id).not.toBeNull();
    return id!;
  }

  const rowOf = async (id: string) => {
    em.clear();
    return em.findOneOrFail(EmailDelivery, { id });
  };

  const auditRowsFor = async (ids: string[]) => {
    em.clear();
    return em.find(AuditLogEntry, { action: 'email_delivery.anonymized', objectId: { $in: ids } });
  };

  it('scrubs recipient, subject, context and detail on every record to the address, case-insensitively, and keeps the rest', async () => {
    const address = `subject-${unique()}@example.test`;
    const sent = await delivery(address);
    const refused = await delivery(address.toUpperCase(), {
      status: 'failed',
      detail: `550 5.1.1 <${address}>: Recipient address rejected`,
    });
    const before = await rowOf(sent);

    expect(await service.anonymizeForRecipient(address)).toBe(2);

    for (const id of [sent, refused]) {
      const row = await rowOf(id);
      expect({
        recipient: row.recipient,
        subject: row.subject ?? null,
        context: row.context ?? null,
        detail: row.detail ?? null,
      }).toEqual({ recipient: ANONYMIZED_EMAIL_RECIPIENT, subject: null, context: null, detail: null });
      expect(JSON.stringify(row)).not.toContain(REJECTION_REASON);
      expect(JSON.stringify(row).toLowerCase()).not.toContain(address.toLowerCase());
    }
    // What answers "did this leave the building" is kept.
    const after = await rowOf(sent);
    expect({
      messageId: after.messageId,
      kind: after.kind,
      status: after.status,
      documentType: after.documentType,
      documentId: after.documentId,
      attemptedAt: after.attemptedAt,
    }).toEqual({
      messageId: before.messageId,
      kind: before.kind,
      status: before.status,
      documentType: before.documentType,
      documentId: before.documentId,
      attemptedAt: before.attemptedAt,
    });
    expect((await rowOf(refused)).reason).toBe('transport_error');
  });

  it('records one email_delivery.anonymized entry per record it changed, with no actor and no payload', async () => {
    const address = `audited-${unique()}@example.test`;
    const ids = [await delivery(address), await delivery(address)];

    await service.anonymizeForRecipient(address);

    const rows = await auditRowsFor(ids);
    expect(rows.map((row) => row.objectId).sort()).toEqual([...ids].sort());
    for (const row of rows) {
      // A hydrated nullable column reads `undefined`: compare as `null`.
      expect({
        objectType: row.objectType,
        actorAdminUserId: row.actorAdminUserId ?? null,
        actorCustomerAccountId: row.actorCustomerAccountId ?? null,
      }).toEqual({ objectType: 'email_delivery', actorAdminUserId: null, actorCustomerAccountId: null });
      expect(row.stateBefore ?? null).toBeNull();
      expect(row.stateAfter ?? null).toBeNull();
    }
  });

  it('leaves a record to any other address as it is', async () => {
    const address = `subject-${unique()}@example.test`;
    const other = `other-${unique()}@example.test`;
    // A longer address that contains the subject's: a match is the whole value, not a substring.
    const containing = `x${address}`;
    const untouched = [await delivery(other), await delivery(containing)];
    const before = await Promise.all(untouched.map(async (id) => ({ ...(await rowOf(id)) })));

    await service.anonymizeForRecipient(address);

    const after = await Promise.all(untouched.map(async (id) => ({ ...(await rowOf(id)) })));
    expect(after).toEqual(before);
    expect(await auditRowsFor(untouched)).toEqual([]);
  });

  it('is idempotent: a repeat call changes nothing and records nothing', async () => {
    const address = `repeat-${unique()}@example.test`;
    const id = await delivery(address);
    expect(await service.anonymizeForRecipient(address)).toBe(1);
    const first = { ...(await rowOf(id)) };

    expect(await service.anonymizeForRecipient(address)).toBe(0);

    expect({ ...(await rowOf(id)) }).toEqual(first);
    expect(await auditRowsFor([id])).toHaveLength(1);
  });

  it('never matches the marker itself: an address that is already the marker changes nothing', async () => {
    const address = `marker-${unique()}@example.test`;
    const id = await delivery(address);
    await service.anonymizeForRecipient(address);

    expect(await service.anonymizeForRecipient(ANONYMIZED_EMAIL_RECIPIENT)).toBe(0);
    expect(await auditRowsFor([id])).toHaveLength(1);
  });
});
