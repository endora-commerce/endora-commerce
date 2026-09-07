/**
 * CI check — **a Page Builder block name is namespaced, declared once, and
 * rendered by exactly the programs that say they render it.**
 *
 * Normative contract: `specs/096-page-builder-block-ownership/contracts/block-name-check.md`.
 *
 * Usage: `tsx scripts/check-block-names.ts`
 * Exit 0 = clean; exit 1 = at least one finding; exit 2 = the run could not see
 * the population it judges.
 *
 * ## Why a check of its own
 *
 * **Its predicate is a block name, and no existing check's population contains
 * one.** `check:module-boundary` reads import specifiers and SQL table
 * identifiers; `check:admin-zones` reads `useTranslation` scopes and zone names;
 * `i18n:hardcoded` reads JSX in `.tsx` under three admin roots; `check:naming`
 * reads folder shape and Zod keys; `check:default-language-prose` reads
 * non-English prose. A Puck `type` value in a `.ts` object literal is none of
 * them. Widening `check:admin-zones` was the serious alternative and was
 * rejected: it would enlarge what that check's `read:` line claims while
 * answering a different question, which is issue #244's shape arriving through
 * the repair.
 *
 * ## What a site is
 *
 * Two kinds, and the asymmetry between them and the migration's node
 * recognition is deliberate (§2.1).
 *
 * - A **tree site** is a string-literal `type` property in an object literal
 *   that *also* has a `props` property. The `props` sibling is required here and
 *   is not required by the migration, because the two fail in opposite
 *   directions: the migration reads a client's data and must catch every node,
 *   while this reads *source*, where `{ type: 'text', label: 'Gap' }` is a Puck
 *   **field** descriptor and appears hundreds of times.
 * - A **renderer-map site** is a key of the object literal assigned to a
 *   `components` property inside a declaration annotated `Config`, or a
 *   `case '<name>':` label in a `switch` over a `.type`. Both spellings exist in
 *   the tree and both are the same claim: *this program can render this name*.
 *
 * Comments are out of the population **by construction, not by exclusion** — the
 * predicate reads literal AST nodes, which is `check:diacritic-folds`' discipline
 * and is what lets the contract be quoted verbatim in the tree.
 *
 * ## One reading the contract leaves ambiguous, settled here
 *
 * §3's table says finding 2 covers *"a tree site or a renderer-map site naming a
 * block no manifest declares"*, and finding 6 covers the same renderer-map case.
 * Its own paragraph then says the two are *"two directions of one sweep"* —
 * declared ⇒ rendered and rendered ⇒ declared — and its red proofs assert **one**
 * finding each, over a tree site for 2 and a renderer map for 6. Reporting one
 * site twice under two kinds is a count nobody can act on, so: **finding 2 is
 * tree sites, finding 6 is renderer-map sites.** Both proofs then produce exactly
 * one finding, which is what the contract asks of them.
 *
 * ## What it cannot see
 *
 * Stated here rather than discovered later.
 *
 * - **A tree assembled by concatenation.** Nodes built in one file and pushed
 *   into an array in another; the analysis is one file deep, like
 *   `check:subscribe-seam`'s binding rule.
 * - **A name reaching a `type` position through a variable.** Reported as
 *   `unreadable-block-name` where the value is not a literal at that position,
 *   and missed where a helper inlines the constant.
 * - **A node literal with no `props` sibling.** Deliberate, and the cost is
 *   stated: a hand-written `{ type: 'cms.Row' }` in source is invisible. The
 *   migration's walk does not share the restriction, so stored data is
 *   unaffected.
 * - **A name-keyed map that is not a Puck `Config`.** `invoices`' PDF
 *   `COMPONENT_MAP` is keyed by block name and is a `Record<InvoiceComponentName,
 *   Mapper>`, so it is outside §2.1's renderer-map definition. Widening the
 *   predicate to "any object whose keys are block names" would make the
 *   population depend on the answer.
 * - **A block name in a test**, and one in a `migrations/` directory. Both out
 *   by decision: a test may name a stale vocabulary on purpose, and an applied
 *   migration is frozen history a finding could never drain.
 * - **Anything in a client's database.** That is the pre-flight report's
 *   (`block-name-migration.md` §7). No static check can answer it, and one that
 *   appeared to would be worse than none.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

export const PREFIX = '[block-names]';

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export interface BlocksWithoutARendererEntry {
  /** Why this block has no first-party renderer. */
  readonly reason: string;
  /** What retires the entry. An empty one is a finding. */
  readonly retiredBy: string;
}

