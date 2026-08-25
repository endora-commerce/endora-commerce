import type { NonBindingPortEdge } from './gating-graph.js';

/**
 * The deactivation-consequence ledger — feature 074, FR-017 … FR-023.
 *
 * **This is not machinery bought for CI.** It is the data the confirmation
 * dialog renders. Principle XVII's flip-time refusal is becoming an informed
 * confirmation, which means the platform may come to rest with a present module
 * depending on an absent one — so every seam between them needs an answer to
 * *"what happens?"*, and the operator being asked to accept the flip needs the
 * same answer, by name, before the write. Two independent computations of "what
 * will stop working" would drift, and the CI one would be the copy nobody
 * reads. So there is one:
 *
 *  - {@link buildDeactivationLedger} assigns an outcome to every cross-module
 *    edge whose owner an operator may switch off, and reports the edges it can
 *    assign none to. `check-port-dependencies.ts` fails the build on that
 *    second list.
 *  - {@link deactivationConsequencesFor} projects the *same entries* into the
 *    rows an operator is shown. It is the **only** way those rows may be
 *    computed: the presence projection the dialog reads and the 409
 *    `MODULE_DEACTIVATION_UNCONFIRMED` envelope the write is refused with each
 *    call it, so FR-022's equality — the id set in the dialog equals the id set
 *    in `details.consequences` — holds by being one expression evaluated twice
 *    rather than two lists somebody keeps in step. A second computation of
 *    "what will stop working" anywhere in the tree is the defect, however
 *    correct it looks on the day it is written.
 *
 * The module is **pure**: it takes the edges as data and reads no tree, no
 * container and no manifest index. That is what lets the build-time caller
 * supply them from a TypeScript scan and a runtime caller supply them from the
 * composed deployment without the classification differing between the two.
 *
 * **What exists today, honestly.** The build-time caller is
 * `backend/scripts/check-port-dependencies.ts`, which measures the reads with
 * the TypeScript compiler API. The two runtime callers are 074's later phases
 * and do not exist yet; what this file settles ahead of them is that there is
 * one classifier and one projection for both to call, and one place — the
 * classification below — where a change reaches the build gate and the operator
 * screen together.
 *
 * The four acceptable outcomes and the one unacceptable one are FR-017's table;
 * {@link DeactivationOutcome} and {@link UnassignedShape} carry them.
 */

/**
 * What happens to a dependent when the module it reads is switched off.
 *
 *  - `fails-closed` — the calls that touch the owner answer 503
 *    `MODULE_DISABLED`, everything else in the dependent keeps working. The
 *    default for a call-time read of a gated port, and equally for a read of a
 *    registry whose host *skips* an absent owner's entry: the caller gets
 *    nothing back, which is the same answer arriving at enumeration instead of
 *    at the port. A `refuses-without` entry reaches the same outcome **and
 *    brings a sentence with it** — same behaviour, named rather than inferred.
 *  - `degrades` — the dependent keeps working with less, as its own manifest
 *    declares. The `whenAbsent` sentence is the one the dialog renders.
 *  - `contributes` — nothing happens: a boot-time push into an ungated table
 *    the host filters, or a host that deliberately honours an absent owner's
 *    entry.
 *  - `schema-only` — nothing happens: deactivation drops no tables, so a
 *    foreign key into the owner's schema stays valid.
 */
export type DeactivationOutcome = 'fails-closed' | 'degrades' | 'contributes' | 'schema-only';

/**
 * The three shapes of "silently wrong, or a crash" — each a *fail-open* rather
 * than a fail-closed, and each a build failure.
 *
 *  - `captured-registration` — the name is read once, at construction, so it
 *    keeps answering after its owner is switched off.
 *  - `registry-without-policy` — an ungated registration whose owner has not
 *    said what happens to an entry, or to a caller, while it is absent. The
 *    host is the only party that can answer, because the answer depends on the
 *    contributor and a gate on the host's own registration cannot express that.
 *  - `gated-port-before-first-request` — a gated port resolved from a boot hook
 *    or a route-registration body, where the gate's "no" stops the next start
 *    instead of stopping one request.
 */
