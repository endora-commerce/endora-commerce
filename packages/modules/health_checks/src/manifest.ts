import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Health Checks module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'health_checks',
  docs: { dir: 'docs' },
  name: 'Health Checks',
  description:
    'Liveness/readiness HTTP endpoints consumed by orchestrators.',
  version: '1.0.0',
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/health_checks.ts`.
   */
  env: [
    {
      name: 'MEILISEARCH_URL',
      describes: {
        en: 'Where the health endpoint looks for the search engine when it reports whether this instance is whole.',
        pl: 'Gdzie punkt kontroli stanu szuka silnika wyszukiwania, gdy raportuje, czy ta instancja jest sprawna.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The probe reaches for the search engine at the platform’s own address, so a shop that runs it elsewhere is reported degraded while it is working.',
          pl: 'Sonda szuka silnika wyszukiwania pod adresem wbudowanym w platformę, więc sklep, który uruchamia go gdzie indziej, jest raportowany jako niesprawny, choć działa.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'health_checks' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'npm_package_version',
      describes: {
        en: 'The version this instance reports in its health payload. The package manager sets it when it starts the server; an operator has nothing to choose here.',
        pl: 'Wersja, którą ta instancja podaje w odpowiedzi kontroli stanu. Ustawia ją menedżer pakietów przy starcie serwera; operator nie ma tu nic do wyboru.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The health payload carries no usable version, so one deployment cannot be told apart from the one before it.',
          pl: 'Odpowiedź kontroli stanu nie niesie użytecznej wersji, więc nie da się odróżnić jednego wdrożenia od poprzedniego.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'health_checks' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
  dependencies: [],
  // No activation declaration, deliberately (D-36a item 4). This module owns
  // exactly one surface — the probes — and D-36b exempts them from gating
  // outright, through `ctx.ungatedRoutes`: there is no seam left for either
  // axis to close, so an orchestrator that reports this module disabled still
  // answers /health.
  //
  // Feature 074 makes that a **third category** rather than the last unconverted
  // module: *structurally unswitchable*. It is neither core (which would
  // announce a hazard, see below) nor operator-controlled (there is nothing for
  // a control to close), and it is the only member — pinned by
  // `test/unit/_lifecycle/non-deactivatable-set.test.ts`, which asserts that the
  // set of manifests with no activation block is exactly this one. No third
  // schema arm was added for it (Constitution IV): a test with a stated reason
  // is the whole mechanism, so a second module arriving here fails the build
  // instead of joining a category by omission.
  //
  // What the flag would add is therefore nothing. It binds **both** axes since
  // `assertDeactivatable` shipped — the platform CLI refuses the disable with no
  // `--force`, exactly as the operator write does (feature 073, Amendment A1;
  // this comment previously claimed it closed the operator axis only, which was
  // true before that method existed and false after). Declaring it here would
  // announce a hazard the route exemption has already removed, and a declaration
  // about a hazard is what D-32 rejected in favour of a structure without one.
});
