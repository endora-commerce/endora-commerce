/**
 * `check:admin-zones` — one red proof per finding, every refusal, and the two
 * directions of its ledger (feature 091, P4a).
 *
 * Every proof enters at the **top**: a fixture is source text, exactly what a
 * real run reads, and the whole chain — the declaration parser, the four site
 * walks, the six classifiers — runs over it. `test/helpers/admin-zones-fixture.ts`
 * is that driver, shared with the inventory so the two cannot come to disagree
 * about what the check does.
 */
import { describe, expect, it } from 'vitest';

import {
  checkAdminZones,
  foreignModuleIdKey,
  readZoneDeclarations,
  translationScopeSites,
  vacuousReason,
  visibilityGateSites,
  zoneContributionSites,
  zoneRenderSites,
  FOREIGN_ID_POPULATIONS,
} from '../../../scripts/check-admin-zones.js';
import { FOREIGN_MODULE_IDS } from '../../../scripts/ledgers/foreign-module-ids.js';
import {
  adminZoneFindings,
  declarationSource,
  runAdminZones,
  type AdminZoneFixture,
} from '../../helpers/admin-zones-fixture.js';

const ZONE = 'product.editor.details.before';
const OTHER_ZONE = 'product.editor.pricing.before';

/** A fixture whose only host renders `ZONE` — the shape every proof varies. */
function baseline(overrides: Partial<AdminZoneFixture> = {}): AdminZoneFixture {
  return {
    declarations: declarationSource([ZONE]),
    files: [
      {
        path: 'admin/src/modules/catalog/ProductEditor.tsx',
        source: `export const E = () => <AdminZone name="${ZONE}" props={{ productId: id }} />;`,
        roles: ['host'],
      },
    ],
    registered: ['catalog', 'inpost', 'assets_library', 'payments'],
    ...overrides,
  };
}

describe('check-admin-zones — the declaration reader', () => {
  it('reads the enum members and the props-map keys out of the real source', () => {
    const parsed = readZoneDeclarations(declarationSource([ZONE, OTHER_ZONE], [ZONE]));
    expect(parsed.zoneNames).toEqual([ZONE, OTHER_ZONE]);
    expect(parsed.propsMapKeys).toEqual([ZONE]);
  });

  it('is the independent author: the enum is read, never computed', () => {
    // A file with no enum yields nothing, which is what the first refusal is
    // for — the check does not fall back to a list of its own.
    expect(readZoneDeclarations('export const nothing = 1;').zoneNames).toEqual([]);
  });
});

describe('check-admin-zones — the site walks', () => {
  it('reads a zone name off <AdminZone> and off useAdminZone', () => {
    const source = [
      `const a = <AdminZone name="${ZONE}" props={{ productId }} />;`,
      `const b = useAdminZone('${OTHER_ZONE}', { productId });`,
    ].join('\n');
    expect(zoneRenderSites(source, 'f.tsx').map((site) => site.zone)).toEqual([ZONE, OTHER_ZONE]);
  });

  it('reads a contribution in both published spellings', () => {
    const source = [
      `zoneComponent('${ZONE}', () => import('./A.js'));`,
      `const raw = { zone: '${OTHER_ZONE}', weight: 0, component: () => import('./B.js') };`,
    ].join('\n');
    expect(zoneContributionSites(source, 'f.ts', 'blog').map((site) => site.zone)).toEqual([
      ZONE,
      OTHER_ZONE,
    ]);
  });

  it('reads a visibility gate only through a predicate bound in the same file', () => {
    const source = [
      'const isVisible = useSurfaceVisibility();',
      "const a = isVisible({ module: 'inpost' });",
      // A `{ module }` that is not handed to the predicate is the nav array's
      // shape and is not a gate — over-reaching here would report a hundred
      // honest declarations as couplings.
      "const nav = [{ to: '/x', module: 'payments' }];",
    ].join('\n');
    expect(visibilityGateSites(source, 'f.tsx')).toEqual([{ line: 2, named: 'inpost' }]);
  });

  it('reads a translation scope, and reports a computed one as unreadable', () => {
    const source = ["useTranslation('inpost');", 'useTranslation(scope);'].join('\n');
    expect(translationScopeSites(source, 'f.tsx').map((site) => site.named)).toEqual([
      'inpost',
      null,
    ]);
  });
});

