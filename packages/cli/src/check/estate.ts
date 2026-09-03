/**
 * The estate manifest — one entry per rule in this platform's static-check
 * estate, and what each rule *means* when its subject is one module package
 * (`specs/101-endora-check/data-model.md` §1).
 *
 * ## Why the manifest exists at all
 *
 * `endora check` could have fronted the three or four rules that port most
 * easily and said nothing about the rest. That is a **curated subset**, and a
 * curated subset is a list somebody updates or does not: the thirty-sixth rule
 * joins it according to whether an author remembered, and a rule that is simply
 * unmentioned is the silent skip this whole estate exists against
 * (`research.md` §9). So every rule gets a row and a verdict, including the
 * ones that can never run for a package — those carry a written reason and are
 * *printed*, never absent.
 *
 * ## This file is not a second author for *which rules exist*
 *
 * The population is `backend/test/unit/scripts/check-inventory.test.ts`'s, which
 * enumerates every `check-*` script and fails on one it does not name. That test
 * reconciles this manifest against its own inventory **in both directions**, so
 * a rule cannot arrive here without a script or leave a script without a row.
 * What this file authors is only the per-rule classification: scope, the reason
 * a repository-only rule cannot travel, the phase a pending rule waits for, the
 * declaration that gives the rule a subject, and the tier.
 *
 * **Nothing here writes the estate's size down.** The count went stale by four
 * inside five days in the artefact whose whole subject is a derived population
 * (`research.md` §1), and it moved again — by one — between that measurement and
 * this file being written. {@link ESTATE}`.length` answers it, on every run.
 *
 * ## The four verdicts, and where each comes from
 *
 * `scope` and `host` are **declared** here; `not-applicable`-from-a-declaration
 * and `unreadable` are **determined per run** and are never written down
 * (`contracts/exit-reduction.md` §1). A `repository-only` entry is reported to
 * the author as `not-applicable` carrying {@link EstateEntry.reason} — a line,
 * never an absence.
 */

/** What a rule's subject can be. */
export type EstateScope =
  /** The rule can be evaluated over one module package. */
  | 'package'
  /**
   * The rule's *subject* is this repository — not merely its root. Reported as
   * `not-applicable` with {@link EstateEntry.reason} on its own line.
   */
  | 'repository-only';

/**
 * Whether a `package`-scope rule has a package-scope host in this build.
 *
 * `pending` names the phase that lands it. It is a **fourth verdict** and it
 * amends `specs/089-endora-cli-module-scaffold/contracts/check-scope-classification.md`
 * §1's "there is no fourth verdict", which was written for the finished command:
 * under three verdicts a rule whose *host* is not built has to be filed
 * `unreadable`, whose contract is "name the input and the remedy" — and there is
 * no input the author can supply. It would blame the author's tree for the
 * tool's incompleteness, and an author would go looking.
 *
 * It cannot become permanent: while any entry is `pending`,
 * `@endora-commerce/cli` stays `private: true` and `check:release-intent`
 * reports the field coming off (`contracts/exit-reduction.md` §5.1).
 */
export type EstateHost = 'built' | { readonly pending: string };

/** One signal a rule evaluated in this repository and cannot in package scope. */
export interface PartialSignal {
  /** The signal's own name, as the rule's header spells it. */
  readonly signal: string;
  /** Why it cannot be evaluated here. Printed on the rule's own line. */
  readonly reason: string;
}

/**
 * The kind of declaration that gives a rule a subject in one package.
 *
 * This is the whole of `contracts/exit-reduction.md` §2 as data. It is what lets
 * an author with one module and none of the optional layers reach exit 0 in an
 * estate whose standing rule is that a short walk is exit 2 — because issue
 * #215's refusal was never "empty is bad", it was "the walk disagreed with an
 * independent second author", and a package has one: its own `package.json`.
 */
export type SubjectDeclarationKind =
  /** An `exports` subpath the package declares. */
  | 'exports-subpath'
  /** A block the module's own manifest declares. */
  | 'manifest-block'
  /** A flag the module's manifest declares, or declines to. */
  | 'manifest-flag'
  /** A `package.json` script running a source path. */
  | 'package-script'
  /** Unconditional — the package itself is the subject. */
  | 'always';

