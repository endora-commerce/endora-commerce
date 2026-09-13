/**
 * T1 of `specs/110-instance-repository/contracts/instance-tree.md` §5 — **at
 * symbol granularity**.
 *
 * ## The defect it exists for
 *
 * `endora new instance` produced a tree that did not compile. `template.ts`
 * named `configuredEntities` and `configuredMigrations` on `./composition` and
 * `resolvedManifestEntries` on `./lifecycle`, three times each, and the
 * platform exports none of the three. Its own header already said so —
 * *"`./db`'s and `./lifecycle`'s **under other names**"* — so the knowledge was
 * present in the file and nothing held the rendered text to it.
 *
 * **T1 as drafted would have passed over all three.** It reconciles the
 * *subpath*, and `./composition` and `./lifecycle` are both declared by the
 * `exports` map, so every one of those specifiers resolves. Only the symbol
 * fails, which is why this file asks for the symbol.
 *
 * ## One derivation, not a second one
 *
 * `src/lib/platform-surface.ts`' {@link parseBarrel} is what
 * `check:platform-surface` and `published-surface.test.ts` already read a
 * barrel with, and it is what this file reads one with. A second parse of
 * "what does `lifecycle/index.ts` export" would be two answers waiting to
 * disagree — the shape that file's own header exists to refuse — and the shape
 * whose first disagreement would be the next unpublished name to travel.
 *
 * Which subpaths the host declares comes off the host's own `exports` map
 * ({@link platformSubpathsOf}), which member is the host off its own
 * `endora.type` block, and the scope off the host's name. Nothing here spells
 * `@endora-commerce/`, `packages/platform` or a subpath (D-100).
 *
 * ## The fixtures enter at the top
 *
 * Issue #130. {@link reconcileTemplate} takes rendered file **text**, a host
 * declaration and a reader for barrel sources — the three things a real run
 * computes first — so every red proof below is the template's own output with
 * one line changed, never a pre-classified verdict handed to the last function
 * in the chain. Three of them reproduce the three real names.
 *
 * ## What it refuses rather than passing (issue #113)
 *
 * A reconciliation over nothing is vacuously clean, and four inputs can be
 * empty without anything else looking wrong. Each is a {@link Refusal} with a
 * kind of its own, and each has a red proof below:
 *
 *   * `no-file` — a plan that renders nothing;
 *   * `no-host-reach` — a plan naming the host nowhere, which is what a
 *     template whose specifiers were rewritten by hand looks like;
 *   * `no-platform` — a workspace declaring no host, so there is no `exports`
 *     map to judge a specifier against;
 *   * `barrel-unreadable` — a barrel that is not on disk, that parses to no
 *     published name, or that `parseBarrel` could not read in full. A barrel
 *     read *partially* would license every name it failed to see.
 *
 * ## What it is not
 *
 * It is not §5's T2, T3 or T4, and it is not T1's second direction. It says
 * nothing about whether a symbol *should* be published, which is
 * `published-surface.test.ts`' question, and nothing about whether the rendered
 * tree runs, which is the acceptance criterion's (T140). It answers one
 * question — *does every platform name this template writes exist* — and that
 * is the question the three errors were.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceMember,
} from '../../src/lib/workspace-packages.js';
import {
  platformPackageNameOf,
  platformSourceRootOf,
  platformSubpathsOf,
} from '../../src/lib/platform-root.js';
import { barrelKeyOf, parseBarrel } from '../../src/lib/platform-surface.js';
import { planInstance, type PlanInput, type PlannedFile } from '../../src/new-instance/template.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

// ---------------------------------------------------------------------------
// The analysis — pure over rendered text, a host declaration and a barrel
// reader, so every input a real run computes is one a proof can substitute.
// ---------------------------------------------------------------------------

/** What the host says about itself: its npm name and the subpaths it declares. */
interface HostDeclaration {
  readonly name: string;
  readonly declaredSubpaths: ReadonlySet<string>;
}

/** A barrel's source text for one subpath, or `null` when it is not there. */
type BarrelReader = (subpath: string) => string | null;

