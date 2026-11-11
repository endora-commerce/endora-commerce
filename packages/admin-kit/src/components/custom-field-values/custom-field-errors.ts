import { ERROR_CODES } from '@endora-commerce/contracts';
import { ApiError } from '../../lib/index.js';

/**
 * Feature 175 — a create or save refused `422 CUSTOM_FIELD_VALUE_INVALID`, as
 * the `fieldErrors` the embedded {@link CustomFieldValuesPanel} says at each
 * field: the key is the entry's `path` (the definition key), the sentence its
 * `issue`. `null` for any other failure, which the screen reports as before.
 *
 * Published beside the panel so every host screen reads a refusal one way
 * (Principle IX) rather than each module carrying its own copy.
 */
export function customFieldErrorsOf(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError)) return null;
  const { code, details } = error.envelope.error;
  if (code !== ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID || !Array.isArray(details)) return null;
  const out: Record<string, string> = {};
  for (const entry of details as unknown[]) {
    if (entry && typeof entry === 'object') {
      const { path, issue } = entry as { path?: unknown; issue?: unknown };
      if (typeof path === 'string' && typeof issue === 'string') out[path] = issue;
    }
  }
  return out;
}
