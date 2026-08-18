/**
 * CI check — a published port's **shape**: it declares no optional method
 * (D-97.3), and the container name in its doc block is the name it is actually
 * registered under (issue #192).
 *
 * Two signals over one population, because both read the same thing: the doc
 * block that makes an interface a published port, and what `backend/src/modules`
 * does with the name in it.
 *
 * ## Signal 2 — the documented container name (issue #192)
 *
 * `port-publication.md` §1.2 makes the container name part of the contract: it
 * is the literal a consumer copies into `lazyPort<T>(ctx, 'thatName')`. Nothing
 * checked it, and on the tree this signal was written against it was wrong six
 * times out of 97 — four naming a container nothing registers, and **two naming
 * the ungated legacy service the port was published to replace**. That second
 * pair is why this is a build failure rather than tidiness: a consumer following
 * `AdminRolePort`'s doc resolved `adminRoleService`, a plain `di.register` with
 * no presence gate, whose `list()` returns `AdminRole` **entities** — and
 * `AdminRole` is structurally assignable to `AdminRoleRecord`, so `tsc` said
 * nothing. A doc that teaches a Principle XVII violation is worse than no doc.
 *
 * Two shapes are refused:
 *
 *  - **`container-name-unregistered`** — the documented name appears in no
 *    `di.register` and no `di.providePort` anywhere under `src/modules` or
 *    `src/apps`. A consumer copying it gets
 *    `[kernel] '…' is not registered in this composition` at first call.
 *  - **`container-name-not-the-gated-registration`** — the port type *is*
 *    registered, by a typed `di.providePort<T>('X', …)`, and the doc names some
 *    other container. Whatever `Y` is, it is not the gate; where it happens to
 *    exist it is the ungated twin, which is the fail-open trap above.
 *
 * The second shape needs the registration's **type argument**, so it sees only
 * the 81 of 134 `providePort` calls that carry one. That is not a weakness of
 * this check but the reason A12 wants `providePort<T>` made non-inferrable: an
 * untyped registration compares nothing, here or in `tsc`.
 *
 * `PORTS_WITHOUT_A_REGISTRATION` is the ledger for the first shape, two-way and
 * empty since D-98.5. It is not a debt list to grow — an entry says why a
 * published interface with no provider is standing, and the check refuses a
 * stale one.
 *
 * ## Signal 1 — why the optional-method rule is a type rule and not advice
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
 *     is introduced by. One parse, `portDocOf`, answers both "is this a port?"
 *     and "which container does it name?", so the two signals cannot come to
 *     disagree about the population.
 *  2. **Interfaces extending one** — an `interface X extends <port>` anywhere in
 *     `backend/src/modules` or `backend/src/apps`, or in the contracts package
 *     itself. A widening is the shape that actually happened; refusing it only
 *     at the published type would refuse the tidy half.
 *  3. **Registrations** — `di.register` keys and `di.providePort` names in the
 *     same module sources, read through `check-port-dependencies.ts`'s
 *     `registeredNames` / `providedPorts`. Imported rather than re-derived: a
 *     second expression of "this call is a registration" is a rule that can go
 *     half-missing while the check still prints `violations=0`.
 *
 * A member is an optional method when it is a `foo?(…): T` signature **or** a
 * `foo?: (…) => T` property, because those are the same promise written twice.
 * Optional *parameters* and optional *data properties* are untouched — all 34
 * optional members across the tree's ports are of that kind, and none is
 * affected.
 *
 * Usage: `tsx scripts/check-port-shape.ts [--list]`
 * Exit 0 = clean; exit 1 = at least one finding, of either signal;
 * exit 2 = nothing was read — no sources, no port type in the contracts
 * package, or **no registration in the module scan**, each of which would make a
 * green mean "not looking" (issue #113). The third is the guard signal 2 needs:
 * a registration map that came back empty would report every one of the 97 ports
 * as unregistered, and a reader who "fixed" that by widening the ledger would
 * have turned the whole check off.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { providedPorts, registeredNames } from './check-port-dependencies.js';

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

export type PortNameFindingKind =
  /** The documented container name is registered nowhere. */
  | 'container-name-unregistered'
  /**
   * The port type is registered by a typed `providePort<T>`, under a name the
   * doc block does not give. Where the documented name exists at all it is the
   * ungated twin, and that is the fail-open half of this signal.
   */
  | 'container-name-not-the-gated-registration';

