/**
 * What `backend/src` still holds, and why each file is not in the platform
 * package (`specs/110-instance-repository/` T11A, SC-007).
 *
 * The analysis behind `test/unit/kernel/host-residue-partition.test.ts`. It is a
 * separate file so every red proof in that test can enter at the **top** of it —
 * over an invented file map and invented inputs — rather than below the
 * derivation the proof is supposed to protect (issue #130). Nothing here reads
 * the disk; the caller supplies the population and the four external authors.
 *
 * ## The partition, and where it comes from
 *
 * `research.md` §3.1 classifies the whole of `backend/src` into three, and this
 * is that classification made executable:
 *
 *   - **`shim`** — a re-export shim. It holds nothing: every export forwards to
 *     `@endora-commerce/platform`. It retires with the reaches it forwards.
 *   - **`residual`** — it stays behind. §3.1 enumerates *"5 generated + 4 entry
 *     points + 5 seeds + 8 deployment"*, and its two later corrections add the
 *     bindings and the command entry points.
 *   - **`platform-shaped`** — the move: it holds code and nothing holds it here.
 *
 * **The enumeration is not the rule.** A test carrying §3.1's list of paths
 * would pass today and learn nothing tomorrow (D-100), so the residual class is
 * derived from the rule those files are instances *of*, which is
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` §1:
 *
 * > A file belongs to `@endora-commerce/platform` unless it names a path in the
 * > tree that installs the platform. […] **the platform may not know where the
 * > application is.**
 *
 * So a file is residual when the tree that installs the platform knows where it
 * is, or it knows where the tree is. That question has seven readings below and
 * **six independent authors**, and none of them is a path written down here.
 *
 * ## The seven readings
 *
 * | reading | evidence | author |
 * | --- | --- | --- |
 * | `generated` | its path is one the determinism gate covers | `coveredArtifactPaths()` |
 * | `entry-point` | a `backend/package.json` script spawns its path | the backend manifest |
 * | `deployment` | it sits under a deployment root | the application's own root supplier |
 * | `locates-itself` | its source derives a path from its own location | its own syntax |
 * | `names-this-tree` | it names a path outside the member it sits in | its own syntax, or its text |
 * | `named-by-an-artefact` | a committed generated artefact imports its path | the artefacts' own specifiers |
 * | `reaches-the-residue` | it imports a residual file of this application | the import graph |
 *
 * The last is a closure and is forced rather than chosen: a platform file may
 * not import an application file (D-52/D-53), so a file that reaches the residue
 * cannot move until the value it reaches for arrives as a parameter — which is
 * §1's own remedy, in §1's own words. A **shim does not conduct**: it forwards
 * to the platform, so a file importing one could name the platform instead.
 *
 * `named-by-an-artefact` is the reverse edge and is deliberately narrow — only a
 * *generated* artefact's specifier counts, because that specifier is a path a
 * generator wrote into a committed file, so moving the target breaks the
 * artefact. `backend/src/overlay/types.ts` is the worked example and says so in
 * its own doc block: *"every deployment's generated divergence artefact names it
 * by a **relative** path, deliberately"*.
 *
 * ## The one reading a non-source file gets, and its bound
 *
 * A file the TypeScript dialect cannot read is asked the same question of its
 * **text**: does it name a path under the application root? That is
 * `names-this-tree` in a second dialect and not a fourth class. It is the
 * weakest reading in the table — any prose mentioning `backend/…` satisfies it —
 * and the bound is stated rather than discovered: prose cannot become a
 * composition root, which is the thing the strict readings protect against. A
 * non-source file naming nothing of this tree still falls in no class and fails.
 */