/**
 * `BLOCKS_WITHOUT_A_RENDERER` — **the only ledger this check has, and it lands
 * empty** (§4).
 *
 * It has one legitimate shape: a block declared in a context whose renderer
 * chain is the theme's, which is F7's work and outside feature 096. It is empty
 * on arrival because at the moment this check lands every declared block has a
 * first-party renderer; the ledger exists so that F7 can declare a block ahead
 * of its themed renderer with the reason in the diff.
 *
 * **The other seven findings have no ledger, deliberately.** For each, the remedy
 * is available in the same merge request — namespace the name, declare the block,
 * fix the segment, rename one of the two, delete the renderer, write the name as
 * a literal, or align the two numbers — and an entry could only license a palette
 * whose presentation flips when a module is switched off.
 */
export const BLOCKS_WITHOUT_A_RENDERER: Readonly<Record<string, BlocksWithoutARendererEntry>> = {};

// ---------------------------------------------------------------------------
// The analysis — pure over the values the host hands in (issue #130)
// ---------------------------------------------------------------------------

export type BlockNameFindingKind =
  | 'bare-block-name'
  | 'undeclared-block-name'
  | 'foreign-namespace-declaration'
  | 'duplicate-block-name'
  | 'declared-without-renderer'
  | 'renderer-without-declaration'
  | 'unreadable-block-name'
  | 'category-presentation-disagreement'
  | 'stale-ledger-entry'
  | 'ledger-entry-without-a-retiring-condition';

export interface BlockNameFinding {
  readonly kind: BlockNameFindingKind;
  /** Where the finding is, in the estate's own key grammar. */
  readonly where: string;
  readonly detail: string;
}

/** One module's declarations, as the manifest states them. */
export interface DeclaredModule {
  readonly id: string;
  readonly blocks: ReadonlyArray<{
    readonly name: string;
    readonly category: string;
    readonly contexts: readonly string[];
  }>;
  readonly categories: ReadonlyArray<{
    readonly key: string;
    readonly contexts: readonly string[];
    readonly weight?: number | undefined;
    readonly visible?: boolean | undefined;
  }>;
}

/** A source file the walk opened, with the key a message will name it by. */
export interface SourceFile {
  readonly key: string;
  readonly text: string;
}

export interface BlockNameSites {
  /** `{ type: '<name>', props: … }` in a module's own sources. */
  readonly tree: ReadonlyArray<{ readonly key: string; readonly name: string }>;
  /** A `type` position whose value this analysis could not read. */
  readonly unreadable: ReadonlyArray<{ readonly key: string; readonly detail: string }>;
  /** A `components` key or a renderer `case` label. */
  readonly renderer: ReadonlyArray<{ readonly key: string; readonly name: string }>;
}

export interface BlockNameAnalysis {
  readonly findings: readonly BlockNameFinding[];
  readonly sites: number;
  /** Distinct names the renderer maps key. */
  readonly renderedNames: readonly string[];
  /** Distinct names the manifests declare. */
  readonly declaredNames: readonly string[];
  /** Distinct `(category, context)` pairs the declared blocks name. */
  readonly namedSections: readonly string[];
  /** Of those, the pairs a `blockCategories` entry declares. */
  readonly declaredSections: readonly string[];
}

/**
 * The whole predicate, over source text and a manifest set.
 *
 * Everything the host does before this is population-building; everything it
 * does after is printing. A red proof therefore enters here, which is where a
 * real run enters (issue #130).
 */
