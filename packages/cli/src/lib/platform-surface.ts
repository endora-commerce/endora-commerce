/**
 * "What does the platform publish?" — one derivation, read out of the barrels
 * (feature 080, T042d; D-160.8).
 *
 * ## Why the barrel and not a list
 *
 * `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies every
 * platform file a module reaches as **P** (published API), **A** (accidental
 * reach) or **O** (the module is reaching for a class where a port exists).
 * §2.1 turns that classification into an `exports` map with five enumerated
 * subpaths, one per publishable directory, each resolving to that directory's
 * barrel (D-160.7). So the barrel *is* the classification, expressed as source
 * the compiler reads rather than as prose.
 *
 * Two consumers need that answer and they must never be able to disagree:
 *
 *   * `test/unit/kernel/published-surface.test.ts` holds each barrel to §1.3's
 *     symbol column, in both directions (MR !883);
 *   * `scripts/check-platform-surface.ts` refuses a module reach into a
 *     platform symbol the barrel does not carry.
 *
 * Before this file the first of them parsed the barrel with a regular
 * expression of its own. A second, independently written parse in the check
 * would be two answers to "what does `kernel/index.ts` export" — and the shape
 * one of them forgot would be the shape the next unpublished reach travelled
 * through. There is one parse, it is the TypeScript compiler's, and both read
 * it.
 *
 * ## What a barrel says, and the two things it says
 *
 * A published re-export carries **a name and the file it came from**:
 *
 * ```ts
 * export { HttpError } from './error-envelope.js';
 * ```
 *
 * — publishes `HttpError`, and publishes it *of* `http/error-envelope.ts`. Both
 * halves matter. §1.3's verdict is per file and its symbol column is per
 * symbol, and !883 found the gap materially: sixteen symbols of **P** files are
 * reached by nobody and are deliberately not published, so "the file is P" does
 * not license every export of it. Keying the answer on the pair is what lets a
 * consumer ask the question the classification actually answers — *may this
 * module take **this symbol** of **that file***.
 *
 * ## Which directories are published, and why that is declared here
 *
 * {@link PUBLISHED_SUBPATHS} is the one thing in this file that is written down
 * rather than derived, and it is a **ruling** (D-160.7) rather than a fact about
 * the tree: five enumerated subpaths, no root export, no wildcard, with `db`,
 * `overlay` and `packages` deliberately unpublishable (§1.4f, §1.4l). It cannot
 * be derived from "a directory with an `index.ts`", because `src/db/index.ts`
 * exists and is the single hardest **A** in the contract — publishing it would
 * make the host import all 219 module-owned entity references.
 *
 * It stops being written down the day the host `package.json` exists: its
 * `exports` map is the same five subpaths, authored once, and this constant is
 * replaced by a read of it. Until then every *consequence* of the list is
 * derived — which symbols, of which files, and what a reach into a directory
 * that is not on it means — and a directory named here whose barrel is missing
 * or empty is an error rather than a silently narrower surface.
 */
import { posix } from 'node:path';
import ts from 'typescript';

/**
 * The platform directories the host publishes, in the order §2.1 lists them.
 *
 * A ruling (D-160.7), not a measurement — see the header. `db` is absent on
 * purpose and its absence is the whole of §1.4f: a reach into it is unpublished
 * by construction. `overlay` and `packages` were absent for the same reason and
 * are now **declared and host-internal** (`specs/110-instance-repository/` T113
 * and T114): the code moved into the package, so the application needed an
 * address for it, and the answer to "may a module name it" is still no — see
 * {@link HOST_INTERNAL_SUBPATHS}, which is where that judgement is recorded.
 */
export const PUBLISHED_SUBPATHS: readonly string[] = [
  'kernel',
  'http',
  'tenancy',
  'commands',
  'events',
];