type FindingKind =
  /** A name the barrel carrying this subpath does not publish. */
  | 'unpublished-symbol'
  /** A bare specifier into the host naming a subpath the `exports` map has not. */
  | 'undeclared-subpath'
  /**
   * A namespace, default or side-effect import of a host subpath. It names no
   * symbol, so it takes whatever the barrel happens to carry — which is the
   * state this file exists to refuse, one granularity coarser.
   */
  | 'whole-file-reach';

interface Finding {
  readonly kind: FindingKind;
  /** The rendered file, as the plan paths it. */
  readonly file: string;
  readonly specifier: string;
  /** The symbol, or the import's shape for `whole-file-reach`. */
  readonly subject: string;
  readonly message: string;
}

type RefusalKind = 'no-file' | 'no-host-reach' | 'no-platform' | 'barrel-unreadable';

interface Refusal {
  readonly kind: RefusalKind;
  readonly message: string;
}

interface Reconciliation {
  readonly findings: readonly Finding[];
  readonly refusals: readonly Refusal[];
  /** Files opened. */
  readonly files: number;
  /** Symbols examined — the population a `findings=0` is a claim about. */
  readonly symbols: number;
  /** Host subpaths the template named. */
  readonly subpaths: readonly string[];
}

/** One `import … from '<host>/<subpath>'` in a rendered file. */
interface HostImport {
  readonly file: string;
  readonly specifier: string;
  readonly subpath: string;
  readonly names: readonly string[];
  /** Set when the import names no symbol at all. */
  readonly wholeFile: string | null;
}

/**
 * Every bare import of the host in one rendered file.
 *
 * Read as literal AST specifier nodes, so a path spelled in a comment or in a
 * string is out of the population by construction rather than by exclusion —
 * this template's files are full of both.
 */
function hostImportsIn(file: PlannedFile, host: HostDeclaration): readonly HostImport[] {
  if (!file.path.endsWith('.ts')) return [];
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const found: HostImport[] = [];
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const specifierNode = node.moduleSpecifier;
    if (!ts.isStringLiteral(specifierNode)) return;
    const specifier = specifierNode.text;
    if (specifier !== host.name && !specifier.startsWith(`${host.name}/`)) return;
    const subpath = specifier.slice(host.name.length).replace(/^\//, '');
    const clause = node.importClause;
    if (clause === undefined) {
      found.push({ file: file.path, specifier, subpath, names: [], wholeFile: 'side-effect' });
      return;
    }
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      found.push({ file: file.path, specifier, subpath, names: [], wholeFile: 'namespace' });
      return;
    }
    const names: string[] = [];
    // A default import names no barrel symbol — a barrel has no default export
    // — so it is reported as a whole-file reach rather than as a missing name.
    if (clause.name !== undefined) {
      found.push({ file: file.path, specifier, subpath, names: [], wholeFile: 'default' });
    }
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        names.push((element.propertyName ?? element.name).text);
      }
    }
    if (names.length > 0) {
      found.push({ file: file.path, specifier, subpath, names, wholeFile: null });
    }
  });
  return found;
}

/**
 * Does every platform symbol this template writes exist on the subpath it
 * writes it on?
 *
 * `readBarrel` is injected rather than reached for: it is what makes a proof a
 * substitution of the analysis's own input instead of a fixture on disk, and it
 * is what keeps this function honest about a barrel it could not read.
 */