export function analyseBlockNames(input: {
  readonly sites: BlockNameSites;
  readonly modules: readonly DeclaredModule[];
  readonly ledger: Readonly<Record<string, BlocksWithoutARendererEntry>>;
}): BlockNameAnalysis {
  const findings: BlockNameFinding[] = [];

  // --- the declarations, and what is wrong inside them --------------------
  const declaredBy = new Map<string, string>();
  const contextsOf = new Map<string, readonly string[]>();
  const namedSections = new Set<string>();
  for (const module of input.modules) {
    for (const block of module.blocks) {
      const owner = block.name.includes('.') ? block.name.slice(0, block.name.indexOf('.')) : null;
      if (owner !== module.id) {
        findings.push({
          kind: 'foreign-namespace-declaration',
          where: `manifest:${module.id}`,
          detail:
            `declares \`${block.name}\`, whose owner segment is ` +
            `${owner === null ? 'absent' : `\`${owner}\``} and not \`${module.id}\` — a block ` +
            'name states its owner once, and the module that writes it is that owner',
        });
      }
      const first = declaredBy.get(block.name);
      if (first !== undefined && first !== module.id) {
        findings.push({
          kind: 'duplicate-block-name',
          where: `manifest:${module.id}`,
          detail:
            `\`${block.name}\` is declared by both \`${first}\` and \`${module.id}\` — a block ` +
            'name is persisted and must have one owner; rename one of the two declarations',
        });
      } else {
        declaredBy.set(block.name, module.id);
      }
      contextsOf.set(block.name, block.contexts);
      for (const context of block.contexts) namedSections.add(`${block.category}/${context}`);
    }
  }

  // --- the sections two modules disagree about ---------------------------
  const declaredSections = new Set<string>();
  const sectionDeclarations = new Map<
    string,
    Array<{ module: string; weight?: number | undefined; visible?: boolean | undefined }>
  >();
  for (const module of input.modules) {
    for (const category of module.categories) {
      for (const context of category.contexts) {
        const pair = `${category.key}/${context}`;
        declaredSections.add(pair);
        const bucket = sectionDeclarations.get(pair) ?? [];
        bucket.push({ module: module.id, weight: category.weight, visible: category.visible });
        sectionDeclarations.set(pair, bucket);
      }
    }
  }
  for (const [pair, declarations] of [...sectionDeclarations.entries()].sort(byKey)) {
    if (declarations.length < 2) continue;
    for (const field of ['weight', 'visible'] as const) {
      // Only declarations that *state* the field can disagree: the authoring
      // guidance for a joining declaration is to omit `weight` and `visible`
      // entirely, and a check that read an omission as a value would refuse the
      // very shape `block-definition.md` §1.1 tells authors to write.
      const stated = declarations.filter((d) => d[field] !== undefined);
      const values = new Set(stated.map((d) => String(d[field])));
      if (values.size > 1) {
        findings.push({
          kind: 'category-presentation-disagreement',
          where: `section:${pair}`,
          detail:
            `${stated.map((d) => `\`${d.module}\` (${field}=${String(d[field])})`).join(' and ')} ` +
            `disagree about \`${field}\` — the merge resolves it silently and the losing ` +
            "module's intent disappears; align the two, or omit `weight` and `visible` from " +
            'the joining declaration',
        });
      }
    }
  }

  // --- the sites --------------------------------------------------------
  for (const site of input.sites.tree) {
    if (!site.name.includes('.')) {
      findings.push({
        kind: 'bare-block-name',
        where: site.key,
        detail:
          `\`${site.name}\` carries no owner segment — a stored block name is ` +
          '`<moduleId>.<LocalName>`, and a bare one is what a seeder writing the ' +
          'pre-migration vocabulary looks like',
      });
      continue;
    }
    if (!declaredBy.has(site.name)) {
      findings.push({
        kind: 'undeclared-block-name',
        where: site.key,
        detail: `\`${site.name}\` is declared by no module's manifest \`blocks\` array`,
      });
    }
  }
  for (const site of input.sites.unreadable) {
    findings.push({
      kind: 'unreadable-block-name',
      where: site.key,
      detail:
        `${site.detail} — a block name is persisted, so it is written as a literal; a name ` +
        'this analysis cannot read is a finding rather than a skip (issue #113)',
    });
  }

  const rendered = new Set(input.sites.renderer.map((site) => site.name));
  for (const site of input.sites.renderer) {
    if (!declaredBy.has(site.name)) {
      findings.push({
        kind: 'renderer-without-declaration',
        where: site.key,
        detail:
          `renders \`${site.name}\`, which no module declares — a renderer left behind after ` +
          'a block was retired renders a name nothing can insert',
      });
    }
  }

  // --- declared ⇒ rendered, and the one ledger --------------------------
  for (const [name] of [...declaredBy.entries()].sort(byKey)) {
    if (rendered.has(name)) continue;
    if (input.ledger[name] !== undefined) continue;
    findings.push({
      kind: 'declared-without-renderer',
      where: `manifest:${declaredBy.get(name)!}`,
      detail:
        `declares \`${name}\` and no program in this repository renders it — an author can ` +
        'insert it and it will resolve to the missing-component placeholder',
    });
  }
  for (const [name, entry] of Object.entries(input.ledger).sort(byKey)) {
    if (rendered.has(name) || !declaredBy.has(name)) {
      findings.push({
        kind: 'stale-ledger-entry',
        where: `ledger:${name}`,
        detail:
          `BLOCKS_WITHOUT_A_RENDERER names \`${name}\`, which ` +
          (rendered.has(name) ? 'now has a renderer' : 'no module declares') +
          ' — delete the entry',
      });
      continue;
    }
    if (entry.retiredBy.trim() === '') {
      findings.push({
        kind: 'ledger-entry-without-a-retiring-condition',
        where: `ledger:${name}`,
        detail: 'the entry names nothing that would retire it',
      });
    }
  }

  return {
    findings,
    sites:
      input.sites.tree.length +
      input.sites.unreadable.length +
      input.sites.renderer.length +
      [...declaredBy.keys()].length +
      [...declaredSections].length,
    renderedNames: [...rendered].sort(),
    declaredNames: [...declaredBy.keys()].sort(),
    namedSections: [...namedSections].sort(),
    declaredSections: [...declaredSections].sort(),
  };
}

