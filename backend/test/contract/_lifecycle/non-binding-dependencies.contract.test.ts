import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { defineModuleManifest } from '@endora-commerce/contracts';
import {
  orderMigrations,
  type MigrationClass,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { coreModuleDependencies } from '../../../src/db/configured-migrations.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * D-44 — a `nonBindingDependencies` entry cannot change an emitted migration
 * order.
 *
 * This is the property D-44 §8 singled out as "the one most likely to be broken
 * by a well-meaning later edit": the field looks like a dependency, the install
 * order reads dependencies, and unioning the three arrays in the one expression
 * that builds the ordering graph is a two-word change that no type would catch.
 * What it would buy is a cross-module foreign key whose ordering claim lives in
 * an array `fk-dependency-drift.test.ts` does not read — a table created after
 * the table it references, on a fresh database only.
 *
 * Three assertions, because each alone is defeatable: the **behaviour**, over
 * the ordering function itself; the **derivation**, driven over the live
 * manifests; and the **uniqueness** of that derivation, read out of the tree.
 */

const BASELINE_THROUGH = '20260801T000000';

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationClass {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationClass;
}

function entry(moduleId: string, stamp: string, tail: string): MigrationRegistryEntry {
  return { moduleId, cls: migrationClass(`Migration${stamp}${tail}`) };
}

/**
 * The graph shape `orderMigrations` is fed, over manifests this test invents —
 * the two behavioural cases below need edges the real platform does not have.
 *
 * It is a second spelling of the production derivation and no longer pretends
 * otherwise: "spelled exactly as the one site spells it" was how this file used
 * to argue that the two could not drift, and that argument was only ever as good
 * as a reader noticing. What holds them together now is the third test, which
 * drives `coreModuleDependencies` itself.
 */
function orderingGraph(
  manifests: readonly ModuleManifest[],
): ReadonlyMap<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    ['core', []],
    ...manifests.map((manifest) => [manifest.id, manifest.dependencies ?? []] as const),
  ]);
}

/**
 * `reader`'s migration is stamped *before* `writer`'s, and both are past the
 * watermark — so a declared dependency puts `writer` first and anything else
 * leaves the two modules unrelated, where the id sorts them (`reader` first).
 */
const ENTRIES: readonly MigrationRegistryEntry[] = [
  entry('reader', '20260901T090000', 'ReaderTable'),
  entry('writer', '20260902T090000', 'WriterTable'),
];

function emitted(manifests: readonly ModuleManifest[]): string[] {
  return orderMigrations({
    entries: ENTRIES,
    moduleDependencies: orderingGraph(manifests),
    baselineThrough: BASELINE_THROUGH,
  }).migrations.map((migration) => migration.name);
}

const writer = defineModuleManifest({
  id: 'writer',
  name: 'Writer',
  version: '1.0.0',
  dependencies: [],
});

const readerDeclaring = defineModuleManifest({
  id: 'reader',
  name: 'Reader',
  version: '1.0.0',
  dependencies: ['writer'],
});

const readerWithdrawing = defineModuleManifest({
  id: 'reader',
  name: 'Reader',
  version: '1.0.0',
  dependencies: [],
  nonBindingDependencies: [
    {
      moduleId: 'writer',
      name: 'writerToolRegistry',
      kind: 'contributes-to',
      reason:
        'Pushes an inert descriptor into the writer catalogue at boot; nothing is read back.',
    },
  ],
});

const SRC_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));

function walkSources(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (full.endsWith('.ts')) out.set(full, readFileSync(full, 'utf8'));
  }
  return out;
}