export type UnassignedShape =
  | 'captured-registration'
  | 'registry-without-policy'
  | 'gated-port-before-first-request';

/** One cross-module read of a registration, as the caller measured it. */
export interface CrossModuleRead {
  /** The module doing the reading. */
  readonly moduleId: string;
  /** The module that owns the registration. */
  readonly dependsOn: string;
  /** The registration name. */
  readonly name: string;
  /** Registered with `di.providePort`, so resolving it asks a presence gate. */
  readonly gated: boolean;
  /** Resolved once, when the reading module's registration is constructed. */
  readonly captured: boolean;
  /** When the read happens, relative to the first request the platform serves. */
  readonly site: 'boot' | 'wiring' | 'call';
}

export interface LedgerEntry {
  /** The dependent. */
  readonly moduleId: string;
  /** The module an operator would be switching off. */
  readonly dependsOn: string;
  /** The registration the edge runs over; `null` for an edge with no container read under it. */
  readonly name: string | null;
  readonly outcome: DeactivationOutcome;
  /**
   * The dependent's own sentence. Always set for `degrades`; set for
   * `fails-closed` when the dependent declared `refuses-without`, and `null`
   * for the fail-closed the gate produces on its own.
   */
  readonly whenAbsent: string | null;
}

export interface UnassignedEdge {
  readonly moduleId: string;
  readonly dependsOn: string;
  readonly name: string;
  readonly shape: UnassignedShape;
  readonly detail: string;
}

export interface DeactivationLedger {
  readonly entries: readonly LedgerEntry[];
  readonly unassigned: readonly UnassignedEdge[];
  /**
   * Reads left out because the name is not the owning module's registration —
   * see {@link LedgerInput.excludedNames}. Counted rather than dropped, so a
   * growing exclusion is visible in the check's own output line.
   */
  readonly excluded: number;
}

export interface LedgerInput {
  /** Every cross-module read the caller measured. */
  readonly reads: readonly CrossModuleRead[];
  /** moduleId → `manifest.dependencies`, for the edges with no read under them. */
  readonly declaredDependencies: ReadonlyMap<string, readonly string[]>;
  /** The `nonBindingDependencies` edges, flattened (D-44). */
  readonly nonBinding: readonly NonBindingPortEdge[];
  /**
   * Modules the platform refuses to switch off on either axis. Their edges need
   * no outcome: the flip cannot happen, so there is no state to describe
   * (FR-021).
   */
  readonly neverAbsentOwners: ReadonlySet<string>;
  /**
   * The `acknowledgedDependencies` edges, as `<dependent>` + `<name>` — D-101 §5.
   *
   * They are the one exception to the line above, and the exception is about
   * *states* rather than flips. `nonDeactivatable` binds the transition: an
   * operator cannot switch the owner off, and no `--force` exists. It does not
   * bind the **initial state** — a deployment may omit the module outright, and
   * since D-101 it may do so only by declaring the omission in a committed
   * per-deployment ledger. The consequence rows are what that declaration is
   * read against: the difference between "we shipped without `admin_users`" and
   * "we shipped without `admin_users`, and here are the seams that now fail
   * closed."
   *
   * Only the acknowledged edges, because they are the ones a reader checking
   * what a deployment loses would otherwise never see — an edge deliberately
   * withheld from `dependencies` shows up in no array they would think to read.
   */
  readonly acknowledged: readonly { readonly moduleId: string; readonly name: string }[];
  /**
   * `<owner>:<name>` → what the host does with an entry whose owner is absent.
   * `skip` answers as if the entry were not registered; `honour` returns it
   * anyway, deliberately and with a reason written at the class.
   */
  readonly contributionPolicies: Readonly<Record<string, 'skip' | 'honour'>>;
  /**
   * Names a **composition root** registers on the owning module's behalf. They
   * are excluded rather than classified: a root's registration does not
   * disappear when the module it stands in for is switched off, so there is no
   * host that could state a policy for it, and nothing the owning module can
   * declare. Their ledger is the bridging table itself, which drains as each
   * name becomes a real port.
   */
  readonly excludedNames: ReadonlySet<string>;
}

