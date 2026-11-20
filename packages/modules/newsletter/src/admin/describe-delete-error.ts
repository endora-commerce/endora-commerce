import { ApiError } from '@endora-commerce/admin-kit/lib';

/**
 * Words a failed delete for the confirmation dialog it runs in (issue #1464):
 * the API's own sentence when it sent one — the backend translates its
 * refusals, such as a tag a campaign still uses — and the module's generic
 * failure otherwise, never a raw `Error` string.
 */
export function describeDeleteError(t: (key: string) => string): (err: unknown) => string {
  return (err) => (err instanceof ApiError ? err.envelope.error.message : t('delete.failed'));
}
