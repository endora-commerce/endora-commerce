import { StorefrontApiError } from '../api/client';
import { isRoleErrorCode, type RoleErrorCode } from './organization-roles';

/**
 * The code a failed role write reports: the API's own when the page can name it.
 *
 * Kept apart from `organization-roles.ts` because it needs `StorefrontApiError`,
 * whose module reaches `next/headers`. The role vocabulary is imported by the
 * client form `components/account/RoleEditorForm.tsx`, and `next build` refuses
 * a client graph that reaches `next/headers` (`test/client-server-boundary.test.ts`).
 */
export function roleFailureCode(err: unknown): RoleErrorCode {
  return err instanceof StorefrontApiError && isRoleErrorCode(err.code) ? err.code : 'FAILED';
}