export interface PortNameFinding {
  /** Contract file, as the caller keyed it. */
  readonly file: string;
  readonly line: number;
  /** The published port type. */
  readonly portName: string;
  /** The container name the doc block gives. */
  readonly documented: string;
  /**
   * The name the port is really registered under, for
   * `container-name-not-the-gated-registration`; `null` for the unregistered
   * shape, where there is nothing to point at.
   */
  readonly registered: string | null;
  /**
   * How the documented name *is* registered, when it is: `'plain'` for a
   * `di.register` key, `'gated'` for a `di.providePort`. `null` when nothing
   * registers it. A `'plain'` here is the trap — an ungated registration behind
   * a name the contract advertises.
   */
  readonly documentedRegistrationKind: 'plain' | 'gated' | null;
  readonly kind: PortNameFindingKind;
}

/**
 * Published interfaces with no registration behind them, and why each stands.
 *
 * **Two-way**: an entry whose port has gained a registration, or whose port no
 * longer exists, fails the check as stale. This is not a queue to add to — a
 * port nobody provides is what `@b2b/contracts` would publish to the outside
 * world at F4, so an entry is a decision that has been taken and recorded, not
 * one deferred.
 *
 * **Empty, which is the state this ledger should be in.** Its one entry was
 * `ModuleManifestReadPort`, standing unprovided while Q2 of the Phase-P
 * unreached-port audit was open; D-98.5 answered it — module manifests are
 * platform-owned and the interface is deleted — by the retirement condition
 * that entry itself named.
 */
export const PORTS_WITHOUT_A_REGISTRATION: Readonly<Record<string, string>> = {};

export interface PortShapeInput {
  /** Contract sources, keyed however the caller likes (the key is reported). */
  readonly contracts: ReadonlyMap<string, string>;
  /** Module sources — `src/modules/**`, `src/apps/**`. */
  readonly modules: ReadonlyMap<string, string>;
  /** Defaults to {@link PORTS_WITHOUT_A_REGISTRATION}; a fixture overrides it. */
  readonly unregisteredLedger?: Readonly<Record<string, string>>;
}