/** `<moduleId>:<name>`, the key every lookup in this file uses. */
function keyOf(moduleId: string, name: string): string {
  return `${moduleId}:${name}`;
}

/**
 * Assign an outcome to every cross-module edge, and report the ones that get
 * none.
 *
 * Rule order is load-bearing and reads top to bottom as "what could make this
 * edge lie to an operator?": a capture survives every other answer the edge
 * might have had, because it is about *when* the name is read rather than what
 * it answers; a gated port resolved too early takes the platform down rather
 * than the request; only then do the declarations and the gate get to speak.
 */
export function buildDeactivationLedger(input: LedgerInput): DeactivationLedger {
  const entries: LedgerEntry[] = [];
  const unassigned: UnassignedEdge[] = [];
  let excluded = 0;

  const degrades = new Map<string, string>();
  // Beside it rather than merged into it: the two declarations produce
  // different outcomes and the operator's row says different things. A
  // `refuses-without` entry with no sentence is refused by the schema and
  // reported by `check-port-dependencies.ts`; it is classified here anyway, so
  // that a declaration this file cannot render still cannot silently become
  // some *other* classification.
  const refuses = new Map<string, string | null>();
  for (const edge of input.nonBinding) {
    if (edge.kind === 'degrades-without' && edge.whenAbsent !== null) {
      degrades.set(keyOf(edge.moduleId, edge.name), edge.whenAbsent);
    }
    if (edge.kind === 'refuses-without') {
      refuses.set(keyOf(edge.moduleId, edge.name), edge.whenAbsent);
    }
  }

  /** One group per (dependent, owner, name); a name read from six files is one edge. */
  const groups = new Map<string, { read: CrossModuleRead; sites: Set<string>; captured: boolean }>();
  const acknowledged = new Set(
    input.acknowledged.map((edge) => keyOf(edge.moduleId, edge.name)),
  );
  for (const read of input.reads) {
    if (read.moduleId === read.dependsOn) continue;
    if (
      input.neverAbsentOwners.has(read.dependsOn) &&
      !acknowledged.has(keyOf(read.moduleId, read.name))
    ) {
      continue;
    }
    if (input.excludedNames.has(read.name)) {
      excluded += 1;
      continue;
    }
    const key = `${read.moduleId}:${read.dependsOn}:${read.name}`;
    const group = groups.get(key) ?? { read, sites: new Set<string>(), captured: false };
    group.sites.add(read.site);
    group.captured = group.captured || read.captured;
    groups.set(key, group);
  }

  const classified = new Set<string>();
  for (const { read, sites, captured } of groups.values()) {
    classified.add(`${read.moduleId}:${read.dependsOn}`);
    const declared = degrades.get(keyOf(read.moduleId, read.name));
    const edge = { moduleId: read.moduleId, dependsOn: read.dependsOn, name: read.name };

    if (captured) {
      unassigned.push({
        ...edge,
        shape: 'captured-registration',
        detail:
          `read once at construction, so it keeps answering after \`${read.dependsOn}\` ` +
          `is switched off`,
      });
      continue;
    }
    if (read.gated && [...sites].some((site) => site !== 'call')) {
      unassigned.push({
        ...edge,
        shape: 'gated-port-before-first-request',
        detail: `a gate with a real "no" answer is asked at ${[...sites].sort().join(', ')}`,
      });
      continue;
    }
    if (declared !== undefined) {
      entries.push({ ...edge, outcome: 'degrades', whenAbsent: declared });
      continue;
    }
    // Before the bare gate below, and the order is what the kind buys: the
    // outcome is the same either way, so the only difference this branch makes
    // is that the operator's row carries the dependent's own sentence instead
    // of the platform's translated default.
    const refusal = refuses.get(keyOf(read.moduleId, read.name));
    if (refusal !== undefined) {
      entries.push({ ...edge, outcome: 'fails-closed', whenAbsent: refusal });
      continue;
    }
    if (read.gated) {
      entries.push({ ...edge, outcome: 'fails-closed', whenAbsent: null });
      continue;
    }
    const policy = input.contributionPolicies[keyOf(read.dependsOn, read.name)];
    if (policy === undefined) {
      unassigned.push({
        ...edge,
        shape: 'registry-without-policy',
        detail: `\`${read.dependsOn}\` states nothing about what an absent owner's entry does`,
      });
      continue;
    }
    // A push happens once, from a boot hook, and reads nothing back; a host
    // that honours an absent owner's entry answers the same to everybody. Both
    // are "nothing happens". A *read* under a skip policy is not: the caller
    // gets nothing back, which is the seam failing closed at enumeration.
    const pushOnly = [...sites].every((site) => site === 'boot');
    entries.push({
      ...edge,
      outcome: policy === 'honour' || pushOnly ? 'contributes' : 'fails-closed',
      whenAbsent: null,
    });
  }

  // Whatever a manifest declares and no container read backs. Deactivation
  // drops no tables, so a foreign key into the owner's schema stays valid and
  // nothing stops — which is also where a declaration backed by nothing at all
  // lands, and that is a separate finding with its own owner.
  for (const [moduleId, dependencies] of input.declaredDependencies) {
    for (const dependsOn of dependencies) {
      if (dependsOn === moduleId) continue;
      if (input.neverAbsentOwners.has(dependsOn)) continue;
      if (classified.has(`${moduleId}:${dependsOn}`)) continue;
      entries.push({ moduleId, dependsOn, name: null, outcome: 'schema-only', whenAbsent: null });
    }
  }

  return { entries, unassigned, excluded };
}

