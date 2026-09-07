/**
 * What a permission code needs beside itself — D-175, feature 080 T057.
 *
 * A role holding `rfqs:handle` and nothing else opens the RFQ create screen and
 * silently loses its price prefill, because that screen fetches a `price_lists`
 * route and `price_lists` gates it with a code of its own. That sentence was
 * written down three times — in D-173, in the route's own comment and in the
 * dev seed that grants `sales_representative` both codes — and in nothing an
 * operator could read. `ModulePermissionDeclaration.requires` is where it goes;
 * this file is the rule that keeps it true.
 *
 * ## Why the edge is declared rather than derived
 *
 * This repository's standing hazard is a derived fact written down (D-100), so
 * the question was asked before the field existed: can the platform work this
 * out on its own? It cannot, and the reason is not that the parsing is hard.
 *
 * The **coupling** runs from an admin screen's own fetches to another module's
 * route. Measured on this tree: of 705 `apiClient` call sites in module-owned
 * admin layers, 82 name their path as a plain literal and 293 interpolate one,
 * and 299 of the 689 admin route registrations bind their `preHandler` to a
 * variable rather than writing `requireAdmin(...)` in place. So a derivation
 * would be a heuristic over a minority of the sites.
 *
 * The **judgement** is the part no instrument can reach at all. Even a perfect
 * screen -> route -> code trace answers *"this screen calls a route gated C"*.
 * It cannot answer *"and a role without C is therefore broken"*: `RfqCreatePage`
 * degrades to manual entry, which D-173 ruled acceptable, while another screen
 * would 403 into an empty page. A field that recorded the trace would be the
 * derived fact D-100 refuses; a field that records the judgement is a second
 * fact, and the two never come to disagree because only one of them exists.
 *
 * **A module enforcing a code another module owns is a different question and
 * is already derived** — `test/helpers/foreign-gates.ts`, D-173's sweep, which
 * reads the gates and the manifests and needs nothing declared. D-175 proposed
 * that `requires` should give that sweep "something to reconcile against"; the
 * corrected D-173 (!956) had by then repaired all five of its findings and left
 * a population of fourteen, every one of them a pass, so there is nothing to
 * reconcile and, more to the point, `declared-owner` is *ledgerable debt and
 * never a pass* there. Wiring this field into that verdict would license the
 * defect that ruling closed. The two stay apart.
 *
 * ## What is checkable, and is
 *
 * The half a machine owns is the **vocabulary**: a requirement names a code the
 * platform knows. A typo, or a code renamed by its owner, would otherwise sit in
 * a manifest advising an operator to grant something that does not exist, and
 * nothing anywhere would say so — the failure mode of every declaration this
 * repository has ever added. It is checked against
 * `PermissionCatalogueService.listKnownCodes()`, the vocabulary and deliberately
 * not the grantable set: a requirement on a switched-off module's code is
 * exactly when the advisory is worth reading.
 */

import type { ReadSizeInput } from '../../scripts/lib/read-size.js';

/** How a declared requirement fails. */
export type PermissionDependencyKind =
  /** The required code is in no manifest and no catalogue row. */
  | 'unknown-requirement'
  /** A code requiring itself — always satisfied, so it advises nothing. */
  | 'self-requirement';

/*
 * **There is no `duplicate-requirement`, and the omission was measured.** It was
 * written, and its proof — a declaration naming one code twice, entering through
 * a real `PermissionCatalogueService` — came back with no finding: the merge
 * unions into a `Set`, so a duplicate cannot reach this analysis through the
 * path a real run takes. A signal whose only red proof has to bypass the merge
 * is a signal that can never fire on the tree, and this estate's rule is one
 * proof per shape the check claims to refuse (issue #130). It was removed rather
 * than proven from below.
 */

export interface PermissionDependencyFinding {
  readonly kind: PermissionDependencyKind;
  /** The code carrying the declaration. */
  readonly code: string;
  /** The code it names, for every kind. */
  readonly requirement: string;
  /** The modules whose presence keeps {@link code} grantable. */
  readonly owners: readonly string[];
}