function reconcileTemplate(
  files: readonly PlannedFile[],
  host: HostDeclaration | null,
  readBarrel: BarrelReader,
): Reconciliation {
  const findings: Finding[] = [];
  const refusals: Refusal[] = [];

  if (files.length === 0) {
    refusals.push({
      kind: 'no-file',
      message:
        'the plan renders no file at all. Every assertion below is vacuously true over an ' +
        'empty plan, and an empty plan is what a broken renderer produces.',
    });
  }
  if (host === null) {
    refusals.push({
      kind: 'no-platform',
      message:
        'no workspace member declares `endora.type: "platform"`, so there is no `exports` ' +
        'map to judge a specifier against and no barrel to judge a symbol against.',
    });
    return { findings, refusals, files: files.length, symbols: 0, subpaths: [] };
  }

  const imports = files.flatMap((file) => hostImportsIn(file, host));
  if (imports.length === 0) {
    refusals.push({
      kind: 'no-host-reach',
      message:
        `no rendered file imports \`${host.name}\`. A template that names the host nowhere ` +
        'reconciles clean while writing a tree that composes nothing.',
    });
  }

  // Each named subpath's barrel, parsed once. A barrel that cannot be read in
  // full is a refusal and never a pass: the names it failed to yield are
  // exactly the names this file would otherwise have licensed.
  const published = new Map<string, ReadonlySet<string>>();
  const subpaths = [...new Set(imports.map((entry) => entry.subpath))].sort();
  for (const subpath of subpaths) {
    if (!host.declaredSubpaths.has(subpath)) continue;
    const barrel = barrelKeyOf(subpath);
    const source = readBarrel(subpath);
    if (source === null) {
      refusals.push({
        kind: 'barrel-unreadable',
        message: `${barrel} is not on disk — the template names \`${host.name}/${subpath}\`.`,
      });
      continue;
    }
    const parsed = parseBarrel(source, barrel);
    for (const unreadable of parsed.unreadable) {
      refusals.push({
        kind: 'barrel-unreadable',
        message: `${barrel}:${String(unreadable.line)} — ${unreadable.reason}`,
      });
    }
    if (parsed.published.length === 0) {
      refusals.push({
        kind: 'barrel-unreadable',
        message:
          `${barrel} publishes no name. Every symbol the template takes from ` +
          `\`${host.name}/${subpath}\` would be reported missing, which is a finding about ` +
          'the parse rather than about the template.',
      });
      continue;
    }
    published.set(subpath, new Set(parsed.published.map((symbol) => symbol.name)));
  }

  let symbols = 0;
  for (const entry of imports) {
    if (entry.wholeFile !== null) {
      findings.push({
        kind: 'whole-file-reach',
        file: entry.file,
        specifier: entry.specifier,
        subject: entry.wholeFile,
        message:
          `${entry.file} takes \`${entry.specifier}\` as a ${entry.wholeFile} import, which ` +
          'names no symbol. Import the names the wiring uses, so that a name the host stops ' +
          'publishing is a compile error here rather than an `undefined` in a client tree.',
      });
      continue;
    }
    if (!host.declaredSubpaths.has(entry.subpath)) {
      findings.push({
        kind: 'undeclared-subpath',
        file: entry.file,
        specifier: entry.specifier,
        subject: entry.subpath,
        message:
          `${entry.file} imports \`${entry.specifier}\`, and ${host.name}'s \`exports\` map ` +
          `declares no \`./${entry.subpath}\`. The declared subpaths are ` +
          `${[...host.declaredSubpaths].sort().join(', ')}.`,
      });
      continue;
    }
    const names = published.get(entry.subpath);
    if (names === undefined) continue; // refused above; do not report over an unread barrel.
    for (const name of entry.names) {
      symbols += 1;
      if (names.has(name)) continue;
      findings.push({
        kind: 'unpublished-symbol',
        file: entry.file,
        specifier: entry.specifier,
        subject: name,
        message:
          `${entry.file} imports \`${name}\` from \`${entry.specifier}\`, and that barrel ` +
          'does not publish it. A client scaffolding this tree gets TS2305 on a file they ' +
          'did not write.',
      });
    }
  }

  return { findings, refusals, files: files.length, symbols, subpaths };
}

// ---------------------------------------------------------------------------
// The real inputs
// ---------------------------------------------------------------------------

const MEMBERS: readonly WorkspaceMember[] = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
const HOST_NAME = platformPackageNameOf(MEMBERS);
const PLATFORM_SRC = platformSourceRootOf(MEMBERS);

const HOST: HostDeclaration | null =
  HOST_NAME === null
    ? null
    : { name: HOST_NAME, declaredSubpaths: new Set(platformSubpathsOf(MEMBERS)) };

