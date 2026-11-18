import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, resetReturnGraph } from './helpers.js';
import { makeMember, makeOrganization, releaseMembers, type ReturnsFixtureMember } from './organization-fixtures.js';
import { SMALL_PDF, TINY_PNG, allowOffPlatform, complaintReasonId, file, noOrderBody, upload } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T066 (FR-B22, Principle XI): who gets a case's
 * file — the filer, an organization viewer, an administrator holding `returns:read` —
 * and how it is served; everyone else gets 404.
 */
describe('returns — serving an attachment', () => {
  let h: BackendServerHandle;
  let undoStore: () => Promise<void>;
  let undoOffPlatform: () => Promise<void>;
  let caseId: string;
  let pdfId: string;
  let pngId: string;
  let filer: ReturnsFixtureMember;
  let viewer: ReturnsFixtureMember;
  let outsider: ReturnsFixtureMember;
  let member: ReturnsFixtureMember;
  let noReturns: { cookies: { b2b_session: string }; undo: () => void };

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    undoStore = (await useTemporaryAssetStore(h)).undo;
    undoOffPlatform = await allowOffPlatform(h);
    const org = await makeOrganization(h.em(), '180 attachment audience');
    filer = await makeMember(h.em(), org, 'member', { label: 'Filer180a' });
    viewer = await makeMember(h.em(), org, { permissions: ['returns.view_organization'] }, { label: 'Viewer180' });
    member = await makeMember(h.em(), org, 'member', { label: 'Member180' });
    const filerCookie = { b2b_session: filer.cookie };
    const ids: string[] = [];
    for (const f of [
      { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF },
      { type: 'photo', filename: 'p.png', mime: 'image/png', value: TINY_PNG },
    ]) {
      ids.push((((await upload(h, f, { cookies: filerCookie })).json()) as { data: { uploadId: string } }).data.uploadId);
    }
    [pdfId, pngId] = ids as [string, string];
    const res = await file(h, noOrderBody(await complaintReasonId(h.em()), { attachments: ids.map((uploadId) => ({ uploadId })) }), {
      cookies: filerCookie,
      headers: { 'x-sales-channel': 'default' },
    });
    expect(res.statusCode, res.body).toBe(201);
    caseId = (res.json() as { data: { id: string } }).data.id;
    outsider = await makeMember(h.em(), await makeOrganization(h.em(), '180 outsider'), 'administrator', { label: 'Out180' });
    noReturns = await seedCrmAdmin(h.em(), 'no_returns_180', ['orders:read']);
  });
  afterAll(async () => {
    noReturns.undo();
    await undoOffPlatform();
    await undoStore();
    releaseMembers();
    await teardownBackendServer(h);
  });

  const customerFile = (attachmentId: string, cookies: Record<string, string> | undefined, id = caseId) =>
    h.app.inject({ method: 'GET', url: `/api/v1/returns/${id}/attachments/${attachmentId}/file`, ...(cookies ? { cookies } : {}) });
  const adminFile = (attachmentId: string, cookies: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}/attachments/${attachmentId}/file`, cookies });

  it('serves the bytes to the filer and to an organization viewer, never sniffed and never cached', async () => {
    for (const cookies of [{ b2b_session: filer.cookie }, { b2b_session: viewer.cookie }]) {
      const res = await customerFile(pdfId, cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.rawPayload.equals(SMALL_PDF)).toBe(true);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toMatch(/^attachment/);
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('answers 404 to a colleague without the view permission, another organization, a signed-out caller and a mismatched pair', async () => {
    expect((await customerFile(pdfId, { b2b_session: member.cookie })).statusCode).toBe(404);
    expect((await customerFile(pdfId, { b2b_session: outsider.cookie })).statusCode).toBe(404);
    expect([401, 404]).toContain((await customerFile(pdfId, undefined)).statusCode);
    expect((await customerFile(pdfId, CUSTOMER_COOKIE)).statusCode).toBe(404);
    expect((await customerFile(pdfId, { b2b_session: filer.cookie }, randomUUID())).statusCode).toBe(404);
    expect((await customerFile(randomUUID(), { b2b_session: filer.cookie })).statusCode).toBe(404);
  });

  it('serves an administrator with returns:read, inline for an image, and refuses one without', async () => {
    const png = await adminFile(pngId, ADMIN_COOKIE);
    expect(png.statusCode, png.body).toBe(200);
    expect(png.headers['content-disposition']).toMatch(/^inline/);
    expect((await adminFile(pdfId, ADMIN_COOKIE)).headers['content-disposition']).toMatch(/^attachment/);
    expect((await adminFile(pdfId, noReturns.cookies)).statusCode).toBe(403);
  });

  it('neither lists nor serves a legacy asset link', async () => {
    const legacy = randomUUID();
    await h.em().getKnex()('return_case_attachments').insert({
      id: legacy,
      return_case_id: caseId,
      organization_id: filer.organizationId,
      asset_id: randomUUID(),
      created_at: new Date(),
    });
    expect((await customerFile(legacy, { b2b_session: filer.cookie })).statusCode).toBe(404);
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}`, cookies: ADMIN_COOKIE });
    expect((detail.json() as { data: { attachments: Array<{ id: string }> } }).data.attachments.map((a) => a.id)).not.toContain(legacy);
  });
});
