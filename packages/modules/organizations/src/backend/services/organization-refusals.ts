import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  OrganizationNotFoundError,
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from './organization-moderation-errors.js';

/**
 * The HTTP refusals of the moderation and restriction writes — shared by the
 * admin routes and `organizationCommandPort` (`specs/186-aggregate-ports/`
 * convention item 2a.5: a port's refusals are its admin route's), so the two
 * answer one error one way. The routes still name the statuses in the reader's
 * language through `statusGuardRefusal`'s labels; the port, with no reader,
 * answers the codes as labels.
 *
 * The restriction writes and the moderation transitions throw the same
 * {@link OrganizationVersionMismatchError}, so both answer
 * `409 VERSION_CONFLICT` with `currentVersion`.
 */

export function restrictionHttpError(err: unknown): HttpError {
  if (err instanceof OrganizationVersionMismatchError) {
    return new HttpError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'Organization was modified by another request. Refresh and retry.',
      {
        code: 'organization_version_mismatch',
        currentVersion: err.currentVersion,
      },
    );
  }
  if (err instanceof HttpError) return err;
  return new HttpError(
    500,
    ERROR_CODES.INTERNAL,
    err instanceof Error ? err.message : 'Internal error.',
  );
}

/**
 * Issue #629 (#86) — the organization refuses a well-formed moderation request
 * because it is in another status: a code of its own. The machine values stay
 * in `details` for a client to branch on; the labels beside them fill the
 * sentence.
 */
export function statusGuardRefusal(
  err: OrganizationStatusGuardError,
  currentStatusLabel: string,
  requiredStatusLabel: string,
): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.ORGANIZATION_STATUS_INVALID,
    `Organization is in status '${err.currentStatus}', cannot perform an action that requires '${err.requiredStatus}'.`,
    {
      currentStatus: err.currentStatus,
      requiredStatus: err.requiredStatus,
      currentStatusLabel,
      requiredStatusLabel,
    },
  );
}

export function moderationHttpError(err: unknown): HttpError {
  if (err instanceof OrganizationVersionMismatchError) {
    return new HttpError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'Organization was modified by another request. Refresh and retry.',
      {
        code: 'organization_version_mismatch',
        currentVersion: err.currentVersion,
      },
    );
  }
  if (err instanceof OrganizationStatusGuardError) {
    return statusGuardRefusal(err, err.currentStatus, err.requiredStatus);
  }
  if (err instanceof OrganizationNotFoundError) {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }
  if (err instanceof HttpError) return err;
  return new HttpError(
    500,
    ERROR_CODES.INTERNAL,
    err instanceof Error ? err.message : 'Internal error.',
  );
}
