import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_ACCOUNT_ANONYMIZED_EVENT } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { ReturnCase, ReturnCaseAttachment, ReturnCaseComment, ReturnCaseItem } from '../../helpers/package-entities.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  runReturnsMaintenanceJob,
  type ReturnsMaintenanceJobDeps,
} from '../../../../packages/modules/returns/src/backend/workers/returns-maintenance-worker.js';
import { resetReturnGraph } from './helpers.js';
import type { ReturnErasureService } from '../../../../packages/modules/returns/src/backend/services/return-erasure-service.js';
import { makeMember, makeOrganization, releaseMembers, type ReturnsFixtureMember } from './organization-fixtures.js';
import { SMALL_PDF, allowOffPlatform, complaintReasonId, file, noOrderBody, upload } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T085 (FR-B43, D-8, research R-15): anonymising a
 * customer erases the contact data, the return address and the files of their cases —
 * by the event, and by the maintenance sweep for an anonymisation `returns` missed.
 */
describe('returns — erasing a customer’s personal data', () => {
  let h: BackendServerHandle;
  let undoStore: () => Promise<void>;
  let baseDir: string;
  let undoOffPlatform: () => Promise<void>;
  let organizationId: string;
  let reasonId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    ({ undo: undoStore, baseDir } = await useTemporaryAssetStore(h));
    undoOffPlatform = await allowOffPlatform(h);
    organizationId = await makeOrganization(h.em(), '180 erasure');
    reasonId = await complaintReasonId(h.em());
  });
  afterAll(async () => {
    await undoOffPlatform();
    await undoStore();
    releaseMembers();
    await teardownBackendServer(h);
  });

  const pdf = { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF };

  /** A member with a filed off-platform case holding one file and a comment, and one pending upload. */
  async function customerWithCase(label: string): Promise<{ member: ReturnsFixtureMember; caseId: string; pendingId: string }> {
    const member = await makeMember(h.em(), organizationId, 'member', { label });
    const cookies = { b2b_session: member.cookie };
    const attached = ((await upload(h, pdf, { cookies })).json() as { data: { uploadId: string } }).data.uploadId;
    const res = await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: attached }], comment: 'Please hurry' }), {
      cookies,
      headers: { 'x-sales-channel': 'default' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const pendingId = ((await upload(h, pdf, { cookies })).json() as { data: { uploadId: string } }).data.uploadId;
    return { member, caseId: (res.json() as { data: { id: string } }).data.id, pendingId };
  }

  async function expectErased(caseId: string, customerAccountId: string): Promise<void> {
    const em = h.em().fork();
    const rc = await em.findOneOrFail(ReturnCase, { id: caseId }, { filters: false });
    expect(rc.contact ?? null).toBeNull();
    expect(rc.returnAddress ?? null).toBeNull();
    expect(rc.personalDataErasedAt).toBeInstanceOf(Date);
    // Lines, purchase data and comments stay: the case remains workable.
    expect(rc.purchaseDate).toBe('2026-10-01');
    expect(await em.count(ReturnCaseItem, { returnCaseId: caseId })).toBe(1);
    expect(await em.count(ReturnCaseComment, { returnCaseId: caseId })).toBe(1);
    expect(await em.count(ReturnCaseAttachment, { customerAccountId }, { filters: false })).toBe(0);
  }

  const auditOf = (customerAccountId: string) =>
    h.em().fork().find(AuditLogEntry, { objectId: customerAccountId, action: 'return_case.erase_personal_data' });

  it('erases on customer_account.anonymized.v1, auditing counts and field names only', async () => {
    const { member, caseId } = await customerWithCase('Erased180');
    h.eventBus.emit(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      customerAccountId: member.id,
      organizationId,
    } as never);
    await vi.waitFor(async () => expect(await auditOf(member.id)).toHaveLength(1), { timeout: 5000 });
    await expectErased(caseId, member.id);
    const entry = (await auditOf(member.id))[0]!;
    expect(entry.stateAfter).toEqual({ caseCount: 1, attachmentCount: 2, fields: ['contact', 'returnAddress'] });
    expect(JSON.stringify(entry)).not.toMatch(/Ewa|Prosta|ewa@example/);
  });

  /**
   * The `customer_account.anonymized.v1` subscriber and the daily sweep can erase the same
   * account at the same moment, and so can two sweeps. Each must see what the other left:
   * one erasure, one audit entry, every file gone, and neither run failing.
   */
  it('erases one account once when two erasures run concurrently', async () => {
    const { member, caseId } = await customerWithCase('Twice180');
    const service = h.container.resolve('returnsErasureService') as ReturnErasureService;
    const results = await Promise.allSettled([service.eraseForAccount(member.id), service.eraseForAccount(member.id)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((results as Array<PromiseFulfilledResult<number>>).map((r) => r.value).sort()).toEqual([0, 1]);
    await expectErased(caseId, member.id);
    expect(await auditOf(member.id)).toHaveLength(1);
  });

  it('erases a file whose bytes are already gone, without failing', async () => {
    const { member, caseId } = await customerWithCase('Gone180');
    // A run that deleted the bytes and then rolled back left the rows behind.
    for (const entry of await readdir(baseDir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) await rm(join(entry.parentPath, entry.name));
    }
    const service = h.container.resolve('returnsErasureService') as ReturnErasureService;
    await expect(service.eraseForAccount(member.id)).resolves.toBe(1);
    await expectErased(caseId, member.id);
    expect(await auditOf(member.id)).toHaveLength(1);
  });

  it('erases in the maintenance sweep an account anonymised while returns was off, deletes expired uploads, and is idempotent', async () => {
    const { member, caseId } = await customerWithCase('Missed180');
    await h.em().getConnection().execute(`update "customer_accounts" set "anonymized_at" = now() where "id" = ?`, [member.id]);
    const other = await makeMember(h.em(), organizationId, 'member', { label: 'Expired180' });
    const expired = ((await upload(h, pdf, { cookies: { b2b_session: other.cookie } })).json() as { data: { uploadId: string } }).data.uploadId;
    await h.em().fork().nativeUpdate(ReturnCaseAttachment, { id: expired }, { expiresAt: new Date(Date.now() - 1000) });

    const deps = h.container.resolve('returnsMaintenanceDeps') as ReturnsMaintenanceJobDeps;
    await runWithoutTenantContext(() => runReturnsMaintenanceJob(deps, new Date()));
    // The outcome, whoever produced it: a sweep of another file may have erased first.
    await expectErased(caseId, member.id);
    expect(await h.em().fork().count(ReturnCaseAttachment, { id: expired }, { filters: false })).toBe(0);
    expect(await auditOf(member.id)).toHaveLength(1);

    await runWithoutTenantContext(() => runReturnsMaintenanceJob(deps, new Date()));
    expect(await auditOf(member.id)).toHaveLength(1);
  });
});
