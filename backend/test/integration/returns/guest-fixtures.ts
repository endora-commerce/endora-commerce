import { createHash, randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { overrideReturnsSetting } from './notification-jobs.js';
import { SMALL_PDF, allowOffPlatform } from './off-platform-fixtures.js';
import { multipartBody } from '../../helpers/crm-attachment-upload.js';

/**
 * Fixtures for complaints from guests without an account (`specs/181-guest-complaints/`):
 * the two settings, the verification request, the redeem and the session cookie.
 */

export const GUEST_SETTING = 'returns.guest_complaints_enabled';
export const GUEST_COOKIE = 'b2b_returns_guest';
export const OTHER_CHANNEL = 'pl_retail';

/**
 * Switch guest complaints on platform-wide for the rest of the file — with 180's no-order
 * complaints, which they require (G7). Answers the undo.
 */
export async function allowGuests(h: BackendServerHandle): Promise<() => Promise<void>> {
  const undoOffPlatform = await allowOffPlatform(h);
  const undoGuests = await overrideReturnsSetting(h, GUEST_SETTING, true);
  return async () => {
    await undoGuests();
    await undoOffPlatform();
  };
}

/** Give `code` a value on one sales channel; answers the undo. */
export async function channelSetting(
  h: BackendServerHandle,
  code: string,
  channelCode: string,
  value: unknown,
): Promise<() => Promise<void>> {
  const em = h.em().fork();
  const channel = await em.findOneOrFail(SalesChannel, { code: channelCode });
  const setting = await em.findOneOrFail(Setting, { code });
  const row = em.create(SettingValue, { setting, salesChannel: channel, value });
  await em.flush();
  await h.settings.cache.invalidate(code);
  return async () => {
    const fork = h.em().fork();
    await fork.nativeDelete(SettingValue, { id: row.id });
    await h.settings.cache.invalidate(code);
  };
}

let address = 1;
/** A client address no other request of the run has used, so a per-address limit starts empty. */
export const nextIp = (): string => `10.181.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

/** An e-mail address no other test has used. */
export const freshEmail = (): string => `guest-${randomUUID()}@example.test`;

/** SHA-256 hex of the lower-cased, trimmed address: the stored `email_hash`. */
export const emailHashOf = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

export interface GuestRequestOptions {
  readonly ip?: string;
  readonly channel?: string;
  readonly headers?: Record<string, string>;
  readonly cookies?: Record<string, string>;
}

function requestHeaders(options: GuestRequestOptions): Record<string, string> {
  return { 'x-sales-channel': options.channel ?? 'default', ...(options.headers ?? {}) };
}

/** G2 `POST /api/v1/returns/guest/verifications`. */
export function requestLink(
  h: BackendServerHandle,
  body: Record<string, unknown>,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/guest/verifications',
    remoteAddress: options.ip ?? nextIp(),
    headers: requestHeaders(options),
    ...(options.cookies ? { cookies: options.cookies } : {}),
    payload: body,
  });
}

/** G3 `POST /api/v1/returns/guest/sessions`. */
export function redeem(h: BackendServerHandle, token: string, options: GuestRequestOptions = {}): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/guest/sessions',
    remoteAddress: options.ip ?? nextIp(),
    headers: requestHeaders(options),
    payload: { token },
  });
}

/** G4 `DELETE /api/v1/returns/guest/sessions/current` with the session cookie. */
export function leave(h: BackendServerHandle, sessionToken: string | null, options: GuestRequestOptions = {}): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'DELETE',
    url: '/api/v1/returns/guest/sessions/current',
    remoteAddress: options.ip ?? nextIp(),
    headers: requestHeaders(options),
    ...(sessionToken === null ? {} : { cookies: { [GUEST_COOKIE]: sessionToken } }),
  });
}

/** G1 `GET /api/v1/returns/guest/availability`. */
export async function availability(h: BackendServerHandle, channel = 'default'): Promise<{ statusCode: number; enabled: boolean | undefined }> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/returns/guest/availability',
    remoteAddress: nextIp(),
    headers: { 'x-sales-channel': channel },
  });
  return { statusCode: res.statusCode, enabled: (res.json() as { data?: { enabled?: boolean } }).data?.enabled };
}

export interface VerificationRow {
  readonly id: string;
  readonly sales_channel_id: string;
  readonly email: string;
  readonly language: string;
  readonly link_expires_at: Date;
  readonly redeemed_at: Date | null;
  readonly session_expires_at: Date | null;
  readonly ended_at: Date | null;
  readonly created_at: Date;
}

/** The verification rows of an address, oldest first. */
export async function verificationsOf(h: BackendServerHandle, email: string): Promise<VerificationRow[]> {
  const rows = (await h
    .em()
    .execute('select * from "return_guest_verifications" where "email_hash" = ? order by "created_at", "id"', [
      emailHashOf(email),
    ])) as Array<Record<string, unknown>>;
  const at = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));
  return rows.map((r) => ({
    id: r['id'] as string,
    sales_channel_id: r['sales_channel_id'] as string,
    email: r['email'] as string,
    language: r['language'] as string,
    link_expires_at: at(r['link_expires_at'])!,
    redeemed_at: at(r['redeemed_at']),
    session_expires_at: at(r['session_expires_at']),
    ended_at: at(r['ended_at']),
    created_at: at(r['created_at'])!,
  }));
}

/** The verification link token of a row, as the e-mail carries it — sealed by the module's own links. */
export function verificationTokenOf(h: BackendServerHandle, verificationId: string): string {
  return h.container.resolve<{ verificationToken(id: string): string }>('returnsGuestLinks').verificationToken(verificationId);
}

/**
 * Request a link for a fresh address and redeem it: answers the session token and the
 * address. The request and the redeem each use a fresh client address.
 */
export async function openGuestSession(
  h: BackendServerHandle,
  options: { channel?: string; email?: string } = {},
): Promise<{ sessionToken: string; email: string; verificationId: string }> {
  const email = options.email ?? freshEmail();
  const requested = await requestLink(h, { email }, options.channel ? { channel: options.channel } : {});
  if (requested.statusCode !== 202) throw new Error(`verification request answered ${requested.statusCode}: ${requested.body}`);
  const rows = await verificationsOf(h, email);
  const verificationId = rows[rows.length - 1]!.id;
  const res = await redeem(h, verificationTokenOf(h, verificationId), options.channel ? { channel: options.channel } : {});
  if (res.statusCode !== 201) throw new Error(`redeem answered ${res.statusCode}: ${res.body}`);
  return { sessionToken: (res.json() as { data: { sessionToken: string } }).data.sessionToken, email, verificationId };
}

// --- Guest filing and the tracking link (`specs/181-guest-complaints/` G-4, G-5) ---------

export const TRACKING_HEADER = 'x-returns-tracking-token';

/** A valid guest complaint body (G7); `over` replaces top-level keys. */
export function guestBody(reasonId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'complaint',
    lines: [{ modelName: 'Drill X181', quantity: 1, reasonId, description: 'The battery swells', serialNumber: 'SN-181' }],
    purchase: { proofNumber: 'FV/181/2026', date: '2026-10-01' },
    contact: { name: 'Gość Kowalski', phone: '+48 600 000 181' },
    returnAddress: { name: 'Gość Kowalski', street: 'Prosta 2', postalCode: '00-002', city: 'Warszawa', countryCode: 'PL' },
    ...over,
  };
}

/** Request options with the guest session cookie (and any other cookies). */
function sessionCookies(sessionToken: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...(sessionToken === null ? {} : { [GUEST_COOKIE]: sessionToken }) };
}

/** G7 `POST /api/v1/returns/guest/cases` with the session cookie. */
export function fileAsGuest(
  h: BackendServerHandle,
  sessionToken: string | null,
  body: Record<string, unknown>,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/guest/cases',
    remoteAddress: options.ip ?? nextIp(),
    headers: requestHeaders(options),
    cookies: sessionCookies(sessionToken, options.cookies),
    payload: body,
  });
}

/** G5 `GET /api/v1/returns/guest/form-config` with the session cookie. */
export function guestFormConfig(
  h: BackendServerHandle,
  sessionToken: string | null,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'GET',
    url: '/api/v1/returns/guest/form-config',
    remoteAddress: options.ip ?? nextIp(),
    headers: requestHeaders(options),
    cookies: sessionCookies(sessionToken, options.cookies),
  });
}

/** A multipart body with one file, its `type` and optional extra fields. */
function filePart(
  file: { type: string; filename: string; mime: string; value: Buffer },
  fields: Record<string, string> = {},
): { body: Buffer; contentType: string } {
  return multipartBody([
    { name: 'type', value: file.type },
    ...Object.entries(fields).map(([name, value]) => ({ name, value })),
    { name: 'file', filename: file.filename, mime: file.mime, value: file.value },
  ]);
}

/** A small PDF the type sniffer accepts. */
export const GUEST_PDF = { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF };

/** G6 `POST /api/v1/returns/guest/uploads` with the session cookie. */
export function guestUpload(
  h: BackendServerHandle,
  sessionToken: string | null,
  file: { type: string; filename: string; mime: string; value: Buffer } = GUEST_PDF,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  const { body, contentType } = filePart(file);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/guest/uploads',
    remoteAddress: options.ip ?? nextIp(),
    headers: { ...requestHeaders(options), 'content-type': contentType },
    cookies: sessionCookies(sessionToken, options.cookies),
    payload: body,
  });
}

/** The tracking token's request options: the token travels in a header, never the URL. */
function trackingHeaders(token: string | null, options: GuestRequestOptions): Record<string, string> {
  return { ...requestHeaders(options), ...(token === null ? {} : { [TRACKING_HEADER]: token }) };
}

/** G8 `GET /api/v1/returns/track`. */
export function track(h: BackendServerHandle, token: string | null, options: GuestRequestOptions = {}): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'GET',
    url: '/api/v1/returns/track',
    remoteAddress: options.ip ?? nextIp(),
    headers: trackingHeaders(token, options),
    ...(options.cookies ? { cookies: options.cookies } : {}),
  });
}

/** G9 `POST /api/v1/returns/track/comments`. */
export function trackComment(
  h: BackendServerHandle,
  token: string | null,
  body: string,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/track/comments',
    remoteAddress: options.ip ?? nextIp(),
    headers: trackingHeaders(token, options),
    ...(options.cookies ? { cookies: options.cookies } : {}),
    payload: { body },
  });
}

/** G10 `POST /api/v1/returns/track/attachments`. */
export function trackUpload(
  h: BackendServerHandle,
  token: string | null,
  file: { type: string; filename: string; mime: string; value: Buffer } = GUEST_PDF,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  const { body, contentType } = filePart(file);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/returns/track/attachments',
    remoteAddress: options.ip ?? nextIp(),
    headers: { ...trackingHeaders(token, options), 'content-type': contentType },
    ...(options.cookies ? { cookies: options.cookies } : {}),
    payload: body,
  });
}

/** G10 `GET /api/v1/returns/track/attachments/:attachmentId/file`. */
export function trackFile(
  h: BackendServerHandle,
  token: string | null,
  attachmentId: string,
  options: GuestRequestOptions = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method: 'GET',
    url: `/api/v1/returns/track/attachments/${attachmentId}/file`,
    remoteAddress: options.ip ?? nextIp(),
    headers: trackingHeaders(token, options),
  });
}

/** The case a tracking token names, opened by the module's own links. */
export function caseIdOfToken(h: BackendServerHandle, token: string): string {
  const opened = h.container
    .resolve<{ openTracking(token: string): { caseId: string; version: number } | null }>('returnsGuestLinks')
    .openTracking(token);
  if (!opened) throw new Error('not a tracking token');
  return opened.caseId;
}

/** The tracking token of a case at a version, as an e-mail carries it. */
export function trackingTokenOf(h: BackendServerHandle, caseId: string, version: number): string {
  return h.container.resolve<{ trackingToken(id: string, v: number): string }>('returnsGuestLinks').trackingToken(caseId, version);
}

export interface FiledGuestCase {
  readonly caseId: string;
  readonly reference: string;
  readonly trackingToken: string;
  readonly email: string;
  readonly sessionToken: string;
  readonly verificationId: string;
}

/**
 * Open a guest session and file one complaint with a proof of purchase (so the case
 * files whatever the proof setting says). Fails the test on anything but 201.
 */
export async function fileGuestCase(
  h: BackendServerHandle,
  reasonId: string,
  options: { email?: string; over?: Record<string, unknown>; channel?: string } = {},
): Promise<FiledGuestCase> {
  const session = await openGuestSession(h, {
    ...(options.email ? { email: options.email } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
  });
  const channelOptions = options.channel ? { channel: options.channel } : {};
  const uploaded = await guestUpload(h, session.sessionToken, GUEST_PDF, channelOptions);
  if (uploaded.statusCode !== 201) throw new Error(`guest upload answered ${uploaded.statusCode}: ${uploaded.body}`);
  const uploadId = (uploaded.json() as { data: { uploadId: string } }).data.uploadId;
  const res = await fileAsGuest(
    h,
    session.sessionToken,
    guestBody(reasonId, { attachments: [{ uploadId }], ...(options.over ?? {}) }),
    channelOptions,
  );
  if (res.statusCode !== 201) throw new Error(`guest filing answered ${res.statusCode}: ${res.body}`);
  const data = (res.json() as { data: { reference: string; trackingToken: string; email: string } }).data;
  return { ...data, caseId: caseIdOfToken(h, data.trackingToken), sessionToken: session.sessionToken, verificationId: session.verificationId };
}