/**
 * The subpaths the `exports` map declares and **no published barrel carries**
 * (D-160.14), each with the reason it is on this side of the line.
 *
 * A subpath here is declared, so `node` and `tsc` resolve it for the host, the
 * test kit and the composition root — and it is not public API, so
 * {@link resolveHostSpecifier} answers a module's reach into one with
 * `host-internal-subpath` rather than with a pass. **The reason is the member**:
 * a set of bare names is a list somebody grows, and this whole class is a
 * judgement about who may name a surface, which no name records.
 *
 * It is kept apart from {@link PUBLISHED_SUBPATHS} rather than appended to it
 * because the two answer different questions, and `host-package.md` §2.7.5(a) is
 * that merging them is the mistake: the published list is what a **symbol** is
 * judged against, and an entry there would publish `composeModules` out of
 * `kernel/compose.ts` for every reach at that file — a module's relative one
 * included — while changing nothing `check:platform-surface` prints.
 *
 * It lives here rather than in a test because by the time it had two members it
 * had two copies, in two test files, neither carrying a per-member reason. Two
 * independently written answers to "which subpaths are host-internal" are two
 * answers waiting to disagree, in the estate whose own rule that is (D-100).
 */
export const HOST_INTERNAL_SUBPATHS: Readonly<Record<string, string>> = {
  composition:
    'the host composition surface (D-160.14, feature 109 T010): the symbols a composition ' +
    'root needs — build the server, open the container, register the ORM, compose the ' +
    'sub-kernels, prime the registry cache, establish a tenant context. Reachable by a ' +
    'package that is not a module and nameable by no module at all, because a module that ' +
    'could name it could compose the platform that composes it.',
  migrations:
    'the frozen historical prefix an execution order is computed from ' +
    '(`specs/110-instance-repository/contracts/instance-migration-order.md` R1.5). It is the ' +
    "platform's own claim about its schema history, which a client receives by installing " +
    'the platform and corrects by `pnpm update` — never by writing a migration into it.',
  lifecycle:
    "`_lifecycle`'s operator surface (D115-4, `specs/115-lifecycle-container-move/`): the " +
    'orchestrator, the dependency and gating graphs, the lifecycle lock, the manifest loader ' +
    "and the module plugin. Host-internal for `./composition`'s own reason — this surface " +
    '*drives* the presence axis, so a module that could name it could install, uninstall, ' +
    'enable or disable its siblings. D-160.11 refused to **publish** `_lifecycle`, and that ' +
    'is an argument against publishing a surface rather than against giving it an address: ' +
    'without one the application reaches it by relative path into ' +
    "`packages/platform/dist/`, which resolves in this checkout and in no client's.",
  env:
    'the environment-input declaration (feature 117, FR-001): the inputs the host and the ' +
    'platform read, with what each configures, whether it is required and what is lost ' +
    'without it. Its readers are the scaffolding commands, `endora doctor` and the ' +
    "reconciliation check \u2014 none of them a module. Host-internal for `./composition`'s own " +
    'reason, one surface over: a module declares its **own** inputs in its manifest, so a ' +
    'module that could name this one could read, and would eventually copy, a population it ' +
    'does not own. The shape it is written in is public API and lives in ' +
    '`@endora-commerce/contracts`, which is where a module takes it from.',
  packages:
    'installed extension-package discovery (`specs/110-instance-repository/` T113, FR-013): the ' +
    '`node_modules` scan, the classification that tells a tarball install from a workspace link, ' +
    'and the manifest, `ModuleEntry` and schema readers a composition root appends to its one ' +
    "`composeModules` call. Host-internal for `./composition`'s own reason one surface over — this " +
    'is the code that decides which packages are composed at all, so a module that could name it ' +
    'could enumerate, and eventually judge, its siblings. What it finds is merged into the ORM ' +
    "configuration by the host, which is where a module's own schema reaches it from.",
  overlay:
    "the loader that composes a deployment's client-only modules " +
    '(`specs/110-instance-repository/` T114, FR-013): the listing of an overlay root, the ' +
    'unit resolution a compiled tree needs, the id-collision seam both overlay readers go ' +
    'through, and the two loaders a composition root appends to its core list. ' +
    "Host-internal for `./composition`'s own reason — an overlay module is the deployment's " +
    'answer to customising without forking, and the loader that composes one decides which ' +
    'modules a deployment runs at all. It derives no path: the overlay root and the claims ' +
    'already made on a module id are parameters the application supplies.',
};

/** The file a published directory's surface is written in. */
export function barrelKeyOf(subpath: string): string {
  return posix.join(subpath, 'index.ts');
}