export interface PortShapeResult {
  /** Every published port type found, by name. Empty means "not looking". */
  readonly portTypes: readonly string[];
  readonly findings: readonly PortShapeFinding[];
  /** Signal 2 — the documented container name against the registered one. */
  readonly nameFindings: readonly PortNameFinding[];
  /**
   * How many distinct container names the module scan saw. Zero means the scan
   * read nothing, which the CLI turns into exit 2 rather than into 97 findings.
   */
  readonly registeredNameCount: number;
  /** Ledger entries whose port is registered now, or no longer published. */
  readonly staleLedgerEntries: readonly string[];
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** What a port's doc block declares. `container` is `null` when it is unparseable. */
interface PortDoc {
  readonly container: string | null;
}

/**
 * The declaration's port doc block, or `null` when it has none.
 *
 * The single answer to "is this a published port?" — signal 1 asks it to build
 * the population and signal 2 asks it for the name, so neither can drift into
 * its own idea of what a port is.
 */
function portDocOf(node: ts.InterfaceDeclaration, text: string): PortDoc | null {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  const block = ranges
    .map((range) => text.slice(range.pos, range.end))
    .find((comment) => comment.includes(PORT_DOC_MARKER));
  if (block === undefined) return null;
  const named = /Container name:\s*`([^`]+)`/.exec(block);
  return { container: named?.[1] ?? null };
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
  /** Every published port, with where it is declared and what it documents. */
  const published: Array<{
    readonly portName: string;
    readonly file: string;
    readonly line: number;
    readonly container: string | null;
  }> = [];

  for (const [file, text] of input.contracts) {
    const sf = parse(file, text);
    parsedContracts.set(file, sf);
    for (const node of interfaces(sf)) {
      const doc = portDocOf(node, text);
      if (doc === null) continue;
      portTypes.add(node.name.text);
      published.push({
        portName: node.name.text,
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        container: doc.container,
      });
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

  // --- signal 2: the documented container name -------------------------------
  //
  // Both registration readers come from `check-port-dependencies.ts`, which owns
  // the "this call is a registration" predicate. `registeredNames` already
  // covers `providePort` names, so `plainNames` is derived by subtraction rather
  // than by a second parse deciding the same thing differently.
  const allNames = new Set<string>();
  const gatedNames = new Set<string>();
  /** Container name a typed `providePort<T>` gives each port type. */
  const gatedNameOfType = new Map<string, string>();
  for (const [file, text] of input.modules) {
    for (const name of registeredNames(text, file)) allNames.add(name);
    for (const port of providedPorts(text, file)) {
      gatedNames.add(port.name);
      if (port.typeName !== null && !gatedNameOfType.has(port.typeName)) {
        gatedNameOfType.set(port.typeName, port.name);
      }
    }
  }

  const ledger = input.unregisteredLedger ?? PORTS_WITHOUT_A_REGISTRATION;
  const nameFindings: PortNameFinding[] = [];
  const ledgerHits = new Set<string>();

  for (const port of published) {
    if (port.container === null) continue;
    const registeredKind = gatedNames.has(port.container)
      ? 'gated'
      : allNames.has(port.container)
        ? 'plain'
        : null;
    const gatedName = gatedNameOfType.get(port.portName);

    if (registeredKind === null) {
      if (ledger[port.portName] !== undefined) {
        ledgerHits.add(port.portName);
        continue;
      }
      nameFindings.push({
        file: port.file,
        line: port.line,
        portName: port.portName,
        documented: port.container,
        registered: gatedName ?? null,
        documentedRegistrationKind: null,
        kind: 'container-name-unregistered',
      });
      continue;
    }

    if (gatedName !== undefined && gatedName !== port.container) {
      nameFindings.push({
        file: port.file,
        line: port.line,
        portName: port.portName,
        documented: port.container,
        registered: gatedName,
        documentedRegistrationKind: registeredKind,
        kind: 'container-name-not-the-gated-registration',
      });
    }
  }

  nameFindings.sort((a, b) => a.portName.localeCompare(b.portName));
  const staleLedgerEntries = Object.keys(ledger)
    .filter((portName) => !ledgerHits.has(portName))
    .sort();

  return {
    portTypes: [...portTypes].sort(),
    findings,
    nameFindings,
    registeredNameCount: allNames.size,
    staleLedgerEntries,
  };
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

  if (result.registeredNameCount === 0) {
    console.error(
      `[port-shape] the scan of ${moduleFiles.length} module files found no container ` +
        `registration at all — every published port would read as unregistered, so this ` +
        `is "not looking" rather than a result (issue #113)`,
    );
    process.exit(2);
  }

  if (listMode) {
    for (const name of result.portTypes) console.log(`PORT ${name}`);
    console.log('');
  }

  const violations =
    result.findings.length + result.nameFindings.length + result.staleLedgerEntries.length;
  console.log(
    `[port-shape] ports=${result.portTypes.length} ` +
      `contract-files=${contractFiles.length} module-files=${moduleFiles.length} ` +
      `registered-names=${result.registeredNameCount} ` +
      `ledgered-unregistered=${Object.keys(PORTS_WITHOUT_A_REGISTRATION).length} ` +
      `violations=${violations}`,
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

  if (result.nameFindings.length > 0) {
    console.error(
      "\nA published port's doc block names a container that is not the registration\n" +
        '(port-publication.md §1.2). The name is what a consumer copies into\n' +
        "`lazyPort<T>(ctx, 'thatName')`, and nothing else in the tree checks it: an\n" +
        'unregistered name fails at first call, and a name that resolves to the ungated\n' +
        'legacy service does not fail at all — it hands the class across with no\n' +
        '`MODULE_DISABLED` gate, and `tsc` is satisfied by the structural match.\n' +
        'Correct the doc block, or register the name it gives.\n',
    );
    for (const finding of result.nameFindings) {
      const target =
        finding.registered === null
          ? 'registered by nothing'
          : `registered as \`${finding.registered}\``;
      const documented =
        finding.documentedRegistrationKind === null
          ? 'nothing registers it'
          : `that name is a ${finding.documentedRegistrationKind} registration`;
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.portName} documents ` +
          `\`${finding.documented}\` — ${documented}; the port is ${target} ` +
          `[${finding.kind}]`,
      );
    }
  }

  if (result.staleLedgerEntries.length > 0) {
    console.error(
      '\nA `PORTS_WITHOUT_A_REGISTRATION` entry no longer describes the tree: the port has\n' +
        'gained a registration, or it is no longer published. Delete the entry.\n',
    );
    for (const portName of result.staleLedgerEntries) console.error(`  - ${portName}`);
  }

  process.exit(violations > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