/**
 * Where the ordering graph is computed, and where it comes from.
 *
 * This used to name `src/db/mikro-orm.config.ts` and match
 * `/moduleDependencies\s*=\s*new Map[\s\S]*?\n\]\);/`, and issue #289 broke it
 * three ways at once: the map moved to `configured-migrations.ts`, the `=`
 * became a `:` as it turned into an inline property, and the `\n]);` terminator
 * became `\n  ]),`. Feature 080's T033 (`49f00beb`) then broke it a fourth way,
 * and that one is the instructive one: the *derivation* moved out from under the
 * name when the merge became an async factory. `moduleDependencies` is now a
 * **consumer** — `new Map(inputs.coreModuleDependencies)` — so the guard found
 * it, asserted against it, and went red on a tree in which the property had
 * never been violated. `master` stayed red across the 29 merges that followed.
 *
 * Four things follow, and they pull in the same direction.
 *
 * A **path** is the wrong handle: the property is *"nowhere in this platform's
 * sources is the ordering graph built from anything but `dependencies`"*, a
 * claim about the tree and not about a filename. So the site is resolved.
 *
 * A **local variable name** is the wrong handle for the same reason one layer
 * in — it is the tree's spelling, not the platform's contract. Both names this
 * guard keys on come off the imported bindings (`orderMigrations.name`,
 * `coreModuleDependencies.name`), so a rename follows and a rename that does not
 * keep the export in step is a compile error here rather than a silent green.
 *
 * The **ordering function** is the right handle for uniqueness, and is stronger
 * than the map's name was: a graph that never reaches `orderMigrations` is not
 * an ordering graph, and a second call passing an inline expression — which the
 * old probe could not have seen at all — is a second derivation this one counts.
 *
 * And resolving is only safe if **not** resolving is a failure. Zero call sites,
 * more than one, a chain this walk cannot follow, or a chain that does not reach
 * the derivation the test above drives: each is red. There is no path through
 * here that means "I could not look".
 *
 * What it cannot see, stated rather than discovered later: the chain is followed
 * **within one file**, so a contribution reached through an import is invisible
 * to it — as it was to every version of this guard — and the uniqueness
 * assertion is what stands in that gap.
 */
const ORDERING_FUNCTION = orderMigrations.name;
const GRAPH_DERIVATION = coreModuleDependencies.name;

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** The index of the bracket closing the one at `open`, or `-1`. */
function closingIndex(source: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch in CLOSERS) stack.push(CLOSERS[ch]!);
    else if (stack.length > 0 && ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The value text at `start`, up to the first `,`/`;`/closer at depth 0. */
function valueAt(source: string, start: number): string {
  const stack: string[] = [];
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch in CLOSERS) stack.push(CLOSERS[ch]!);
    else if (stack.length > 0 && ch === stack[stack.length - 1]) stack.pop();
    else if (
      stack.length === 0 &&
      (ch === ',' || ch === ';' || ch === ')' || ch === '}' || ch === ']')
    ) {
      return source.slice(start, i).trim();
    }
  }
  return source.slice(start).trim();
}

/** A match on a line that opens as a comment is prose, not a call. */
function onACommentLine(source: string, index: number): boolean {
  const before = source.slice(source.lastIndexOf('\n', index) + 1, index).trimStart();
  return before.startsWith('*') || before.startsWith('//') || before.startsWith('/*');
}

function escapeForRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A call of `name` as a plain identifier — never `receiver.name(...)`, which is
 * somebody else's method of the same spelling.
 *
 * The second lookbehind is not decoration: a `.` before the name is a member
 * access **unless** it is the last of a `...` spread, and
 * `new Map([...coreModuleDependencies(), …])` is exactly the shape a union that
 * still consults the real derivation would be written in. The first draft of
 * this guard read the spread as a member call and reported the union as
 * untraceable — a red for the wrong reason, which the proof below caught.
 */
