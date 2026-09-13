import { describe, expect, it } from 'vitest';
import {
  claimFileOnce,
  divergenceBoundary,
  divergenceRefusal,
  moduleContextSeams,
  routeIdentities,
  SEAM_CLASSIFICATION,
  type DivergenceRefusalInput,
  type DivergenceRefusalKind,
} from '../../../scripts/lib/divergence.js';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';
import { rootRegisteredNames as rootRegisteredNamesFromCheck } from '../../../scripts/check-port-dependencies.js';
import { rootRegisteredNames as rootRegisteredNamesFromPackage } from '@endora-commerce/cli/lib/port-registrations.js';
import {
  FIXTURE_OVERLAY,
  FIXTURE_REASONS,
  fixtureDivergence,
  fixtureFindings,
  MODULE_CONTEXT_SOURCE,
} from '../../helpers/divergence-fixture.js';

/**
 * `check:divergence` (`backend/scripts/check-divergence.ts`) — the derivation,
 * its nine findings and its four refusals.
 *
 * **The acceptance instrument is the fixture deployment, not this repository's
 * own two overlay modules** (SC-008). Between them they carry one decoration,
 * one interceptor and one registration; a companion test over that tree would
 * prove three of the nine kinds and go quiet about the other six. The fixture
 * exercises every seam once, and it enters as **source text** — the top of the
 * analysis — so the receiver resolution, the seam spelling, the literal
 * resolution, the owner attribution and the rung stamp all run over it.
 */

describe('the derivation covers every seam a deployment can use (SC-008)', () => {
  const derived = fixtureDivergence();

  it('finds one entry per recorded seam, and none for a module’s own surface', () => {
    const byKind = new Map<string, number>();
    for (const entry of derived.report.entries) {
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    }
    // Every recorded kind, once. `routes`, `ungatedRoutes` and `onBoot` are in
    // the fixture and must contribute nothing: they are a module acting on its
    // own surface, which is not a divergence from core.
    expect([...byKind.keys()].sort()).toEqual([...divergenceBoundary().recorded].sort());
    expect(derived.report.entries).toHaveLength(9);
  });

  it('stamps the rung the ladder gives each seam', () => {
    const rungOf = new Map(derived.report.entries.map((e) => [e.kind, e.rung] as const));
    expect(rungOf.get('subscription')).toBe(1);
    expect(rungOf.get('interceptor')).toBe(2);
    expect(rungOf.get('port-provided')).toBe(3);
    expect(rungOf.get('port-consumed')).toBe(3);
    expect(rungOf.get('decoration')).toBe(4);
    expect(rungOf.get('root-plugin')).toBe(4);
    // The ladder's own three `—` rows: a registration and a worker are a module
    // contributing its own surface to the container and to the queue, and an
    // omission comes from the declaration and from no seam at all. `null` is not
    // "unclassified" — that is a finding, proven below.
    expect(rungOf.get('registration')).toBeNull();
    expect(rungOf.get('worker')).toBeNull();
    expect(rungOf.get('omission')).toBeNull();
  });

  it('names the owner of every subject it can, per kind', () => {
    const ownerOf = new Map(derived.report.entries.map((e) => [e.kind, e.owner] as const));
    // A container name's owner is the module that registered it.
    expect(ownerOf.get('decoration')).toBe('price_lists');
    expect(ownerOf.get('port-consumed')).toBe('orders');
    // An **endpoint's** owner is the module that registered the route, which is
    // a different namespace: reading it out of the container map would answer
    // `null` for every interceptor in the tree.
    expect(ownerOf.get('interceptor')).toBe('orders');
    // An event's owner is honestly unknown: the platform publishes no catalogue
    // of emitters, which the ladder's rung 1 records as a standing gap.
    expect(ownerOf.get('subscription')).toBeNull();
  });

  it('records a decoration’s depth as null rather than guessing it', () => {
    const decoration = derived.report.entries.find((e) => e.kind === 'decoration');
    expect(decoration?.detail).toEqual({ kind: 'decoration', depth: null });
  });

  it('keys an interceptor by its phase, because one endpoint takes two', () => {
    const interceptor = derived.report.entries.find((e) => e.kind === 'interceptor');
    expect(interceptor?.key).toBe('interceptor:acme_overlay:POST /api/v1/orders#pre');
  });

  it('sorts the entries and the overlay module list', () => {
    // A directory listing and a walk order are the inputs, and two filesystems
    // disagree about both. This is where the sort happens — the renders sort
    // nothing, so that there is one answer to it.
    const keys = derived.report.entries.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
    const listed = fixtureDivergence({ overlayModules: ['b_mod', 'acme_overlay'] });
    expect(listed.report.overlayModules).toEqual(['acme_overlay', 'b_mod']);
  });

  it('is clean over a fixture that declares every one of them', () => {
    // The discrimination the nine red proofs below turn on: with every entry
    // explained, every subject owned and every target matched, the check finds
    // nothing. A rule that could not be satisfied would be a rule nobody could
    // land.
    expect(derived.findings).toEqual([]);
  });
});

