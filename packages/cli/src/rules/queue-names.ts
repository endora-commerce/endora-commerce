/**
 * CI check — **a BullMQ queue name is a value the library accepts**, which
 * today means one rule: it may not contain `:`.
 *
 * ## The defect it exists for
 *
 * `comarch_xl` named its three queues `comarch_xl:detect`, `comarch_xl:sync`
 * and `comarch_xl:shop-export`. BullMQ owns `:` as its own Redis
 * key-namespace separator and `new QueueBase` throws
 * `Queue name cannot contain :` **before it reaches Redis**, so the module's
 * `startWorkers` threw, its plugin never finished loading, and the process
 * never listened. That reached `master` and stayed there, and the reason this
 * is a check rather than a review note is that one bad value produced three
 * symptoms that name three different things:
 *
 *   - `boot-gate`, in all four of its cases: *"the positive container never
 *     logged `backend listening`"* — a container that does not start, naming
 *     no module and no queue;
 *   - `acceptance:package-schema` A6 — *"the activation control switches the
 *     package off and back on"* — **inconclusive**, because the throw landed
 *     in the *gate-off* phase. So the colon also took away the operator's
 *     ability to switch a module off (Constitution XVII), which is not a
 *     boot-time symptom at all;
 *   - `test:backend:deployment`, later, for a different reason entirely.
 *
 * Only the acceptance criterion's output quoted the cause, and it reached it by
 * accident of running the gate. The estate had no rule whose population
 * contained a queue **name**, so nothing refused the value where it was
 * written.
 *
 * ## Why this is a check of its own
 *
 * `check:subscribe-seam` is the near miss and widening it was the serious
 * alternative. It rejects for the reason `check:block-names` gives for the same
 * decision about `check:admin-zones`: **no existing check's population contains
 * a queue name.** Subscribe-seam's population is BullMQ *`Worker` sites* and
 * its question is where the constructed value **goes** — into `ctx.worker` or
 * onto the floor. It never reads argument 0, and `comarch_xl`'s three
 * constructions are `new Queue(…)`, which is not in its population at all. A
 * rule about the name would arrive there as issue #244's shape through the
 * repair: a second subject inside a population that was derived for the first.
 *
 * ## What counts as a queue-name site
 *
 * `new <Binding>(<arg0>, …)` where `<Binding>` is what the file imported from
 * `bullmq` — the import is followed, so `import { Queue as BullQueue }` is the
 * same site — and the class is one whose **first constructor parameter is the
 * queue name**. That set is {@link QUEUE_NAME_CLASSES}. It is written down,
 * which is a liability the floor answers rather than hides: a run that resolves
 * **no** queue name at all is exit 2 in the repository host, because this tree
 * is known to hold queues, so a renamed export or a moved walk reds instead of
 * printing a clean line (issue #113).
 *
 * `arg0` is resolved three ways, and the third is the one that catches the
 * defect:
 *
 *   1. a string literal, or a template with no substitutions, read in place;
 *   2. an identifier declared `const X = '…'` in the **same file** — which is
 *      `comarch_xl`'s shape, and `newsletter`'s, and `product_feeds`';
 *   3. an identifier this file **imported** from a relative specifier, resolved
 *      one hop into the file that declares it — `infakt`'s shape, where
 *      `workers/queue-names.ts` declares and `workers/*-worker.ts` constructs.
 *
 * Anything else — a parameter (`createComarchXlWorker(queueName, …)`), a
 * property access (`queue.name`), a template with a substitution, a re-export
 * chain — is an **unresolved** site. It is counted in the read line and never
 * judged, because a rule that guessed would report on code it cannot see. The
 * cost is honest and bounded: every name in this tree is a literal at its
 * declaration, so a colon is always reachable at *some* site even when one site
 * hides it behind a parameter.
 *
 * What it cannot see, stated here rather than discovered later: a name assembled
 * at runtime (`` `${prefix}:${id}` `` — no declaration holds the colon), a
 * `FlowProducer` flow node's `queueName` **property** rather than a
 * constructor argument (nothing in this tree uses one), a `QueueBase` subclass,
 * and a computed callee. The first is the one worth knowing about: it would
 * still be refused at runtime and this rule would be silent.
 *
 * ## The rule is narrow on purpose
 *
 * `:` is the whole rule, because `:` is what the library refuses. The
 * repository's own convention is broader — `<module_id>.<verb>`, which nearly
 * every queue follows — and it is deliberately **not** enforced here, because
 * nobody has ruled on it and four names in the tree would need a ledger entry
 * on day one: `infakt-delivery`, `wfirma-delivery`, `pim-pimcore-delivery` and
 * `webhook.deliver` (whose module id is `webhooks`). Those are style; this is a
 * process that does not start. If the broader rule is ever wanted, the shape is
 * a second finding kind here — `name-not-module-scoped` — with a ledger holding
 * those four and a reason per entry, and it needs a ruling first.
 *
 * ## No ledger, and that is the design
 *
 * Every other rule in this estate carries a two-way ledger for the finding that
 * may legitimately stand. This one cannot have such a finding: a ledgered colon
 * is a queue that cannot be constructed, so the entry would exempt a module
 * from starting. The remedy is always available in the same merge request —
 * rename the constant — so there is nothing to postpone.
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis. `backend/scripts/check-queue-names.ts` hosts it
 * over this repository's source roots; `endora check` hosts it over one module
 * package (`specs/101-endora-check/contracts/package-scope-layout.md` §6). The
 * *site floor* — no queue name resolved at all is exit 2 — is a statement about
 * a **repository** known to hold queues; a single package holding none is the
 * ordinary case, so the package host declares that signal unevaluated rather
 * than refusing, exactly as subscribe-seam's worker floor does.
 */