function callPattern(name: string, flags = ''): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_$])(?<!(?<!\\.)\\.)${escapeForRegExp(name)}\\s*\\(`, flags);
}

/** Every call of `name` in `sources`, with its balanced argument list. */
function callsOf(
  name: string,
  sources: ReadonlyMap<string, string>,
): { file: string; args: string }[] {
  const pattern = callPattern(name, 'g');
  const calls: { file: string; args: string }[] = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(pattern)) {
      const at = match.index;
      // The declaration is not a call of itself.
      if (/\bfunction\s*$/.test(source.slice(Math.max(0, at - 24), at))) continue;
      if (onACommentLine(source, at)) continue;
      const open = at + match[0].length - 1;
      const end = closingIndex(source, open);
      // Fail closed: an argument list this scanner cannot delimit is not one it
      // may quietly drop.
      expect(end, `unbalanced parentheses after ${name}( in ${file}`).toBeGreaterThan(open);
      calls.push({ file, args: source.slice(open, end + 1) });
    }
  }
  return calls;
}

const KEYWORDS = new Set([
  'new',
  'await',
  'return',
  'const',
  'let',
  'var',
  'function',
  'typeof',
  'as',
  'readonly',
  'of',
  'in',
  'for',
  'if',
  'else',
  'string',
  'number',
  'boolean',
  'undefined',
  'null',
  'true',
  'false',
  'void',
  'this',
  'throw',
  'async',
  'satisfies',
  'keyof',
  'extends',
]);

/**
 * The names an expression could carry the graph's data through.
 *
 * An initial capital is a type, a class or an imported constant — never a
 * binding whose value this file computes — so following one buys nothing and
 * widens the closure past the point where a bound means anything.
 */
function namesIn(expression: string): string[] {
  const names: string[] = [];
  for (const match of expression.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const name = match[0];
    if (/^[A-Z]/.test(name) || KEYWORDS.has(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Everything one file binds under `name`: a `const`/`let`/`var`, a `function`
 * body, and an object-literal property or interface member.
 *
 * The third shape is what makes a parameter followable. `configuredMigrationsFrom`
 * reads its graph off `inputs.coreModuleDependencies`, and the object literal
 * that fills that property sits in the same file — one hop, in one file, in the
 * idiom `check:port-catches` already uses.
 */
function bindingsOf(name: string, source: string): string[] {
  const escaped = escapeForRegExp(name);
  const found: string[] = [];
  for (const m of source.matchAll(
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b[^=;]*=`, 'g'),
  )) {
    found.push(valueAt(source, m.index + m[0].length));
  }
  for (const m of source.matchAll(new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`, 'g'))) {
    const params = closingIndex(source, source.indexOf('(', m.index));
    const brace = params < 0 ? -1 : source.indexOf('{', params);
    const end = brace < 0 ? -1 : closingIndex(source, brace);
    if (end > brace) found.push(source.slice(brace, end + 1));
  }
  for (const m of source.matchAll(new RegExp(`(?<![A-Za-z0-9_$.?])${escaped}\\s*:`, 'g'))) {
    found.push(valueAt(source, m.index + m[0].length));
  }
  return found;
}

/** How far, and how wide, the walk may go before it reports that it gave up. */
const WALK_LIMITS = { hops: 4, expressions: 200 } as const;

interface WalkLimits {
  readonly hops: number;
  readonly expressions: number;
}

interface OrderingGraphAnalysis {
  /** Every place the ordering function is called. Exactly one is the property. */
  readonly callSites: readonly string[];
  /** Every expression the one call's arguments were followed through. */
  readonly chain: readonly string[];
  /** Whether the chain reaches a call of the graph derivation. */
  readonly reachesDerivation: boolean;
  /** Chain expressions naming a withdrawn-edge array. */
  readonly withdrawnEdgeReads: readonly string[];
  /** True when the walk hit its own bound — a refusal, never a pass. */
  readonly gaveUp: boolean;
}

/**
 * Read the ordering graph out of `sources`: where it is computed, and what the
 * one computation's inputs are followed back to.
 *
 * The fixture enters **here**, at the top of the analysis — every red proof
 * hands it a source map, so nothing this is meant to refuse is pre-decided for
 * it (issue #130).
 */
function analyseOrderingGraph(
  sources: ReadonlyMap<string, string>,
  limits: WalkLimits = WALK_LIMITS,
): OrderingGraphAnalysis {
  const calls = callsOf(ORDERING_FUNCTION, sources);
  const callSites = calls.map((call) => call.file);
  if (calls.length !== 1) {
    return {
      callSites,
      chain: [],
      reachesDerivation: false,
      withdrawnEdgeReads: [],
      gaveUp: false,
    };
  }

  const source = sources.get(calls[0]!.file)!;
  const chain: string[] = [calls[0]!.args];
  const seen = new Set<string>();
  let frontier = namesIn(calls[0]!.args);
  let gaveUp = false;

  for (let hop = 0; hop < limits.hops && frontier.length > 0 && !gaveUp; hop += 1) {
    const next: string[] = [];
    for (const name of frontier) {
      if (seen.has(name)) continue;
      seen.add(name);
      for (const binding of bindingsOf(name, source)) {
        if (chain.length >= limits.expressions) {
          gaveUp = true;
          break;
        }
        chain.push(binding);
        next.push(...namesIn(binding));
      }
      if (gaveUp) break;
    }
    frontier = next;
  }

  const derivationCall = callPattern(GRAPH_DERIVATION);
  return {
    callSites,
    chain,
    gaveUp,
    reachesDerivation: chain.some((expression) => derivationCall.test(expression)),
    withdrawnEdgeReads: chain.filter((expression) =>
      /\b(?:nonBinding|acknowledged)Dependencies\b/.test(expression),
    ),
  };
}

describe('nonBindingDependencies — invisible to the migration order', () => {
  it('a declared dependency does order the pair', () => {
    // The control. Without it the assertion below would pass on a graph that
    // reads no edges at all.
    expect(emitted([writer, readerDeclaring])).toEqual([
      'Migration20260902T090000WriterTable',
      'Migration20260901T090000ReaderTable',
    ]);
  });

  it('the same edge declared as non-binding leaves the two modules unrelated', () => {
    expect(emitted([writer, readerWithdrawing])).toEqual([
      'Migration20260901T090000ReaderTable',
      'Migration20260902T090000WriterTable',
    ]);
  });

  it('the platform derives its ordering graph from `dependencies` and nothing else', () => {
    // The derivation, **driven** rather than read. Every manifest declaring a
    // withdrawn edge is a discriminating fixture by construction: the contract
    // refuses a `nonBindingDependencies` or `acknowledgedDependencies` target
    // that `dependencies` already names, so a union would move this map.
    const graph = coreModuleDependencies();

    const withWithdrawnEdges = DISCOVERED_MANIFESTS.filter(
      (entry) =>
        (entry.manifest.nonBindingDependencies?.length ?? 0) > 0 ||
        (entry.manifest.acknowledgedDependencies?.length ?? 0) > 0,
    );
    expect(
      withWithdrawnEdges.length,
      'no registered manifest declares a withdrawn edge, so this assertion can no ' +
        'longer tell a clean derivation from a unioned one — it is measuring nothing. ' +
        'Restore a fixture carrying one before trusting the green.',
    ).toBeGreaterThan(0);

    expect(graph.get('core'), 'the ordering graph lost its `core` node').toEqual([]);
    for (const entry of DISCOVERED_MANIFESTS) {
      expect(
        graph.get(entry.id),
        `the ordering graph edge for "${entry.id}" is not its manifest \`dependencies\``,
      ).toEqual(entry.manifest.dependencies ?? []);
    }
  });

  it('the ordering graph is computed once, and from that derivation', () => {
    const sources = walkSources(SRC_ROOT);
    // The vacuous-pass floor: a walk that read nothing would report no call
    // site, and "no call site" is this test's loudest failure — it must mean
    // the ordering moved, never that the walk was blind.
    expect(sources.size, `no TypeScript sources under ${SRC_ROOT}`).toBeGreaterThan(0);

    const analysis = analyseOrderingGraph(sources);

    expect(
      analysis.callSites,
      `${ORDERING_FUNCTION} is called nowhere in backend/src — renamed, deleted or moved out ` +
        `— or it is called more than once, which is a second derivation of the ordering ` +
        `graph and the change this test exists to refuse`,
    ).toHaveLength(1);

    expect(
      analysis.gaveUp,
      `the inputs of the one ${ORDERING_FUNCTION} call could not be followed within ` +
        `${analysis.callSites[0]} inside ${WALK_LIMITS.hops} hops. That is a refusal, not a ` +
        `pass: ` +
        `this guard cannot say where the graph comes from, so nobody can.`,
    ).toBe(false);

    expect(
      analysis.reachesDerivation,
      `the graph passed to ${ORDERING_FUNCTION} does not trace back to ${GRAPH_DERIVATION}(), ` +
        `the derivation the test above drives. Either it is now built somewhere this guard ` +
        `cannot follow — one hop, one file — or a second derivation feeds it.`,
    ).toBe(true);

    expect(
      analysis.withdrawnEdgeReads,
      'a withdrawn-edge array is read on the way into the ordering graph (D-44 §8): a ' +
        '`nonBindingDependencies` or `acknowledgedDependencies` entry must not be able to ' +
        'move a migration',
    ).toEqual([]);
  });
});

