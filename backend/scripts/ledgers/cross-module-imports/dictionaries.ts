/**
 * Cross-module imports still standing in `dictionaries` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/dictionaries/backend.ts:currencies/backend':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/backend.ts:currencies/services/currency-service':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/backend.ts:languages/backend':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/backend.ts:languages/services/language-service':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/routes.admin.ts:currencies/entities/currency.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/routes.admin.ts:currencies/services/currency-service':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/routes.admin.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/routes.admin.ts:languages/services/language-service':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/dictionary-read-service.ts:currencies/entities/currency.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/dictionary-read-service.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/dictionary-validator.ts:currencies/entities/currency.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/dictionary-validator.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/label-resolver.ts:currencies/entities/currency.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/label-resolver.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/language-country-service.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/translation-service.ts:currencies/entities/currency.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
  'modules/dictionaries/services/translation-service.ts:languages/entities/language.entity':
    'F3 Phase C — dictionaries. Retired by the dictionaries cut merge request.',
};
