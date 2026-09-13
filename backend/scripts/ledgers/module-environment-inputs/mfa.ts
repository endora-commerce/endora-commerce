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
  ADMIN_BASE_URL: {
    classification: 'bootstrap' as const,
    reason:
      'An instance’s own topology: where the admin panel is, so a link mailed to an ' +
      'administrator opens their installation rather than nothing. It is the same class of ' +
      'fact as `STOREFRONT_BASE_URL` and `BACKEND_PUBLIC_URL`, which the platform declares ' +
      'for the same reason — a scaffold resolves all three against the members it has just ' +
      'written, before there is a settings store to put anything in, and `addressOf` is what ' +
      'lets `endora new instance` do it. It is owned by `mfa` rather than by the platform ' +
      'because `mfa` is what reads it (§R2.1: the platform declares what the platform ' +
      'reads); if a second module ever needs the admin’s address, the platform is where ' +
      'this entry should move, not that module.',
  },
};
