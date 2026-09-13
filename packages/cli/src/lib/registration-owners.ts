/**
 * "Which module registered this container name?" — the port→owner map, as one
 * merge rule rather than two.
 *
 * `check:port-dependencies` has built this map since feature 080's T034, from
 * three sources with a precedence between them, and the divergence report
 * (`specs/107-override-report-and-ladder/contracts/divergence-report.md` §3.2)
 * needs the same answer: a decoration or a port resolution names a subject, and
 * the entry has to say who owns it. §3.2's own words are *"it is not recomputed
 * here"*, and this file is what makes that true — the two checks share the merge
 * as well as the syntactic primitives (`registeredNames`, `moduleOf`,
 * `loadPackageDeclarations`), so they cannot come to disagree about who owns a
 * name.
 *
 * The precedence is the rule and it is stated once, here:
 *
 *  1. **the host table** seeds the map — `HOST_REGISTERED_PORTS`, the names a
 *     composition root registers on an unconverted module's behalf;
 *  2. **the tree** overwrites it, last claim winning, because a module that
 *     registers a name is its owner whatever a bridging table says;
 *  3. **an installed package** claims only a name nothing above claimed. The
 *     tree wins a collision for the reason `check:module-boundary`'s table map
 *     gives: two registrations of one name is a `DuplicateRegistrationError` the
 *     container raises for itself, and until it does, a stranger must not take a
 *     core module's name away from it in the diagnosis.
 *
 * ## Three sources, and an instance has one of them
 *
 * It moved here from `backend/scripts/lib/` with the derivation it feeds
 * (`specs/110-instance-repository/` T138a), because the divergence report now has
 * a second host and the two must not come to disagree about who owns a name. The
 * precedence above is unchanged and is what the two hosts differ **in the inputs
 * to**, never in: this repository fills all three, and a client's instance fills
 * only the third — it has no module sources and no composition root of its own,
 * every module being an installed package and `composeApp` the platform's. So an
 * instance's report attributes a name the platform's composition root registers
 * on a module's behalf to *a composition root* rather than to that module, which
 * is true of the instance and is said out loud in its report's `boundary`
 * (`divergence-artefacts.ts`' `INSTANCE_BOUNDARY_NOTES`) rather than left to be
 * noticed.
 */

/** One claim on a container name. */
export interface OwnerClaim {
  readonly name: string;
  readonly moduleId: string;
}

export interface RegistrationOwnerInput {
  /** The host bridging table — name → the module a root registers it for. */
  readonly hostRegistered: Readonly<Record<string, string>>;
  /** Claims read from this repository's own module sources, in walk order. */
  readonly treeClaims: Iterable<OwnerClaim>;
  /** Claims read from installed extension packages' `./backend` artefacts. */
  readonly packageClaims: Iterable<OwnerClaim>;
}

/** The port→owner map, under the precedence above. */
export function mergeRegistrationOwners(input: RegistrationOwnerInput): Map<string, string> {
  const owners = new Map<string, string>(Object.entries(input.hostRegistered));
  for (const claim of input.treeClaims) owners.set(claim.name, claim.moduleId);
  for (const claim of input.packageClaims) {
    if (!owners.has(claim.name)) owners.set(claim.name, claim.moduleId);
  }
  return owners;
}

/**
 * The names **no module owns** — what a composition root supplies.
 *
 * They matter to the divergence report for one reason: an overlay module's
 * decoration of `commandBus`, `auditLogService`, `eventBus` or `emFactory` is
 * legal and total (D-156.4), and a report that could not tell "a root registers
 * it" from "nobody registers it" would file every one of them as
 * `unowned-subject` — a finding about the run dressed as one about the tree.
 *
 * Derived, never listed (D-100, D-156.5): a name the container holds that no
 * module claimed is exactly a name a composition root supplied, which is the
 * same derivation `ForeignRegistrationError` rests on. The caller supplies the
 * sources so a fixture enters at the top of this analysis.
 */
export function rootSuppliedNames(input: {
  /** Every name a composition root writes, from `rootRegisteredNames`. */
  readonly rootNames: Iterable<string>;
  /** Every name the platform's own kernel registers. */
  readonly kernelNames: Iterable<string>;
  /** The owner map — a name a module owns is not root-supplied. */
  readonly owners: ReadonlyMap<string, string>;
}): Set<string> {
  const supplied = new Set<string>();
  for (const name of input.rootNames) if (!input.owners.has(name)) supplied.add(name);
  for (const name of input.kernelNames) if (!input.owners.has(name)) supplied.add(name);
  return supplied;
}