export interface SubjectDeclaration {
  readonly kind: SubjectDeclarationKind;
  /**
   * The declaration in the package's own vocabulary, as a noun phrase the
   * report negates: *"no `i18n.bundlesDir` in the module manifest"*. That
   * sentence is what makes a `not-applicable` verdict auditable by its reader,
   * which is the entire difference between this verdict and a skip.
   */
  readonly declaration: string;
}

/** Which inputs a rule needs beyond the package — the phase boundary, derived. */
export type EstateTier =
  /** The package, `@endora-commerce/contracts` and `@endora-commerce/platform`. */
  | 'A'
  /** Additionally an owner map or peers' manifests over the installed set. */
  | 'B'
  /** This repository. Always `repository-only`. */
  | 'C';

export interface EstateEntry {
  /**
   * The npm script that runs it, or the script's stem where there is none. The
   * key `check-inventory.test.ts` reconciles on.
   */
  readonly id: string;
  /** Repository-relative path. Must resolve to a file in this tree. */
  readonly script: string;
  readonly scope: EstateScope;
  /** Required for `repository-only`; refused for `package`. */
  readonly reason?: string;
  /** Only meaningful for `scope: 'package'`. */
  readonly host?: EstateHost;
  /** Signals this rule cannot evaluate in package scope. Counts once, as `ran`. */
  readonly partial?: readonly PartialSignal[];
  /** What makes the rule applicable. `null` is unconditionally applicable. */
  readonly subjectDeclaration: SubjectDeclaration | null;
  /** True where the rule's subject is something the platform *loads*. */
  readonly readsArtefact: boolean;
  readonly tier: EstateTier;
}

/** `always`, spelled once so no entry writes the sentence twice. */
const ALWAYS: SubjectDeclaration = {
  kind: 'always',
  declaration: 'package at all — this rule is unconditional',
};

/** A rule whose host lands in a later phase, with the phase named. */
const pending = (phase: string): EstateHost => ({ pending: phase });

/**
 * Every rule in the estate.
 *
 * Sorted by `id`, so a reader can find a rule and a diff shows one line moving.
 * The order carries no meaning — the run reports in this order and the
 * arithmetic is order-free.
 */