import { dirname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/** §3.1's three classes. `null` is the failure: a file in no class. */
export type HostFileClass = 'shim' | 'residual' | 'platform-shaped' | null;

/** Which reading of `operator-half.md` §1 put a file in the residual class. */
export type ResidueReading =
  | 'generated'
  | 'entry-point'
  | 'deployment'
  | 'locates-itself'
  | 'names-this-tree'
  | 'named-by-an-artefact'
  | 'reaches-the-residue';

export interface ClassifiedFile {
  /** Repository-relative, one namespace for every path this analysis prints. */
  readonly path: string;
  readonly klass: HostFileClass;
  /** The reading, for a residual file; `null` for the other two classes. */
  readonly reading: ResidueReading | null;
  /** The evidence, in the words a reader needs to disagree with it. */
  readonly evidence: string;
}

/**
 * Everything the analysis is given. Every field is a *derived* fact with an
 * author outside this file — the point of the shape is that a fixture supplies
 * them the same way the real run does.
 */
export interface HostResidueInput {
  /** Repository root, absolute. Every printed path is relative to it. */
  readonly repoRoot: string;
  /** The member `backend/src` sits in — `<repoRoot>/backend`, absolute. */
  readonly applicationRoot: string;
  /** The population's root — `<repoRoot>/backend/src`, absolute. */
  readonly sourceRoot: string;
  /** The platform package's directory, absolute. Its `dist` is what a shim names. */
  readonly platformPackageRoot: string;
  /** The platform package's name, for the bare specifiers a shim writes. */
  readonly platformPackageName: string;
  /** Every file under {@link sourceRoot}, absolute path to source text. */
  readonly files: ReadonlyMap<string, string>;
  /** Absolute paths the determinism gate covers. Only those under the source root are used. */
  readonly generatedArtefacts: readonly string[];
  /** Absolute paths a `package.json` script spawns. */
  readonly entryPoints: readonly string[];
  /** Absolute deployment directories, from the application's own root supplier. */
  readonly deploymentRoots: readonly string[];
}

/**
 * One external author, reconciled against the population.
 *
 * `declared` is what that author says exists under the source root; `covered` is
 * how much of it the walk actually produced. The two are printed as
 * `<name>:<covered>/<declared>` and a shortfall is a refusal, not a finding: an
 * author whose paths the walk cannot see has gone blind, and every file it would
 * have classified silently becomes somebody else's class (issue #215).
 */
export interface AuthorCoverage {
  readonly declared: number;
  readonly covered: number;
  /** What the author named and the walk did not produce, repository-relative. */
  readonly missing: readonly string[];
}

export interface HostResidueResult {
  readonly files: readonly ClassifiedFile[];
  /** Files whose text the TypeScript dialect could read — the syntax walk's own size. */
  readonly parsed: number;
  /** The three external authors, each reconciled against the population. */
  readonly sources: {
    readonly generatedArtefacts: AuthorCoverage;
    readonly entryPoints: AuthorCoverage;
    readonly deploymentRoots: AuthorCoverage;
  };
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function under(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/**
 * The specifiers a file names, as literal AST nodes.
 *
 * Literal nodes rather than a text scan, for the reason every check in this
 * estate reads them that way: a path quoted in a doc block is prose about the
 * tree and not a reach into it, and `backend/src` is full of doc blocks quoting
 * paths. The five files whose headers name `packages/platform/dist` in prose are
 * the measured case.
 */
interface FileSyntax {
  /** Module-level statements that are neither an import nor a re-export. */
  readonly ownDeclarations: number;
  readonly reexports: readonly string[];
  readonly specifiers: readonly string[];
  /** `import.meta.url`, `process.cwd()` or `__dirname`, as expressions and not as prose. */
  readonly locatesItself: boolean;
}

/**
 * Does this file derive a path from where it is?
 *
 * Read as expressions rather than as text, for the same reason the specifiers
 * are: `backend/src` is full of doc blocks explaining *why* a neighbouring file
 * computes a root from `import.meta.url`, and a text scan would file every one
 * of those explanations as the thing it explains.
 */
function derivesItsOwnLocation(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    const { expression, name } = node;
    if (ts.isMetaProperty(expression) && expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
      if (name.text === 'url' || name.text === 'dirname' || name.text === 'filename') return true;
    }
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    node.expression.name.text === 'cwd'
  ) {
    return true;
  }
  if (ts.isIdentifier(node) && (node.text === '__dirname' || node.text === '__filename')) {
    // Not a property name, not a declaration's own name — a read of the value.
    const parent = node.parent as ts.Node | undefined;
    if (parent === undefined) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
    return true;
  }
  return ts.forEachChild(node, derivesItsOwnLocation) === true;
}

function readSyntax(path: string, text: string): FileSyntax {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let ownDeclarations = 0;
  const reexports: string[] = [];
  const specifiers: string[] = [];
  const locatesItself = ts.forEachChild(sourceFile, derivesItsOwnLocation) === true;
  for (const statement of sourceFile.statements) {
    const isImport = ts.isImportDeclaration(statement);
    const isExportFrom = ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;
    if (!isImport && !isExportFrom) {
      ownDeclarations += 1;
      continue;
    }
    const moduleSpecifier = isImport
      ? statement.moduleSpecifier
      : (statement as ts.ExportDeclaration).moduleSpecifier;
    if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) continue;
    specifiers.push(moduleSpecifier.text);
    if (isExportFrom) reexports.push(moduleSpecifier.text);
  }
  return { ownDeclarations, reexports, specifiers, locatesItself };
}

/**
 * A path token in prose, resolved against the repository root.
 *
 * The dialect a non-source file is read in. Deliberately generous about what
 * looks like a path and strict about where it has to land: the question is
 * whether the text names *this* tree, and a token that does not resolve under
 * the application root answers no.
 */
function textNamesThisTree(text: string, repoRoot: string, applicationRoot: string): string | null {
  for (const match of text.matchAll(/[A-Za-z0-9_@./-]+\/[A-Za-z0-9_@./*-]+/g)) {
    const token = match[0].replace(/[.,;:)`'"]+$/, '');
    if (token.startsWith('/') || token.includes('://')) continue;
    const resolved = resolve(repoRoot, token);
    if (under(applicationRoot, resolved)) return token;
  }
  return null;
}

/** Does this specifier name the platform package, in either spelling a shim writes? */
function namesThePlatform(
  specifier: string,
  fromDir: string,
  platformPackageRoot: string,
  platformPackageName: string,
): boolean {
  if (specifier === platformPackageName || specifier.startsWith(platformPackageName + '/')) return true;
  if (!specifier.startsWith('.')) return false;
  return under(platformPackageRoot, resolve(fromDir, specifier));
}

/**
 * Where a relative specifier lands in the population.
 *
 * `.js` is rewritten to the source extensions, because every specifier in this
 * tree is written as the emitted name and every file in the population is a
 * source one.
 */
function resolveInPopulation(
  specifier: string,
  fromDir: string,
  files: ReadonlyMap<string, string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = resolve(fromDir, specifier);
  const candidates = [target, ...SOURCE_EXTENSIONS.map((ext) => target.replace(/\.[cm]?js$/, ext))];
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return null;
}

export function partitionHostResidue(input: HostResidueInput): HostResidueResult {
  const {
    repoRoot,
    applicationRoot,
    sourceRoot,
    platformPackageRoot,
    platformPackageName,
    files,
  } = input;

  const paths = [...files.keys()].sort();
  const rel = (path: string): string => relative(repoRoot, path);

  const declaredGenerated = input.generatedArtefacts.filter((path) => under(sourceRoot, path));
  const declaredEntryPoints = input.entryPoints.filter((path) => under(sourceRoot, path));
  const declaredDeployments = input.deploymentRoots.filter((root) => under(sourceRoot, root));

  const generated = new Set(declaredGenerated.filter((path) => files.has(path)));
  const entryPoints = new Set(declaredEntryPoints.filter((path) => files.has(path)));
  const deploymentRoots = declaredDeployments.filter((root) =>
    paths.some((path) => under(root, path)),
  );

  const syntax = new Map<string, FileSyntax>();
  for (const path of paths) {
    if (!isSource(path)) continue;
    syntax.set(path, readSyntax(path, files.get(path) ?? ''));
  }

  // The reverse edge: a committed generated artefact naming a path in the
  // population pins that path, because the specifier is in a committed file.
  const namedByAnArtefact = new Map<string, string>();
  for (const artefact of generated) {
    const text = files.get(artefact);
    if (text === undefined) continue;
    const parsed = syntax.get(artefact) ?? (isSource(artefact) ? readSyntax(artefact, text) : null);
    if (parsed === null) continue;
    for (const specifier of parsed.specifiers) {
      const target = resolveInPopulation(specifier, dirname(artefact), files);
      if (target !== null && target !== artefact && !namedByAnArtefact.has(target)) {
        namedByAnArtefact.set(target, `${rel(artefact)} imports it as '${specifier}'`);
      }
    }
  }

  const klass = new Map<string, HostFileClass>();
  const reading = new Map<string, ResidueReading>();
  const evidence = new Map<string, string>();

  const record = (path: string, k: HostFileClass, r: ResidueReading | null, why: string): void => {
    klass.set(path, k);
    if (r !== null) reading.set(path, r);
    evidence.set(path, why);
  };

  for (const path of paths) {
    if (generated.has(path)) {
      record(path, 'residual', 'generated', 'the determinism gate renders this path');
      continue;
    }
    if (entryPoints.has(path)) {
      record(path, 'residual', 'entry-point', "a backend package script spawns this path");
      continue;
    }
    const deployment = deploymentRoots.find((root) => under(root, path));
    if (deployment !== undefined) {
      record(path, 'residual', 'deployment', `under the deployment root ${rel(deployment)}`);
      continue;
    }

    const parsed = syntax.get(path);
    if (parsed === undefined) {
      const named = textNamesThisTree(files.get(path) ?? '', repoRoot, applicationRoot);
      if (named !== null) {
        record(path, 'residual', 'names-this-tree', `its text names ${named}`);
      } else {
        record(path, null, null, 'not source, and its text names no path in this tree');
      }
      continue;
    }

    const forwards =
      parsed.ownDeclarations === 0 &&
      parsed.reexports.length > 0 &&
      parsed.reexports.every((specifier) =>
        namesThePlatform(specifier, dirname(path), platformPackageRoot, platformPackageName),
      );
    if (forwards) {
      record(path, 'shim', null, `every export forwards to ${platformPackageName}`);
      continue;
    }

    if (parsed.locatesItself) {
      record(path, 'residual', 'locates-itself', 'its source derives a path from its own location');
      continue;
    }

    const escaping = parsed.specifiers.find((specifier) => {
      if (!specifier.startsWith('.')) return false;
      const target = resolve(dirname(path), specifier);
      return !under(applicationRoot, target);
    });
    if (escaping !== undefined) {
      record(path, 'residual', 'names-this-tree', `it names '${escaping}', outside ${rel(applicationRoot)}`);
      continue;
    }

    const pinned = namedByAnArtefact.get(path);
    if (pinned !== undefined) {
      record(path, 'residual', 'named-by-an-artefact', pinned);
      continue;
    }

    record(path, 'platform-shaped', null, 'it holds code and names no path in this tree');
  }

  // A barrel over shims is itself the bridge, one hop out. `packages/index.ts`
  // is the live case: it holds nothing, and every symbol it publishes comes from
  // the platform through the three shims beside it, so it drains with them
  // rather than moving anywhere. The hop is what makes it a closure and not a
  // clause — a barrel over barrels is the same file one level further out.
  for (;;) {
    let moved = false;
    for (const path of paths) {
      if (klass.get(path) !== 'platform-shaped') continue;
      const parsed = syntax.get(path);
      if (parsed === undefined || parsed.ownDeclarations > 0 || parsed.reexports.length === 0) continue;
      const forwardsThroughShims = parsed.specifiers.every((specifier) => {
        if (namesThePlatform(specifier, dirname(path), platformPackageRoot, platformPackageName)) return true;
        const target = resolveInPopulation(specifier, dirname(path), files);
        return target !== null && klass.get(target) === 'shim';
      });
      if (!forwardsThroughShims) continue;
      record(path, 'shim', null, `every export forwards to ${platformPackageName} through the shims beside it`);
      moved = true;
    }
    if (!moved) break;
  }

  // The residue's closure. A shim does not conduct; neither does a file already
  // residual, which is why this runs over the platform-shaped set alone.
  for (;;) {
    let moved = false;
    for (const path of paths) {
      if (klass.get(path) !== 'platform-shaped') continue;
      const parsed = syntax.get(path);
      if (parsed === undefined) continue;
      for (const specifier of parsed.specifiers) {
        const target = resolveInPopulation(specifier, dirname(path), files);
        if (target === null || klass.get(target) !== 'residual') continue;
        record(
          path,
          'residual',
          'reaches-the-residue',
          `it imports '${specifier}', which is ${rel(target)} — ${evidence.get(target) ?? ''}`,
        );
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }

  return {
    files: paths.map((path) => ({
      path: rel(path),
      klass: klass.get(path) ?? null,
      reading: reading.get(path) ?? null,
      evidence: evidence.get(path) ?? '',
    })),
    parsed: syntax.size,
    sources: {
      generatedArtefacts: {
        declared: declaredGenerated.length,
        covered: generated.size,
        missing: declaredGenerated.filter((path) => !generated.has(path)).map(rel),
      },
      entryPoints: {
        declared: declaredEntryPoints.length,
        covered: entryPoints.size,
        missing: declaredEntryPoints.filter((path) => !entryPoints.has(path)).map(rel),
      },
      deploymentRoots: {
        declared: declaredDeployments.length,
        covered: deploymentRoots.length,
        missing: declaredDeployments.filter((root) => !deploymentRoots.includes(root)).map(rel),
      },
    },
  };
}