/** One name a barrel publishes, and the file it publishes it out of. */
export interface PublishedSymbol {
  /** The exported name, after any `as` rename. */
  readonly name: string;
  /**
   * The file it comes from, keyed relative to the source root with POSIX
   * separators — `http/error-envelope.ts`. A name the barrel *declares* itself
   * is attributed to the barrel.
   */
  readonly target: string;
}

/** Why a barrel could not be read in full — never a reason to report a pass. */
export interface BarrelUnreadable {
  /** The barrel, keyed relative to the source root. */
  readonly barrel: string;
  readonly line: number;
  readonly reason: string;
}

export interface BarrelParse {
  readonly barrel: string;
  readonly published: readonly PublishedSymbol[];
  readonly unreadable: readonly BarrelUnreadable[];
}

/**
 * How a barrel's re-export specifier becomes a file key.
 *
 * Injected because the answer needs the walk's file list — `./ports` is a
 * directory in one tree and a file in another — while {@link parseBarrel} must
 * stay pure over source text so both consumers' fixtures enter at the top.
 * {@link firstCandidate} is the answer for a caller that has no file list: the
 * `.js` → `.ts` rewrite every specifier in this tree's barrels is written as.
 */
export type TargetResolver = (fromKey: string, specifier: string) => string | null;

/** The `.js` → `.ts` rewrite, with no filesystem behind it. */
export const firstCandidate: TargetResolver = (fromKey, specifier) => {
  const joined = resolveRelative(fromKey, specifier);
  if (joined === null) return null;
  return resolutionCandidates(joined)[0] ?? null;
};

/** The exported name of one `export { … }` element, after any `as` rename. */
function exportedName(element: ts.ExportSpecifier): string {
  return element.name.text;
}

/** Names a statement exports by declaring them, or `[]`. */
function locallyExportedNames(node: ts.Node): string[] {
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name !== undefined
  ) {
    return [node.name.text];
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return [node.name.text];
  }
  return [];
}

/**
 * Everything one barrel publishes, and everything about it this parse could not
 * read.
 *
 * Pure over the source text, so both consumers — and every fixture — enter
 * where a real run enters.
 *
 * The three shapes it refuses to guess at are the three that would make the
 * published set come back **short**, which is the direction that turns a
 * correct reach into a finding and, worse, lets an author "repair" it by
 * widening the barrel:
 *
 *   * `export * from './x.js'` — the names are in another file;
 *   * `export * as ns from './x.js'` — a namespace object, whose members no
 *     `exports` map can enumerate;
 *   * `export { X }` with no `from` — a re-export of a local binding whose own
 *     origin this parse does not follow.
 *
 * None of the three occurs in the five barrels today. Each is reported rather
 * than skipped, because a barrel this file reads *partially* is exactly the
 * "green while not looking" shape issue #113 is about.
 */
export function parseBarrel(
  source: string,
  barrel: string,
  resolve: TargetResolver = firstCandidate,
): BarrelParse {
  const sf = ts.createSourceFile(barrel, source, ts.ScriptTarget.Latest, true);
  const published: PublishedSymbol[] = [];
  const unreadable: BarrelUnreadable[] = [];
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  sf.forEachChild((node) => {
    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) {
        unreadable.push({
          barrel,
          line: lineOf(node),
          reason:
            '`export { … }` with no `from` — the names are re-exports of local bindings ' +
            'whose origin this parse does not follow',
        });
        return;
      }
      const target = resolve(barrel, specifier.text);
      if (node.exportClause === undefined) {
        unreadable.push({
          barrel,
          line: lineOf(node),
          reason: `\`export * from '${specifier.text}'\` — the published names are in another file`,
        });
        return;
      }
      if (ts.isNamespaceExport(node.exportClause)) {
        unreadable.push({
          barrel,
          line: lineOf(node),
          reason:
            `\`export * as ${node.exportClause.name.text} from '${specifier.text}'\` — a ` +
            'namespace object, whose members no `exports` map can enumerate',
        });
        return;
      }
      for (const element of node.exportClause.elements) {
        published.push({ name: exportedName(element), target: target ?? barrel });
      }
      return;
    }
    for (const name of locallyExportedNames(node)) published.push({ name, target: barrel });
  });

  return { barrel, published, unreadable };
}

