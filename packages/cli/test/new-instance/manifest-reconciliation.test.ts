/**
 * §5's missing assertion — **the created tree is exactly §2's manifest**
 * (`specs/110-instance-repository/contracts/instance-tree.md` §2; T137).
 *
 * ## The defect it exists for
 *
 * T137's done-when is *"the created tree is exactly §2's manifest"*, and until
 * this file existed that clause was asserted by nothing. Measured on a real run
 * it was false in four places at once: `backend/src/cli.ts` was omitted (with a
 * reason, so a contract question rather than a slip), `backend/src/migrate.ts`
 * and `backend/src/module-commands/runtime.ts` were written and §2.3 listed
 * neither, and the root manifest had no `generate` script §2.5 requires. Every
 * one of the four is the same shape: a list of files in prose and a list of
 * files in code, with nobody holding them together.
 *
 * ## Both sides are derived, and that is the whole design
 *
 * A list typed twice is what this repository spends its review effort refusing,
 * so neither side of the comparison is written here. The **contract** side is
 * parsed out of `instance-tree.md` §2 itself — every table row's first cell,
 * with `{a,b,c}` expanded and `<deployment>` substituted — so a row added to
 * the contract is a file the command must write, in the same merge request and
 * with no test to edit. The **tree** side is a real {@link planInstance} run,
 * so a file the command starts writing is a row the contract must gain.
 *
 * A path §2 names is accounted for two ways and only two: the plan **writes**
 * it, or the plan **omits** it with a reason (`PlannedOmission`). The second is
 * not a loophole — it is §2.3's own answer for `backend/src/cli.ts`, whose
 * surface the platform does not publish, and it is printed to the client on
 * every run. What it is not is silence.
 *
 * ## The fixtures enter at the top
 *
 * Issue #130. {@link reconcileManifest} takes **contract text** and a **plan**,
 * which are the two things a real run computes first, so every red proof below
 * is one of those two with one line changed — never a pre-classified verdict
 * handed to the last function in the chain. Two of the proofs reproduce two of
 * the four real findings.
 *
 * ## What it refuses rather than passing (issue #113)
 *
 * A reconciliation over an empty side is vacuously clean, and there are three
 * ways to get one without anything else looking wrong: a contract whose §2
 * heading has moved, a §2 that parsed to no path, and a plan that wrote no
 * file. Each is a refusal with a kind of its own and a red proof.
 *
 * ## What it is not
 *
 * It says nothing about a file's **content** — that is T1's question for the
 * platform names in it and the acceptance criterion's for whether the tree
 * runs — and nothing about whether §2 asks for the right files. It answers one
 * question: does the command write what the contract says, and does the
 * contract say what the command writes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { planInstance, type InstancePlan, type PlanInput } from '../../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';
const DEPLOYMENT = 'acme-shop';

/**
 * The contract, found by walking up from this file.
 *
 * Never a relative path written down: this test lives in a package whose
 * directory has already moved once, and `specs/` is the repository's rather
 * than the package's.
 */
function contractPath(): string {
  const relative = join(
    'specs',
    '110-instance-repository',
    'contracts',
    'instance-tree.md',
  );
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(current, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `no ${relative} above ${dirname(fileURLToPath(import.meta.url))} — the contract is ` +
          'this reconciliation\'s other side and there is nothing to reconcile against',
      );
    }
    current = parent;
  }
}

/** A state in which the comparison would be vacuously clean. */
interface Refusal {
  readonly kind: 'no-section' | 'no-declared-path' | 'no-planned-file';
  readonly detail: string;
}

interface ManifestReconciliation {
  readonly declared: readonly string[];
  readonly written: readonly string[];
  /** Written by the command and named by no row of §2. */
  readonly unlisted: readonly string[];
  /** Named by §2 and neither written nor omitted with a reason. */
  readonly unwritten: readonly string[];
  readonly refusals: readonly Refusal[];
}

/**
 * Expand `a/{x,y}.ts` into `a/x.ts` and `a/y.ts`.
 *
 * §2.3 writes the five `module:*` entry points that way, which is one row for
 * five files. The brace group is the contract's own shorthand and is expanded
 * here rather than spelled out five times there.
 */
function expandBraces(path: string): readonly string[] {
  const match = /\{([^}]*)\}/.exec(path);
  if (match === null) return [path];
  return match[1]!
    .split(',')
    .map((alternative) => alternative.trim())
    .flatMap((alternative) =>
      expandBraces(`${path.slice(0, match.index)}${alternative}${path.slice(match.index + match[0].length)}`),
    );
}