describe('the findings — one red proof per shape it refuses', () => {
  it('computed-subject: a decoration name built from a value', () => {
    // FR-016, and the rule that matters most here: with two overlay modules in
    // this repository, a walk that silently skipped what it could not read would
    // print `entries=1` over a deployment with fifty.
    expect(
      fixtureFindings('computed-subject', {
        sources: [
          {
            moduleId: 'acme_overlay',
            file: 'backend/src/apps/acme/modules/acme_overlay/backend.ts',
            text: `
              import type { ModuleContext } from '../../../../kernel/index.js';
              export function registerModule(ctx: ModuleContext): void {
                ctx.di.decorate<Pricing>(nameFrom(config), (inner) => inner);
              }
            `,
          },
        ],
      }),
    ).toBeGreaterThan(0);
  });

  it('unowned-subject: a decoration of a name no module registers', () => {
    expect(fixtureFindings('unowned-subject', { owners: new Map() })).toBeGreaterThan(0);
  });

  it('unmatched-interceptor-target: an endpoint no route registration serves', () => {
    // The registry accepts it silently and the interceptor simply never runs, so
    // nothing else in the platform would tell you.
    expect(fixtureFindings('unmatched-interceptor-target', { routeSources: [] })).toBeGreaterThan(
      0,
    );
  });

  it('undeclared-divergence: a divergence with no sentence', () => {
    expect(fixtureFindings('undeclared-divergence', { reasons: {} })).toBeGreaterThan(0);
  });

  it('stale-reason: a sentence describing a divergence that is gone', () => {
    expect(
      fixtureFindings('stale-reason', {
        reasons: {
          ...FIXTURE_REASONS,
          'decoration:acme_overlay:somethingRemoved':
            'A wrap this deployment used to carry and no longer does — the shape that lets a ' +
            'deployment silently reacquire a hazard it once declared.',
        },
      }),
    ).toBeGreaterThan(0);
  });

  it('unclassified-seam: a ModuleContext member no rung classifies', () => {
    // FR-031, and the reason the seam population is read from the platform's own
    // interface rather than from the rung table: `rootPlugin` arrived
    // unclassified once, and nothing said so.
    expect(
      fixtureFindings('unclassified-seam', {
        seams: [...moduleContextSeams(MODULE_CONTEXT_SOURCE), 'mountEverything'],
      }),
    ).toBeGreaterThan(0);
  });

  it('stale-decoration-order: an order for a name no two modules decorate', () => {
    expect(
      fixtureFindings('stale-decoration-order', {
        decorationOrder: { pricingService: ['acme_overlay'] },
      }),
    ).toBeGreaterThan(0);
  });

  it('foreign-order-member: an order naming a module this deployment does not ship', () => {
    expect(
      fixtureFindings('foreign-order-member', {
        decorationOrder: { pricingService: ['acme_overlay', 'somebody_elses_module'] },
      }),
    ).toBeGreaterThan(0);
  });

  it('incomplete-order: an order naming fewer modules than decorate that name', () => {
    // Two overlay modules wrapping one name, and the declaration naming one.
    // A partial order refuses the composition at boot rather than ordering it,
    // so the entry reads as a decision and behaves as a comment.
    const second = FIXTURE_OVERLAY.replace('acme_overlay', 'beta_overlay');
    expect(
      fixtureFindings('incomplete-order', {
        overlayModules: ['acme_overlay', 'beta_overlay'],
        decorationOrder: { pricingService: ['acme_overlay'] },
        sources: [
          {
            moduleId: 'acme_overlay',
            file: 'backend/src/apps/acme/modules/acme_overlay/backend.ts',
            text: FIXTURE_OVERLAY,
          },
          {
            moduleId: 'beta_overlay',
            file: 'backend/src/apps/acme/modules/beta_overlay/backend.ts',
            text: second,
          },
        ],
      }),
    ).toBeGreaterThan(0);
  });
});