/**
 * A relative specifier from `fromKey`, as a key relative to the same root.
 *
 * The `.js` an ESM specifier carries is rewritten to `.ts`, an extensionless
 * specifier gains one, and a directory specifier gains `/index.ts` — the three
 * shapes this tree writes. `null` for a specifier that is not relative, or that
 * climbs out of the root.
 */
export function resolveRelative(fromKey: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = posix.normalize(posix.join(posix.dirname(fromKey), specifier));
  if (joined.startsWith('..')) return null;
  return joined;
}

/**
 * The host package as a consumer names it (feature 080, T060).
 *
 * A module that has become a workspace package stops writing
 * `../../kernel/index.js` and writes `@endora-commerce/platform/kernel`. Both
 * are the same reach at the same barrel, and until T060 only the first was in
 * the check's population — so a module's platform reaches left the walk the day
 * the module left the tree, 216 of them by the first batch.
 *
 * Neither field is written down anywhere. {@link HostPackage.name} is the name
 * in the manifest of the member declaring `endora.type: "platform"`, and
 * {@link HostPackage.subpathTargets} is that manifest's own `exports` map read
 * back as file keys — so the D-161 scope rename, a sixth published directory
 * and a renamed host all arrive here by being authored once.
 */
export interface HostPackage {
  /** The npm name the host publishes under. */
  readonly name: string;
  /**
   * **Published** subpath (`kernel`) → the barrel's file key, in the caller's
   * own namespace. This is {@link PUBLISHED_SUBPATHS}' population, not the
   * `exports` map's: a subpath the map declares and no barrel carries is in
   * {@link HostPackage.declaredSubpaths} and not here.
   */
  readonly subpathTargets: ReadonlyMap<string, string>;
  /**
   * Every subpath the host's own `exports` map declares, `./package.json`
   * aside — read off the manifest, never written down (`lib/platform-root.ts`'s
   * `platformSubpathsOf`).
   *
   * It exists because the two lists legitimately differ (D-160.14, feature 109;
   * `host-package.md` §2.7.5a). `./composition` carries the 27 composition
   * symbols the host's own root and the test kit need: **declared** by the map,
   * so `node` and `tsc` resolve it, and **published** by no barrel, so no module
   * may name it. Without both lists a reach into it is indistinguishable from a
   * reach into a subpath that does not exist, and the remedy a consumer is
   * handed — *"the map refuses this at resolution time"* — is false.
   *
   * It must not be folded into {@link PUBLISHED_SUBPATHS} either, which was
   * measured: {@link PlatformSurface.published} is keyed by **target file** with
   * no subpath dimension, so a sixth entry there publishes `composeModules` out
   * of `kernel/compose.ts` for every reach at that file, a module's *relative*
   * one included — and because this check reports `violations=0`, the widening
   * would change nothing it prints. A blindness that arrives green.
   */
  readonly declaredSubpaths: ReadonlySet<string>;
}

/** What a bare specifier into the host package names, or nothing. */
export type HostReach =
  | { readonly kind: 'published-subpath'; readonly subpath: string; readonly target: string }
  /**
   * Declared by the `exports` map, carried by no barrel — host composition
   * surface. It resolves for `node` and `tsc`, which is exactly why a module
   * naming it needs a finding of its own: nothing else would stop it.
   */
  | { readonly kind: 'host-internal-subpath'; readonly subpath: string }
  | { readonly kind: 'undeclared-subpath'; readonly subpath: string };

/**
 * The host file a bare specifier names, or `null` when it does not name the
 * host at all.
 *
 * The match is on a **segment boundary**, which is the same care
 * `check-module-boundary`'s `resolveModulePackage` takes and for the same
 * reason: `@endora-commerce/platform-extras` is a different package, and a bare
 * `startsWith` reads it as this one.
 *
 * `null` for a relative specifier, for a third party's, and for every specifier
 * at all when the workspace declares no platform — a fixture workspace
 * legitimately has none, and "no host reach" is the only honest answer there.
 *
 * **Three answers, not two** (D-160.14). A subpath the `exports` map declares
 * and no barrel carries is `host-internal-subpath`, between the published one
 * and the one that does not exist. Collapsing it into either is wrong in a
 * different way: as *published* it would license the reach, and as *undeclared*
 * it would tell the author their specifier does not resolve, which it does.
 */