/**
 * Every path §2 names, from the contract's own tables.
 *
 * A row's first cell, when it holds exactly one backticked value that **is a
 * path**: no whitespace, no `:`, and either a `/` in it or an extension at the
 * end. Heading rows and the `| --- |` separator produce nothing, and so do the
 * two tables in §2 whose first column is not a path — §2.5's script names
 * (`migrate`, `generate`, `module:install`) and §2.6's artefact descriptions.
 *
 * The predicate is a shape rather than a section list, because a section list
 * would be a second statement of which subsections §2 has and would go stale
 * the next time one is added — which is exactly what §2.4a did to this
 * contract.
 */
export function declaredManifestPaths(
  contract: string,
  deployment: string,
): { paths: readonly string[]; refusals: readonly Refusal[] } {
  const start = contract.indexOf('## §2 — The file manifest');
  const end = contract.indexOf('\n## §3');
  if (start === -1 || end === -1 || end < start) {
    return {
      paths: [],
      refusals: [
        {
          kind: 'no-section',
          detail:
            'the contract has no `## §2 — The file manifest` section ending before `## §3`, ' +
            'so there is no manifest to reconcile the plan against',
        },
      ],
    };
  }
  const paths = new Set<string>();
  for (const line of contract.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1]?.trim() ?? '';
    const quoted = /^`([^`]+)`$/.exec(cell);
    if (quoted === null) continue;
    const value = quoted[1]!;
    if (/[\s:]/.test(value)) continue;
    if (!value.includes('/') && !/\.[A-Za-z0-9]+$/.test(value)) continue;
    for (const expanded of expandBraces(value)) {
      paths.add(expanded.split('<deployment>').join(deployment));
    }
  }
  if (paths.size === 0) {
    return {
      paths: [],
      refusals: [
        {
          kind: 'no-declared-path',
          detail:
            'the `## §2` section holds no table row naming a path. A comparison against an ' +
            'empty manifest passes whatever the command writes',
        },
      ],
    };
  }
  return { paths: [...paths].sort(), refusals: [] };
}

/**
 * The two sides, compared.
 *
 * Both enter as values a real run produces — the contract's text and a plan —
 * so a proof can change either one line at a time.
 */
export function reconcileManifest(
  contract: string,
  plan: InstancePlan,
  deployment: string,
): ManifestReconciliation {
  const { paths: declared, refusals } = declaredManifestPaths(contract, deployment);
  const written = plan.files.map((file) => file.path).sort();
  // A member the command omitted is named as a **directory** (`admin/`), and a
  // file it omitted as itself (`backend/src/cli.ts`). Both account for a §2 row
  // without writing it, which is the honest third state and the one §2.3 relies
  // on: the client is told, on every run.
  const omitted = plan.omitted.map((entry) => entry.path);
  const accounted = (path: string): boolean =>
    written.includes(path) ||
    omitted.some((entry) => path === entry || path.startsWith(entry));
  return {
    declared,
    written,
    unlisted: written.filter((path) => !declared.includes(path)),
    unwritten: declared.filter((path) => !accounted(path)),
    refusals:
      written.length === 0
        ? [
            ...refusals,
            {
              kind: 'no-planned-file' as const,
              detail:
                'the plan writes no file, so every row of §2 reads as unwritten and nothing ' +
                'the command writes can be unlisted',
            },
          ]
        : refusals,
  };
}

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: DEPLOYMENT,
    deployment: DEPLOYMENT,
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: undefined,
    // The version is the module package's **own**, and deliberately not the
    // platform's above: a range over another package's version is one no
    // registry can satisfy, and a fixture in which the two agree cannot tell
    // the right derivation from the wrong one.
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    // Every member present: §2 is the manifest of a **complete** instance, and
    // a fixture with a member omitted would report that member's rows as
    // unwritten — a finding about the fixture dressed as one about the command.
    adminShellVersion: '4.5.6',
    adminKitVersion: '4.5.6',
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map([
      ['@docusaurus/core', '^3.10.0'],
      ['@docusaurus/preset-classic', '^3.10.0'],
    ]),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['@mikro-orm/postgresql', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['ioredis', '^5.10.1'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    ...overrides,
  };
}

/**
 * The plan the command really builds, in **both** registry modes.
 *
 * `.npmrc` is §2.1's one conditional row — written only under `--registry` —
 * so a single-mode fixture would report it as unwritten for ever. The union is
 * what the contract's manifest describes: every file the command can write.
 */
function completePlan(): InstancePlan {
  const bare = planInstance(planInput());
  const withRegistry = planInstance(
    planInput({ registry: 'https://registry.example.com', npmrc: '@endora-commerce:registry=…\n' }),
  );
  const byPath = new Map(bare.files.map((file) => [file.path, file] as const));
  for (const file of withRegistry.files) byPath.set(file.path, file);
  return { ...bare, files: [...byPath.values()] };
}

