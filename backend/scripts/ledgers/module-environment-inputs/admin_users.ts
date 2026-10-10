/**
 * Why admin_users' environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  ADMIN_AUTH_ACCOUNT_WIDE_LIMIT: {
    classification: 'bootstrap' as const,
    reason:
      'It can never move: it switches off part of the limit on wrong administrator ' +
      'passwords, and a Setting would be a switch in the Admin UI that the limit protects — ' +
      'whoever got in could turn it off for the next attempt. It is decided by whoever ' +
      'deploys the instance, before anybody can sign in to it, and is meant for demo ' +
      'instances that publish an administrator password. Nothing to drain.',
  },
};
