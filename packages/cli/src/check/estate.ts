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
    host: 'built',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check-entity-tenant-classification',
    script: 'backend/scripts/check-entity-tenant-classification.ts',
    scope: 'package',
    // Phase 3's first host, and the one the phase exists for. The declaration
    // is read as *an artefact declaring an `entities` array*, which is the
    // package's own statement about which subpath publishes entity classes —
    // no subpath is spelled here or in the host (D-100).
    host: 'built',
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
    // Tier **B**, corrected in Phase 2 against `plan.md`'s Phase 2 list, and on
    // a measurement. The analysis is relocated and its package host is a dozen
    // lines; what is missing is one **input**. Half this estate writes a
    // permission code as a module-level constant (`requireAdmin(SC_READ)`), and
    // the reader that follows one is `admin_roles`' `ConstantResolver` —
    // published only on `@endora-commerce/mod-admin-roles/backend`, which no
    // module package depends on and whose import evaluates the platform.
    //
    // Measured over all 70 module packages with the resolver absent: **27
    // gates in 11 packages** read as `unreadable`, which the analysis correctly
    // reports as an `unresolvable` finding (an unreadable gate taken for
    // "ungated" agrees with everything). Every one of them is a gate this
    // repository's own run resolves, so shipping the host would hand an author
    // 27 findings about correct code — exactly the state
    // `contracts/package-scope-layout.md` §5.1 refuses, where a finding an
    // author cannot reproduce is one they learn to ignore.
    //
    // The unblocking step is one relocation, not a re-implementation:
    // `ConstantResolver` is a pure source-text reader and belongs in
    // `@endora-commerce/cli/lib/`, with `scanEnforcedPermissionGates` taking it
    // as an argument so no module package depends on the CLI.
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: 'a non-empty `actions` array in the module manifest',
    },
    readsArtefact: true,
    tier: 'B',
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
    id: 'check:block-names',
    script: 'backend/scripts/check-block-names.ts',
    scope: 'package',
    /**
     * **Neither of Tier B's two halves, which is why the phase is named rather
     * than numbered.** `plan.md`'s Phase 3 is the owner map — `package-declarations`
     * over the installed set, `switchable-modules` — and its Phase 4 is the admin
     * half and enumerates three rules by name, at the end of which `pending`
     * reaches zero. This rule is in neither list: what a lone package cannot
     * supply is the **page-builder family's renderer maps**, which are workspace
     * members that are not modules and not the admin. Writing `Phase 4` would
     * have made that plan's own count wrong without saying so, so the string
     * names the phase it belongs beside and what it adds — the idiom
     * `check:module-docs` already uses for a rule waiting on another feature.
     */
    host: pending("Phase 4 — beside the admin half, and a fourth rule to it: this one waits on the page-builder family's renderer maps rather than on an admin layer"),
    partial: [
      {
        signal: 'duplicate-block-name',
        reason:
          'two modules declaring one name is a fact about a **pair** of manifests, and a lone ' +
          'package supplies one; its own manifest declaring a name twice is refused by ' +
          '`defineModuleManifest` before this rule sees it',
      },
      {
        signal: 'category-presentation-disagreement',
        reason:
          "the same shape one level up — a disagreement needs a peer's `blockCategories`, and " +
          'one manifest declaring a `(key, context)` twice is `defineModuleManifest`’s rule 4',
      },
      {
        signal: 'renderer-without-declaration',
        reason:
          'the renderer maps are the page-builder family’s — the workspace members that ' +
          'declare one, derived per run and never a list — and a module package holds only ' +
          'its own, so a name another member renders and nobody declares is outside the run',
      },
    ],
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: '`blocks` in the module manifest',
    },
    readsArtefact: true,
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
    id: 'check:class-vocabulary',
    script: 'backend/scripts/check-class-vocabulary.ts',
    scope: 'package',
    /**
     * Neither of Tier B's two halves, so the phase is **named** rather than
     * numbered, in `check:block-names`' idiom.
     *
     * What a lone module package cannot supply is the thing this rule is
     * *about*: the **published design system**. The vocabulary is read off the
     * `./theme.css` of whichever package declares it, and a module package
     * declares none — it is a consumer of that vocabulary, not its author. So a
     * package host needs the installed design system resolved by name out of
     * the author's own `node_modules`, which is the same capability the admin
     * half of `plan.md`'s Phase 4 builds and one seam wider than it.
     *
     * Until it lands, `endora check` reports this rule `pending` rather than
     * `unreadable`: an author with a module and no installed kit has no input
     * they could supply, and blaming their tree for the tool's incompleteness
     * would send them looking.
     */
    host: pending(
      "Phase 4 — beside the admin half, and a rule to it: this one waits on the **installed** design system, whose `./theme.css` is the author's dependency rather than anything their package declares",
    ),
    partial: [
      {
        signal: 'unrendered-definition',
        reason:
          'the definitions are the design system package’s and the renders are the whole ' +
          'estate’s, so a lone package can only ever answer "this module renders none of ' +
          'them" — which is true of most modules and is not a finding',
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
    host: 'built',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:demo-data-budget',
    script: 'backend/scripts/check-demo-data-budget.ts',
    // **`package`, and the subject is one package's own shipped bytes.** A
    // module's demo layer is located from that module's own manifest artefact
    // and measured in that module's own source tree; nothing about the answer
    // needs a sibling, an owner map or an application. That is Tier **A** as
    // the tier is defined — the package, `@endora-commerce/contracts` and
    // `@endora-commerce/platform` — and `repository-only` would be the claim
    // this file's own guard refuses, since the rule walks the module tree and a
    // module package is one of those modules.
    scope: 'package',
    // **`pending`, and the phase is *named* rather than numbered** in
    // `check:block-names`' idiom, because what a package-scope host is waiting
    // for is neither of Tier B's two halves. It is a **relocation**: the
    // question *"does this file ship"* has exactly one owner since D-218 —
    // `classifyAssetFile` in `scripts/lib/runtime-assets.mjs`, the same function
    // `copy-package-assets.mjs` and the manifest generator ask — and that file
    // sits at the repository root, outside every package. A host in
    // `@endora-commerce/cli` cannot reach it without a second copy of the
    // classification, and a second copy is precisely the defect D-218 closed:
    // two readers able to disagree about the same directory, one shipping a
    // file the other refuses.
    host: pending(
      "the relocation of `scripts/lib/runtime-assets.mjs`' asset classification into " +
        '`@endora-commerce/cli/lib/`, so that "does this file ship" keeps the one owner D-218 ' +
        'gave it rather than gaining a package-scope copy',
    ),
    partial: [
      {
        signal: 'ledger reconciliation',
        reason:
          'the accepted per-module floors are **this repository’s** ledger, kept beside the ' +
          'check; a lone package supplies none, so `stale-budget-entry`, ' +
          '`orphan-budget-entry` and `budget-entry-without-a-reason` have no subject here ' +
          'and the package is judged against the shared floor alone',
      },
      {
        signal: 'undeclared-demo-assets',
        reason:
          'the demo-layer paths it probes are derived from *other* modules’ declarations, so ' +
          'a lone package supplies none; a package that ships demo assets under a layer its ' +
          'own manifest does not declare is invisible to this run',
      },
    ],
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: 'a `demo` object in the module manifest',
    },
    // The declaration is read out of the manifest artefact the platform loads —
    // `dist/manifest.js` for a module package (D-164) — so the run carries
    // `emitted-freshness`' two refusals.
    readsArtefact: true,
    tier: 'A',
  },
  {
    id: 'check:diacritic-folds',
    script: 'backend/scripts/check-diacritic-folds.ts',
    scope: 'package',
    host: 'built',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'A',
  },
  {
    id: 'check:divergence',
    script: 'backend/scripts/check-divergence.ts',
    scope: 'repository-only',
    reason:
      'its subject is a **deployment** — the overlay tree under ' +
      '`backend/src/apps/<name>/` and that deployment’s own declaration beside it. A module ' +
      'package is not one and cannot become one: a package’s divergence from core is a ' +
      'contradiction in terms, because from the instance’s point of view the package *is* ' +
      'core. Nothing an author can put in a package would give this rule a subject.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
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
    host: 'built',
    partial: [
      {
        signal: 'locked-owner-exemption',
        reason:
          'a `nonDeactivatable` module’s **boot hooks** are out of the population and its ' +
          'timers are not, and that exemption is read from the manifest the platform loads. ' +
          'Over a package whose artefact is not current the exemption cannot be derived, so ' +
          'the run keeps every hook in — the safe direction — and says so, because a finding ' +
          'an author cannot reproduce is a finding they learn to ignore',
      },
    ],
    // **`null`, corrected in Phase 3, and the correction is the host's own
    // finding.** This entry read `manifest-flag` / *"module manifest declaring
    // an activation control"*, which would have made a `nonDeactivatable`
    // package `not-applicable`. The rule's own input refuses that reading:
    // `lockedModules` takes a locked module's **boot hooks** out of the
    // population and leaves its **timers** in — `_lifecycle`'s lease heartbeat is
    // *ledgered* rather than exempted, which is only meaningful if a locked
    // module's timers are still judged. So the manifest decides an exemption,
    // never applicability, and the rule is unconditional.
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'B',
  },
  {
    id: 'check:entry-scope',
    script: 'backend/scripts/check-entry-scope.ts',
    scope: 'package',
    host: 'built',
    subjectDeclaration: {
      kind: 'package-script',
      declaration: '`package.json` script running a source path, no worker and no timer',
    },
    readsArtefact: false,
    tier: 'A',
  },
  {
    // `specs/117-instance-bring-up/` FR-003. **`package`, not
    // `repository-only`, and the distinction is a claim about the rule's
    // *subject*.** A module declares its own environment inputs in
    // `manifest.ts` beside its permissions and its actions, on identical terms
    // with an installed package. Filing it `repository-only` would write "a
    // module can never have inputs to declare" into an artefact three programs
    // read, which is the opposite of the design.
    //
    // **The subject now exists and this repository's host judges it** (Phase 3,
    // T3-A and T3-B): the `env` field is on `ModuleManifestSchema` and
    // `check:env-inputs` walks the module tree. What is still `pending` is the
    // *package-scope* host, and the phase text says what it is waiting on rather
    // than repeating a phase that has landed — a pending naming work that is
    // done is worse than no pending, because it sends its reader to look for
    // something nobody is going to do.
    //
    // What it waits on is one derivation, not effort. A module's read of
    // `STOREFRONT_BASE_URL` is satisfied by the **platform's** declaration, and
    // this check reads a declaration out of its own **source text** — which an
    // installed `@endora-commerce/platform` does not ship, having only `dist`. A
    // host that resolved it from the emitted module would be the first reader in
    // this estate to do so, and whether that is right (there is no source for it
    // to be stale against, so D-164's objection may not apply here at all) is a
    // ruling rather than an implementation.
    id: 'check:env-inputs',
    script: 'backend/scripts/check-env-inputs.ts',
    scope: 'package',
    host: pending(
      'a package-scope host, which needs a ruling first: the platform declaration a module ' +
        "read resolves against is source text here and `dist` in a client's tree",
    ),
    subjectDeclaration: {
      kind: 'manifest-block',
      declaration: '`env` in the module manifest',
    },
    // The declarations are read out of their own **source text**, never out of
    // an emitted module: an imported one would answer about the previous build
    // (D-164), which is the `stale-artefact` class
    // `check:action-route-permissions` grew a refusal for after three measured
    // false greens. Reading the text removes the question rather than guarding
    // it, and the run needs no build at all.
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
    host: 'built',
    partial: [
      {
        signal: 'platform-root-imports',
        reason:
          'rule B walks the specifiers a **platform root** names, and a module package holds ' +
          'none — the kernel and its three peers are the application’s. Declared unevaluated ' +
          'rather than counted zero: a signal that reports nothing because it had no subject ' +
          'and one that reports nothing because the tree is clean are the two states this ' +
          'estate exists to keep apart',
      },
      {
        signal: 'kernel-import-closure',
        reason:
          'rule C walks the kernel’s transitive relative-import closure, which starts at the ' +
          'platform’s own sources. A package is never one of those roots, so the closure has ' +
          'no starting point here and is declared vacuous rather than reported empty',
      },
    ],
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
    id: 'check:module-docs',
    script: 'backend/scripts/check-module-docs.ts',
    // **`package`, not `repository-only`, and the estate refused the first
    // classification I wrote.** Its population is the registered modules, so a
    // repository-only claim over a module walk is exactly what this file's own
    // guard exists to reject — and the guard was right: the reasoning behind
    // that claim was about the *pairing* (a lone package has no navigation),
    // not about the *subject*, which is a module's own documentation layer.
    //
    // Feature 100's Phase 2 gives a module a package-root `docs/` directory on
    // `i18n/`'s terms. Until it lands there is no package-scope host, and there
    // is no input an author can supply to make one — which is what `pending`
    // means here and why it is not `unreadable`.
    scope: 'package',
    host: pending('specs/100-module-owned-documentation/ Phase 2'),
    subjectDeclaration: null,
    readsArtefact: true,
    // A, not C: in package scope the inputs are the package's own `docs/` layer
    // and its manifest. C is defined as *this repository, always
    // `repository-only`*, so it cannot carry a `package` scope — the second
    // thing this file's guards refused about this entry, and correctly.
    tier: 'A',
  },
  {
    id: 'check:storefront-indexability',
    script: 'backend/scripts/check-storefront-indexability.ts',
    scope: 'repository-only',
    reason:
      'its population is `storefront/app`’s route tree and its second author is that ' +
      'application’s own `sitemap.ts`. A module package has neither, and under D-195 a ' +
      'client’s storefront is generated from a scaffold and owned outright rather than ' +
      'composed from packages — so there is no package-scope subject here and there will ' +
      'not be one.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
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
    host: 'built',
    partial: [
      {
        signal: 'relative-specifier-reach',
        reason:
          'a module in a package reaches the host by **bare** specifier only; the relative ' +
          'half is vacuous here and is declared vacuous rather than counted zero',
      },
      {
        signal: 'application-host-reach',
        reason:
          'an installed module package has no application tree, so the application-reach ' +
          'half has no subject here; declared vacuous rather than counted zero',
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
    host: 'built',
    partial: [
      {
        signal: 'documented-container-name',
        reason:
          'the second signal compares a doc block’s container name to the name the port is ' +
          '**registered** under, and a published port’s provider is routinely another module ' +
          '— `orders` publishes `PaymentPlacementApplyPort` and `payments` registers it — so ' +
          'over one package every such port reads `container-name-unregistered`. A port ' +
          'whose owner is not installed is `unreadable` for that edge and never unowned ' +
          '(`contracts/package-scope-layout.md` §5): the wiring may be right and the map short',
      },
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
    /**
     * **Tier A, `package` and `built` on day one**, which is unusual and is a
     * property of the rule rather than of the effort spent on it: its whole
     * input is one package's own source text. No permission resolver, no peer's
     * published surface, no generated artefact — a `new Queue('a:b')` is wrong
     * in a module package for exactly the reason it is wrong here, and the
     * author who most needs to be refused is the third party writing their
     * first worker.
     */
    id: 'check:queue-names',
    script: 'backend/scripts/check-queue-names.ts',
    scope: 'package',
    host: 'built',
    partial: [
      {
        signal: 'resolved-name-floor',
        reason:
          'the repository-scope floor — *no queue name resolved at all is exit 2* — is a ' +
          'statement about a tree known to hold queues. Most module packages ship no worker ' +
          'and therefore no queue name, so the floor is declared unevaluated here rather ' +
          'than refusing an ordinary package',
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
    id: 'check:release-intent',
    script: 'backend/scripts/check-release-intent.ts',
    scope: 'repository-only',
    reason:
      'its subject is `.changeset/config.json`, `pnpm-workspace.yaml` and this repository’s ' +
      'own release gate. A package is one member of that workspace, not the workspace, and ' +
      'the question it answers — "does this branch carry a changeset" — is about a branch of ' +
      'this repository. Its per-member questions — is this package published, is it fit, is ' +
      'it licensed — are asked of a member **of this publication set**, which a package ' +
      'outside a workspace does not belong to and cannot be given one of: there is no ' +
      '`ignore` list to be exempted by, no scope to agree with, and no configuration deciding ' +
      'whether changesets can see it at all.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:root-dispositions',
    script: 'backend/scripts/check-root-dispositions.ts',
    // `repository-only`, and here the claim about the *subject* is unusually
    // literal: the rule is over **this repository's top-level entries**, and a
    // module package has none of them — it contributes paths under `packages/`
    // and never a root entry. There is no analogue to give an author either:
    // the question "may this be published" is answered for a repository by its
    // owner, once, and a package installed from a registry has already been.
    scope: 'repository-only',
    reason:
      'its subject is this repository’s own top-level entries and the recorded disposition ' +
      'of each — whether a path travels into the public repository at the migration. A ' +
      'module package holds no root entry of its own, and the question the rule asks has ' +
      'already been answered for anything installed from a registry.',
    subjectDeclaration: null,
    readsArtefact: false,
    tier: 'C',
  },
  {
    id: 'check:rsc-discipline',
    script: 'backend/scripts/check-rsc-discipline.ts',
    // `repository-only`, and the reason is the *subject* rather than the root:
    // its population is one application's composed client tree, derived from
    // `storefront/package.json`'s own dependencies. A module package is not a
    // member of that population and cannot become one by being checked — the
    // storefront composes two React packages, neither of them a module — so
    // this is not the module walk a `repository-only` claim is refused over.
    // Under D-195 a client's storefront is generated from this scaffold and
    // owned outright rather than composed from packages, so the gate on the
    // template is the only place any of it is enforceable once.
    scope: 'repository-only',
    reason:
      'its population is the `storefront` application plus the workspace packages that ' +
      'application composes, and its second author is `storefront/package.json`’s own ' +
      'dependency list. A module package is neither: it ships no `page.tsx`, and the ' +
      'question — "does a crawler receive this component’s content" — is asked of a ' +
      'server-rendered site, not of a package.',
    subjectDeclaration: null,
    readsArtefact: false,
    // C, not A: the inputs are a specific application's manifest and its
    // composed package tree, neither of which a lone package can supply.
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
    // Tier **B**, corrected in Phase 2 against `plan.md`'s Phase 2 list, and on
    // a measurement rather than on taste. The rule's subject is a reach into a
    // module package's **source** from a process that also loads that package's
    // published artefact — and `specifierGraph` skips a reach whose target is
    // the reaching file's *own* package (`own.root === pkg.root`), correctly:
    // a package's internal relative imports are one copy, not two. So one
    // package in isolation has no second package for a reach to land in, and a
    // host that ran it anyway would print `violations=0` on every package
    // forever, which is the vacuous green this estate exists against.
    //
    // What it needs is the **peers' sources**, which exist only where a peer is
    // a workspace member rather than an installed package (an installed one
    // ships `dist`). That is peers over the installed set — Tier B's own
    // additional input — so it lands with Phase 3 rather than here.
    host: pending('Phase 3'),
    subjectDeclaration: {
      kind: 'exports-subpath',
      declaration: '`exports` subpath publishing backend sources, beside a peer package',
    },
    readsArtefact: true,
    tier: 'B',
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
    id: 'check:test-ownership',
    script: 'backend/scripts/check-test-ownership.ts',
    scope: 'package',
    /**
     * **Not `repository-only`, and the inventory refuses the alternative.** The
     * rule walks the module tree, so it is recorded `residueGuard:
     * 'derived-population'` and Invariant 3 refuses a repository-only claim over
     * one — which is right, because a module package is one of those modules and
     * *"are this package's tests where they belong and configured to run"* is
     * exactly the question one package asks about itself.
     *
     * The phase is named rather than numbered, in `check:block-names`' idiom.
     * `plan.md`'s Phase 3 is the owner map and its Phase 4 the admin half; this
     * rule is in neither list, and what a lone package cannot supply is the
     * **application's own test tree** — `misplaced-test`'s whole population is
     * `backend/test/**`, which no package has. A package host therefore
     * evaluates four of the five findings and declares the fifth unevaluated,
     * which is the `partial` below rather than a smaller rule.
     */
    host: pending(
      'a phase of its own — the analysis is relocated with the rest, and what a package cannot supply is the *application* test tree that `misplaced-test` is about',
    ),
    partial: [
      {
        signal: 'misplaced-test',
        reason:
          "its population is the application's own `backend/test/**`, which a module package " +
          'does not have; the four findings whose subject is the package itself are evaluated',
      },
    ],
    subjectDeclaration: ALWAYS,
    readsArtefact: false,
    // **B, not A.** Resolving an owner needs the npm name each *sibling* module
    // package publishes mapped to the id it declares — the peers' manifests over
    // the installed set — because half the tree names a module by bare
    // specifier. A rule that read only relative paths would classify that half
    // as platform-owned, which is the fail-open direction.
    tier: 'B',
  },
  {
    id: 'check:transaction-context',
    script: 'backend/scripts/check-transaction-context.ts',
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