function byKey(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/**
 * Why this run may not report on what it read, or `null` — the five refusals
 * that are decidable from the values themselves (§6.3, §6.3a, §6.4, §6.5, §6.7).
 *
 * Pure, so a vacuous-pass proof enters where a real run enters (issue #130). The
 * other four — an unresolvable layout, a short module walk, an unparseable
 * family member and a stale emitted manifest — need the filesystem and stay in
 * the host, each with its own guard.
 */
export type BlockNameRefusalKind =
  | 'no-declared-block'
  | 'no-declared-category'
  | 'no-tree-site'
  | 'no-renderer-site'
  | 'no-family-member';

export interface BlockNameRefusal {
  readonly kind: BlockNameRefusalKind;
  readonly message: string;
}

export function blockNameRefusal(input: {
  readonly declaredBlocks: number;
  readonly declaredCategories: number;
  readonly treeSites: number;
  readonly rendererSites: number;
  readonly familyMembers: number;
}): BlockNameRefusal | null {
  if (input.familyMembers === 0) {
    return {
      kind: 'no-family-member',
      message:
        'the workspace derivation named no page-builder family member — no workspace member ' +
        'holds a `components` map in a `Config` declaration or a renderer `switch` over ' +
        '`node.type`, so findings 5 and 6 are vacuous in opposite directions; refusing to ' +
        'report a vacuous pass',
    };
  }
  if (input.declaredBlocks === 0) {
    return {
      kind: 'no-declared-block',
      message:
        'no manifest declares a block — every finding is conditional on the declarations, so ' +
        'a run over zero of them prints `findings=0` honestly and means nothing; refusing to ' +
        'report a vacuous pass',
    };
  }
  if (input.declaredCategories === 0) {
    return {
      kind: 'no-declared-category',
      message:
        `${input.declaredBlocks} block(s) are declared and no category is — every declared ` +
        'block names a declared section, so zero categories beside a non-zero block count is ' +
        'a manifest read that came back partial, never a tree with no sections; refusing to ' +
        'report a vacuous pass',
    };
  }
  if (input.treeSites === 0) {
    return {
      kind: 'no-tree-site',
      message:
        'no tree site was read at all — the module-population floor stays satisfied by files ' +
        'carrying no block tree, so a `{ type, props }` shape that stopped resolving would ' +
        'print a clean line over an unwatched tree; refusing to report a vacuous pass',
    };
  }
  if (input.rendererSites === 0) {
    return {
      kind: 'no-renderer-site',
      message:
        'no renderer-map site was read at all — findings 5 and 6 are the two directions of ' +
        'one sweep and both are vacuous without it; refusing to report a vacuous pass',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The site readers — literal AST nodes, so a comment is never in the population
// ---------------------------------------------------------------------------

export interface CollectedSites {
  readonly tree: Array<{ key: string; name: string }>;
  readonly unreadable: Array<{ key: string; detail: string }>;
  readonly renderer: Array<{ key: string; name: string }>;
}

export function emptySites(): CollectedSites {
  return { tree: [], unreadable: [], renderer: [] };
}

/**
 * Read every site in one source file into `into`, or answer why it could not be
 * read.
 *
 * **Unparseable must never read as "renders nothing"** (§6.6), or every one of
 * that member's blocks becomes `declared-without-renderer` — a check reporting
 * the tree in violation for a file it could not open. `ts.createSourceFile`
 * recovers from a syntax error rather than throwing, so the syntactic
 * diagnostics are what says so; they are reached through a narrow cast because
 * the field is on TypeScript's internal `SourceFile` and is not on the public
 * type. If a future TypeScript drops it the cast yields `undefined`, the file
 * reads as parsed, and the escape hatch is the same one every check has: the
 * companion test's vacuous-pass proof goes red.
 */
export function collectSites(file: SourceFile, into: CollectedSites): string | null {
  const source = ts.createSourceFile(file.key, file.text, ts.ScriptTarget.Latest, true);
  const diagnostics = (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics !== undefined && diagnostics.length > 0) {
    return String(ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' '));
  }

  const lineOf = (node: ts.Node): string =>
    `${file.key}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      readTreeSite(node, lineOf, into);
      readComponentsMap(node, lineOf, into);
    }
    if (ts.isCaseClause(node)) readRendererCase(node, lineOf, into);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return null;
}

function propertyNamed(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = member.name;
    const text = ts.isIdentifier(key)
      ? key.text
      : ts.isStringLiteralLike(key)
        ? key.text
        : undefined;
    if (text === name) return member;
  }
  return undefined;
}

function hasPropsSibling(object: ts.ObjectLiteralExpression): boolean {
  for (const member of object.properties) {
    if (ts.isShorthandPropertyAssignment(member) && member.name.text === 'props') return true;
    if (!ts.isPropertyAssignment(member) && !ts.isMethodDeclaration(member)) continue;
    const key = member.name;
    if (ts.isIdentifier(key) && key.text === 'props') return true;
    if (ts.isStringLiteralLike(key) && key.text === 'props') return true;
  }
  return false;
}

/** `x as const`, `(x)`, `x satisfies T` — the wrappers, peeled. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
    else if (ts.isParenthesizedExpression(current)) current = current.expression;
    else return current;
  }
}

/**
 * Is this `type:` initializer **copying** a `type` from somewhere rather than
 * authoring one?
 *
 * `{ type: record.type, props: record.props }` is a tree-copy helper — three of
 * them exist in this tree, in `row-layout-presets`, `email-row-layout-presets`
 * and `outline-data`. It carries no written name: whatever name it moves was
 * authored somewhere else and is judged there. Reporting it as
 * `unreadable-block-name` would be a permanent finding with no remedy and no
 * ledger, which is the shape §4 refuses to create.
 *
 * The predicate is narrow on purpose — the *property being read is itself named
 * `type`* — so `{ type: HERO, props: {} }`, the case issue #113 is about, stays
 * a finding.
 */
function copiesAType(value: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(value)) return value.name.text === 'type';
  if (ts.isElementAccessExpression(value)) {
    const argument = value.argumentExpression;
    return ts.isStringLiteralLike(argument) && argument.text === 'type';
  }
  return false;
}

function readTreeSite(
  object: ts.ObjectLiteralExpression,
  lineOf: (node: ts.Node) => string,
  into: CollectedSites,
): void {
  const type = propertyNamed(object, 'type');
  if (type === undefined || !hasPropsSibling(object)) return;
  const value = unwrap(type.initializer);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    into.tree.push({ key: lineOf(type), name: value.text });
    return;
  }
  if (copiesAType(value)) return;
  // A `type` position in a node literal whose value is not a literal string: a
  // template literal with a substitution, a variable, a call. Refused rather
  // than skipped.
  into.unreadable.push({
    key: lineOf(type),
    detail: `\`type\` in a node literal is a ${ts.SyntaxKind[value.kind]}`,
  });
}

/**
 * A `components` object inside a declaration annotated `Config`.
 *
 * The annotation is what keeps the population to Puck configs. Without it the
 * predicate would be "any object literal with a `components` property", which in
 * this tree matches a category descriptor, a test fixture and an options bag.
 */
function readComponentsMap(
  object: ts.ObjectLiteralExpression,
  lineOf: (node: ts.Node) => string,
  into: CollectedSites,
): void {
  const components = propertyNamed(object, 'components');
  if (components === undefined || !ts.isObjectLiteralExpression(components.initializer)) return;
  if (!insideAConfigDeclaration(object)) return;
  for (const member of components.initializer.properties) {
    const key = ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member)
      ? member.name
      : undefined;
    if (key === undefined) continue;
    if (ts.isStringLiteralLike(key) || ts.isIdentifier(key)) {
      into.renderer.push({ key: lineOf(member), name: key.text });
    }
  }
}

