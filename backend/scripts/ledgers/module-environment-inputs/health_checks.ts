/**
 * Why health_checks's environment inputs are not Settings
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
      'A liveness probe answers when the rest of the platform cannot, which is the whole ' +
      'reason it exists: `GET /api/v1/_health` is ungated (D-36b) so that an orchestrator ' +
      'gets an answer rather than a 503 from a module that is off. Reading this address ' +
      'through the settings store would make the probe depend on the store being up — and a ' +
      'store that is down is exactly the condition the probe is asked about. It is ' +
      'deliberately declared here as well as by `search`: a client may install ' +
      '`health_checks` and not `search`, and this module declares no dependency on it.',
  },
  npm_package_version: {
    classification: 'bootstrap' as const,
    reason:
      'Not an operator input at all — the package manager sets it when it starts the ' +
      'server, and there is nothing for anybody to choose. It is declared for the same ' +
      'reason the storefront declares `NEXT_RUNTIME`: a variable this platform reads and ' +
      'nobody declared is a variable `check:env-inputs` reports as undeclared, and the ' +
      'honest answer is a declaration whose sentence says the operator has no choice to ' +
      'make. A Setting would be a copy of a fact the runtime already has.',
  },
};
