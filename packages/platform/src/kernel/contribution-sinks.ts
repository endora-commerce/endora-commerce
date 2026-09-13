/**
 * **A contribution to a registry that was never registered is dropped**
 * (owner ruling, 2026-09-12; feature 117, A4).
 *
 * ## The question this answers, and the one it does not
 *
 * The deactivation-consequence ledger (D-44) has four answers and every one of
 * them is about an owner an **operator switched off** — a module that is
 * composed, registered, and absent by choice. There is no answer for an owner
 * an **instance never installed**, which is not a runtime choice but a fact
 * about the module set the tree was scaffolded with.
 *
 * In this repository every module is always composed, so the difference could
 * not arise. `endora new instance` executed it for the first time: it writes
 * the modules declaring `activation.nonDeactivatable` closed over
 * `dependencies` and over **nothing else**, so a `contributes-to` edge — whose
 * whole purpose is to withhold the `dependencies` claim, since declaring it
 * would make an optional assistant undeactivatable for as long as a
 * non-deactivatable module is present — is precisely a promise that the owner
 * may be missing. A scaffolded instance migrated 118 migrations and then died:
 *
 *     ModuleCompositionError: [kernel] module 'catalog' failed in its boot
 *     hook: Could not resolve 'promptActionToolRegistry'
 *
 * ## Why a mechanism rather than a fifth classification
 *
 * A fifth kind would add a concept every module author must learn in order to
 * describe a failure they could not have known about — the module set their
 * consumer scaffolds with. The mechanism removes the failure instead, so a
 * module contributes to another module's registry without knowing whether that
 * registry exists in this composition.
 *
 * ## Why it is not either of the two repairs that are refused in writing
 *
 *  - **Probing `effectiveState.isPresent` in the hook** is refused by
 *    `specs/conventions/module-activation.md`: the host filters by contributor
 *    at enumeration, so a probe would make runtime activation require a
 *    restart, and a hook mixing work with a contribution must be split before
 *    either answer applies. This mechanism asks nothing about presence.
 *  - **Declaring the owner in `dependencies`** makes a module mandatory by
 *    accident of one hook rather than by a manifest that says so — Principle
 *    XVII's axis decided in the wrong place.
 *
 * ## What keeps it narrow
 *
 * The drop is **not** "an unregistered name resolves to something". That would
 * turn every typo and every genuinely missing dependency into a silent
 * `undefined`, which is the opposite of what the container is for. It fires on
 * a conjunction of three facts, all of them derived:
 *
 *  1. the reading module's **own manifest** declares this exact name as
 *     `contributes-to` — so a module gets the drop only for an edge it
 *     declared, and never for a name it merely happens to read;
 *  2. **nothing in this composition registers the name** — the owner is not
 *     here, so there is no table for the descriptor to land in and nobody to
 *     walk it;
 *  3. a manifest set has been supplied at all. A process that never established
 *     one gets today's behaviour — the resolution throws — because answering
 *     from an empty declaration set would be the silent fall-open this file
 *     exists to avoid.
 *
 * A `contributes-to` edge naming a name **nobody** registers is still a build
 * failure: `check:port-dependencies` reports it as `unowned-name`. So the
 * loudness lives where a wiring bug belongs — in CI, against the whole module
 * set — and what is dropped at runtime is only ever an edge whose owner this
 * particular instance chose not to install.
 *
 * ## The bound, stated rather than discovered
 *
 * This covers `contributes-to` and **not** `degrades-without`, and the reason
 * is the direction of the data rather than the spelling of the kind. A
 * contribution is a **push**: nothing observes the result, so dropping it is
 * exactly the declared outcome. A `degrades-without` read is a **pull**: the
 * consumer wants a value back and its declaration promises a *degrade*, which
 * is a different branch rather than a silent no-op. Handing it an inert sink
 * would answer `undefined` from every method, and `paymentAdapterRegistry.get`
 * returning `undefined` is indistinguishable from "no adapter for this code" —
 * the fail-open D-179 measured writing a row into a switched-off module's own
 * table (issue #188). A push can be dropped; a pull cannot.
 */

/** One declared contribution: the module that pushes, and the name it pushes into. */
export interface DeclaredContribution {
  /** The module whose manifest declares the edge. */
  readonly moduleId: string;
  /** The container registration name it contributes to. */
  readonly name: string;
}

/**
 * The declaration set, supplied by whoever owns the manifests.
 *
 * `null` means no manifest set has been established in this process, which is a
 * real state — a bare fixture composition, a CLI that composes nothing — and is
 * deliberately **not** the same as an empty one. It fails closed: with no
 * declarations, nothing is dropped and every unregistered name throws exactly
 * as it did before this file existed.
 *
 * A supplier rather than a snapshot, for the reason `provideDefaultGatingManifests`
 * is one: the manifest set is established during composition and read after it.
 */
let declarations: (() => readonly DeclaredContribution[]) | null = null;

/** Memoised per supplier, so a resolution is a set lookup rather than a walk. */
let index: ReadonlySet<string> | null = null;

const keyOf = (moduleId: string, name: string): string => `${moduleId}:${name}`;

/**
 * Install the deployment's declared contributions. Idempotent;
 * last-writer-wins, like the gating graph it is installed beside.
 */
export function provideDeclaredContributions(
  supplier: () => readonly DeclaredContribution[],
): void {
  declarations = supplier;
  index = null;
}

/**
 * Forget the declaration set — for a test that needs the un-supplied state
 * back, which is the state a bare composition is really in.
 */
export function resetDeclaredContributionsForTesting(): void {
  declarations = null;
  index = null;
}

/**
 * Does `moduleId`'s own manifest declare `name` as a `contributes-to` edge?
 *
 * `false` when no manifest set has been supplied, which is the fail-closed
 * answer: see {@link declarations}.
 */
export function isDeclaredContribution(moduleId: string, name: string): boolean {
  if (declarations === null) return false;
  if (index === null) {
    index = new Set(declarations().map((edge) => keyOf(edge.moduleId, edge.name)));
  }
  return index.has(keyOf(moduleId, name));
}

/**
 * The registry that is not there: every method is a no-op returning
 * `undefined`.
 *
 * A `Proxy` rather than an object with the methods on it, because the platform
 * cannot know the interface — the registry class belongs to a module, and the
 * platform may not import one (D-52/D-53). What it does know is the shape of
 * the *contract*: a `contributes-to` edge is push-only, and all three of the
 * declarations standing when this landed say so in as many words ("a push, not
 * a pull: nothing is read back").
 *
 * A symbol property answers `undefined` rather than a function, so the runtime
 * probing the object — `Symbol.toPrimitive`, `then` on an accidental `await` —
 * sees an ordinary object rather than a thenable that never settles.
 */
const NO_OP = (): undefined => undefined;

export const DROPPED_CONTRIBUTION_SINK: unknown = new Proxy(Object.create(null) as object, {
  get(_target, property): unknown {
    if (typeof property === 'symbol') return undefined;
    return NO_OP;
  },
  has(): boolean {
    return true;
  },
});
