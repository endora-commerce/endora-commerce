/**
 * Why assets_library's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  ASSETS_LIBRARY_HMAC_KEY: {
    classification: 'configuration' as const,
    reason:
      'A secret with no bootstrap-ordering claim on it. `HmacSigner.fromEnv()` is called ' +
      'lazily inside two route handlers — `plugin.ts:87` and `:143` — so the settings store ' +
      'is open and readable by the time the key is wanted, which is the test §4.2 sets. It ' +
      'is here because the module was written before the store carried secrets, not because ' +
      'it has to be. The repair is a `secret`-typed Setting this module owns, plus a ' +
      'migration that reads the existing environment value once so that a running shop does ' +
      'not invalidate every download link it has already handed out.',
  },
};