function insideAConfigDeclaration(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isVariableDeclaration(current) && current.type !== undefined) {
      return /\bConfig\b/.test(current.type.getText());
    }
    if (ts.isAsExpression(current) && /\bConfig\b/.test(current.type.getText())) return true;
  }
  return false;
}

/**
 * `case '<name>':` in a `switch (node.type)`.
 *
 * **The subject is spelled `node.type`, which is the contract's own words**
 * (§2.1: *"a `case '<name>':` label in a renderer's `switch` over `node.type`"*),
 * and the narrowness is measured rather than assumed. Any `.type` pulls in 26
 * names from five files that have nothing to do with blocks — a catalog
 * attribute kind, a promotion kind, a Stripe webhook `event.type`, two rule
 * builders — and every one of them would be a `renderer-without-declaration`
 * finding with no remedy.
 *
 * The cost is stated: a renderer that names its parameter something else is
 * outside the population. Its names are still judged wherever they appear in a
 * `components` map, and a renderer with neither is what
 * `declared-without-renderer` reports from the other direction.
 */
function readRendererCase(
  clause: ts.CaseClause,
  lineOf: (node: ts.Node) => string,
  into: CollectedSites,
): void {
  const block = clause.parent;
  const statement = block.parent;
  if (!ts.isSwitchStatement(statement)) return;
  if (statement.expression.getText().trim() !== 'node.type') return;
  const value = clause.expression;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    into.renderer.push({ key: lineOf(clause), name: value.text });
  }
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'coverage', 'build']);

