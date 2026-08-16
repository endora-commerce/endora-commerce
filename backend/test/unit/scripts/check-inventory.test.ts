import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyzeSource as channelAnalyze } from '../../../scripts/check-channel-resolution.js';
import { analyzeSource as commandCoverageAnalyze } from '../../../scripts/check-command-coverage.js';
import { analyzeSource as containerAnalyze } from '../../../scripts/check-container-imports.js';
import { checkDocument } from '../../../scripts/check-doc-snippets.js';
import { analyzeSource as classificationAnalyze } from '../../../scripts/check-entity-tenant-classification.js';
import { violationsOf } from '../../../scripts/check-entry-scope.js';
import { findUntranslatedErrorCodes } from '../../../scripts/check-error-translations.js';
import {
  analyzeSource as boundaryAnalyze,
  isViolation,
} from '../../../scripts/check-kernel-boundary.js';
import { compareArtifact } from '../../../scripts/check-overlay-determinism.js';
import { checkPortCatches } from '../../../scripts/check-port-catches.js';
import { findViolations } from '../../../scripts/check-port-dependencies.js';
import { checkSubscribeSeam } from '../../../scripts/check-subscribe-seam.js';
import { analyzeSource as hardcodedAnalyze } from '../../../scripts/i18n-hardcoded-strings.js';
import { createShellCheckFixture } from '../../helpers/shell-check-fixture.js';

/**
 * The inventory of static checks, and the one property none of them had
 * (issue #113).
 *
 * Six checks were found weaker than their own description in a single week, and
 * the common cause was not carelessness: **a green result cannot be told apart
 * from a check that looked at nothing**, and nothing in the repository forced
 * the distinction. Each of the six was green while blind — one matched 4 of 492
 * enforcement sites, one had no ratchet at all, one scanned a file suffix rather
 * than a rule.
 *
 * So this file is the enforcement point for the convention, and it does three
 * things a "does a test file exist?" assertion cannot:
 *
 *   1. **It enumerates.** Every `backend/scripts/check-*.ts` and every
 *      `scripts/check-*.sh` must appear below, and every entry must name a file
 *      that exists — a two-way ratchet, so a new check cannot arrive unlisted
 *      and a deleted one cannot linger.
 *   2. **It drives every check red, here, on synthetic input.** `red()` is not a
 *      description of a fixture: it runs the check's own analysis over an input
 *      the tree does not contain and asserts a finding comes back. A check that
 *      stops seeing its own violation shape fails this file even if its
 *      companion test was deleted in the same commit.
 *   3. **It pins where each check runs and how it refuses a vacuous pass**, and
 *      compares that against `.gitlab-ci.yml` — a check that quietly leaves the
 *      job, or joins it, has to say so here.
 *
 * The companion test named by each entry is where the *shapes* live: this file
 * proves a check can go red at all, that one proves it goes red on everything it
 * claims to refuse. Adding a check means writing both.
 *
 * Scope: the `check-*` **scripts**. The tests that act as gates —
 * `harness-parity`, `permission-inventory`, `registered-bundles-shape`,
 * `migrations-registry`, `fk-dependency-drift` — are not enumerated here,
 * because a test is already something the suite runs and reports; what they need
 * is the same red-first fixture, which each keeps next to itself (the permission
 * scanner's lives in `test/unit/admin_roles/permission-inventory-scanner.test.ts`,
 * written after its regex matched 4 sites out of 492).
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');
const read = (repoRelative: string): string => readFileSync(join(REPO_ROOT, repoRelative), 'utf8');

/** How a check refuses to report a pass over an input it never read. */
type VacuousGuard =
  /** Exits 2 — distinct from both "clean" (0) and "violations found" (1). */
  | 'exit-2'
  /** Returns a verdict its caller turns into a failure; it never exits itself. */
  | 'verdict';

interface CheckEntry {
  /** Path relative to the repository root. */
  readonly script: string;
  /** The package script that runs it, or `null` when it is only invoked directly. */
  readonly npmScript: string | null;
  /** Which CI job runs it. `none` is a statement, not an oversight — say why. */
  readonly job: 'quality' | 'quality:static' | 'none';
  /** Where the shapes it refuses are enumerated. */
  readonly companionTest: string;
  readonly vacuousGuard: VacuousGuard;
  /** Runs the check over synthetic input it does not otherwise meet; must find something. */
  readonly red: () => number;
}

