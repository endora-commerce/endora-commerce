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
 * A ruling (D-160.7), not a measurement — see the header. `db`, `overlay` and
 * `packages` are absent on purpose and their absence is the whole of §1.4f and
 * §1.4l: a reach into one of them is unpublished by construction.
 */
export const PUBLISHED_SUBPATHS: readonly string[] = [
  'kernel',
  'http',
  'tenancy',
  'commands',
  'events',
];

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

/** Every candidate file a relative specifier could name, most specific first. */
export function resolutionCandidates(joined: string): readonly string[] {
  const candidates = [
    joined.endsWith('.js') ? `${joined.slice(0, -'.js'.length)}.ts` : null,
    joined.endsWith('.ts') ? joined : null,
    `${joined}.ts`,
    posix.join(joined, 'index.ts'),
  ];
  return candidates.filter((candidate): candidate is string => candidate !== null);
}

/** The platform's published surface, as both consumers read it. */
export interface PlatformSurface {
  /** `<target file>` → the names the barrels publish out of it. */
  readonly published: ReadonlyMap<string, ReadonlySet<string>>;
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
    }
  }

  return {
    published,
    barrels: new Set(barrels.keys()),
    unreadable,
    barrelsWithExports,
  };
}
