/**
 * `./support` — what a module contributes to a test composition (feature 109,
 * contract §4).
 *
 * A module package that needs test support declares it at
 * `src/test-support/index.ts` and publishes it as `./test-support`; the caller
 * collects the declarations of **the modules it composed** and hands them to
 * `composeTestServer` as `PlatformComposition.testSupport`. The kit never
 * discovers them: discovery walks `node_modules`, which is a fact about the
 * caller's process (R2.2).
 *
 * ## What is here in Phase 1b, and what is not
 *
 * The **declaration shape** and the **registration** member, because
 * `PlatformComposition` takes contributions and a type it could not name would
 * make that member `unknown`. The three collectors — the truncate ordering
 * derived from the foreign-key graph (R4.2), the per-module seed decomposition
 * (R4.6) and the fixture re-export — are Phase 3, and the members they read are
 * declared here now so that a module author writing a `./test-support` layer
 * writes one declaration rather than two.
 *
 * `volatileTables` and `seed` are therefore **declared and not yet collected**,
 * which is stated rather than left to be discovered: `composeTestServer`
 * applies `registrations` and reads neither, and a module that declares tables
 * today gets no truncate from them. The alternative — leaving them out of the
 * type until the collector exists — would make every module that ships a
 * contribution in Phase 3 edit a declaration it had already written.
 */

/**
 * One module's test support.
 *
 * Four optional members and nothing else (R4.1). Every one of them is that
 * module's own policy: the taxonomy fetcher that refuses and the PIM client
 * that throws exist to make a test which reaches the network fail loudly, and
 * that is `product_feeds`' and `pim_ergonode`' decision rather than a harness's.
 */
export interface TestSupportContribution {
  /**
   * The module this contribution belongs to. It is the module's own manifest
   * id, and the kit uses it for one thing: naming the module in a refusal.
   */
  readonly moduleId: string;
  /**
   * Container registrations this module's tests substitute by default, keyed by
   * the **registration name its owner registers** — the same key
   * `composedModules.contribute` takes.
   *
   * A module may not contribute over a name it does not own (R4.4), for the
   * reason D-176 and issue #203 give about decoration: a substitution rewrites
   * what every consumer of that name resolves. A test that needs to substitute
   * *another* module's collaborator does it at the call site, in its own file,
   * through `composeTestServer`'s own `contribute` option — where the coupling
   * is visible in the test that wanted it.
   */
  readonly registrations?: Readonly<Record<string, unknown>>;
  /**
   * The tables this module owns whose rows must not survive between tests.
   *
   * A **set, not a sequence** (R4.2): the order they are emptied in is derived
   * from the foreign-key graph, and a set the derivation cannot order is a
   * failure naming the cycle. A hand-written order is a fact about the schema
   * that the schema can state for itself.
   */
  readonly volatileTables?: readonly string[];
  /**
   * Rows this module contributes to a named seed.
   *
   * Additive and order-independent (R4.6): a seed whose result depends on the
   * order two modules contributed in is a defect, not a configuration.
   */
  readonly seed?: Readonly<Record<string, (em: unknown) => Promise<void>>>;
  /** Anything else this module's tests build, re-exported for its own use. */
  readonly fixtures?: Readonly<Record<string, unknown>>;
}

/**
 * Every registration the given contributions substitute, merged.
 *
 * Refuses two modules claiming one name rather than letting the last one win:
 * a substitution the reader cannot attribute is the shape D-176 refuses for
 * decoration, and "whichever was collected last" is not an answer anybody can
 * act on.
 */
export function mergeTestSupportRegistrations(
  contributions: readonly TestSupportContribution[],
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  const claimedBy = new Map<string, string>();
  for (const contribution of contributions) {
    for (const [name, value] of Object.entries(contribution.registrations ?? {})) {
      const owner = claimedBy.get(name);
      if (owner !== undefined) {
        throw new ConflictingTestSupportError(name, owner, contribution.moduleId);
      }
      claimedBy.set(name, contribution.moduleId);
      merged[name] = value;
    }
  }
  return merged;
}

/** Two modules substituting one registration name. */
export class ConflictingTestSupportError extends Error {
  constructor(
    readonly registrationName: string,
    readonly firstModuleId: string,
    readonly secondModuleId: string,
  ) {
    super(
      `test support for '${registrationName}' is contributed by both '${firstModuleId}' and ` +
        `'${secondModuleId}'. A registration has one owner, and a substitution rewrites what ` +
        `every consumer of that name resolves — so only the module that registers it may ` +
        `substitute it by default. A test that needs the other module's substitution asks for ` +
        `it at its own call site.`,
    );
    this.name = 'ConflictingTestSupportError';
  }
}