// --- fixtures the red proofs run on ----------------------------------------

const MODULE_FILE = join(BACKEND_ROOT, 'src/modules/blog/backend.ts');
const SEARCH_ENTITY = join(BACKEND_ROOT, 'src/modules/search/entities/search-phrase-record.entity.ts');
const CROSS_MODULE_RELATION = [
  "import { Category } from '../../catalog/entities/category.entity.js';",
  '@Entity()',
  'export class SearchPhraseRecord {',
  '  @ManyToOne(() => Category, { fieldName: "category_id" })',
  '  category!: Category;',
  '}',
].join('\n');

const UNAUDITED_WRITE = `
  export class ThingService {
    constructor(private em: () => any) {}
    async rename(id: string) {
      const em = this.em();
      await em.persistAndFlush({ id });
    }
  }`;

const PORT_CATCH_TREE = new Map([
  [
    'modules/promotions/backend.ts',
    "export function registerModule(ctx) { ctx.di.providePort('promotionService', x); }",
  ],
  [
    'modules/carts/services/cart-admin-service.ts',
    'try { await this.deps.promotionService.applyToCart({}); } catch { return 0; }',
  ],
]);

const DRIFTED_DOC = [
  '# Doc',
  '',
  '<!-- verbatim-from: backend/src/example.ts -->',
  '```ts',
  'export function greet(name: string, extra: number): string {',
  '```',
].join('\n');

function docReader(path: string): string {
  return path.endsWith('example.ts')
    ? 'export function greet(name: string): string {\n'
    : DRIFTED_DOC;
}

/** Runs one shell check over a fixture that violates it; 1 when it goes red. */
function shellRed(script: string, prepare: (f: ReturnType<typeof createShellCheckFixture>) => void): number {
  const fixture = createShellCheckFixture();
  try {
    prepare(fixture);
    return fixture.run(script).status === 1 ? 1 : 0;
  } finally {
    fixture.cleanup();
  }
}

// --- the inventory ----------------------------------------------------------

