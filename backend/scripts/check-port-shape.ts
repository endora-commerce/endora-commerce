/**
 * CI check — a published port declares no **optional method** (D-97.3).
 *
 * ## Why this is a type rule and not advice
 *
 * A consumer that wants to know whether a provider implements something asks
 * the object. Through a port it cannot: `lazyPort` hands back a `Proxy` whose
 * `get` trap answers *every* non-symbol property with a function
 * (`src/kernel/lazy-port.ts`), so `x.maybe`, `!x.maybe` and
 * `typeof x.maybe === 'function'` are all truthy whatever is registered, and
 * `x.maybe?.()` therefore always calls — into a provider that does not
 * implement it, where the forward throws `'…' is not a function`.
 *
 * **And the proxy cannot be repaired.** Making the trap honest means resolving
 * the name at *property-access* time to look at the real object, and for a
 * gated port that turns a `typeof` probe into a `ModuleDisabledError`: a
 * presence check that throws when the module is absent is worse than the hazard
 * it fixes, and deferring resolution to the call is the entire reason `lazyPort`
 * exists. The runtime cannot be made to answer, so the type has to forbid the
 * question.
 *
 * `tsc` is silent on both halves: the member is optional, and `lazyPort<T>`'s
 * `T` is an assertion rather than a check. That is why a check reads the shape.
 *
 * The one occurrence this rule was written from —
 * `catalog`'s `AttributeDefinitionSource`, widening the custom-field read port
 * with `publishInvalidate?` — fired its recovery branch on every integrity
 * error and turned a benign, self-healing cache window into a 500 on the
 * attribute screens. D-97.1 deleted it, so this check is born green with red
 * proofs behind it and **no ledger**: there is nothing to drain, and an entry
 * would be a licence to re-open the only hole the rule has ever had.
 *
 * ## What it reads
 *
 *  1. **Published ports** — an exported `interface` in `packages/contracts/src`
 *     whose doc block carries the `Container name:` line every port in the tree
 *     is introduced by. That sweep is the same one the published-port-vs-provider
 *     check will use; this is its first signal, and the provider-conformance
 *     ones join it here rather than in a second script over the same inputs.
 *  2. **Interfaces extending one** — an `interface X extends <port>` anywhere in
 *     `backend/src/modules` or `backend/src/apps`, or in the contracts package
 *     itself. A widening is the shape that actually happened; refusing it only
 *     at the published type would refuse the tidy half.
 *
 * A member is an optional method when it is a `foo?(…): T` signature **or** a
 * `foo?: (…) => T` property, because those are the same promise written twice.
 * Optional *parameters* and optional *data properties* are untouched — all 34
 * optional members across the tree's ports are of that kind, and none is
 * affected.
 *
 * Usage: `tsx scripts/check-port-shape.ts [--list]`
 * Exit 0 = no optional method on a port; exit 1 = at least one;
 * exit 2 = nothing was read — no sources, or no port type in the contracts
 * package, which would make a green mean "not looking" (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BACKEND_SRC = join(HERE, '..', 'src');
const CONTRACTS_SRC = join(HERE, '..', '..', 'packages', 'contracts', 'src');

/** The line every port's doc block carries, and the only marker that finds one. */
const PORT_DOC_MARKER = 'Container name:';

export type PortShapeFindingKind =
  /** The optional method is on the published port type itself. */
  | 'optional-method-on-port'
  /** The optional method is on an interface that `extends` a published port. */
  | 'optional-method-on-port-extension';

export interface PortShapeFinding {
  /** Path as the caller keyed it. */
  readonly file: string;
  readonly line: number;
  /** The interface the member is declared on. */
  readonly typeName: string;
  /** The published port the type is, or extends. */
  readonly portName: string;
  readonly member: string;
  readonly kind: PortShapeFindingKind;
}

export interface PortShapeInput {
  /** Contract sources, keyed however the caller likes (the key is reported). */
  readonly contracts: ReadonlyMap<string, string>;
  /** Module sources — `src/modules/**`, `src/apps/**`. */
  readonly modules: ReadonlyMap<string, string>;
}

export interface PortShapeResult {
  /** Every published port type found, by name. Empty means "not looking". */
  readonly portTypes: readonly string[];
  readonly findings: readonly PortShapeFinding[];
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Whether the declaration's own doc comment introduces a container name. */
function hasPortDocBlock(node: ts.InterfaceDeclaration, text: string): boolean {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  return ranges.some((range) => text.slice(range.pos, range.end).includes(PORT_DOC_MARKER));
}

function interfaces(sf: ts.SourceFile): ts.InterfaceDeclaration[] {
  const found: ts.InterfaceDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) found.push(node);
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/** The names an interface extends, as written (type arguments dropped). */
function extendedNames(node: ts.InterfaceDeclaration): string[] {
  const names: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) {
      if (ts.isIdentifier(type.expression)) names.push(type.expression.text);
    }
  }
  return names;
}