describe('the refusals — one red proof per input whose absence is a vacuous pass', () => {
  const SOUND: DivergenceRefusalInput = {
    deployments: ['acme'],
    committedDeploymentArtefacts: ['backend/src/apps/acme/divergence.generated.ts'],
    sites: 9,
    overlaySpellsASeamCall: true,
    ownersResolved: 4,
    seamsClassified: Object.keys(SEAM_CLASSIFICATION).length,
  };

  it('reports nothing over a sound run — the discrimination the four turn on', () => {
    expect(divergenceRefusal(SOUND)).toBeNull();
  });

  const cases: ReadonlyArray<[DivergenceRefusalKind, Partial<DivergenceRefusalInput>]> = [
    // §5.6 — asked first, because with nothing classified every other predicate
    // is answering a question the ladder has not been asked.
    ['no-seam-classified', { seamsClassified: 0 }],
    // §5.1 — issue #120's shape: the population is gone while the artefacts
    // describing it are not.
    ['no-deployment-with-committed-artefact', { deployments: [] }],
    // §5.4 — attribution is off, so every entry would read `unowned-subject`.
    ['no-owner-resolved', { ownersResolved: 0 }],
    // §5.3 — the load-bearing one: the sources spell a seam call and the walk
    // read none of them.
    ['no-seam-call-read', { sites: 0 }],
  ];

  for (const [kind, override] of cases) {
    it(`refuses: ${kind}`, () => {
      const refusal = divergenceRefusal({ ...SOUND, ...override });
      expect(refusal?.kind).toBe(kind);
      expect(refusal?.message.length).toBeGreaterThan(0);
    });
  }

  it('does not refuse a deployment that genuinely uses no seam', () => {
    // The discrimination §5.3 turns on, and the reason the predicate takes a
    // second author. An overlay module that only registers routes writes no seam
    // call at all, which is legal — and indistinguishable from a resolver that
    // stopped reading them, unless something asks whether the source text spells
    // one.
    expect(
      divergenceRefusal({ ...SOUND, sites: 0, overlaySpellsASeamCall: false }),
    ).toBeNull();
  });
});

describe('the seam population is the platform’s, not the rung table’s', () => {
  it('reads ModuleContext’s own members, expanding `di` and nothing else', () => {
    const seams = moduleContextSeams(MODULE_CONTEXT_SOURCE);
    expect(seams).toContain('di.decorate');
    expect(seams).toContain('rootPlugin');
    // `module` is also an inline object literal — of two `string` properties.
    // Expanding it reported `module.id` and `module.version` as seams the ladder
    // does not classify, which is a finding about the reader. A property is a
    // fact the context carries; a method is something a module does.
    expect(seams).toContain('module');
    expect(seams).not.toContain('module.id');
  });

  it('classifies every member the platform declares', () => {
    // The other direction, and the one that keeps the eleventh seam from
    // arriving unclassified: every member read has an entry, or the derivation
    // raises `unclassified-seam`.
    for (const seam of moduleContextSeams(MODULE_CONTEXT_SOURCE)) {
      expect(SEAM_CLASSIFICATION[seam], `\`ctx.${seam}\` is classified by no rung`).toBeDefined();
    }
  });

  it('refuses an interface it could not read rather than reporting an empty seam set', () => {
    // `expected: 0` on the read line's `seam-kinds` author is what the shared
    // reporter refuses as `no-expectation`; here the input is what produces it.
    expect(moduleContextSeams('export const nothing = 1;')).toEqual([]);
  });
});