const CHECKS: readonly CheckEntry[] = [
  {
    script: 'backend/scripts/check-channel-resolution.ts',
    npmScript: 'channel:resolution',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-channel-resolution.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      channelAnalyze(
        "const code = request.headers['x-sales-channel'];",
        'modules/catalog/services/pricing.service.ts',
      ).length,
  },
  {
    script: 'backend/scripts/check-command-coverage.ts',
    npmScript: 'check:command-coverage',
    job: 'quality',
    companionTest: 'backend/test/unit/commands/check-command-coverage.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      commandCoverageAnalyze('src/modules/catalog/services/thing.service.ts', UNAUDITED_WRITE)
        .length,
  },
  {
    script: 'backend/scripts/check-container-imports.ts',
    npmScript: 'check:container-imports',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/container-import-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () => containerAnalyze("import { asClass } from 'awilix';\n", MODULE_FILE).length,
  },
  {
    script: 'backend/scripts/check-doc-snippets.ts',
    npmScript: 'check:doc-snippets',
    job: 'quality',
    companionTest: 'backend/test/unit/docs/check-doc-snippets.test.ts',
    vacuousGuard: 'exit-2',
    red: () => checkDocument('d.md', docReader).length,
  },
  {
    script: 'backend/scripts/check-entity-tenant-classification.ts',
    npmScript: null,
    job: 'quality',
    companionTest: 'backend/test/unit/tenancy/classification-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      classificationAnalyze(
        '@Entity({ tableName: "widgets" })\nexport class Widget {}',
        'src/modules/catalog/entities/widget.ts',
      ).filter((f) => f.classifications.length !== 1).length,
  },
  {
    script: 'backend/scripts/check-entry-scope.ts',
    npmScript: 'check:entry-scope',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/entry-scope-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      violationsOf([
        {
          file: '/repo/backend/src/modules/search/scripts/reindex.ts',
          kind: 'cli',
          scoped: false,
        },
      ]).length,
  },
  {
    script: 'backend/scripts/check-error-translations.ts',
    npmScript: 'check:error-translations',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-error-translations.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      findUntranslatedErrorCodes({
        keys: { BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' } },
        readBundle: () => ({}),
      }).length,
  },
  {
    script: 'backend/scripts/check-kernel-boundary.ts',
    npmScript: 'check:kernel-boundary',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/boundary-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () => boundaryAnalyze(CROSS_MODULE_RELATION, SEARCH_ENTITY).filter(isViolation).length,
  },
  {
    script: 'backend/scripts/check-overlay-determinism.ts',
    npmScript: 'overlay:check',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/check-overlay-determinism.test.ts',
    vacuousGuard: 'verdict',
    red: () => (compareArtifact('/repo/x.generated.ts', 'rendered\n', () => 'stale\n').ok ? 0 : 1),
  },
  {
    script: 'backend/scripts/check-port-catches.ts',
    npmScript: 'check:port-catches',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-catch-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () => checkPortCatches({ sources: PORT_CATCH_TREE }, {}).violations.length,
  },
  {
    script: 'backend/scripts/check-port-dependencies.ts',
    npmScript: 'check:port-dependencies',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/port-dependency-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      findViolations({
        resolutions: [
          {
            moduleId: 'blog',
            name: 'requireAdmin',
            file: '/repo/backend/src/modules/blog/backend.ts',
            line: 1,
            kind: 'deferred',
            site: 'call',
          },
        ],
        owners: new Map([['requireAdmin', 'auth']]),
        dependencies: new Map([['blog', []]]),
      }).length,
  },
  {
    script: 'backend/scripts/check-subscribe-seam.ts',
    npmScript: 'check:subscribe-seam',
    job: 'quality',
    companionTest: 'backend/test/unit/kernel/subscribe-seam-check.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      checkSubscribeSeam(
        {
          sources: new Map([
            [
              'modules/inventory/services/low-stock-alert-service.ts',
              "eventBus.on('inventory.adjusted.v1', (p) => this.handle(p));",
            ],
          ]),
        },
        {},
      ).violations.length,
  },
  {
    // Ran in no job until issue #116. The admin SPA carries 274 findings, so
    // `--strict` would have failed the build on standing debt rather than on a
    // regression; it runs against a per-file baseline instead, two-way like
    // every other ledger here.
    script: 'backend/scripts/i18n-hardcoded-strings.ts',
    npmScript: 'i18n:hardcoded',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/i18n-hardcoded-strings.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      hardcodedAnalyze(
        'export const A = () => <Button>Save changes</Button>;\n',
        '/repo/admin/src/a.tsx',
      ).length,
  },
  {
    script: 'scripts/check-naming.sh',
    npmScript: 'check:naming',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      shellRed('check-naming.sh', (fixture) => {
        fixture.write('backend/src/modules/BadName/thing.ts', 'export const a = 1;\n');
        fixture.lists(['backend/src/modules/BadName/thing.ts']);
      }),
  },
  {
    script: 'scripts/check-language.sh',
    npmScript: 'check:language',
    job: 'quality:static',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      shellRed('check-language.sh', (fixture) => {
        // A template literal, not a quoted string: this file is itself scanned
        // by the check, and its citation blanking strips a backticked run.
        fixture.write(
          'backend/src/modules/orders/order-service.ts',
          `// Zwraca zamówienie klienta.\nexport const a = 1;\n`,
        );
      }),
  },
  {
    // In no job until issue #116, on the grounds that it measures an installed
    // `node_modules` — which the `quality` job installs in `before_script` and
    // always has. The reason held only for `quality:static`, whose image is
    // deliberately toolchain-free, and it was written as if it held for both.
    script: 'scripts/check-pdfmake-footprint.sh',
    npmScript: 'check:pdfmake-footprint',
    job: 'quality',
    companionTest: 'backend/test/unit/scripts/shell-checks.test.ts',
    vacuousGuard: 'exit-2',
    red: () =>
      shellRed('check-pdfmake-footprint.sh', (fixture) => {
        fixture.installPdfmake(40 * 1024 * 1024);
      }),
  },
];

// --- the enumeration --------------------------------------------------------

function scriptsMatching(dir: string, pattern: RegExp, prefix: string): string[] {
  return readdirSync(join(REPO_ROOT, dir))
    .filter((name) => pattern.test(name))
    .map((name) => `${prefix}${name}`)
    .sort();
}

