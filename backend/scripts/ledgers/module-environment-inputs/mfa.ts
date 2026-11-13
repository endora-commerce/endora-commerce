/**
 * Why mfa's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  MFA_SECRET_ENCRYPTION_KEY: {
    classification: 'bootstrap' as const,
    reason:
      '§4.2’s standing example, and it can never move: it is the key a stored second-factor ' +
      'secret is encrypted with, so a Setting holding it would be a secret encrypted with ' +
      'itself. The store cannot be the home of the key that opens the store. Nothing to ' +
      'drain — this entry is here to say so, not to schedule anything.',
  },
};