describe('the module-population floor, which this check delegates rather than owns', () => {
  // `check-divergence.ts` is not in `moved-module-tree.test.ts`, so the refusal
  // is proven here instead, over the same shared helper the check calls —
  // first, before every other refusal.
  //
  // **Why it is not there changed under it** (feature 111, Phase 4). This
  // comment read *"and is classified `not-a-module-walk`, because its population
  // is `backend/src/apps/` and the module tree is the owner map's input rather
  // than the subject it judges"*. The second half is still true and is why
  // `endora check` records the rule `repository-only`; what it does not answer
  // is `residueGuard`, which asks whether the check carries the shared
  // module-population floor — and this one calls
  // `refuseVacuousModulePopulation` before anything else, so it does. It is
  // therefore `deferred-shared-proof`, with the measurement and the retiring
  // condition in `check-inventory.test.ts`' `DEFERRED_SHARED_PROOFS`: over the
  // split fixture it exits 1, because that fixture stages the module tree and
  // not the application root's repository-resident package roots, so
  // `acceptanceProbeGreeter`'s owner — `backend/acceptance/fixture-package` — is
  // not there and the deployment that decorates it reads as decorating nobody.
  //
  // What it protects against is issue #215 one field over: a short owner map
  // does not report fewer entries, it reports every decoration as owned by
  // nobody. Four `unowned-subject` findings over `example` and `acceptance` read
  // exactly like a deployment that misspelled a registration name.
  it('refuses a walk that produced no source for a registered module', () => {
    expect(
      vacuousModulePopulation({
        registered: ['catalog', 'orders'],
        files: ['/repo/backend/src/modules/catalog/backend.ts'],
        moduleIdOf: (file) => (file.includes('/catalog/') ? 'catalog' : null),
      }),
    ).not.toBeNull();
  });

  it('does not refuse a walk that produced one for every module', () => {
    // The discrimination: without this case the assertion above is satisfied by
    // a helper that refuses everything.
    expect(
      vacuousModulePopulation({
        registered: ['catalog', 'orders'],
        files: [
          '/repo/backend/src/modules/catalog/backend.ts',
          '/repo/backend/src/modules/orders/backend.ts',
        ],
        moduleIdOf: (file) => (file.includes('/catalog/') ? 'catalog' : 'orders'),
      }),
    ).toBeNull();
  });
});

describe('the route table', () => {
  it('attributes an endpoint to the module that registered it', () => {
    const routes = routeIdentities([
      {
        file: 'modules/orders/routes.ts',
        text: "app.post('/api/v1/orders', async () => ({}));",
        moduleId: 'orders',
      },
    ]);
    expect(routes.get('POST /api/v1/orders')).toBe('orders');
  });

  it('is not the admin-route scanner: an interceptor may target any endpoint', () => {
    // `check:action-route-permissions`' own scanner filters to `/api/v1/admin/**`,
    // so reusing it would report every storefront target as matching nothing.
    const routes = routeIdentities([
      {
        file: 'modules/catalog/routes.ts',
        text: "app.get('/api/v1/storefront/products', async () => ({}));",
        moduleId: 'catalog',
      },
    ]);
    expect(routes.has('GET /api/v1/storefront/products')).toBe(true);
  });
});

