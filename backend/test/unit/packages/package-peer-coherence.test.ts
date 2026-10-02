import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';

/**
 * What a manifest declares must not be able to produce pnpm's *"Issues with
 * peer dependencies found"* in a project that only installs the release.
 *
 * ## The defect this was written from
 *
 * `npx create-endora-commerce` printed that block to every stranger, twice —
 * once for the temporary host `endora install` provisions and once for the
 * instance — measured on the published `0.100.2`. Three causes, and the two
 * that are properties of a manifest are held here.
 *
 * **A lockstep family declared two ways.** Every `@tiptap/*` package peers on
 * its siblings at its own **exact** version. `@endora-commerce/cms-components`
 * and the storefront declared the five extensions at exactly `3.31.3` and
 * `@tiptap/core`, `react` and `starter-kit` at `^3.31.3`, so the day `3.31.4`
 * was published a fresh resolution took the carets forward and left the pins
 * behind: four extensions asking for a core that was no longer in the graph.
 * The workspace lockfile hid it, because a lockfile freezes the carets too.
 * The rule is derived rather than keyed on a scope: for every dependency a
 * manifest declares, the **installed** manifest of that dependency says which
 * siblings it pins exactly, and a manifest that also declares such a sibling
 * must declare it with the same range.
 *
 * **A required peer only the package's own tests reach.** A required peer is
 * installed by pnpm into every project that installs the package and declares
 * nothing itself, which is what the install host is. `@endora-commerce/test-kit`
 * required `vitest` while no file it ships names it — only its own test files
 * and vitest configs do, and those are covered by its `devDependencies`. So the
 * host installed a test runner, the runner brought `vite@8`, and pnpm bound
 * `@endora-commerce/admin-shell`'s optional `vite@^7` peer to it. The module
 * generator already refuses this shape for a module package (a test-file reach
 * contributes no peer); this holds it for the hand-written manifests too.
 *
 * ## What this cannot see
 *
 * The third cause — `@endora-commerce/mod-auth` peering on `fastify-plugin@^5`
 * while `@fastify/cookie` had moved its own dependency to `^6`, and pnpm
 * handing an undeclared peer the highest version in the graph — is a fact about
 * what the registry serves on the day of the install. No manifest in this tree
 * states it and the lockfile, frozen, contradicts it. Only a fresh install from
 * the packed tarballs shows it, which is the acceptance run's subject.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

type Ranges = Readonly<Record<string, string>>;

const DECLARING_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

function rangesIn(manifest: Readonly<Record<string, unknown>>, field: string): Ranges {
  const block = manifest[field];
  if (block === null || typeof block !== 'object') return {};
  return Object.fromEntries(
    Object.entries(block as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Every range a manifest declares for a name, across the four declaring fields. */
function declaredRanges(manifest: Readonly<Record<string, unknown>>): ReadonlyMap<string, readonly string[]> {
  const declared = new Map<string, string[]>();
  for (const field of DECLARING_FIELDS) {
    for (const [name, range] of Object.entries(rangesIn(manifest, field))) {
      const ranges = declared.get(name) ?? [];
      if (!ranges.includes(range)) ranges.push(range);
      declared.set(name, ranges);
    }
  }
  return declared;
}

/** `3.31.3`, `1.0.0-rc.1` — one version, not a range. */
function isExactVersion(range: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range);
}

/**
 * The pairs a manifest declares two ways although one pins the other exactly.
 *
 * `peersOf` answers with the peers the **installed** copy of a declared
 * dependency carries, or `null` when it is not installed (an optional peer).
 */
export function lockstepSkews(
  declared: ReadonlyMap<string, readonly string[]>,
  peersOf: (name: string) => Ranges | null,
): readonly string[] {
  const skews: string[] = [];
  for (const [name, ranges] of declared) {
    const peers = peersOf(name);
    if (peers === null) continue;
    for (const [peer, peerRange] of Object.entries(peers)) {
      if (!isExactVersion(peerRange)) continue;
      const siblingRanges = declared.get(peer);
      if (siblingRanges === undefined) continue;
      const same =
        ranges.length === siblingRanges.length &&
        ranges.every((range) => siblingRanges.includes(range));
      if (!same) {
        skews.push(
          `${name}@${ranges.join(' | ')} pins ${peer} exactly, which is declared ${siblingRanges.join(' | ')}`,
        );
      }
    }
  }
  return skews.sort();
}

