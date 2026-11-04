import type { ScopeMissingValue } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 163 (T088) — scope refusals and completeness gate pairs in the operator's words.
 * Feature 172: the editor's reads and writes moved to `scoped-values-api.ts`; the removed
 * `…/scope-context` route is no longer called (channel names come from the read's
 * `validScopes`).
 */

type Translate = (key: string, params?: Record<string, string>) => string;

/** One missing value (FR-041 vocabulary) in the operator's words. */
export function describeMissingValue(value: ScopeMissingValue, t: Translate): string {
  if (value === 'name') return t('productEditor.scopeControls.missing.name');
  if (value === 'urlKey') return t('productEditor.scopeControls.missing.urlKey');
  return t('productEditor.scopeControls.missing.attribute', { key: value.slice('attribute:'.length) });
}

/** `B2B · DE: name, URL key` — one gate pair. */
export function describeIncompletePair(
  pair: { channelId: string; languageCode: string; missing: readonly ScopeMissingValue[] },
  channelName: (channelId: string) => string,
  t: Translate,
): string {
  return t('productEditor.scopeControls.incompletePair', {
    channel: channelName(pair.channelId),
    language: pair.languageCode.toUpperCase(),
    missing: pair.missing.map((m) => describeMissingValue(m, t)).join(', '),
  });
}

/**
 * A refused scope write as one translated sentence. The error code never reaches the
 * operator; an unknown refusal gets the generic sentence, which says the edit is kept.
 */
export function scopeSaveErrorMessage(
  err: unknown,
  channelName: (channelId: string) => string,
  t: Translate,
  genericKey = 'productEditor.scopeControls.error.generic',
  incompleteKey = 'productEditor.scopeControls.error.incomplete',
): string {
  if (!(err instanceof ApiError)) return t(genericKey);
  if (err.status === 403) return t('productEditor.scopeControls.error.forbidden');
  const { code, details } = err.envelope.error as { code: string; details?: Record<string, unknown> };
  if (code === 'SCOPE_INVALID' && details) {
    const channel = channelName(String(details['channelId'] ?? ''));
    if (details['reason'] === 'language_not_offered') {
      return t('productEditor.scopeControls.error.languageNotOffered', {
        channel,
        language: String(details['languageCode'] ?? '').toUpperCase(),
      });
    }
    return t('productEditor.scopeControls.error.notAMember', { channel });
  }
  if (code === 'VALIDATION_FAILED' && details?.['field'] === 'window') {
    return t('productEditor.scopeControls.error.window');
  }
  if (code === 'VALIDATION_FAILED' && details?.['field'] === 'languageStatuses') {
    return t('productEditor.scopeControls.error.languageRepeated', {
      channel: channelName(String(details['channelId'] ?? '')),
      language: String(details['languageCode'] ?? '').toUpperCase(),
    });
  }
  if (code === 'VERSION_CONFLICT') return t('productEditor.scopeControls.error.conflict');
  if (code === 'SCOPE_INCOMPLETE' && details && Array.isArray(details['pairs'])) {
    const pairs = details['pairs'] as Array<{
      channelId: string;
      languageCode: string;
      missing: ScopeMissingValue[];
    }>;
    return t(incompleteKey, {
      details: pairs.map((pair) => describeIncompletePair(pair, channelName, t)).join('; '),
    });
  }
  return t(genericKey);
}