export interface PermissionDependencyInput {
  /**
   * `code -> the codes it declares a need for`, from
   * `PermissionCatalogueService.listRequirementsByCode()`.
   *
   * Handed in rather than re-derived from the manifests: the merge that unions a
   * shared code's declarers is the merge `/admin-roles` renders, and a second
   * one here would be two answers to one question with the short one reporting
   * a clean tree — `permission-labels.ts` says the same about the owner map, for
   * the same reason.
   */
  readonly requirements: ReadonlyMap<string, readonly string[]>;
  /** The vocabulary — `listKnownCodes()`, present or not. */
  readonly known: ReadonlySet<string>;
  /** `code -> owners`, for naming who has to fix a finding. */
  readonly owners: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Every declared requirement this build cannot stand behind. */
export function findPermissionDependencyDefects(
  input: PermissionDependencyInput,
): readonly PermissionDependencyFinding[] {
  const findings: PermissionDependencyFinding[] = [];
  for (const [code, requirements] of [...input.requirements].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const owners = [...(input.owners.get(code) ?? [])].sort();
    for (const requirement of requirements) {
      const kind: PermissionDependencyKind | null =
        requirement === code
          ? 'self-requirement'
          : input.known.has(requirement)
            ? null
            : 'unknown-requirement';
      if (kind !== null) findings.push({ kind, code, requirement, owners });
    }
  }
  return findings;
}

/*
 * The operator-facing half is **not here**: it is
 * `missingPermissionRequirements` in `@endora-commerce/contracts`, over the
 * catalogue rows `GET /admin/permissions` returns, and the role editor and this
 * sweep read the same function. D-175's second caution is that the benchmark's
 * per-module tests hand-assemble their own cross-module catalogue; a second copy
 * of "what is this role missing" living in a test helper would be that, one
 * surface over.
 */

/** What the sweep read, in the numbers a reader can reconcile. */
export interface PermissionDependencyWalk {
  /** Manifests the generated index registers that declare a permission. */
  readonly declaringManifests: number;
  /** Of those, the ones the catalogue merge attributed at least one code to. */
  readonly mergedManifests: number;
  /** Declared requirement entries, across every code. */
  readonly requirements: number;
}

/**
 * What the sweep read (issue #244).
 *
 * `files` is the manifest files the declarations came off — this sweep opens
 * nothing itself, and saying otherwise would be the grammar's whole point
 * defeated. The independent author is the **generated manifest index**: it says
 * how many registered modules declare a permission at all, and the catalogue
 * merge says how many of them it actually attributed a code to. A module tree
 * that moved, or a merge that stopped reading `permissions`, makes the two
 * disagree instead of leaving a requirement sweep that quietly has nothing to
 * sweep (issue #215).
 */
export function permissionDependencyReadSize(walk: PermissionDependencyWalk): ReadSizeInput {
  return {
    prefix: '[permission-dependencies]',
    files: walk.declaringManifests,
    sites: walk.requirements,
    coverage: [
      {
        source: 'manifest-index',
        expected: walk.declaringManifests,
        covered: walk.mergedManifests,
      },
    ],
  };
}

/**
 * Why this run read nothing worth reporting, or `null` when it read enough.
 *
 * The `exit 2` of a check in the shape a test can assert (issue #113). The last
 * clause is the one that matters and the one a careless implementation omits: a
 * sweep whose subject is *declarations* reports a cheerful zero when there are
 * no declarations, and that state is indistinguishable from a merge that stopped
 * reading `requires` at all.
 */
export function permissionDependencyRefusal(input: PermissionDependencyInput): string | null {
  if (input.known.size === 0) return 'the catalogue knows no permission code';
  if (input.owners.size === 0) return 'no permission code has an owner';
  if (input.requirements.size === 0) return 'no permission code declares a requirement';
  return null;
}