/** The required third-party peers a package's own tests reach and nothing it ships does. */
export function testOnlyRequiredPeers(input: {
  readonly requiredPeers: readonly string[];
  readonly shippedReach: ReadonlySet<string>;
  readonly testReach: ReadonlySet<string>;
}): readonly string[] {
  return input.requiredPeers
    .filter((name) => !input.shippedReach.has(name) && input.testReach.has(name))
    .sort();
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`; relative and `node:` → `null`. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Every package a source file names in a module-specifier position — type-only
 * forms included, because a package whose types a shipped declaration names is
 * one the consumer must resolve as well.
 */
export function specifiersOf(fileName: string, text: string): readonly string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const add = (node: ts.Node | undefined): void => {
    if (node === undefined || !ts.isStringLiteralLike(node)) return;
    const name = packageNameOf(node.text);
    if (name !== null) names.add(name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names];
}

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;

function filesUnder(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE_FILE.test(entry) && !entry.endsWith('.d.ts')) found.push(path);
    }
  };
  walk(dir);
  return found;
}

function reachOf(files: readonly string[]): ReadonlySet<string> {
  return new Set(files.flatMap((file) => specifiersOf(file, readFileSync(file, 'utf8'))));
}

interface Member {
  readonly dir: string;
  readonly name: string;
  readonly family: boolean;
  readonly manifest: Readonly<Record<string, unknown>>;
}

function members(): readonly Member[] {
  return classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members;
}

function installedPeersOf(member: Member, name: string): Ranges | null {
  const path = join(member.dir, 'node_modules', name, 'package.json');
  if (!existsSync(path)) return null;
  return rangesIn(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>, 'peerDependencies');
}

function requiredThirdPartyPeers(member: Member, workspaceNames: ReadonlySet<string>): readonly string[] {
  const meta = member.manifest['peerDependenciesMeta'];
  const optional = (name: string): boolean => {
    if (meta === null || typeof meta !== 'object') return false;
    const entry = (meta as Record<string, unknown>)[name];
    return (
      entry !== null &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>)['optional'] === true
    );
  };
  return Object.keys(rangesIn(member.manifest, 'peerDependencies')).filter(
    (name) => !workspaceNames.has(name) && !optional(name),
  );
}

describe('lockstepSkews', () => {
  const peersOf = (name: string): Ranges | null =>
    ({
      'family-extension': { 'family-core': '3.31.3' },
      'family-core': {},
      'ranged-plugin': { host: '^5.0.0' },
      host: {},
    })[name] ?? null;

  it('reports a dependency pinned exactly beside the sibling it pins, declared with a caret', () => {
    const declared = new Map([
      ['family-extension', ['3.31.3']],
      ['family-core', ['^3.31.3']],
    ]);
    expect(lockstepSkews(declared, peersOf)).toEqual([
      'family-extension@3.31.3 pins family-core exactly, which is declared ^3.31.3',
    ]);
  });

  it('accepts the family declared one way, whichever way that is', () => {
    for (const range of ['^3.31.3', '3.31.3']) {
      const declared = new Map([
        ['family-extension', [range]],
        ['family-core', [range]],
      ]);
      expect(lockstepSkews(declared, peersOf)).toEqual([]);
    }
  });

  it('does not judge a peer declared as a range, an undeclared sibling or an uninstalled dependency', () => {
    expect(
      lockstepSkews(
        new Map([
          ['ranged-plugin', ['1.0.0']],
          ['host', ['^5.1.0']],
        ]),
        peersOf,
      ),
    ).toEqual([]);
    expect(lockstepSkews(new Map([['family-extension', ['3.31.3']]]), peersOf)).toEqual([]);
    expect(
      lockstepSkews(
        new Map([
          ['not-installed', ['1.0.0']],
          ['family-core', ['^3.31.3']],
        ]),
        peersOf,
      ),
    ).toEqual([]);
  });
});

describe('testOnlyRequiredPeers', () => {
  it('reports a required peer only the test files name, and nothing a shipped file names', () => {
    expect(
      testOnlyRequiredPeers({
        requiredPeers: ['runner', 'driver', 'unreached'],
        shippedReach: new Set(['driver']),
        testReach: new Set(['runner', 'driver']),
      }),
    ).toEqual(['runner']);
  });
});

describe('specifiersOf', () => {
  it('reads every module-specifier position, type-only forms included', () => {
    const text = [
      "import { a } from '@scope/value/sub';",
      "import type { B } from 'type-only';",
      "export * from 'reexported';",
      "import './relative.js';",
      "import { readFileSync } from 'node:fs';",
      "type G = import('type-position').G;",
      "async function h() { await import('dynamic'); }",
      "// import { c } from 'commented';",
    ].join('\n');
    expect([...specifiersOf('x.ts', text)].sort()).toEqual([
      '@scope/value',
      'dynamic',
      'reexported',
      'type-only',
      'type-position',
    ]);
  });
});

describe('a manifest cannot produce an unmet peer in a project that only installs the release', () => {
  it('derives a population that reaches the applications and the published packages', () => {
    expect(repoRoot).not.toBeNull();
    const names = members().map((member) => member.name);
    expect(names).toContain('storefront');
    expect(names).toContain('@endora-commerce/cms-components');
    expect(names).toContain('@endora-commerce/test-kit');
  });

  it('reads installed manifests, so the lockstep rule is not judging an empty tree', () => {
    const read = members().flatMap((member) =>
      [...declaredRanges(member.manifest).keys()].filter(
        (name) => installedPeersOf(member, name) !== null,
      ),
    );
    expect(read.length).toBeGreaterThan(0);
  });

  it('declares a dependency and the sibling it pins exactly with one range', () => {
    const skews = members().flatMap((member) =>
      lockstepSkews(declaredRanges(member.manifest), (name) => installedPeersOf(member, name)).map(
        (skew) => `${member.name}: ${skew}`,
      ),
    );
    expect(skews).toEqual([]);
  });

  it('requires no third-party peer that only the package\'s own tests reach', () => {
    const all = members();
    const workspaceNames = new Set(all.map((member) => member.name));
    const published = all.filter((member) => member.family && member.manifest['private'] !== true);
    expect(published.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const member of published) {
      const sources = filesUnder(join(member.dir, 'src'));
      const shipped = sources.filter((file) => !TEST_FILE.test(file));
      const tests = [
        ...sources.filter((file) => TEST_FILE.test(file)),
        ...filesUnder(join(member.dir, 'test')),
        ...readdirSync(member.dir)
          .filter((entry) => /^vitest(?:\.[\w-]+)*\.config\.ts$/.test(entry))
          .map((entry) => join(member.dir, entry)),
      ];
      for (const peer of testOnlyRequiredPeers({
        requiredPeers: requiredThirdPartyPeers(member, workspaceNames),
        shippedReach: reachOf(shipped),
        testReach: reachOf(tests),
      })) {
        found.push(`${member.name}: ${peer}`);
      }
    }
    expect(found).toEqual([]);
  });
});