/** One row of the confirmation dialog, and one element of `details.consequences`. */
export interface ConsequenceRow {
  /** The dependent that has the consequence. */
  readonly moduleId: string;
  readonly effect: 'unavailable' | 'degraded';
  /**
   * The dependent's own `whenAbsent` sentence, or `null` when it declared none
   * — in which case the caller renders the platform's translated default.
   */
  readonly description: string | null;
}

/**
 * The rows an operator is shown before switching `moduleId` off, and the rows
 * the refusal carries when they have not acknowledged them.
 *
 * One row per dependent, whatever the number of edges between the two: an
 * operator is choosing about modules, not about registrations. Where a
 * dependent both pulls and contributes, **the pull decides** — a contribution
 * costs nothing and saying so beside a capability that stops would be a
 * consequence list that reads as reassurance.
 *
 * **The sentence follows the effect that wins**, and it has to, now that
 * `fails-closed` can carry one. A dependent that degrades on one edge and
 * refuses on another gets `unavailable`, and pairing that word with the
 * degrade's *"keeps working with less"* sentence would be a row that
 * contradicts itself in six words. A declared sentence is still kept when the
 * winning effect has none of its own, because it is then the only specific
 * thing the platform knows about that dependent.
 */
export function deactivationConsequencesFor(
  entries: readonly LedgerEntry[],
  moduleId: string,
  isPresent: (dependentId: string) => boolean,
): ConsequenceRow[] {
  const rows = new Map<string, ConsequenceRow>();
  for (const entry of entries) {
    if (entry.dependsOn !== moduleId) continue;
    if (entry.outcome !== 'fails-closed' && entry.outcome !== 'degrades') continue;
    if (!isPresent(entry.moduleId)) continue;
    const existing = rows.get(entry.moduleId);
    const effect = entry.outcome === 'degrades' ? 'degraded' : 'unavailable';
    const winning =
      existing?.effect === 'unavailable' || effect === 'unavailable' ? 'unavailable' : 'degraded';
    rows.set(entry.moduleId, {
      moduleId: entry.moduleId,
      effect: winning,
      description:
        effect === winning
          ? (entry.whenAbsent ?? existing?.description ?? null)
          : (existing?.description ?? entry.whenAbsent ?? null),
    });
  }
  return [...rows.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}