describe('every static check is inventoried', () => {
  const listed = new Set(CHECKS.map((c) => c.script));

  it('names every check script in the tree', () => {
    const onDisk = [
      ...scriptsMatching('backend/scripts', /^check-.*\.ts$/, 'backend/scripts/'),
      ...scriptsMatching('scripts', /^check-.*\.sh$/, 'scripts/'),
    ];
    expect(onDisk.filter((script) => !listed.has(script))).toEqual([]);
  });

  it('names nothing that has been deleted or moved', () => {
    expect(CHECKS.filter((c) => !existsSync(join(REPO_ROOT, c.script))).map((c) => c.script)).toEqual(
      [],
    );
  });

  it('covers every check:* package script', () => {
    const backendScripts = JSON.parse(read('backend/package.json')) as {
      scripts: Record<string, string>;
    };
    const rootScripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const declared = [
      ...Object.keys(backendScripts.scripts),
      ...Object.keys(rootScripts.scripts),
    ].filter((name) => name.startsWith('check:'));
    const inventoried = new Set(CHECKS.map((c) => c.npmScript));
    expect(declared.filter((name) => !inventoried.has(name))).toEqual([]);
  });
});

describe('every check can go red', () => {
  // The heart of this file. Each proof runs the check's own analysis over an
  // input the repository does not contain: a check whose reach silently
  // narrows — a regex that stops matching, a walk scoped to a filename, an
  // alias it cannot follow — fails here, in the suite a developer runs, rather
  // than at the next incident.
  for (const check of CHECKS) {
    it(`${check.script} reports a violation on a synthetic fixture`, () => {
      expect(check.red()).toBeGreaterThan(0);
    });
  }
});

describe('every check refuses a vacuous pass', () => {
  for (const check of CHECKS) {
    it(`${check.script} carries the guard the inventory claims`, () => {
      const source = read(check.script);
      // Presence, not behaviour: the behavioural half is the companion test,
      // which runs the check over an empty input and reads the exit code.
      expect(source, `${check.script} names no vacuous-pass guard`).toMatch(/vacuous/);
      if (check.vacuousGuard === 'exit-2') {
        expect(source, `${check.script} should exit 2, not 0 or 1`).toMatch(/exit\(2\)|exit 2/);
      }
    });
  }
});

describe('every check has a companion test that exercises it', () => {
  for (const check of CHECKS) {
    it(`${check.script} → ${check.companionTest}`, () => {
      expect(existsSync(join(REPO_ROOT, check.companionTest))).toBe(true);
      const test = read(check.companionTest);
      const basename = check.script.slice(check.script.lastIndexOf('/') + 1);
      const stem = basename.replace(/\.(ts|sh)$/, '');
      // The test must actually name the script — a file that merely sits at the
      // path proves nothing, which is the failure mode this whole file is about.
      expect(test, `${check.companionTest} never mentions ${stem}`).toContain(stem);
    });
  }
});

describe('the inventory agrees with the CI jobs', () => {
  const ci = read('.gitlab-ci.yml').split('\n');

  /**
   * The commands a job runs — the `- …` entries of its block, comments
   * dropped. Slicing the raw text between two job headers reads the prose
   * around them too, and those comments name half the checks: it made
   * `check:naming` look like part of the `quality` job because the paragraph
   * above `quality:static` mentions it.
   */
  function jobCommands(job: string): string {
    const start = ci.indexOf(`${job}:`);
    if (start === -1) return '';
    const rest = ci.slice(start + 1);
    const end = rest.findIndex((line) => /^\S/.test(line));
    return rest
      .slice(0, end === -1 ? rest.length : end)
      .filter((line) => line.trim().startsWith('- '))
      .join('\n');
  }

  const qualityBlock = jobCommands('quality');
  const staticBlock = jobCommands('quality:static');

  const mentions = (block: string, check: CheckEntry): boolean => {
    const basename = check.script.slice(check.script.lastIndexOf('/') + 1);
    return block.includes(basename) || (check.npmScript !== null && block.includes(check.npmScript));
  };

  it('reads a quality job and a quality:static job out of the pipeline', () => {
    expect(qualityBlock.length).toBeGreaterThan(300);
    expect(staticBlock.length).toBeGreaterThan(50);
  });

  for (const check of CHECKS) {
    it(`${check.script} runs in ${check.job}`, () => {
      expect(mentions(qualityBlock, check), 'quality job').toBe(check.job === 'quality');
      expect(mentions(staticBlock, check), 'quality:static job').toBe(check.job === 'quality:static');
    });
  }
});
