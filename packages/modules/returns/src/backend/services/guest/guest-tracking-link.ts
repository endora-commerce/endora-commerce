import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../../entities/return-case.entity.js';
import type { ReturnsNotificationJob } from '../notifications/dispatch.js';

/**
 * The guest's two links (`specs/181-guest-complaints/` research R-3, R-5, owner ruling
 * of 2026-11-16): purpose-sealed references, never stored secrets.
 *
 * - The **verification link** seals the verification row's id under
 *   {@link GUEST_VERIFY_PURPOSE}. The worker re-derives it when it sends the e-mail, so
 *   no secret enters the job or the database.
 * - The **tracking link** seals `<caseId>:<trackingVersion>` under
 *   {@link GUEST_TRACKING_PURPOSE}. It is deterministic, so every e-mail about a case
 *   carries the same link until an operator replaces it by incrementing the version.
 *
 * The seal is the platform's `cursorSeal` (AES-256-GCM, the purpose as additional data),
 * resolved from the container and named here by a local structural type: a module may
 * not import the platform's composition subpath (`check:platform-surface`). Because the
 * purpose is the additional data, a verification token never opens as a tracking token,
 * a pagination cursor as either, nor the reverse. Rotating the session key voids every
 * link; an unreadable token is answered as an invalid one.
 */

/** The platform seal's shape, as `returns` uses it. */
export interface GuestLinkSeal {
  seal(purpose: string, payload: string): string;
  /** The payload, or `null` for a token of another purpose or key, an altered one, garbage. */
  open(purpose: string, token: string): string | null;
}

export const GUEST_VERIFY_PURPOSE = 'returns.guest-verify.v1';
export const GUEST_TRACKING_PURPOSE = 'returns.guest-tracking.v1';

/** No token this module issues is longer: a longer one is refused before it is decrypted. */
const MAX_TOKEN_LENGTH = 512;

export interface GuestTrackingReference {
  readonly caseId: string;
  readonly version: number;
}

export interface GuestLinks {
  verificationToken(verificationId: string): string;
  /** The verification id, or `null` for anything that is not a verification token of this key. */
  openVerification(token: string): string | null;
  trackingToken(caseId: string, version: number): string;
  /** The case and version, or `null` for anything that is not a tracking token of this key. */
  openTracking(token: string): GuestTrackingReference | null;
}

export function createGuestLinks(seal: GuestLinkSeal): GuestLinks {
  const open = (purpose: string, token: string): string | null =>
    typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? seal.open(purpose, token) : null;

  return {
    verificationToken: (verificationId) => seal.seal(GUEST_VERIFY_PURPOSE, verificationId),
    openVerification(token) {
      const id = open(GUEST_VERIFY_PURPOSE, token);
      return id !== null && isUuidShape(id) ? id : null;
    },
    trackingToken: (caseId, version) => seal.seal(GUEST_TRACKING_PURPOSE, `${caseId}:${version}`),
    openTracking(token) {
      const payload = open(GUEST_TRACKING_PURPOSE, token);
      if (payload === null) return null;
      const match = /^([0-9a-f-]{36}):([1-9][0-9]{0,8})$/.exec(payload);
      if (!match || !isUuidShape(match[1]!)) return null;
      return { caseId: match[1]!, version: Number(match[2]) };
    },
  };
}

export interface TrackingLinkReissueDeps {
  readonly commandBus: Pick<CommandBus, 'run'>;
  /** Hand `guest_link_reissued` to the notification queue after the commit; never throws. */
  readonly enqueue?: (job: ReturnsNotificationJob) => Promise<void>;
}

/**
 * *Send a new tracking link* (`specs/181-guest-complaints/` FR-046, admin-api.md A3):
 * Command `return_case.tracking_link.reissue` increments the case's `tracking_version`,
 * so every earlier link opens to a version that no longer matches and is refused like an
 * unknown one (research R-5); the new link goes to the verified address from the queue.
 *
 * The case is read in the admin's tenant context, so an administrator who cannot see a
 * guest case gets the same 404 as for one that does not exist (research R-1). A
 * customer's case is `422 not_guest_case`; an erased one `409 RETURN_GUEST_DATA_ERASED`
 * — there is no address left to send a link to. The entry records the version numbers
 * only.
 */
export async function reissueTrackingLink(deps: TrackingLinkReissueDeps, caseId: string): Promise<{ trackingVersion: number }> {
  if (!isUuidShape(caseId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
  const trackingVersion = await deps.commandBus.run<number>({
    action: 'return_case.tracking_link.reissue',
    objectType: 'return_case',
    objectId: caseId,
    run: async ({ em }) => {
      const rc = await em.findOne(ReturnCase, { id: caseId });
      if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
      if (rc.customerAccountId != null) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only a guest’s case has a tracking link.', { code: 'not_guest_case' });
      }
      if (rc.personalDataErasedAt) {
        throw new HttpError(409, ERROR_CODES.RETURN_GUEST_DATA_ERASED, 'The personal data of this case has been erased.');
      }
      const before = rc.trackingVersion ?? 1;
      rc.trackingVersion = before + 1;
      await em.flush();
      return { result: rc.trackingVersion, before: { trackingVersion: before }, after: { trackingVersion: rc.trackingVersion } };
    },
  });
  await deps.enqueue?.({ kind: 'guest_link_reissued', caseId, trackingVersion });
  return { trackingVersion };
}