const CONTRACT = readFileSync(contractPath(), 'utf8');

describe('the created tree is exactly §2 of instance-tree.md', () => {
  it('writes no file §2 does not name', () => {
    const { unlisted } = reconcileManifest(CONTRACT, completePlan(), DEPLOYMENT);
    expect(unlisted, 'these files are written and no row of §2 names them').toEqual([]);
  });

  it('names no file it neither writes nor omits with a reason', () => {
    const { unwritten } = reconcileManifest(CONTRACT, completePlan(), DEPLOYMENT);
    expect(unwritten, 'these rows of §2 are neither written nor omitted').toEqual([]);
  });

  /**
   * §2.3's omission, asserted as the third state rather than assumed.
   *
   * `backend/src/cli.ts` is in the contract, is not written, and is reported —
   * so the assertion above passes for a reason a reader can check, and a
   * command that quietly stopped printing the omission would fail it.
   */
  it('accounts for a contract row it does not write by printing the omission', () => {
    const plan = completePlan();
    expect(plan.omitted.map((entry) => entry.path)).toContain('backend/src/cli.ts');
    for (const omission of plan.omitted) expect(omission.reason.length).toBeGreaterThan(40);
  });

  it('reads a real manifest — not an empty section that would pass anything', () => {
    const { declared, written } = reconcileManifest(CONTRACT, completePlan(), DEPLOYMENT);
    // The numbers are not written down (D-100): what is asserted is that both
    // sides are populated and that the five `module:*` rows expanded.
    expect(declared.length).toBeGreaterThan(15);
    expect(written.length).toBeGreaterThan(15);
    expect(declared).toContain('backend/src/module-commands/install.ts');
    expect(declared).toContain('backend/src/module-commands/status.ts');
    expect(declared).toContain(`apps/${DEPLOYMENT}/divergence.ts`);
  });
});

describe('it goes red on each side, with the fixture entering as the contract or the plan', () => {
  /** The real finding of 2026-09-11: a file written and listed nowhere. */
  it('a file the contract does not name is `unlisted`', () => {
    const without = CONTRACT.split('\n')
      .filter((line) => !line.startsWith('| `backend/src/migrate.ts`'))
      .join('\n');
    const { unlisted } = reconcileManifest(without, completePlan(), DEPLOYMENT);
    expect(unlisted).toEqual(['backend/src/migrate.ts']);
  });

  /** The other direction: a row nothing answers. */
  it('a row the command neither writes nor omits is `unwritten`', () => {
    const extra = CONTRACT.replace(
      '| `backend/tsconfig.json` |',
      '| `backend/src/telemetry.ts` | wiring | invented for this proof |\n| `backend/tsconfig.json` |',
    );
    const { unwritten } = reconcileManifest(extra, completePlan(), DEPLOYMENT);
    expect(unwritten).toEqual(['backend/src/telemetry.ts']);
  });

  it('the brace group really expands — one row is five files', () => {
    const { paths } = declaredManifestPaths(
      '## §2 — The file manifest\n| `a/{one,two}.ts` | wiring | x |\n## §3',
      DEPLOYMENT,
    );
    expect(paths).toEqual(['a/one.ts', 'a/two.ts']);
  });

  it('`<deployment>` is substituted, not compared literally', () => {
    const { paths } = declaredManifestPaths(
      '## §2 — The file manifest\n| `apps/<deployment>/divergence.ts` | client | x |\n## §3',
      'beta',
    );
    expect(paths).toEqual(['apps/beta/divergence.ts']);
  });
});

describe('it refuses a vacuous pass rather than reporting clean', () => {
  it('a contract with no §2 section is `no-section`', () => {
    const { refusals } = reconcileManifest('# nothing here\n', completePlan(), DEPLOYMENT);
    expect(refusals.map((refusal) => refusal.kind)).toEqual(['no-section']);
  });

  it('a §2 section naming no path is `no-declared-path`', () => {
    const { refusals } = reconcileManifest(
      '## §2 — The file manifest\n| Path | Kind |\n| --- | --- |\n## §3\n',
      completePlan(),
      DEPLOYMENT,
    );
    expect(refusals.map((refusal) => refusal.kind)).toEqual(['no-declared-path']);
  });

  it('a plan that writes nothing is `no-planned-file`', () => {
    const empty: InstancePlan = { ...completePlan(), files: [] };
    const { refusals } = reconcileManifest(CONTRACT, empty, DEPLOYMENT);
    expect(refusals.map((refusal) => refusal.kind)).toEqual(['no-planned-file']);
  });

  it('the real run raises none of the three', () => {
    expect(reconcileManifest(CONTRACT, completePlan(), DEPLOYMENT).refusals).toEqual([]);
  });
});
