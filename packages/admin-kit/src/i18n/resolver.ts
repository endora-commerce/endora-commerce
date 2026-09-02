// Pure i18n resolver — feature 019 / research §R7.
//
// Three-step fallback chain: requested-language entry → English entry →
// `${scope}.${key}` placeholder. The `outcome` field lets callers
// observe whether a fallback fired so the diagnostic surface
// (TranslationProvider's dev-mode console.warn) can log it.

import { interpolate } from './interpolate.js';
import type { Bundle, ResolveOutcome, SupportedAdminLanguage } from './types.js';

const FALLBACK_LANGUAGE: SupportedAdminLanguage = 'en';

export interface ResolveArgs {
  scope: string;
  key: string;
  language: SupportedAdminLanguage;
  bundle: Bundle;
  /** Optional EN bundle pre-fetched separately. When undefined, no
   *  cross-language fallback is attempted (useful when the SPA already
   *  fetched only the user's preferred bundle and is in a degraded
   *  rendering state — see research §R7). */
  fallbackBundle?: Bundle;
  params?: Record<string, string | number>;
}

export interface ResolveResult {
  value: string;
  outcome: ResolveOutcome;
}

export function resolve(args: ResolveArgs): ResolveResult {
  const { scope, key, language, bundle, fallbackBundle, params } = args;
  const requested = bundle[scope]?.[key];
  if (requested != null) {
    return { value: interpolate(requested, params), outcome: 'requested' };
  }
  if (language !== FALLBACK_LANGUAGE) {
    const englishValue = fallbackBundle?.[scope]?.[key];
    if (englishValue != null) {
      return { value: interpolate(englishValue, params), outcome: 'en' };
    }
  }
  return { value: `${scope}.${key}`, outcome: 'placeholder' };
}