export function resolveHostSpecifier(
  specifier: string,
  host: HostPackage | null,
): HostReach | null {
  if (host === null || specifier.startsWith('.')) return null;
  if (specifier !== host.name && !specifier.startsWith(`${host.name}/`)) return null;
  const subpath = specifier.slice(host.name.length).replace(/^\//, '');
  const target = host.subpathTargets.get(subpath);
  if (target !== undefined) return { kind: 'published-subpath', subpath, target };
  if (host.declaredSubpaths.has(subpath)) return { kind: 'host-internal-subpath', subpath };
  return { kind: 'undeclared-subpath', subpath };
}

/**
 * Every candidate file a relative specifier could name, most specific first.
 *
 * `.tsx` is here beside `.ts` because a module's sources are no longer only
 * Node code: a module package's `./admin` layer (feature 091) is React
 * components, and a `./pages/Screen.js` specifier inside one resolves to a
 * `.tsx` file or to nothing. Nothing is the fail-closed answer this check gives
 * an unresolvable reach — correct as a default, and wrong here, where the file
 * is there and the candidate list had never heard of its extension.
 */
export function resolutionCandidates(joined: string): readonly string[] {
  const stem = joined.endsWith('.js') ? joined.slice(0, -'.js'.length) : null;
  const candidates = [
    stem === null ? null : `${stem}.ts`,
    stem === null ? null : `${stem}.tsx`,
    joined.endsWith('.ts') || joined.endsWith('.tsx') ? joined : null,
    `${joined}.ts`,
    `${joined}.tsx`,
    posix.join(joined, 'index.ts'),
    posix.join(joined, 'index.tsx'),
  ];
  return candidates.filter((candidate): candidate is string => candidate !== null);
}

/** The platform's published surface, as both consumers read it. */
export interface PlatformSurface {
  /** `<target file>` → the names the barrels publish out of it. */
  readonly published: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * `<target file>` → the barrels that publish it — {@link PlatformSurface.published}'s
   * provenance, which the merge above otherwise drops.
   *
   * It exists for one question {@link PlatformSurface.published} cannot answer:
   * *which subpath carries this file*. A caller holding the `exports` map knows
   * subpath → barrel, so barrel → target closes the chain and a remedy can name
   * the address a reach should have used. Deriving it here rather than in the
   * caller keeps it the same parse the verdict rests on: a second walk of the
   * barrels would be a second answer to "what does this barrel re-export", which
   * is the duplication this file's own header exists to refuse.
   */
  readonly publishedBy: ReadonlyMap<string, ReadonlySet<string>>;
  /** The barrel files themselves — reaching one is reaching the published surface. */
  readonly barrels: ReadonlySet<string>;
  /** Everything the parse could not read. A caller turns a non-empty list into exit 2. */
  readonly unreadable: readonly BarrelUnreadable[];
  /** Barrels that parsed to at least one published name — the `sources=` numerator. */
  readonly barrelsWithExports: number;
}

/**
 * The surface, from the barrel sources.
 *
 * `barrels` is keyed by the barrel's own path relative to the source root, so a
 * caller that hands in fewer than {@link PUBLISHED_SUBPATHS} gets a surface that
 * says so through {@link PlatformSurface.barrelsWithExports} rather than a
 * quietly narrower answer.
 */
export function publishedSurface(
  barrels: ReadonlyMap<string, string>,
  resolve: TargetResolver = firstCandidate,
): PlatformSurface {
  const published = new Map<string, Set<string>>();
  const publishedBy = new Map<string, Set<string>>();
  const unreadable: BarrelUnreadable[] = [];
  let barrelsWithExports = 0;

  for (const [barrel, source] of barrels) {
    const parsed = parseBarrel(source, barrel, resolve);
    unreadable.push(...parsed.unreadable);
    if (parsed.published.length > 0) barrelsWithExports += 1;
    for (const symbol of parsed.published) {
      const names = published.get(symbol.target) ?? new Set<string>();
      names.add(symbol.name);
      published.set(symbol.target, names);
      const carriers = publishedBy.get(symbol.target) ?? new Set<string>();
      carriers.add(barrel);
      publishedBy.set(symbol.target, carriers);
    }
  }

  return {
    published,
    publishedBy,
    barrels: new Set(barrels.keys()),
    unreadable,
    barrelsWithExports,
  };
}
