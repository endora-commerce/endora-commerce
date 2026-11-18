import { ApiError } from '@endora-commerce/admin-kit/lib';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The message a failed dictionary request shows: the API's own (already in the
 * operator's language), with the way out added when the entry is still in use,
 * else the screen's translated fallback (issue #1456).
 */
export function formatDictionaryError(err: unknown, fallback: string, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.envelope.error.code === 'DICTIONARY_ENTRY_HAS_DEPENDENTS') {
      return `${err.envelope.error.message} ${t('error.hasDependentsHint')}`;
    }
    return err.envelope.error.message;
  }
  return fallback;
}