describe('the route population is a union, so a file two roots both reach enters once', () => {
  /**
   * The number this protects is `files`, and it is the estate's one instrument
   * for spotting a walk that has gone blind — so a number that is wrong for a
   * reason nobody knows is worse than one that is missing.
   *
   * The environment is built from several walks and two of them legitimately
   * overlap: a module walk root can sit **inside** the platform's source root,
   * which is what `packages/platform/src/lifecycle` is today. Measured on the
   * tree before this guard existed: a file added under that directory moved
   * `[divergence] read: files=` by **two**, against one for a file added
   * anywhere else the walk reaches, and zero for a file the walk does not
   * reach at all. Every one of the 19 files there was counted twice.
   */
  it('collapses two reaches of one file to one entry', () => {
    const claim = claimFileOnce((file) => file);
    expect(claim('/repo/packages/platform/src/lifecycle/routes.ts')).toBe(true);
    expect(claim('/repo/packages/platform/src/lifecycle/routes.ts')).toBe(false);
  });

  it('keeps two different files', () => {
    // The guard that collapses everything is indistinguishable from a walk that
    // read one file, and it would print a `files` far more wrong than the one
    // this replaces.
    const claim = claimFileOnce((file) => file);
    expect(claim('/repo/a.ts')).toBe(true);
    expect(claim('/repo/b.ts')).toBe(true);
  });

  it('is keyed on the real path and not on the spelling', () => {
    // Two roots reaching one file reach it under two path strings whenever
    // either root is a symlink — which is what a `git worktree` and a linked
    // `node_modules` both produce. A string comparison lets both through.
    const real = (file: string): string =>
      file.replace('/repo/link/', '/repo/packages/platform/src/');
    const claim = claimFileOnce(real);
    expect(claim('/repo/packages/platform/src/lifecycle/routes.ts')).toBe(true);
    expect(claim('/repo/link/lifecycle/routes.ts')).toBe(false);
  });

  it('falls back to the spelling for a path it cannot resolve', () => {
    // A file deleted between the walk and the read. Collapsing a duplicate is
    // this guard's job; refusing a run is the caller's decision to take, and a
    // throw here would turn a vanished file into an exit nobody asked for.
    const claim = claimFileOnce(() => {
      throw new Error('ENOENT');
    });
    expect(claim('/repo/gone.ts')).toBe(true);
    expect(claim('/repo/gone.ts')).toBe(false);
  });
});

/**
 * The root-registration predicate exists twice, and this is what keeps the two
 * copies from going half-missing (`specs/110-instance-repository/` T138a).
 *
 * `check-port-dependencies.ts` has read a composition root's own spelling —
 * `registerValues(container, { … })`, `container.register({ … })`,
 * `composedModules.contribute({ … })` — since D-45, and the divergence report's
 * **second host** needs the same answer: in a client's instance `composeApp` is
 * the composition root, and `rootSuppliedNames` is what tells *"a root registers
 * it"* from *"nobody registers it"*. Measured on a real scaffolded instance
 * installed from tarballs, with only the module spelling read: an overlay module
 * decorating `commandBus` was reported `unowned-subject`, which is the exact
 * state `registration-owners.ts`' doc block says that function exists to
 * prevent — a finding about the run dressed as one about the tree.
 *
 * `@endora-commerce/cli` therefore exports a copy, and a copy is the shape this
 * estate refuses. **The end state is that this file's becomes an import of the
 * package's**, which is one line; it is not made in the merge request that adds
 * this because feature 117's Phase 6 holds `check-port-dependencies.ts` open.
 * Until it is, this reconciles the two over the shapes a root really writes, so
 * a divergence between them is red rather than silent. The fixture is source
 * text and enters at the top of both (issue #130).
 */
describe('the two copies of `rootRegisteredNames` answer identically', () => {
  const ROOT_SOURCE = `
    import { registerValues } from '@endora-commerce/platform/kernel';

    export function composeApp(options) {
      const container = createRootContainer();
      registerValues(container, {
        redis: options.redis,
        eventBus: new EventBus(),
        'quoted-name': options.quoted,
      });
      container.register({ commandBus: asValue(buildCommandBus()) });
      composedModules.contribute({ salesChannelCodeIdPort: buildChannelPort() });
      // A spread names nothing this analysis can reason about, and both copies
      // must agree about that too — a divergence on the *negative* side is the
      // one a positive-only fixture would miss.
      registerValues(container, { ...options.extras });
      // A module's own spelling is not a root's, and neither copy reads it here.
      ctx.di.register({ blogService: ctx.asClass(BlogService).singleton() });
      return container;
    }
  `;

  it('agrees over every shape a root writes, and over the two it does not', () => {
    const fromCheck = rootRegisteredNamesFromCheck(ROOT_SOURCE, 'composition.ts');
    const fromPackage = rootRegisteredNamesFromPackage(ROOT_SOURCE, 'composition.ts');
    expect([...fromPackage].sort()).toEqual([...fromCheck].sort());
    // Asserted absolutely as well as against each other: two copies that had
    // both stopped reading `contribute` would agree perfectly and be wrong, and
    // D-45's contribution window is where nearly every root-supplied name is.
    expect([...fromPackage].sort()).toEqual([
      'commandBus',
      'eventBus',
      'quoted-name',
      'redis',
      'salesChannelCodeIdPort',
    ]);
    expect(fromPackage).not.toContain('blogService');
  });
});