/** The barrel sources, off the platform's own source tree. */
const readBarrel: BarrelReader = (subpath) => {
  if (PLATFORM_SRC === null) return null;
  try {
    return readFileSync(join(PLATFORM_SRC, subpath, 'index.ts'), 'utf8');
  } catch {
    return null;
  }
};

/**
 * The scope is the host's own name minus its last segment, so nothing here
 * spells a scope that D-161 is still renaming.
 */
const SCOPE = HOST_NAME === null ? '@endora-commerce/' : `${HOST_NAME.split('/')[0]!}/`;

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: undefined,
    // The version is the module package's **own**, and deliberately not the
    // platform's above: a range over another package's version is one no
    // registry can satisfy.
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    // The admin member, written: T138 made it part of the plan, and a fixture
    // that left it omitted would reconcile a template one member short of the
    // one the command builds. Its own files name no host subpath today — and
    // `hostImportsIn` reads `.ts` only, so a `.tsx` entry point that grew one
    // would be outside this reconciliation, which is T139's to widen.
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
    adminPeers: new Map([['lucide-react', '^1']]),
    cliVersion: '1.2.3',
    // §2.4a's member, written: the ranges are the CLI's own optional peers,
    // which is where `docsRangesOf` reads them from.
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
    // The default, and the one D-230 kept. A fixture that named the other would
    // be asserting the three-host examples everywhere they are not the subject.
    topology: 'single-host',
    ...overrides,
  };
}

/** The plan the command builds, with one rendered file's text substituted. */
function planWith(path: string, rewrite: (content: string) => string): readonly PlannedFile[] {
  const files = planInstance(planInput()).files;
  const target = files.find((file) => file.path === path);
  if (target === undefined) throw new Error(`no rendered file at ${path}`);
  return files.map((file) =>
    file.path === path ? { ...file, content: rewrite(file.content) } : file,
  );
}

function subjects(result: Reconciliation, kind: FindingKind): readonly string[] {
  return result.findings.filter((finding) => finding.kind === kind).map((finding) => finding.subject);
}

// ---------------------------------------------------------------------------
// T1 — the assertion
// ---------------------------------------------------------------------------