export const ESTATE: readonly EstateEntry[] = [
  {
    id: 'channel:resolution',
    script: 'backend/scripts/check-channel-resolution.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check-entity-tenant-classification',
    script: 'backend/scripts/check-entity-tenant-classification.ts',
    scope: 'package',
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing entity classes',
    },
    readsArtefact: true,
    tier: 'B',
  },
  {
    id: 'check:action-route-permissions',
    script: 'backend/scripts/check-action-route-permissions.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: 'a non-empty `actions` array in the module manifest',
    },
    readsArtefact: true,
    tier: 'A',
  },
  {
    id: 'check:admin-surface',
    script: 'backend/scripts/check-admin-surface.ts',
    scope: 'package',
    host: pending('Phase 4'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing an admin layer',
    },
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'check:admin-zones',
    script: 'backend/scripts/check-admin-zones.ts',
    scope: 'package',
    host: pending('Phase 4'),
    partial: [
      {
        signal: 'admin-application-host-walk',
        reason:
          "its render and `foreign-module-id` halves are the module's; the `admin/src` host " +
          "walk is the admin application's and a package is not one",
      },
    ],
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing an admin layer',
    },
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'check:bundle-pairing',
    script: 'backend/scripts/check-bundle-pairing.ts',
    scope: 'package',
    host: 'built',
    partial: [
      {
        signal: 'undeclared-bundle-dir',
        reason:
          'the directory names it probes are derived from *other* modules’ manifests, so ' +
          'a lone package supplies none; a package that ships bundle files and declares no ' +
          '`i18n.bundlesDir` is invisible to this run',
      },
    ],
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: '`i18n.bundlesDir` in the module manifest',
    },
    readsArtefact: true,
    tier: 'A',
  },
  {
    id: 'check:command-coverage',
    script: 'backend/scripts/check-command-coverage.ts',
    scope: 'package',
    host: 'built',
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:container-imports',
    script: 'backend/scripts/check-container-imports.ts',
    scope: 'package',
    host: 'built',
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:default-language-prose',
    script: 'backend/scripts/check-default-language-prose.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:diacritic-folds',
    script: 'backend/scripts/check-diacritic-folds.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:doc-snippets',
    script: 'backend/scripts/check-doc-snippets.ts',
    scope: 'repository-only',
    reason:
      "its population is this platform's own documentation site and feature artefacts — a " +
      'code block marked `verbatim-from` in `docs/docs/**` or `specs/**`. A package holds ' +
      'neither, and a rule that walked the package for them would be checking nothing.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:entry-presence',
    script: 'backend/scripts/check-entry-presence.ts',
    scope: 'package',
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'manifest-flag',
      declaration: 'module manifest declaring an activation control',
    },
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'check:entry-scope',
    script: 'backend/scripts/check-entry-scope.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: {
      kind: 'package-script',
      declaration: '`package.json` script running a source path, no worker and no timer',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:error-translations',
    script: 'backend/scripts/check-error-translations.ts',
    scope: 'package',
    host: pending('Phase 2'),
    partial: [
      {
        signal: 'routing-table',
        reason:
          '`ERROR_TRANSLATION_KEYS` is a closed enumeration with a hard-coded prefix chain, ' +
          'so a third-party error code is unroutable. The bundle half runs; ' +
          '`specs/090-module-owned-error-codes/` is the repair and this feature does not ' +
          'pre-empt it',
      },
    ],
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: '`i18n.bundlesDir` in the module manifest',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:fixture-substitution',
    script: 'backend/scripts/check-fixture-substitution.ts',
    scope: 'repository-only',
    reason:
      "its population is this repository's own test tree and its `setupBackendServer` " +
      'harness: a read defaulted to a fabricated value is a finding *because* another file ' +
      "in that suite created the row first. A package's tests run against no such harness.",
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:harness-teardown',
    script: 'backend/scripts/check-harness-teardown.ts',
    scope: 'repository-only',
    reason:
      'its subject is `backend/test/helpers/`’ own teardown seam — a hand-written release ' +
      'of a resource `setupBackendServer` owns. The seam is this repository’s test ' +
      'harness and is published by no package, so an author has nothing to violate.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:kernel-boundary',
    script: 'backend/scripts/check-kernel-boundary.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing entity classes',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:language',
    script: 'scripts/check-language.sh',
    scope: 'repository-only',
    reason:
      'Principle VIII’s scope is source-code **comments** and `docs/docs/**` pages, and its ' +
      '`proper_nouns` allow-list is this platform’s own product vocabulary. A rule whose ' +
      'remedy is "ask us to add you to a list" names an input only we can supply, so it is ' +
      'repository-only by construction rather than `unreadable` (`research.md` §3).',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:lock-claims',
    script: 'backend/scripts/check-lock-claims.ts',
    scope: 'package',
    host: pending('Phase 3'),
    subjectDeclaration: null,
    readsArtefact: true,
    tier: 'B',
  },
  {
    id: 'check:module-boundary',
    script: 'backend/scripts/check-module-boundary.ts',
    scope: 'package',
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: true,
    tier: 'B',
  },
  {
    id: 'check:naming',
    script: 'scripts/check-naming.sh',
    scope: 'package',
    host: pending('Phase 2'),
    partial: [
      {
        signal: 'vocabulary-allow-lists',
        reason:
          'plurality, `allowed_singular` and `allowed_proper_noun` are this platform’s own ' +
          'product vocabulary, and a rule whose remedy is "ask us to add you to a list" ' +
          'names an input only we can supply',
      },
    ],
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:nul-bytes',
    script: 'backend/scripts/check-nul-bytes.ts',
    scope: 'package',
    host: 'built',
    subjectDeclaration: ALWAYS,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:off-state-coverage',
    script: 'backend/scripts/check-off-state-coverage.ts',
    scope: 'repository-only',
    reason:
      'its predicate is *a module with an activation control is the argument of an ' +
      '`expectModuleAbsent` call*, and that helper is `backend/test/helpers/off-state.ts` — ' +
      'this repository’s test harness, published by no `@endora-commerce/*` package. An ' +
      'author cannot call it, so there is no seam in a package for the rule to read.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:platform-surface',
    script: 'backend/scripts/check-platform-surface.ts',
    scope: 'package',
    host: pending('Phase 2'),
    partial: [
      {
        signal: 'relative-specifier-reach',
        reason:
          'a module in a package reaches the host by **bare** specifier only; the relative ' +
          'half is vacuous here and is declared vacuous rather than counted zero',
      },
    ],
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: true,
    tier: 'A',
  },
  {
    id: 'check:port-catches',
    script: 'backend/scripts/check-port-catches.ts',
    scope: 'package',
    host: pending('Phase 3'),
    partial: [
      {
        signal: 'owner-locked-merge',
        reason:
          'the `OWNER LOCKED` classification needs peers’ manifests; over whatever the ' +
          'author has installed it **over-reports** — the safe direction — and the run says ' +
          'so, because a finding an author cannot reproduce is a finding they learn to ignore',
      },
    ],
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'check:port-dependencies',
    script: 'backend/scripts/check-port-dependencies.ts',
    scope: 'package',
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: true,
    tier: 'B',
  },
  {
    id: 'check:port-shape',
    script: 'backend/scripts/check-port-shape.ts',
    scope: 'package',
    host: pending('Phase 2'),
    partial: [
      {
        signal: 'cross-module-resolution',
        reason:
          'the third signal asks whether a *module* resolves a container name no contract ' +
          'publishes, which needs the published surface of every installed peer',
      },
    ],
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing a port surface',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:pdfmake-footprint',
    script: 'scripts/check-pdfmake-footprint.sh',
    scope: 'repository-only',
    reason:
      "its subject is this deployment's disk budget on a single VPS (Constitution IV) — the " +
      'size of the pdfmake font bundle this repository ships. A package ships no font bundle ' +
      'and has no budget of ours to exceed.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:release-intent',
    script: 'backend/scripts/check-release-intent.ts',
    scope: 'repository-only',
    reason:
      'its subject is `.changeset/config.json`, `pnpm-workspace.yaml` and this repository’s ' +
      'own release gate. A package is one member of that workspace, not the workspace, and ' +
      'the question it answers — "does this branch carry a changeset" — is about a branch of ' +
      'this repository.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:shared-table-wipes',
    script: 'backend/scripts/check-shared-table-wipes.ts',
    scope: 'repository-only',
    reason:
      "its population is this repository's own test tree, and its baseline is a per-file " +
      'count ratchet over the 197 unscoped wipes standing when it landed. A package predates ' +
      'nothing, so it can have no entry in that ratchet and we can have none in its.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:singleton-identity',
    script: 'backend/scripts/check-singleton-identity.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: true,
    tier: 'A',
  },
  {
    id: 'check:subscribe-seam',
    script: 'backend/scripts/check-subscribe-seam.ts',
    scope: 'package',
    host: 'built',
    partial: [
      {
        signal: 'worker-population-floor',
        reason:
          'the repository-scope floor — *no BullMQ worker site at all is exit 2* — is a ' +
          'statement about a tree known to hold queue consumers. One package holding none is ' +
          'the ordinary case, so the floor is declared unevaluated here rather than refusing',
      },
    ],
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:transaction-context',
    script: 'backend/scripts/check-transaction-context.ts',
    scope: 'package',
    host: pending('Phase 2'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'i18n:hardcoded',
    script: 'backend/scripts/i18n-hardcoded-strings.ts',
    scope: 'package',
    host: pending('Phase 4'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing an admin layer',
    },
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'overlay:check',
    script: 'backend/scripts/check-overlay-determinism.ts',
    scope: 'repository-only',
    reason:
      'its subject is the five generated artefacts this repository commits — the composer, ' +
      'the manifest index, both `db/` registries and the admin contribution registry — and ' +
      'its fourth verdict is *containment*: an entry naming an **installed** package is ' +
      'refused, because such a package is discovered at runtime (D-119/D-155). A package is ' +
      'the thing those artefacts are about, never their author.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
];

/** The estate's own size, derived. Never written down (D-100). */
export const ESTATE_SIZE = ESTATE.length;

/** One entry by id, or `undefined`. */
export function estateEntry(id: string): EstateEntry | undefined {
  return ESTATE.find((entry) => entry.id === id);
}

/**
 * Every entry whose `host` is `pending`, with the phase it names.
 *
 * `check:release-intent` reads this to hold FR-021's coupling: while it is
 * non-empty, `@endora-commerce/cli` stays `private: true`.
 */
export function pendingEntries(
  estate: readonly EstateEntry[] = ESTATE,
): readonly (readonly [string, string])[] {
  return estate.flatMap((entry) =>
    typeof entry.host === 'object' ? [[entry.id, entry.host.pending] as const] : [],
  );
}
