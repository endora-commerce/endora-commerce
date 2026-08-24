import type { ModuleManifest } from '@endora-commerce/contracts';
import { lockedOwners } from '../../scripts/lib/switchable-modules.js';
import type { EnforcedGateSite } from '../../src/modules/admin_roles/permission-inventory.js';

/**
 * D-173 — the `foreign-gate` sweep: a module enforcing a permission code
 * another module owns.
 *
 * Five of them shipped, and **the coupling was held by nothing**. None of the
 * five declared the owner in `dependencies` or `nonBindingDependencies`, and no
 * existing signal could see it: `check:port-dependencies` reads container
 * edges, and a permission code is neither a port nor an import specifier; the
 * permission inventory sweeps *enforced ⇒ grantable* and *grantable ⇒
 * enforced*, and both codes in every one of the five were real, so both
 * directions were clean; `check:action-route-permissions` compares an action's
 * declared code to **its own** `targetRoute`, never to who owns the code; and
 * the lifecycle sees only what a manifest declares.
 *
 * What the pairing costs is concrete and one-directional.
 * `PermissionCatalogueService` presence-filters the grantable set by a code's
 * **owners**, so switching the owner off takes the code off `/admin-roles`
 * while the consumer's routes — if the consumer cannot be switched off with it
 * — go on enforcing it. The screen sits there behind a permission nobody can
 * be granted. That sentence is not new: `organizations/manifest.ts` wrote it
 * down under D-166, about `rfqs:handle`, and `price_lists` was enforcing the
 * same code on the same terms a directory away.
 *
 * **Every verdict is derived from the manifests, never listed** — the
 * `check:lock-claims` discipline on a different edge. The locked set comes off
 * `activation.nonDeactivatable` through the same `lockedOwners` helper the two
 * checks that ask that question already share, and ownership comes off
 * `PermissionCatalogueService.listOwnersByCode()`, which is the merge
 * `/admin-roles` itself renders. So withdrawing a lock re-opens every finding
 * that was resting on it, in the same run, with no ledger to edit — and a
 * hand-written module list, which is what would go stale, is nowhere in the
 * derivation.
 *
 * **Where it lands, and why it is not a `check-*` script.** D-173 asks for a
 * check and says it needs no new population, because the permission inventory
 * already reads every `requireAdmin*` literal and every manifest code. That is
 * this file's input exactly, and the inventory is one of the *tests that act as
 * gates* — `check-inventory.test.ts` names that family and holds it out of its
 * own scope, *"because a test is already something the suite runs and reports;
 * what they need is the same red-first fixture, which each keeps next to
 * itself"*. The fixtures are in `test/unit/admin_roles/foreign-gates.test.ts`,
 * one per verdict, each entering here at the top: sites and manifests in,
 * findings out.
 */

/** How a foreign gate is answered. `ledgerable` is debt, never a pass. */
export type ForeignGateVerdict = 'pass' | 'violation' | 'ledgerable';

/** Why it was answered that way. Derived per run, never written down. */
export type ForeignGateKind =
  /** Some owner declares `nonDeactivatable`, so the code cannot leave. */
  | 'owner-locked'
  /** Every owner is switchable and the consumer cannot be switched off with them. */
  | 'locked-consumer'
  /** Both sides switchable, and no manifest declares the edge. */
  | 'undeclared-owner'
  /** Both sides switchable, and the consumer declares the owner. */
  | 'declared-owner';

export interface ForeignGateFinding {
  /** Ledger key: the file and the code, so a moved line does not churn it. */
  readonly key: string;
  /** The module whose routes enforce the code — `null` for a host-owned file. */
  readonly consumer: string | null;
  readonly code: string;
  /** The modules whose presence keeps the code grantable. */
  readonly owners: readonly string[];
  readonly file: string;
  /** How many gate sites in this file enforce this code. */
  readonly sites: number;
  readonly verdict: ForeignGateVerdict;
  readonly kind: ForeignGateKind;
}