describe('T1 — every platform symbol the template names is published (§5)', () => {
  it('the rendered wiring names nothing the host does not export', () => {
    const result = reconcileTemplate(planInstance(planInput()).files, HOST, readBarrel);
    // Printed rather than asserted against a number: the population grows with
    // the wiring, and a count written down here would be the derived fact this
    // repository refuses (D-100). What is asserted is that it is not zero.
    process.stdout.write(
      `[template-reconciliation] read: files=${String(result.files)} ` +
        `symbols=${String(result.symbols)} ` +
        `sources=host-subpaths:${String(result.subpaths.length)}/` +
        `${String(HOST?.declaredSubpaths.size ?? 0)}\n`,
    );
    expect(result.refusals).toEqual([]);
    expect(result.findings.map((finding) => finding.message)).toEqual([]);
  });

  it('the population is real — files opened, symbols examined, subpaths named', () => {
    const result = reconcileTemplate(planInstance(planInput()).files, HOST, readBarrel);
    expect(result.files).toBeGreaterThan(0);
    expect(result.symbols).toBeGreaterThan(0);
    expect(result.subpaths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Red proofs — one per finding, entering as the template's own output
// ---------------------------------------------------------------------------

describe('T1 goes red, one proof per finding', () => {
  it('reproduces the two `./composition` names the template shipped', () => {
    // The ORM configuration as it stood: `./composition` is a declared subpath,
    // so the specifier resolves and only the symbols are wrong. A subpath-level
    // reconciliation passes this fixture.
    const files = planWith('backend/src/mikro-orm.config.ts', () =>
      [
        `import { configuredEntities, configuredMigrations } from '${SCOPE}platform/composition';`,
        'export default async function config() {',
        '  return { entities: await configuredEntities() };',
        '}',
      ].join('\n'),
    );
    const result = reconcileTemplate(files, HOST, readBarrel);
    expect(subjects(result, 'unpublished-symbol')).toEqual([
      'configuredEntities',
      'configuredMigrations',
    ]);
    expect(subjects(result, 'undeclared-subpath')).toEqual([]);
    expect(result.refusals).toEqual([]);
  });

  it('reproduces the `./lifecycle` name the template shipped', () => {
    const files = planWith('backend/src/module-commands/runtime.ts', (content) =>
      content.replace(/resolveManifestEntries/g, 'resolvedManifestEntries'),
    );
    const result = reconcileTemplate(files, HOST, readBarrel);
    expect(subjects(result, 'unpublished-symbol')).toEqual(['resolvedManifestEntries']);
    expect(result.findings[0]?.message).toContain('does not publish it');
  });

  it('an undeclared subpath is its own finding, and names the declared set', () => {
    const files = planWith('backend/src/index.ts', (content) =>
      content.replace(`${SCOPE}platform/composition`, `${SCOPE}platform/kernel-internals`),
    );
    const result = reconcileTemplate(files, HOST, readBarrel);
    expect(subjects(result, 'undeclared-subpath')).toEqual(['kernel-internals']);
    expect(result.findings[0]?.message).toContain('declares no `./kernel-internals`');
  });

  it('a namespace import names no symbol and is refused as a whole-file reach', () => {
    const files = planWith('backend/src/index.ts', (content) =>
      content.replace(
        `import { buildServer, composeApp } from '${SCOPE}platform/composition';`,
        `import * as composition from '${SCOPE}platform/composition';`,
      ),
    );
    const result = reconcileTemplate(files, HOST, readBarrel);
    expect(subjects(result, 'whole-file-reach')).toEqual(['namespace']);
  });
});

// ---------------------------------------------------------------------------
// The refusals — a reconciliation over nothing must not report clean (#113)
// ---------------------------------------------------------------------------

describe('it refuses a vacuous pass rather than reporting clean', () => {
  it('an empty plan is `no-file`, not zero findings', () => {
    const result = reconcileTemplate([], HOST, readBarrel);
    expect(result.findings).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.kind)).toContain('no-file');
  });

  it('a plan naming the host nowhere is `no-host-reach`', () => {
    const files = planInstance(planInput()).files.map((file) => ({
      ...file,
      content: file.content.replace(new RegExp(`${SCOPE}platform`, 'g'), 'some-other-platform'),
    }));
    const result = reconcileTemplate(files, HOST, readBarrel);
    expect(result.findings).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.kind)).toEqual(['no-host-reach']);
  });

  it('a workspace with no platform member is `no-platform`', () => {
    const result = reconcileTemplate(planInstance(planInput()).files, null, readBarrel);
    expect(result.findings).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.kind)).toEqual(['no-platform']);
    expect(result.symbols).toBe(0);
  });

  it('a barrel that is not on disk is `barrel-unreadable`, and reports no symbol', () => {
    const result = reconcileTemplate(planInstance(planInput()).files, HOST, () => null);
    expect(result.findings).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.kind)).toContain('barrel-unreadable');
    expect(result.symbols).toBe(0);
  });

  it('a barrel that publishes nothing is `barrel-unreadable`, not every symbol missing', () => {
    const result = reconcileTemplate(planInstance(planInput()).files, HOST, () => '// empty\n');
    expect(subjects(result, 'unpublished-symbol')).toEqual([]);
    expect(result.refusals.map((refusal) => refusal.kind)).toContain('barrel-unreadable');
  });

  it('a barrel the parse cannot read in full is `barrel-unreadable`', () => {
    // `export *` is the shape `parseBarrel` reports: the published names are in
    // another file, so a pass here would license whatever they are.
    const result = reconcileTemplate(planInstance(planInput()).files, HOST, () =>
      "export * from './compose-app.js';\n",
    );
    expect(result.refusals.map((refusal) => refusal.kind)).toContain('barrel-unreadable');
    expect(result.refusals.some((refusal) => refusal.message.includes('export *'))).toBe(true);
  });
});
