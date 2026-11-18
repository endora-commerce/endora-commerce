import type { EntityManager } from '@mikro-orm/postgresql';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { ReturnReason } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIE } from './helpers.js';
import { overrideReturnsSetting } from './notification-jobs.js';
import { multipartBody } from '../../helpers/crm-attachment-upload.js';

/**
 * Fixtures for the complaint without a platform order (`specs/180-off-platform-complaints/`
 * phase B): the toggle, a complaint reason and a no-order filing.
 */

export const OFF_PLATFORM_SETTING = 'returns.off_platform_complaints_enabled';
export const PROOF_REQUIRED_SETTING = 'returns.proof_of_purchase_required';

/** Switch no-order complaints on (or off) platform-wide for the rest of the file; answers the undo. */
export function allowOffPlatform(h: BackendServerHandle, on = true): Promise<() => Promise<void>> {
  return overrideReturnsSetting(h, OFF_PLATFORM_SETTING, on);
}

/** An active reason a complaint may name. */
export async function complaintReasonId(em: EntityManager): Promise<string> {
  const reasons = await em.fork().find(ReturnReason, { isActive: true, appliesTo: { $in: ['complaint', 'both'] } });
  return reasons[0]!.id;
}

/** A valid no-order complaint body; `over` replaces top-level keys. */
export function noOrderBody(reasonId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: null,
    kind: 'complaint',
    lines: [{ modelName: 'Drill X200', quantity: 1, reasonId, description: 'The battery swells', serialNumber: 'SN-180' }],
    purchase: { proofNumber: 'FV/180/2026', date: '2026-10-01' },
    contact: { name: 'Ewa Nowak', email: 'ewa@example.test', phone: '+48 600 000 000' },
    returnAddress: { name: 'Ewa Nowak', street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
    ...over,
  };
}

/** `POST /api/v1/returns` as the stub customer (or `cookies`). */
export function file(
  h: BackendServerHandle,
  payload: Record<string, unknown>,
  options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns',
    cookies: options.cookies ?? CUSTOMER_COOKIE,
    ...(options.headers ? { headers: options.headers } : {}),
    payload,
  });
}

/** A small, real PDF and PNG for the attachment tests. */
export const SMALL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export { TINY_PNG } from '../../helpers/crm-attachment-upload.js';

/**
 * `POST /api/v1/returns/uploads` (or `/:id/attachments` with `caseId`) with one file and a type,
 * and the line it shows when `returnCaseItemId` is given.
 */
export function upload(
  h: BackendServerHandle,
  file: { type: string; filename: string; mime: string; value: Buffer },
  options: { cookies?: Record<string, string>; caseId?: string; returnCaseItemId?: string } = {},
) {
  const { body, contentType } = multipartBody([
    { name: 'type', value: file.type },
    ...(options.returnCaseItemId ? [{ name: 'returnCaseItemId', value: options.returnCaseItemId }] : []),
    { name: 'file', filename: file.filename, mime: file.mime, value: file.value },
  ]);
  return h.app.inject({
    method: 'POST',
    url: options.caseId ? `/api/v1/returns/${options.caseId}/attachments` : '/api/v1/returns/uploads',
    headers: { 'content-type': contentType },
    cookies: options.cookies ?? CUSTOMER_COOKIE,
    payload: body,
  });
}