describe('check-admin-zones — one red proof per finding', () => {
  it('unrendered-zone: a member no host renders', () => {
    const findings = adminZoneFindings(
      baseline({ declarations: declarationSource([ZONE, OTHER_ZONE]) }),
      'unrendered-zone',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe(OTHER_ZONE);
  });

  it('contribution-to-unrendered-zone: named per contribution, not per zone', () => {
    const findings = adminZoneFindings(
      baseline({
        declarations: declarationSource([ZONE, OTHER_ZONE]),
        files: [
          ...baseline().files,
          {
            path: 'packages/modules/price_lists/src/admin/index.ts',
            source: `export const contributions = { zones: [zoneComponent('${OTHER_ZONE}', () => import('./P.js'))] };`,
            roles: ['host'],
            owner: 'price_lists',
          },
        ],
      }),
      'contribution-to-unrendered-zone',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('price_lists');
  });

  it('unpublished-zone: a host naming a string the enum does not carry', () => {
    const findings = adminZoneFindings(
      baseline({
        files: [
          {
            path: 'packages/modules/blog/src/admin/Screen.tsx',
            source: '<AdminZone name="blog.made.up" props={{}} />;',
            roles: ['host'],
          },
          ...baseline().files,
        ],
      }),
      'unpublished-zone',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('blog.made.up');
  });

  it('computed-zone-name: refused rather than skipped', () => {
    const findings = adminZoneFindings(
      baseline({
        files: [
          ...baseline().files,
          {
            path: 'admin/src/modules/orders/OrderDetail.tsx',
            source: 'const c = useAdminZone(ZONE_NAME, props);',
            roles: ['host'],
          },
        ],
      }),
      'computed-zone-name',
    );
    expect(findings).toHaveLength(1);
    // Skipping it would report the zone as rendered by nobody, which is the
    // finding this one exists to keep honest.
    expect(findings[0]?.message).toContain('string literal');
  });

  it('missing-props-type: a member the map does not carry', () => {
    const findings = adminZoneFindings(
      baseline({ declarations: declarationSource([ZONE], []) }),
      'missing-props-type',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe(ZONE);
  });

  describe('foreign-module-id — one proof per population', () => {
    it('a visibility gate naming another module', () => {
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'admin/src/modules/orders/OrderShipmentsTab.tsx',
              source: [
                'const isVisible = useSurfaceVisibility();',
                "const show = isVisible({ module: 'inpost' });",
              ].join('\n'),
              roles: ['admin'],
              owner: 'orders',
            },
          ],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.key).toBe(
        'admin/src/modules/orders/OrderShipmentsTab.tsx:visibility-gate:inpost',
      );
    });

    it("a kit source rendering out of a module's namespace", () => {
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'packages/admin-kit/src/components/asset-picker/AssetPicker.tsx',
              source: "const t = useTranslation('assets_library');",
              roles: ['kit'],
            },
          ],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('R6');
    });

    it("a module screen rendering out of another module's namespace", () => {
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'admin/src/modules/settings/components/ConfigurationReferenceInput.tsx',
              source: "const t = useTranslation('credentials');",
              roles: ['admin'],
              owner: 'settings',
            },
          ],
          registered: ['catalog', 'credentials', 'settings'],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.key).toContain('module-namespace:credentials');
    });

    it('a computed namespace in the kit is a finding, not a skip', () => {
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'packages/admin-kit/src/components/Whatever.tsx',
              source: 'const t = useTranslation(namespace);',
              roles: ['kit'],
            },
          ],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('cannot read');
    });

    it("an admin-ui package rendering out of a module's namespace", () => {
      // Feature 091, P5c. The population is widened **before** P5b moves the
      // shared page-builder chrome and the e-mail builder into
      // `@endora-commerce/page-builder-admin`: on this tree the family set is
      // empty, so the only thing that can show the widening works is a fixture
      // that declares one.
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'packages/page-builder-admin/src/email/EmailEditorPane.tsx',
              source: "const t = useTranslation('cms');",
              roles: ['admin-ui'],
            },
          ],
          registered: ['catalog', 'cms'],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.key).toBe(
        'packages/page-builder-admin/src/email/EmailEditorPane.tsx:module-namespace:cms',
      );
      // The message's owner half is what makes the file's own words honest: an
      // admin-ui package owns no module id, so there is no id it could name
      // legitimately.
      expect(findings[0]?.message).toContain('belongs to no module');
    });

    it('a computed namespace in an admin-ui package is a finding, not a skip', () => {
      // The kit's issue-#113 reasoning over a package that is not the kit: no
      // namespace here can be the file's own, so one this walk cannot read is
      // one it cannot clear.
      const findings = adminZoneFindings(
        baseline({
          files: [
            ...baseline().files,
            {
              path: 'packages/page-builder-admin/src/Chrome.tsx',
              source: 'const t = useTranslation(namespace);',
              roles: ['admin-ui'],
            },
          ],
        }),
        'foreign-module-id',
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('cannot read');
    });

    it("a module gating on its own id is not foreign", () => {
      expect(
        adminZoneFindings(
          baseline({
            files: [
              ...baseline().files,
              {
                path: 'admin/src/modules/orders/OrdersList.tsx',
                source: [
                  'const isVisible = useSurfaceVisibility();',
                  "const show = isVisible({ module: 'orders' });",
                  "const t = useTranslation('orders');",
                ].join('\n'),
                roles: ['admin'],
                owner: 'orders',
              },
            ],
            registered: ['catalog', 'orders'],
          }),
          'foreign-module-id',
        ),
      ).toHaveLength(0);
    });
  });
});

