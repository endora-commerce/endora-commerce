/**
 * Why catalog's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  CATALOG_SEARCH_BACKEND: {
    classification: 'configuration' as const,
    reason:
      'A per-deployment choice of engine, read once per public product query at ' +
      '`routes.public.ts:241` — well after the settings store is readable, so nothing about ' +
      'boot order puts it here. It also sits one line above `effectiveState.isPresent(' +
      "'search')`, which is the *other* axis of the same decision already asked the " +
      'platform’s own way: whether the search module is on. The repair is a Setting beside ' +
      'that presence check, at which point an operator changes engine without a restart.',
  },
  CATALOG_MAX_RESOLVE_IDS: {
    classification: 'configuration' as const,
    reason:
      'A numeric bound on one admin operation, read per call at ' +
      '`catalog-admin.service.ts:1308`. It is the plainest `configuration` in this ledger: ' +
      'a shop tunes it to its own catalogue size, which is what the Settings module is for, ' +
      'and an environment variable makes tuning it a redeploy. The repair is a Setting in ' +
      'this module’s own group.',
  },
};