/**
 * The optional **methods** of an interface.
 *
 * Both spellings, because they are one promise: `foo?(): void` is a
 * `MethodSignature` with a question token, `foo?: () => void` a
 * `PropertySignature` whose type is a function. A `foo?: string` is a data
 * property and is deliberately outside the population.
 */
function optionalMethods(node: ts.InterfaceDeclaration): ts.TypeElement[] {
  return node.members.filter((member) => {
    if (member.questionToken === undefined) return false;
    if (ts.isMethodSignature(member)) return true;
    if (ts.isPropertySignature(member) && member.type !== undefined) {
      return ts.isFunctionTypeNode(member.type);
    }
    return false;
  });
}

function memberName(member: ts.TypeElement): string {
  const name = member.name;
  if (name === undefined) return '(computed)';
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

/**
 * Every published port, and every optional method on one or on a widening
 * of one.
 *
 * The input is **source text**, so a fixture enters exactly where a real run
 * does (issue #130): nothing above this function classifies anything.
 */
export function checkPortShape(input: PortShapeInput): PortShapeResult {
  const parsedContracts = new Map<string, ts.SourceFile>();
  const portTypes = new Set<string>();

  for (const [file, text] of input.contracts) {
    const sf = parse(file, text);
    parsedContracts.set(file, sf);
    for (const node of interfaces(sf)) {
      if (hasPortDocBlock(node, text)) portTypes.add(node.name.text);
    }
  }

  const findings: PortShapeFinding[] = [];
  const scan = (file: string, sf: ts.SourceFile): void => {
    for (const node of interfaces(sf)) {
      const own = portTypes.has(node.name.text);
      const extended = extendedNames(node).find((name) => portTypes.has(name));
      if (!own && extended === undefined) continue;
      // A port type declaring an optional method is the stronger finding, so a
      // type that is both a port and an extension is reported as the port.
      const kind: PortShapeFindingKind = own
        ? 'optional-method-on-port'
        : 'optional-method-on-port-extension';
      const portName = own ? node.name.text : (extended as string);
      for (const member of optionalMethods(node)) {
        findings.push({
          file,
          line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
          typeName: node.name.text,
          portName,
          member: memberName(member),
          kind,
        });
      }
    }
  };

  for (const [file, sf] of parsedContracts) scan(file, sf);
  for (const [file, text] of input.modules) scan(file, parse(file, text));

  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { portTypes: [...portTypes].sort(), findings };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function read(root: string, files: string[], prefix: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(`${prefix}${relative(root, file).split('\\').join('/')}`, readFileSync(file, 'utf8'));
  }
  return sources;
}

function main(): void {
  const listMode = process.argv.includes('--list');

  const contractFiles = walk(CONTRACTS_SRC);
  const moduleFiles = [
    ...walk(join(BACKEND_SRC, 'modules')),
    ...walk(join(BACKEND_SRC, 'apps')),
  ];
  if (contractFiles.length === 0 || moduleFiles.length === 0) {
    console.error(
      '[port-shape] no sources under packages/contracts/src or backend/src/modules — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const input: PortShapeInput = {
    contracts: read(CONTRACTS_SRC, contractFiles, 'contracts/'),
    modules: read(BACKEND_SRC, moduleFiles, ''),
  };
  const result = checkPortShape(input);

  if (result.portTypes.length === 0) {
    console.error(
      `[port-shape] no published port found in ${contractFiles.length} contract files — ` +
        `the '${PORT_DOC_MARKER}' doc convention changed, and a green here would mean ` +
        `"not looking" rather than "clean"`,
    );
    process.exit(2);
  }

  if (listMode) {
    for (const name of result.portTypes) console.log(`PORT ${name}`);
    console.log('');
  }

  console.log(
    `[port-shape] ports=${result.portTypes.length} ` +
      `contract-files=${contractFiles.length} module-files=${moduleFiles.length} ` +
      `violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA published port declares an optional method, so a consumer can neither detect it\n' +
        'nor safely call it: `lazyPort`\'s proxy answers every property with a function, and\n' +
        'the forward throws when the provider has none (D-97.3).\n' +
        'Make the method required, or ask a question the provider can always answer — the\n' +
        'freshness guarantee `listForEntityFresh` replaced `publishInvalidate?` with is the\n' +
        'worked example.\n',
    );
    for (const finding of result.findings) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.typeName}.${finding.member}?() ` +
          `[${finding.kind}, port ${finding.portName}]`,
      );
    }
  }

  process.exit(result.findings.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