import { dirname, join } from 'node:path';

import ts from 'typescript';

import {
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';
import { moduleOf } from './container-imports.js';
// The walk, not the seam's analysis: `collectSeamFiles` is this tree's one
// definition of "a source file a static check opens", and a second copy would
// be two definitions of one population. See `collectQueueNameFiles` below.
import { collectSeamFiles } from './subscribe-seam.js';

/**
 * The BullMQ classes whose **first constructor argument is the queue name**.
 *
 * Derived from the library rather than guessed: every class under
 * `bullmq/dist/<target>/classes/` that extends `QueueBase` takes `(name, …)`, because
 * `QueueBase` itself does and it is `QueueBase` that throws. In 5.76.1 that is
 * `Worker`, `QueueEvents`, `QueueEventsProducer`, `QueueGetters`,
 * `JobScheduler` and `Repeat`, plus `Queue` through `QueueGetters` and
 * `QueueBase` itself. Only the ones a consumer is meant to construct are listed
 * — `Repeat` and `QueueGetters` are internal, and naming them costs nothing.
 *
 * `FlowProducer` is deliberately absent: it takes options, not a name, and
 * names its queues per flow node. Nothing in this tree constructs one.
 */
export const QUEUE_NAME_CLASSES: ReadonlySet<string> = new Set([
  'Queue',
  'QueueBase',
  'QueueEvents',
  'QueueEventsProducer',
  'QueueGetters',
  'JobScheduler',
  'Worker',
]);

/** What BullMQ owns, and therefore what a queue name may not contain. */
const FORBIDDEN_IN_A_QUEUE_NAME = ':';

/** The one finding kind. See the header for why there is no second one. */
export type QueueNameFindingKind = 'colon-in-queue-name';

/** How argument 0 was resolved, which decides where the remedy is. */
export type QueueNameResolution =
  /** A literal at the construction site. */
  | 'literal'
  /** A `const` declared in the same file. */
  | 'same-file-constant'
  /** A `const` in a file this one imported from a relative specifier. */
  | 'imported-constant'
  /** Not resolvable from source text: a parameter, a property, a computed name. */
  | 'unresolved';

export interface QueueNameSite {
  /** Path under the walk root, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** `null` outside a module — the kernel, a composition root, the platform. */
  readonly moduleId: string | null;
  /** The BullMQ class, by its *imported* name whatever it was bound to. */
  readonly className: string;
  /** Argument 0 as written, for the message. */
  readonly spelling: string;
  readonly resolution: QueueNameResolution;
  /** The resolved name, or `null` for an unresolved site. */
  readonly name: string | null;
  /** `<file>:<line>` of the literal, when it is not at the site. */
  readonly declaredAt: string | null;
}

export interface QueueNameFinding {
  readonly kind: QueueNameFindingKind;
  readonly site: QueueNameSite;
  /** The offending name, never `null` — a finding implies a resolved site. */
  readonly name: string;
}

/**
 * `<file>:<name>` — the identity of a finding.
 *
 * Keyed on the **construction site's** file and the name rather than on a line,
 * so moving the call inside its file does not change it. There is no ledger to
 * key (see the header), but `endora check` keys every finding it reports and
 * the two hosts must agree on the spelling.
 */
export function keyOf(site: QueueNameSite): string {
  return `${site.file}:${site.name ?? '<unresolved>'}`;
}

export interface QueueNamesInput {
  /** Every source in the walk, keyed by path relative to the walk root. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Directories whose files belong to a module no `modules/<id>/` segment
   * names — `lib/module-roots.ts`' `hostResidentModules`. Only used to
   * *attribute* a site; a site outside every module is still judged, because a
   * colon in the kernel's own queue name would stop the boot just as dead.
   */
  readonly hostResidentModules?: HostResidentModules | undefined;
}

export interface QueueNamesResult {
  /** Every queue-name site read, resolved or not. */
  readonly sites: readonly QueueNameSite[];
  /** The sites whose name this could read — the population actually judged. */
  readonly resolved: readonly QueueNameSite[];
  readonly findings: readonly QueueNameFinding[];
}

/** The string a node denotes, through casts and substitution-free templates. */
function stringLiteralOf(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return stringLiteralOf(node.expression);
  }
  return null;
}

