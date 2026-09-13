/**
 * Why search's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  MEILISEARCH_API_KEY: {
    classification: 'bootstrap' as const,
    reason:
      'The credential for the address above, and it travels with it — a connection is one ' +
      'fact, and splitting the host into the environment and the key into the store would ' +
      'leave an operator changing servers in two places. It is `generable: false` ' +
      'deliberately: the key belongs to the Meilisearch server, so a tool that invented one ' +
      'would be inventing a value that cannot be right.',
  },
};