interface WalkedFile extends SourceFile {
  /** The absolute path, which the module-population floor keys on. */
  readonly path: string;
}

function walkSources(root: string, keyOf: (path: string) => string): WalkedFile[] {
  const out: WalkedFile[] = [];
  const visit = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        // §2 — `migrations/` is out: an applied migration is frozen history and
        // a finding over one could never drain. `check:default-language-prose`'
        // rule, for the same reason.
        if (entry === 'migrations') continue;
        visit(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      // §2 — tests are out by decision: a test may name a stale vocabulary on
      // purpose, and a migration test's whole job is to hold a pre-migration one.
      if (/\.test\.tsx?$/.test(entry)) continue;
      out.push({ key: keyOf(path), path, text: readFileSync(path, 'utf8') });
    }
  };
  visit(root);
  return out;
}

interface PageBuilderMember {
  readonly name: string;
  readonly directory: string;
}

/**
 * The page-builder family: the workspace members that declare a Puck renderer
 * map, derived — never a list of four names.
 *
 * "Declares a renderer map" is read as this check reads one: a member whose own
 * sources hold a `components` object inside a `Config`-annotated declaration, or
 * a renderer `switch` over a `.type`. That is the same predicate the sites use,
 * so the family cannot contain a member this check would then find nothing in.
 */
