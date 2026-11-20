import { ERROR_CODES } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * What the delete confirmation says when a CMS list's delete is refused
 * (issue #1495, UX audit CONTENT-13). The server's own message is English and
 * names the entity type ("CMS Block is referenced."), so the refusals an
 * operator can act on are worded here, in their language, with the way out;
 * anything else is the generic retry line. Exported for the tests.
 */
export function cmsDeleteErrorMessage(err: unknown, t: Translate): string {
  const code = err instanceof ApiError ? err.envelope.error.code : null;
  if (code === ERROR_CODES.CMS_REFERENCED) return t('listActions.deleteReferenced');
  if (code === ERROR_CODES.CMS_HOOK_SYSTEM_PROTECTED) return t('listActions.deleteSystem');
  return t('listActions.deleteFailed');
}

/** A list's load error: the server's message when it gave one, the kit's generic copy otherwise. */
export function loadErrorMessage(err: unknown): { message?: string } {
  return err instanceof ApiError ? { message: err.envelope.error.message } : {};
}