/**
 * A tree in which the graph is derived the way this platform derives it:
 * `orderMigrations` called once, its map traced back through a parameter to
 * `coreModuleDependencies()`. Each proof below mutates exactly one thing about
 * it, so a red names the shape it caught.
 */
function cleanTree(): Map<string, string> {
  return new Map([
    [
      '/src/db/configured-migrations.ts',
      [
        'interface Inputs {',
        '  readonly coreModuleDependencies: ReadonlyMap<string, readonly string[]>;',
        '}',
        'export function configuredMigrationsFrom(inputs: Inputs) {',
        '  const moduleDependencies = new Map(inputs.coreModuleDependencies);',
        '  return orderMigrations({ entries, moduleDependencies, baselineThrough });',
        '}',
        'function coreModuleDependencies(): Map<string, readonly string[]> {',
        '  return new Map(MANIFESTS.map((e) => [e.id, e.manifest.dependencies ?? []]));',
        '}',
        'export async function configuredMigrations() {',
        '  return configuredMigrationsFrom({ coreModuleDependencies: coreModuleDependencies() });',
        '}',
      ].join('\n'),
    ],
  ]);
}

describe('the ordering-graph guard — what it refuses', () => {
  it('is green on a tree shaped like this one', () => {
    const analysis = analyseOrderingGraph(cleanTree());
    expect(analysis.callSites).toHaveLength(1);
    expect(analysis.gaveUp).toBe(false);
    expect(analysis.reachesDerivation).toBe(true);
    expect(analysis.withdrawnEdgeReads).toEqual([]);
  });

  it('refuses a tree with no ordering call at all — renamed, deleted or moved out', () => {
    const tree = new Map([['/src/db/other.ts', 'export const nothing = 1;']]);
    expect(analyseOrderingGraph(tree).callSites).toHaveLength(0);
  });

  it('refuses a second derivation of the ordering graph', () => {
    const tree = cleanTree();
    // The shape the old probe could not have seen: a second call building its
    // graph inline, under no name at all.
    tree.set(
      '/src/db/second-order.ts',
      'export const other = orderMigrations({ entries, moduleDependencies: new Map(), baselineThrough });',
    );
    expect(analyseOrderingGraph(tree).callSites).toHaveLength(2);
  });

  it('does not mistake the declaration of the ordering function for a call of it', () => {
    const tree = new Map([
      [
        '/src/db/migration-order.ts',
        'export function orderMigrations(input: OrderMigrationsInput) {\n  return input;\n}',
      ],
    ]);
    expect(analyseOrderingGraph(tree).callSites).toHaveLength(0);
  });

  it('does not mistake prose about the ordering function for a call of it', () => {
    const tree = cleanTree();
    tree.set(
      '/src/db/notes.ts',
      ['/**', ' * A second orderMigrations({ x }) here would be a defect.', ' */'].join('\n'),
    );
    expect(analyseOrderingGraph(tree).callSites).toHaveLength(1);
  });

  it('refuses a graph it cannot trace back to the derivation', () => {
    const tree = cleanTree();
    tree.set(
      '/src/db/configured-migrations.ts',
      [
        'import { graphFromSomewhereElse } from "./elsewhere.js";',
        'export function configuredMigrationsFrom() {',
        '  const moduleDependencies = graphFromSomewhereElse();',
        '  return orderMigrations({ entries, moduleDependencies, baselineThrough });',
        '}',
      ].join('\n'),
    );
    const analysis = analyseOrderingGraph(tree);
    expect(analysis.callSites).toHaveLength(1);
    expect(analysis.reachesDerivation).toBe(false);
  });

  it('refuses a withdrawn-edge array unioned in on the way to the ordering call', () => {
    const tree = cleanTree();
    tree.set(
      '/src/db/configured-migrations.ts',
      [
        'export function configuredMigrationsFrom() {',
        '  const withdrawn = MANIFESTS.flatMap((e) => e.manifest.nonBindingDependencies ?? []);',
        '  const moduleDependencies = new Map([...coreModuleDependencies(), ...withdrawn]);',
        '  return orderMigrations({ entries, moduleDependencies, baselineThrough });',
        '}',
      ].join('\n'),
    );
    const analysis = analyseOrderingGraph(tree);
    // The two signals are independent: the chain still reaches the derivation,
    // and the union is caught anyway.
    expect(analysis.reachesDerivation).toBe(true);
    expect(analysis.withdrawnEdgeReads.length).toBeGreaterThan(0);
  });

  it('refuses an acknowledged-edge array on the same terms', () => {
    const tree = cleanTree();
    tree.set(
      '/src/db/configured-migrations.ts',
      [
        'export function configuredMigrationsFrom() {',
        '  const moduleDependencies = new Map(edgesOf(m.acknowledgedDependencies ?? []));',
        '  return orderMigrations({ entries, moduleDependencies, baselineThrough });',
        '}',
      ].join('\n'),
    );
    expect(analyseOrderingGraph(tree).withdrawnEdgeReads.length).toBeGreaterThan(0);
  });

  it('reports a chain too wide to follow as a refusal, never as a pass', () => {
    const analysis = analyseOrderingGraph(cleanTree(), { hops: 4, expressions: 1 });
    expect(analysis.gaveUp).toBe(true);
    expect(analysis.reachesDerivation).toBe(false);
  });
});