/** The identifier a node denotes, through the same wrappers. */
function identifierOf(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return identifierOf(node.expression);
  }
  return null;
}

/** Every `const <name> = '<literal>'` in a file, with the line it sits on. */
function stringConstantsOf(sf: ts.SourceFile): Map<string, { value: string; line: number }> {
  const found = new Map<string, { value: string; line: number }>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = stringLiteralOf(node.initializer);
      if (value !== null) {
        found.set(node.name.text, {
          value,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * The local names a file bound BullMQ's queue-name classes to.
 *
 * Keyed by the **local** name and valued by the imported one, so a site says
 * which class it constructed whatever the file called it.
 */
function bullmqQueueBindings(sf: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (stringLiteralOf(statement.moduleSpecifier) !== 'bullmq') continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (QUEUE_NAME_CLASSES.has(imported)) bindings.set(element.name.text, imported);
    }
  }
  return bindings;
}

/**
 * Where a file imported an identifier from, when the specifier is relative.
 *
 * Returns the specifier, not a resolved path: resolution is the caller's,
 * because only it knows the key shape of the walk it is holding.
 */
function relativeImportOf(sf: ts.SourceFile, name: string): string | null {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = stringLiteralOf(statement.moduleSpecifier);
    if (specifier === null || !specifier.startsWith('.')) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if (element.name.text === name) return specifier;
    }
  }
  return null;
}

/**
 * The walk key a relative specifier names, or `null` when it leaves the walk.
 *
 * `./x.js` is how ESM-correct TypeScript spells `./x.ts`, so the `.js`
 * extension is rewritten before the lookup; `./x` and `./x/index.js` are tried
 * too. A specifier whose target is not in `sources` is not in the walk — a
 * package, or a file the walk skipped — and resolving it further would be this
 * rule reading a tree it was not handed.
 */
function keyForSpecifier(
  fromKey: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const base = join(dirname(fromKey), specifier).split('\\').join('/');
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
  ];
  for (const candidate of candidates) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every queue-name site in the walk, and the colons among them.
 *
 * Two passes, because a name can be declared in one file and constructed in
 * another: the first parses every source once and records its string constants
 * and its `bullmq` bindings; the second walks for constructions and resolves
 * argument 0 against the first. Parsing once matters — the repository walk is
 * thousands of files.
 */
