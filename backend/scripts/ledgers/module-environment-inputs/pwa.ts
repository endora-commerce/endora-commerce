/**
 * Why pwa's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  PWA_VAPID_SUBJECT: {
    classification: 'configuration' as const,
    reason:
      'A contact address handed to push providers, read at `backend/index.ts:138` when the ' +
      'module registers its own service — after the settings store is readable, so nothing ' +
      'about ordering puts it here. It is per-shop operator content of exactly the kind the ' +
      'Settings module holds, and it sits beside the VAPID key pair, which this module ' +
      'already keeps out of the environment. The repair is to put the subject where the keys ' +
      'are.',
  },
};