export interface ForeignGateInput {
  /** Every enforcement site the permission inventory resolved. */
  readonly sites: readonly EnforcedGateSite[];
  /** The deployment-resolved manifest set, for the lock and the declarations. */
  readonly manifests: ReadonlyArray<{ manifest: ModuleManifest }>;
  /** Code → the modules whose presence keeps it grantable. */
  readonly owners: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The debt this sweep is allowed to carry, keyed `<file>|<code>`.
 *
 * **Two-way**: an unledgered violation fails, and an entry describing no
 * finding fails too. It is **empty**, and that is the outcome rather than the
 * starting point — D-173 expected it to open at five, with the check landing
 * before the repairs. All five land in the same merge request, so there is
 * nothing for an entry to schedule; the shapes it would have held live as red
 * proofs in the companion test, where they are exercised on every run rather
 * than only while the debt stands.
 *
 * Only a `ledgerable` finding may be entered — both sides switchable and the
 * edge declared. A `violation` is a screen an operator can make unreachable,
 * and an entry over one would license exactly that.
 */
export const FOREIGN_GATES_TO_DRAIN: Readonly<Record<string, string>> = {};

/** Every module id the consumer declares an edge to, in any of the three lists. */
function declaredEdges(manifest: ModuleManifest): ReadonlySet<string> {
  const declared = new Set<string>(manifest.dependencies ?? []);
  for (const entry of manifest.nonBindingDependencies ?? []) declared.add(entry.moduleId);
  for (const entry of manifest.acknowledgedDependencies ?? []) declared.add(entry.moduleId);
  return declared;
}

/**
 * Classify every gate on a code its enforcing module does not own.
 *
 * A host-owned file (`moduleId === null` — `src/http`, `src/kernel`) is a
 * consumer that owns no code and has no activation control, so any foreign gate
 * there reads as `locked-consumer`. There are none today; leaving the case out
 * of the population would be the way the first one arrives unseen.
 */
export function classifyForeignGates(input: ForeignGateInput): readonly ForeignGateFinding[] {
  const locked = lockedOwners(input.manifests.map((entry) => entry.manifest));
  const declared = new Map<string, ReadonlySet<string>>(
    input.manifests.map((entry) => [entry.manifest.id, declaredEdges(entry.manifest)]),
  );

  const byKey = new Map<string, { finding: Omit<ForeignGateFinding, 'sites'>; sites: number }>();
  for (const site of input.sites) {
    if (site.resolution !== 'code') continue;
    for (const code of site.codes) {
      const owners = input.owners.get(code);
      // A code nobody owns is the permission inventory's own finding
      // ("enforced but not grantable"), reported there and not duplicated here.
      if (owners === undefined || owners.size === 0) continue;
      if (site.moduleId !== null && owners.has(site.moduleId)) continue;

      const key = `${site.file}|${code}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.sites += 1;
        continue;
      }
      const consumerLocked = site.moduleId === null || locked.has(site.moduleId);
      const edges = site.moduleId === null ? new Set<string>() : declared.get(site.moduleId);
      const kind: ForeignGateKind = [...owners].some((owner) => locked.has(owner))
        ? 'owner-locked'
        : consumerLocked
          ? 'locked-consumer'
          : [...owners].some((owner) => edges?.has(owner) === true)
            ? 'declared-owner'
            : 'undeclared-owner';
      byKey.set(key, {
        sites: 1,
        finding: {
          key,
          consumer: site.moduleId,
          code,
          owners: [...owners].sort(),
          file: site.file,
          verdict:
            kind === 'owner-locked' ? 'pass' : kind === 'declared-owner' ? 'ledgerable' : 'violation',
          kind,
        },
      });
    }
  }

  return [...byKey.values()]
    .map((entry) => ({ ...entry.finding, sites: entry.sites }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Why this run read nothing worth reporting, or `null` when it read enough.
 *
 * The `exit 2` of a check, in the shape a test can assert: a green that means
 * *"not looking"* is the failure this whole family of ratchets exists to
 * prevent (issue #113). Each clause names an input whose absence would make
 * every verdict above vacuously a pass — no gate to judge, no owner to judge it
 * against, no lock to distinguish the two violations, no manifest to derive
 * either from.
 */
export function foreignGateRefusal(input: ForeignGateInput): string | null {
  if (input.manifests.length === 0) return 'no manifest was resolved';
  if (input.owners.size === 0) return 'no permission code has an owner';
  const resolved = input.sites.filter((site) => site.resolution === 'code');
  if (resolved.length === 0) return 'no enforcement site resolved to a permission code';
  if (lockedOwners(input.manifests.map((entry) => entry.manifest)).size === 0) {
    return 'no manifest declares activation.nonDeactivatable, so no consumer can be locked';
  }
  return null;
}

/** Ledger entries that describe no `ledgerable` finding on this tree. */
export function staleForeignGateLedgerEntries(
  findings: readonly ForeignGateFinding[],
  ledger: Readonly<Record<string, string>> = FOREIGN_GATES_TO_DRAIN,
): string[] {
  const ledgerable = new Set(
    findings.filter((finding) => finding.verdict === 'ledgerable').map((finding) => finding.key),
  );
  return Object.keys(ledger)
    .filter((key) => !ledgerable.has(key))
    .sort();
}