export function checkQueueNames(input: QueueNamesInput): QueueNamesResult {
  const hostResident = input.hostResidentModules ?? NO_HOST_RESIDENT_MODULES;

  const parsed = new Map<
    string,
    {
      sf: ts.SourceFile;
      constants: Map<string, { value: string; line: number }>;
      bindings: Map<string, string>;
    }
  >();
  for (const [file, text] of input.sources) {
    // A file with no `bullmq` import cannot hold a construction site, but it
    // can hold the *declaration* a site in another file imports, so both halves
    // are recorded for every file. `indexOf` first: parsing every source is the
    // expensive part and a cheap pre-filter on the text is wrong here for the
    // same reason — a declaration file names no queue class.
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    parsed.set(file, {
      sf,
      constants: stringConstantsOf(sf),
      bindings: bullmqQueueBindings(sf),
    });
  }

  const sites: QueueNameSite[] = [];

  for (const [file, { sf, constants, bindings }] of parsed) {
    if (bindings.size === 0) continue;
    const moduleId = moduleOf(`/src/${file}`, hostResident);

    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const local = identifierOf(node.expression);
        const className = local === null ? undefined : bindings.get(local);
        const argument = node.arguments?.[0];
        if (className !== undefined && argument !== undefined) {
          sites.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            moduleId,
            className,
            spelling: argument.getText(sf),
            ...resolveName(argument, { file, constants, sf, sources: input.sources, parsed }),
          });
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  sites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const resolved = sites.filter((site) => site.name !== null);
  const findings: QueueNameFinding[] = resolved
    .filter((site) => (site.name as string).includes(FORBIDDEN_IN_A_QUEUE_NAME))
    .map((site) => ({
      kind: 'colon-in-queue-name' as const,
      site,
      name: site.name as string,
    }));

  return { sites, resolved, findings };
}

interface ResolutionContext {
  readonly file: string;
  readonly constants: Map<string, { value: string; line: number }>;
  readonly sf: ts.SourceFile;
  readonly sources: ReadonlyMap<string, string>;
  readonly parsed: Map<
    string,
    {
      sf: ts.SourceFile;
      constants: Map<string, { value: string; line: number }>;
      bindings: Map<string, string>;
    }
  >;
}

/** Argument 0's value and how it was reached — the three ways in the header. */
function resolveName(
  argument: ts.Node,
  context: ResolutionContext,
): Pick<QueueNameSite, 'resolution' | 'name' | 'declaredAt'> {
  const literal = stringLiteralOf(argument);
  if (literal !== null) {
    return { resolution: 'literal', name: literal, declaredAt: null };
  }

  const identifier = identifierOf(argument);
  if (identifier === null) {
    return { resolution: 'unresolved', name: null, declaredAt: null };
  }

  const local = context.constants.get(identifier);
  if (local !== undefined) {
    return {
      resolution: 'same-file-constant',
      name: local.value,
      declaredAt: `${context.file}:${local.line}`,
    };
  }

  const specifier = relativeImportOf(context.sf, identifier);
  if (specifier !== null) {
    const key = keyForSpecifier(context.file, specifier, context.sources);
    const target = key === null ? undefined : context.parsed.get(key);
    const declared = target?.constants.get(identifier);
    if (key !== null && declared !== undefined) {
      return {
        resolution: 'imported-constant',
        name: declared.value,
        declaredAt: `${key}:${declared.line}`,
      };
    }
  }

  return { resolution: 'unresolved', name: null, declaredAt: null };
}

/**
 * The remedy, as the failure message prints it.
 *
 * A function rather than a string in the host, because both hosts print it and
 * two copies of a message are two messages that drift.
 */
export function remedyFor(finding: QueueNameFinding): string {
  const { site } = finding;
  const where = site.declaredAt === null ? `${site.file}:${site.line}` : site.declaredAt;
  return (
    `new ${site.className}('${finding.name}') — a BullMQ queue name may not contain ':'. ` +
    `BullMQ owns that character as its Redis key-namespace separator and \`new QueueBase\` ` +
    `throws \`Queue name cannot contain :\` before it reaches Redis, so this does not ` +
    `misbehave: the process never listens, and an operator cannot switch the module off ` +
    `either (the throw lands in gate-off too). Rename it at ${where} — the tree's ` +
    `convention is \`<module_id>.<verb>\`, e.g. \`${finding.name.split(':').join('.')}\`.`
  );
}

/**
 * Every file this rule judges, under `roots`.
 *
 * The same walk `collectSeamFiles` makes and deliberately a second **entry
 * point** rather than a second definition: it is called from here so that a
 * host holding one population can hand it to both rules, and so that a change
 * to what "a source file" means cannot reach one rule and miss the other. The
 * import direction is this way round because subscribe-seam's is the older
 * definition; neither rule uses the other's analysis.
 */
export function collectQueueNameFiles(roots: readonly string[]): string[] {
  return collectSeamFiles(roots);
}

/** True when a path is one of the walk's own sources. Exported for the hosts. */
export function opensQueueNames(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts');
}