function pageBuilderFamily(repoRoot: string): PageBuilderMember[] {
  const members = workspaceMembers(repoRoot, nodeWorkspaceFs());
  const family: PageBuilderMember[] = [];
  for (const member of members) {
    const src = join(member.dir, 'src');
    if (!existsSync(src)) continue;
    const files = walkSources(src, (path) => relative(repoRoot, path));
    const sites = emptySites();
    // A member whose file will not parse is **not** excluded from the family
    // here: it is named by the host's own §6.6 refusal a few lines later, which
    // is where the reader is told. Dropping it here would make an unparseable
    // renderer map look like a member that renders nothing, which is the exact
    // thing that refusal exists to prevent.
    for (const file of files) collectSites(file, sites);
    if (sites.renderer.length > 0) family.push({ name: member.name, directory: member.dir });
  }
  return family;
}

interface LoadedManifests {
  readonly modules: DeclaredModule[];
  readonly manifestLocations: string[];
}

async function loadManifests(indexPath: string): Promise<LoadedManifests> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifestPath?: string;
      manifest?: {
        blocks?: ReadonlyArray<{ name: string; category: string; contexts: readonly string[] }>;
        blockCategories?: ReadonlyArray<{
          key: string;
          contexts: readonly string[];
          weight?: number;
          visible?: boolean;
        }>;
      };
    }>;
  };
  const modules: DeclaredModule[] = [];
  const manifestLocations: string[] = [];
  for (const entry of loaded.DISCOVERED_MANIFESTS ?? []) {
    if (entry.manifestPath !== undefined) manifestLocations.push(entry.manifestPath);
    modules.push({
      id: entry.id,
      blocks: entry.manifest?.blocks ?? [],
      categories: entry.manifest?.blockCategories ?? [],
    });
  }
  return { modules, manifestLocations };
}