describe('check-admin-zones — the ledger, both directions', () => {
  const fixture = (): AdminZoneFixture =>
    baseline({
      files: [
        ...baseline().files,
        {
          path: 'admin/src/modules/orders/OrderShipmentsTab.tsx',
          source: [
            'const isVisible = useSurfaceVisibility();',
            "const a = isVisible({ module: 'inpost' });",
            "const b = isVisible({ module: 'inpost' });",
          ].join('\n'),
          roles: ['admin'],
          owner: 'orders',
        },
      ],
    });

  const key = 'admin/src/modules/orders/OrderShipmentsTab.tsx:visibility-gate:inpost';

  it('a recorded count that matches the walk is clean', () => {
    expect(
      runAdminZones({ ...fixture(), ledger: { [key]: { sites: 2, reason: 'batch 10' } } }).findings,
    ).toHaveLength(0);
  });

  it('a count below the walk fails — a coupling nobody was asked about', () => {
    const findings = runAdminZones({
      ...fixture(),
      ledger: { [key]: 'batch 10' },
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('records 1 site(s) and the walk found 2');
  });

  it('a count above the walk fails — a number left standing', () => {
    const findings = runAdminZones({
      ...fixture(),
      ledger: { [key]: { sites: 5, reason: 'batch 10' } },
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('records 5 site(s) and the walk found 2');
  });

  it('an entry describing no site at all is stale', () => {
    const result = runAdminZones({
      ...baseline(),
      ledger: { 'admin/src/modules/gone/Gone.tsx:visibility-gate:inpost': 'gone' },
    });
    expect(result.stale).toEqual(['admin/src/modules/gone/Gone.tsx:visibility-gate:inpost']);
    expect(result.findings[0]?.message).toContain('stale direction');
  });

  it('the key survives an edit above the site', () => {
    const site = {
      file: 'admin/src/modules/orders/OrderDetail.tsx',
      line: 197,
      named: 'payments',
      owner: 'orders',
      population: 'visibility-gate',
    } as const;
    expect(foreignModuleIdKey(site)).toBe(foreignModuleIdKey({ ...site, line: 812 }));
  });
});

describe('check-admin-zones — the refusals', () => {
  const complete = {
    zoneNames: 3,
    propsMapKeys: 3,
    hostFiles: 40,
    renders: 7,
    contributions: 0,
    kitFiles: 60,
    translationSites: 200,
    moduleIdCount: 69,
  };

  it('reports nothing to refuse on a complete run', () => {
    expect(vacuousReason(complete)).toBeNull();
  });

  it.each([
    ['no zone name', { zoneNames: 0 }, 'independent author'],
    ['no props-map key', { propsMapKeys: 0 }, 'AdminZonePropsMap'],
    ['no host file', { hostFiles: 0 }, 'no host file'],
    ['no render and no contribution', { renders: 0, contributions: 0 }, 'moved tree'],
    ['no kit source', { kitFiles: 0 }, 'kit-namespace population'],
    ['no useTranslation site', { translationSites: 0 }, 'unwatched tree'],
    ['no module id', { moduleIdCount: 0 }, 'could ever be foreign'],
  ])('refuses a run with %s', (_label, override, fragment) => {
    const reason = vacuousReason({ ...complete, ...override });
    expect(reason).not.toBeNull();
    expect(reason).toContain(fragment);
  });
});

describe('check-admin-zones — the shipped ledger', () => {
  it('records every entry with a retiring condition, and no exemption', () => {
    for (const [key, entry] of Object.entries(FOREIGN_MODULE_IDS)) {
      const reason = typeof entry === 'string' ? entry : entry.reason;
      expect(reason.length, key).toBeGreaterThan(40);
      // An entry that says "this is fine" means the predicate has outgrown its
      // population; every entry here names what removes it.
      expect(/[Rr]etires|repair|move|!\d+/.test(reason), `${key}: ${reason}`).toBe(true);
    }
  });

  it('keys nothing by line number', () => {
    for (const key of Object.keys(FOREIGN_MODULE_IDS)) {
      expect(/:\d+$/.test(key), key).toBe(false);
    }
  });

  // The subject here is the **walk**, not the ledger. A population that drains to
  // zero is this feature's whole purpose — `kit-namespace` emptied on 2026-09-01
  // when !1231 moved `CategoryTreePicker`'s keys to `core` — so asserting that the
  // ledger holds an entry of every kind turns success into a failure, and pressures
  // the next author to keep a stale entry alive to stay green. What must never drain
  // is the check's willingness to *look*: every population keeps a classifier, and a
  // ledger entry may only name one this check can still produce.
  it('classifies every population, so none can stop being looked for', () => {
    expect([...FOREIGN_ID_POPULATIONS].sort()).toEqual([
      'kit-namespace',
      'module-namespace',
      'visibility-gate',
    ]);
  });

  it('files every ledger entry under a population the check still classifies', () => {
    const filed = new Set(
      Object.keys(FOREIGN_MODULE_IDS).map((key) => key.split(':')[1] ?? ''),
    );
    for (const population of filed) {
      expect(FOREIGN_ID_POPULATIONS as readonly string[], population).toContain(population);
    }
  });
});

describe('check-admin-zones — multiplicity is not a finding', () => {
  it('two renders of one zone are legal and expected', () => {
    const result = checkAdminZones(
      {
        zoneNames: [ZONE],
        propsMapKeys: [ZONE],
        renders: [
          { file: 'a.tsx', line: 1, zone: ZONE, via: '<AdminZone>' },
          { file: 'b.tsx', line: 2, zone: ZONE, via: '<AdminZone>' },
        ],
        contributions: [],
        moduleIds: [],
      },
      {},
    );
    expect(result.findings).toHaveLength(0);
  });
});
