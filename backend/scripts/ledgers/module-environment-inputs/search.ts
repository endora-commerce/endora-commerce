/**
 * Why search's environment inputs are not Settings
 * (`specs/117-instance-bring-up/contracts/environment-inputs.md` §4).
 *
 * Two-way: a declaration with no entry here fails the build, and an entry
 * naming a variable this module no longer declares fails it too. Delete the
 * file when its last entry goes.
 */
export const entries = {
  MEILISEARCH_URL: {
    classification: 'bootstrap' as const,
    reason:
      'The address of a piece of this deployment’s infrastructure, in the class the platform ' +
      'puts `DATABASE_URL` and `REDIS_URL` in: where a service is, is how a machine is ' +
      'built, not how a shop is configured. Moving it into the settings store would also ' +
      'make the search index’s address depend on the database being up, which is the ' +
      'dependency inversion `health_checks`’ own entry describes one surface over.',
  },
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