function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  // §6.1 — no layout, no population at all.
  const layout: ModuleTreeLayout = await requireModuleLayout(PREFIX);

  // §6.8 — the manifest half is *imported*, and a module package resolves
  // through its own `exports` map at its build output (D-164). An author who
  // edits a manifest and does not rebuild is answered about the previous build,
  // which for a check whose whole subject is what a manifest declares is a false
  // green. Exit 2 rather than 1: the tree is not in violation, the run could not
  // see it.
  const { modules, manifestLocations } = await loadManifests(layout.manifestIndexPath);
  refuseStaleEmittedArtefacts(
    PREFIX,
    checkEmittedFreshness({
      read: manifestLocations,
      packages: emittingPackages(layout.repoRoot),
    }),
    layout.displayOf,
  );

  // §6.2 — issue #215's shared floor, before every other refusal, so a moved
  // tree is named as a moved tree rather than reported as 74 violations.
  const moduleFiles: WalkedFile[] = [];
  for (const root of layout.moduleWalkRoots) {
    moduleFiles.push(...walkSources(root, layout.keyOf));
  }
  const population = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFiles.map((file) => file.path),
    moduleIdOf: layout.moduleIdOfPath,
  });

  const family = pageBuilderFamily(layout.repoRoot);

  const familyFiles: WalkedFile[] = [];
  for (const member of family) {
    familyFiles.push(
      ...walkSources(join(member.directory, 'src'), (path) => relative(layout.repoRoot, path)),
    );
  }

  const sites = emptySites();
  const opened = new Set<string>();
  for (const file of [...moduleFiles, ...familyFiles]) {
    if (opened.has(file.key)) continue;
    opened.add(file.key);
    // §6.6 — a member whose renderer map cannot be read must be **named**, never
    // treated as rendering nothing: every one of its blocks would otherwise
    // become `declared-without-renderer`, and the check would report the tree in
    // violation for a file it could not open.
    const unparseable = collectSites(file, sites);
    if (unparseable !== null) {
      refuse(
        `${file.key} could not be parsed (${unparseable}) — a member whose renderer map ` +
          'cannot be read must be named rather than treated as rendering nothing; refusing ' +
          'to report a vacuous pass',
      );
    }
  }

  // §6.3, §6.3a, §6.4, §6.5, §6.7 — the five refusals decidable from the values.
  const refusal = blockNameRefusal({
    declaredBlocks: modules.reduce((n, m) => n + m.blocks.length, 0),
    declaredCategories: modules.reduce((n, m) => n + m.categories.length, 0),
    treeSites: sites.tree.length,
    rendererSites: sites.renderer.length,
    familyMembers: family.length,
  });
  if (refusal !== null) refuse(refusal.message);

  const analysis = analyseBlockNames({ sites, modules, ledger: BLOCKS_WITHOUT_A_RENDERER });

  const declaredSections = new Set(analysis.declaredSections);
  const declaringModules = modules.filter((module) => module.blocks.length > 0).map((m) => m.id);
  const modulesWithSource = new Set(
    moduleFiles.map((file) => layout.moduleIdOfPath(file.path)).filter((id) => id !== null),
  );
  const familyWithSites = new Set(
    sites.renderer
      .map((site) => family.find((member) => site.key.startsWith(relative(layout.repoRoot, member.directory))))
      .filter((member): member is PageBuilderMember => member !== undefined)
      .map((member) => member.name),
  );

  /**
   * Four independent derivations, and **no `self-reported` token** (§5).
   *
   * Two of them are not the ones §5 names, and the substitution is stated rather
   * than glossed. §5 defines `renderer-maps` as *the names the renderer maps key,
   * covered by the names the manifests declare* and `block-declarations` as *the
   * names the generated renderer artefacts import, covered by the same*. Both
   * were measured wrong for this line's job:
   *
   *   * A **name** shortfall in either direction is a *finding* — 6 and 5
   *     respectively — and `reportReadSize` refuses a shortfall, so under §5's
   *     spelling neither finding could ever fire on a real tree: the run would
   *     exit 2 before it printed one. A check whose two central findings are
   *     unreachable in production is worse than one that lacks them.
   *   * `block-declarations`' author does not exist. The generated renderer
   *     artefacts are `tasks.md` T305's and are deferred; a token whose
   *     expectation is zero is refused as `no-expectation`.
   *
   * So each token counts a **population** rather than a name set, which is what
   * `files`/`sites` disclosure is for, and each can genuinely go short:
   */
  const coverage: ReadCoverage[] = [
    {
      // Issue #215's shared floor. Short when the module tree moves.
      source: 'manifest-index',
      expected: population.expected,
      covered: population.covered,
    },
    {
      // The workspace's answer against the walk's: a family member that
      // declares a renderer map and produced no site is a member whose map
      // stopped resolving, which is what makes findings 5 and 6 vacuous in
      // opposite directions.
      source: 'renderer-maps',
      expected: family.length,
      covered: familyWithSites.size,
    },
    {
      // The manifests say which modules declare a block; the walk says which
      // are on disk. A declaring module the walk produced no source for is a
      // module whose tree sites are unjudged while its declarations still count.
      source: 'block-declarations',
      expected: declaringModules.length,
      covered: declaringModules.filter((id) => modulesWithSource.has(id)).length,
    },
    {
      // The declarations' own second author: rule 2 of `block-definition.md` §1
      // says every declared block names a declared section, so a shortfall is
      // either that rule broken or a manifest read that came back partial. It
      // costs no new input — both sides come off manifests this check already
      // imports.
      source: 'block-categories',
      expected: analysis.namedSections.length,
      covered: analysis.namedSections.filter((pair) => declaredSections.has(pair)).length,
    },
  ];

  reportReadSize({ prefix: PREFIX, files: opened.size, sites: analysis.sites, coverage });

  for (const finding of analysis.findings) {
    console.error(`${PREFIX} ${finding.kind}: ${finding.where} — ${finding.detail}`);
  }
  console.log(
    `${PREFIX} declared=${analysis.declaredNames.length} rendered=${analysis.renderedNames.length} ` +
      `tree-sites=${sites.tree.length} renderer-sites=${sites.renderer.length} ` +
      `family=${family.length} ledger-size=${Object.keys(BLOCKS_WITHOUT_A_RENDERER).length} ` +
      `findings=${analysis.findings.length}`,
  );
  process.exit(analysis.findings.length === 0 ? 0 : 1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(`${PREFIX} ${String(error)}`);
    if (process.env['BLOCK_NAMES_TRACE'] === '1') console.error((error as Error).stack);
    process.exit(2);
  });
}
