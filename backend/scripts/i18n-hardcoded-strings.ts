import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  AdminLayoutUnresolvableError,
  adminHostRootsOf,
  adminRegistryPathOf,
} from './lib/admin-surfaces.js';
import {
  adminRegistryPresent,
  moduleAdminLayers,
  type ModuleAdminLayer,
} from './lib/module-admin-layers.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import {
  adminUiPackages,
  modulePackages,
  nodeWorkspaceFs,
  workspaceMembers,
} from './lib/workspace-packages.js';

/** The checkout, whichever one this file was loaded from. */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** One directory this check walks, and what put it in the population. */
export interface AdminScanRoot {
  /** Absolute directory. */
  readonly dir: string;
  /**
   * The workspace member that declared it, or `null` for the admin
   * application's own source tree.
   */
  readonly owner: string | null;
  /** True for a root an `endora: { type: 'admin-ui' }` declaration produced. */
  readonly adminUi: boolean;
}

/**
 * The roots the admin's user-visible strings live in, and the reason there is
 * more than one (feature 091, Phase 1b, Phase 4 and P5c).
 *
 * The population was `admin/src` alone, and the key was relative to it. Then 57
 * of those files moved into `@endora-commerce/admin-kit` — the admin's own
 * design system, rendered by the same screens as before — and the ratchet
 * reported the two entries that went with them as **drained**: the strings had
 * not been translated, they had changed address. That is the laundering FR-017
 * exists to refuse, one check over, and the answer is the same one: the
 * instrument follows the code.
 *
 * **Story 3 opens the same channel a third time, one module directory per merge
 * request**, which is why the module packages' own `src/admin` layers are here
 * too. A screen moving from `admin/src/modules/<id>/` into
 * `packages/modules/<id>/src/admin/` is the identical relocation at the
 * identical granularity, and the batch that performs it is — by construction —
 * the batch that cannot see the entry describing it go stale.
 *
 * **P5 opens it a fourth time, and this root is here *before* the move.** The
 * shared page-builder chrome and the e-mail builder go into
 * `@endora-commerce/page-builder-admin`, which is neither the admin
 * application, nor the kit, nor a module package — so on the day it is created
 * the four `_shared/email-builder` baseline entries (9 + 1 + 2 + 4 = 16
 * findings) would name paths no root reaches, and the two-way ratchet would ask
 * for them to be deleted. Sixteen untranslated strings would leave this ledger
 * as *drained*, which is the same laundering in the same direction, one home
 * further out. Widening while the files are still under `admin/src` is a
 * measured no-op; widening afterwards adds the population that would have
 * caught the move in the merge request that no longer needs it.
 *
 * **Feature 110's T120 opens it a fifth time, and this root is here *with* the
 * move.** `admin/src` was the admin application, and T120 extracted the router,
 * the shell and every host screen into `@endora-commerce/admin-shell`, leaving
 * the alias member holding four files. `LoginPage.tsx`'s four baseline findings
 * would have named a path no root reaches, and the two-way ratchet would have
 * asked for the entry to be deleted — sixteen strings' worth of the same
 * laundering, one home further out. So the admin's roots are the **host roots**
 * the layout derives, which are the project's and the shell's, and the one
 * baseline key moves with the file in the same merge request.
 *
 * ## Nothing here is spelled — every root is a declaration
 *
 * The admin application's own roots come from `lib/admin-surfaces.ts`, which
 * derives them from the `"@/*"` alias and from the source root holding the
 * route table and the nav — two declarations rather than a path this file
 * names. Every other root is a workspace member's own statement about itself:
 * `endora: { type: 'module' }` for a module package, whose admin layer is a
 * root when the package has one, and `endora: { type: 'admin-ui' }` for a
 * package whose whole source tree is admin UI. **The kit is found by that
 * declaration and no longer by name.** It used to be `ADMIN_KIT_PACKAGE`, a constant naming
 * `@endora-commerce/admin-kit`, which is a derived fact written down (D-100):
 * the second admin-ui package would have had to be added to it by whoever
 * remembered, and forgetting costs sixteen findings silently.
 *
 * Why a manifest field may decide a check's population at all, since the next
 * reader will reach for D-171: that ruling refused a self-certified
 * **exemption**, and this declaration is the opposite — it only ever adds
 * obligations. The full reasoning is on `declaresAdminUi` in
 * `lib/workspace-packages.ts`, where the derivation lives.
 *
 * The keys are repository-relative, so the ledger names one file in one
 * namespace whichever root it sits under.
 *
 * **Exported because the companion test has to ask the same question, not a
 * similar one** (feature 091, Phase 4 batch three). It kept its own two-root
 * list, and that list stopped describing this script the moment Phase 4's first
 * batch added the third root family. Nothing showed it: batches one and two
 * moved files that carried no baseline entry, so both walks agreed on the empty
 * set. Batch three moved the first screen that does carry one — a LinkedIn URN
 * placeholder — and the script read the entry at its new key while the test,
 * walking two roots, reported it *drained*. Green script, red suite, over one
 * ledger. Two derivations of one population are two answers waiting to
 * disagree; there is one now.
 */
export function adminScanRoots(): readonly AdminScanRoot[] {
  const members = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  const adminUi = adminUiPackages(members);
  if (adminUi.length === 0) {
    process.stderr.write(
      '[i18n:hardcoded] no workspace member declares `endora: { type: "admin-ui" }` — the ' +
        "admin's own design system is one, so half the components every screen renders " +
        'would go unscanned and the ledger entries naming them would read as drained; ' +
        'refusing to report a vacuous pass\n',
    );
    process.exit(2);
  }
  const moduleAdminLayers = modulePackages(members)
    .map((pkg) => ({ dir: join(pkg.dir, 'src', 'admin'), owner: pkg.name, adminUi: false }))
    // A module package with no admin layer is the ordinary case and contributes
    // nothing — an empty set is legitimate here, unlike the admin-ui set,
    // because before Story 3 there were no layers at all.
    .filter((root) => existsSync(root.dir));
  // The admin's own roots, and a refusal rather than a fallback when they
  // cannot be derived (feature 110, T122). The alternative — carrying on with
  // whatever roots are left — is `admin/src`'s four files plus the packages,
  // over a ledger keyed by path: every entry naming a shell file would read as
  // **drained**, which is the laundering this walk's own header exists to
  // refuse, arriving through the derivation instead of through a move.
  let hostRoots: readonly string[];
  try {
    hostRoots = adminHostRootsOf(members);
  } catch (error: unknown) {
    if (!(error instanceof AdminLayoutUnresolvableError)) throw error;
    process.stderr.write(`[i18n:hardcoded] ${error.message}; refusing to report a vacuous pass\n`);
    process.exit(2);
  }
  return [
    // `owner: null` for both, because both are the admin application's: the
    // shell is not an `admin-ui` **library** whose every module id is foreign,
    // it is the mounting point, relocated (feature 110, T122).
    ...hostRoots.map((dir) => ({ dir, owner: null, adminUi: false })),
    ...adminUi.map((pkg) => ({ dir: join(pkg.dir, 'src'), owner: pkg.name, adminUi: true })),
    ...moduleAdminLayers,
  ];
}

/** The directories {@link adminScanRoots} produces — the walk's input. */
export function defaultRoots(): readonly string[] {
  return adminScanRoots().map((root) => root.dir);
}

const STOREFRONT_MEMBER = 'storefront';

/**
 * The storefront application's directory, or `null` for a workspace with none
 * (issue #85).
 *
 * The storefront renders to buyers and carried literals no check counted: 92 of
 * its `.ts`/`.tsx` files held Polish on the day this root was added, among them
 * the quote-request actions and the cookie-consent banner, which a shop running
 * in English showed in Polish. It is the workspace member named `storefront` —
 * `check-rsc-discipline.ts`' precedent, and the name `pnpm --filter storefront`
 * already depends on — so a renamed application drops the `storefront` source
 * token from the read line rather than silently narrowing the walk.
 */
export function storefrontScanRoot(): string | null {
  const members = workspaceMembers(REPO_ROOT, nodeWorkspaceFs());
  return members.find((member) => member.name === STOREFRONT_MEMBER)?.dir ?? null;
}

/**
 * Directories under the storefront that render nothing: its test harness, its
 * build scripts (`.mjs`, so outside the extension filter anyway) and its static
 * assets.
 */
const STOREFRONT_SKIPPED_DIRS = new Set(['test', 'scripts', 'public']);

/**
 * The storefront's sources: `.ts` **and** `.tsx`, unlike the admin walk.
 *
 * The admin walk is JSX-only because the admin's literals were JSX; the
 * storefront's are not — `cart/page.tsx` builds its whole label table as an
 * object of Polish strings handed to a component, and
 * `quote-requests/describe-diff.ts` composes Polish sentences in a template. A
 * walk that opened `.tsx` alone would read the first and miss the second.
 * Tests and declaration files are skipped: a test's expected Polish sentence
 * is the assertion that the catalogue rendered, not a literal the buyer sees.
 */
export function collectStorefrontFiles(root: string, out: string[]): void {
  const walk = (dir: string, topLevel: boolean): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (topLevel && STOREFRONT_SKIPPED_DIRS.has(entry)) continue;
        walk(full, false);
      } else if (st.isFile() && isStorefrontSource(entry)) {
        out.push(full);
      }
    }
  };
  walk(root, true);
}

function isStorefrontSource(name: string): boolean {
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return false;
  if (name.endsWith('.d.ts')) return false;
  return !/\.(test|spec)\.tsx?$/.test(name);
}

/** The whole default population, walked and analysed — what `main` and the companion test share. */
export interface DefaultTreeScan {
  /** Every file the walk opened, admin roots first. */
  readonly files: readonly string[];
  readonly findings: readonly Finding[];
  /** The admin roots, as {@link adminScanRoots} declares them. */
  readonly adminRoots: readonly AdminScanRoot[];
  /** Files opened under each admin root, in the order of `adminRoots`. */
  readonly perAdminRoot: readonly number[];
  /** The storefront directory, or `null` where the workspace has none. */
  readonly storefront: string | null;
  /** Files opened under the storefront. */
  readonly storefrontFiles: number;
}

/**
 * Walk and analyse the default population (issue #85).
 *
 * One call, exported, because the companion test asks the same question as the
 * CLI and has twice been caught asking a similar one instead (see its last
 * case). The storefront is analysed with {@link AnalyzeOptions.polishLiterals};
 * the admin roots are not, so their two shapes and their ledger are unchanged.
 */
export function scanDefaultTree(): DefaultTreeScan {
  const adminRoots = adminScanRoots();
  const files: string[] = [];
  const findings: Finding[] = [];
  const perAdminRoot: number[] = [];
  for (const root of adminRoots) {
    const before = files.length;
    if (existsSync(root.dir)) collectTsxFiles(root.dir, files);
    perAdminRoot.push(files.length - before);
  }
  for (const file of files) walkFile(file, findings);

  const storefront = storefrontScanRoot();
  const storefrontFiles: string[] = [];
  if (storefront !== null) collectStorefrontFiles(storefront, storefrontFiles);
  for (const file of storefrontFiles) walkFile(file, findings, STOREFRONT_ANALYSIS);
  return {
    files: [...files, ...storefrontFiles],
    findings,
    adminRoots,
    perAdminRoot,
    storefront,
    storefrontFiles: storefrontFiles.length,
  };
}

/**
 * How many of the admin layers the generated registry names this walk opened as
 * a root (feature 091 fallout; `contracts/admin-registry.md` R13b).
 *
 * **The registry is the independent author, and it is the only one there is for
 * this family.** `admin-ui` corroborates two of the three root families; the
 * third — 55 module packages' own `src/admin`, which is 357 of the 422 files
 * this check reads — had none, and {@link adminScanRoots} builds it by asking
 * the filesystem whether `<pkg>/src/admin` exists. A population that is a
 * directory listing, reconciled against a count derived from the same listing,
 * is the same answer twice (issue #244): every module admin layer could drop out
 * of the walk at once and this check would print `files=65 sources=admin-ui:2/2`
 * and exit 0, clean over the fifteen per cent of the admin it could still see.
 * That is issue #215's short walk, on the population feature 091 is actively
 * moving, one merge request at a time.
 *
 * `admin/src/modules.generated.ts` is a different program's answer to *"which
 * packages ship admin code, and under which subpath"* — rendered by
 * `generate-composer.ts`, refused by `overlay:check` when it is stale, foreign
 * or empty — and `lib/module-admin-layers.ts` is the one derivation over it,
 * shared with `check:admin-zones` and `check:admin-surface`. Nothing here spells
 * `./admin` or `src/admin`; the subpath's source directory comes off the
 * package's own `exports` map.
 *
 * **Coverage is the root, not a file under it.** One registry-named layer
 * (`admin_roles`) is a barrel and no screen, so a layer holding no `.tsx` is the
 * ordinary case rather than a finding, and a rule keyed on files would refuse a
 * correct tree. What this can see is a layer that left the walk, which is the
 * regression; what it cannot is a root that was walked and yielded nothing,
 * which is `adminScanRoots`' own `existsSync` filter and the companion test's
 * first case.
 */
export function coveredModuleAdminLayers(
  layers: readonly Pick<ModuleAdminLayer, 'directory'>[],
  walkedRoots: readonly string[],
): number {
  const walked = new Set(walkedRoots.map((root) => resolve(root)));
  return layers.filter((layer) => walked.has(resolve(layer.directory))).length;
}

/**
 * The floor's own vacuity refusal, or `null` when there is a floor to apply.
 *
 * `null` layers is *"this workspace has no admin contribution registry"* — a
 * fixture tree, a checkout with no admin application — and the token is omitted
 * rather than printed `0/0`, which `read-size.ts` refuses as `no-expectation`
 * anyway. An **empty** array is the different and dangerous state: the registry
 * is on disk and names nobody, so `module-admin:0/0` would corroborate nothing
 * while looking exactly like a floor.
 *
 * Pure and exported so the proof drives it from a fixture rather than from a
 * value a run computed (issue #130): the branch it guards ends in
 * `process.exit(2)`, which nothing can enter at the top.
 */
export function moduleAdminFloorRefusal(
  layers: readonly Pick<ModuleAdminLayer, 'directory'>[] | null,
): string | null {
  if (layers === null || layers.length > 0) return null;
  return (
    'the generated admin contribution registry names no module package — the module ' +
    "packages' own `src/admin` layers are the larger part of this walk and their floor " +
    'has no other author, so a batch that took every one of them out of the population ' +
    'would print a clean line over the remainder; refusing to report a vacuous pass'
  );
}

/**
 * `pnpm --filter backend run i18n:hardcoded [-- <path>… | --strict | --list]` — feature 021.
 *
 * Walks the admin SPA's `.tsx` source for hard-coded user-visible strings.
 * Flags two shapes:
 *   1. JSX text nodes whose trimmed value contains a non-whitespace English
 *      letter (a-z), e.g. `<Button>Save changes</Button>`.
 *   2. JSX attribute values whose attribute name is in `USER_VISIBLE_ATTRS`
 *      (title, aria-label, placeholder, alt) and whose value is a string
 *      literal, e.g. `<input placeholder="Search…" />`.
 *
 * The storefront (issue #85) is walked as well, over `.ts` and `.tsx`, and is
 * judged strictly ({@link STOREFRONT_ANALYSIS}) — six kinds, each literal
 * reported once, under the first that claims it:
 *   - `jsx-text`: any JSX text with a letter, single words included (`Koszyk`);
 *     `<code>`, `<kbd>`, `<samp>`, `<script>`, `<style>` and SVG text exempt.
 *   - `jsx-attr`: a visible attribute — the four above, `label`, the
 *     text-bearing `aria-*`, a prop named for copy (`removeLabel`) — read
 *     through `{…}`, parentheses, conditional branches, `&&`, `||`, `??`, `+`
 *     and templates, never through a call.
 *   - `jsx-expression`: a literal rendered as a JSX child, `{ok ? 'A' : 'B'}`.
 *   - `copy-property`: a literal under a property named for copy (`title`,
 *     `description`, `label`, `qtyLabel`, … — Next's `metadata`, label
 *     tables), and the word-shaped siblings of a value that was reported.
 *   - `prose-literal`: any other prose-shaped literal (a capital and two
 *     words, or a sentence ending), outside diagnostics, comparisons, keys,
 *     catalogue calls, styling, HTTP headers, URLs, MIME types and SVG paths.
 *   - `polish-literal`: a literal with a Polish diacritic none of those claimed.
 *   All of them skip a per-language structure (an object literal with two or
 *   more locale-keyed properties — the message catalogue's shape). The bound is
 *   declared: a lone word outside every named context (`const unit = 'szt.'`)
 *   and copy reaching the page only through a call argument are invisible.
 *
 * False-positive controls (the admin's two shapes; the storefront's are on
 * {@link analyzeStrict} and its helpers):
 *   - Ignore strings made entirely of code-style characters: identifiers
 *     with dots or underscores, paths, regex shapes, UUID/hex.
 *   - Ignore JSX inside <code>...</code> (technical identifier display).
 *   - Ignore very short strings (single character, punctuation only).
 *   - Ignore strings already wrapped in `t(...)` — they are JSX expressions,
 *     not text nodes, so the AST walker doesn't see them anyway.
 *
 * ## Why this is a ratchet and not a build break (issue #116)
 *
 * `AGENTS.md` has cited this script as *the* gate on Principle VIII for
 * user-facing strings since feature 021, and it has run in no CI job for its
 * whole life — first because its default root resolved against the working
 * directory and matched nothing, then because fixing that revealed 274 findings
 * across 47 files. Switching it on strict would fail the build on history, so it
 * runs against {@link HARDCODED_STRINGS_BASELINE}: a **new** hard-coded string
 * fails, the standing 274 do not, and a file that is translated has to say so.
 *
 * Two modes, and the difference is exactly which one CI runs:
 *   - **default (the ratchet)** — the full default scan, compared to the
 *     baseline in both directions. This is the CI line.
 *   - **`--strict`, or any explicit path** — every finding is a violation. This
 *     is how the remaining debt is measured while draining a screen.
 *
 * Output: one finding per line as `<path>:<line>:<col> → "<text>"`.
 */

const USER_VISIBLE_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
]);

/**
 * The finding vocabulary. The first two are the admin's; the storefront is
 * judged by all six (see {@link AnalyzeOptions.strictShapes}).
 *
 * - `jsx-text` — a JSX text node.
 * - `jsx-attr` — the value of an attribute the user reads or hears.
 * - `jsx-expression` — a literal rendered as a JSX child: `{ok ? 'Saved' : 'Failed'}`.
 * - `copy-property` — a literal under a property named for rendered copy:
 *   `{ title: 'Cart' }`, `metadata.description`, a label table's `qtyLabel`.
 * - `prose-literal` — a literal shaped like prose anywhere else.
 * - `polish-literal` — a literal carrying a Polish diacritic that none of the
 *   above reported.
 */
export type FindingKind =
  | 'jsx-text'
  | 'jsx-attr'
  | 'jsx-expression'
  | 'copy-property'
  | 'prose-literal'
  | 'polish-literal';

export interface Finding {
  filePath: string;
  line: number;
  column: number;
  text: string;
  kind: FindingKind;
}

/** What {@link analyzeSource} asks beyond the two JSX shapes. */
export interface AnalyzeOptions {
  /**
   * Also flag a Polish string or template literal outside JSX text (issue #85).
   * On for the storefront, off for the admin roots, whose ledger was measured
   * over the two JSX shapes.
   */
  readonly polishLiterals?: boolean;
  /**
   * The storefront's strict shapes (issue #85): every JSX text node with a
   * letter in it, a wider set of visible attributes read through `{…}`, literals
   * rendered as JSX children, copy-named properties and prose-shaped literals.
   * Off for the admin roots, so `HARDCODED_STRINGS_BASELINE` is counted by the
   * rule it was measured with. See {@link analyzeStrict}.
   */
  readonly strictShapes?: boolean;
}

/** How the storefront is analysed, by the default scan and by the draining mode alike. */
export const STOREFRONT_ANALYSIS: AnalyzeOptions = { polishLiterals: true, strictShapes: true };

const POLISH_DIACRITIC = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** A property key that names a language or a locale: `pl`, `en`, `pl-PL`, `en_US`. */
const LOCALE_KEY = /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/;

function propertyKeyText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/**
 * Whether `node` sits under a property of a per-language structure: an object
 * literal at least two of whose properties are keyed by a locale. One short key
 * alone (`{ id: '…' }`) is not a language map, so it does not exempt.
 */
function insidePerLanguageStructure(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) {
      const key = propertyKeyText(p.name);
      if (key !== null && LOCALE_KEY.test(key)) {
        const localeKeyed = p.parent.properties.filter((prop) => {
          if (!ts.isPropertyAssignment(prop)) return false;
          const k = propertyKeyText(prop.name);
          return k !== null && LOCALE_KEY.test(k);
        }).length;
        if (localeKeyed >= 2) return true;
      }
    }
    p = p.parent;
  }
  return false;
}

/** A literal that is not a value the program renders — an import path, a type. */
function isNonValueLiteral(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return (
    ts.isLiteralTypeNode(parent) ||
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent)
  );
}

/** A `title`/`aria-label`/… attribute value — already reported as `jsx-attr`. */
function isUserVisibleAttributeValue(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isJsxAttribute(parent) &&
    ts.isIdentifier(parent.name) &&
    USER_VISIBLE_ATTRS.has(parent.name.text)
  );
}

function templateText(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}');
}

function isLikelyCodeIdentifier(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  if (!/[A-Za-z]/.test(t)) return true; // no letters → punctuation / digits only
  if (t.length < 2) return true;
  if (/^[A-Za-z0-9_./-]+$/.test(t) && !/\s/.test(t)) return true; // code-shaped token
  return false;
}

function walkFile(filePath: string, findings: Finding[], options: AnalyzeOptions = {}): void {
  findings.push(...analyzeSource(readFileSync(filePath, 'utf8'), filePath, options));
}

/**
 * Every hard-coded user-visible string in one source.
 *
 * Exported so the rule can be driven red on a fixture rather than only agreeing
 * with whatever `admin/src` currently holds — the walk used to be reachable only
 * through `main`, which meant the analysis had no test at all (issue #113).
 */
export function analyzeSource(
  source: string,
  filePath: string,
  options: AnalyzeOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  // A `.ts` file is parsed as TypeScript: read as TSX, a generic arrow
  // (`<T,>(x: T) => x`) or a type assertion would be misparsed as JSX.
  const kind = filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind);

  function polishLiteral(node: ts.Node, text: string): boolean {
    if (!POLISH_DIACRITIC.test(text)) return false;
    if (isNonValueLiteral(node) || isUserVisibleAttributeValue(node)) return false;
    if (insidePerLanguageStructure(node)) return false;
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ filePath, line: line + 1, column: character + 1, text, kind: 'polish-literal' });
    return true;
  }

  function isInsideCodeElement(node: ts.Node): boolean {
    let p: ts.Node | undefined = node.parent;
    while (p) {
      if (ts.isJsxElement(p) || ts.isJsxOpeningElement(p)) {
        const tagName = ts.isJsxElement(p)
          ? p.openingElement.tagName
          : p.tagName;
        if (ts.isIdentifier(tagName) && tagName.text === 'code') return true;
      }
      p = p.parent;
    }
    return false;
  }

  if (options.strictShapes) {
    analyzeStrict(sf, filePath, findings, (node, text) => polishLiteral(node, text), options);
    return findings;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const trimmed = node.text.trim();
      if (trimmed.length > 0 && !isLikelyCodeIdentifier(trimmed) && !isInsideCodeElement(node)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({
          filePath,
          line: line + 1,
          column: character + 1,
          text: trimmed,
          kind: 'jsx-text',
        });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : '';
      if (USER_VISIBLE_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        if (!isLikelyCodeIdentifier(value)) {
          const { line, character } = sf.getLineAndCharacterOfPosition(node.initializer.getStart(sf));
          findings.push({
            filePath,
            line: line + 1,
            column: character + 1,
            text: value,
            kind: 'jsx-attr',
          });
        }
      }
    }
    if (options.polishLiterals) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        polishLiteral(node, node.text);
      } else if (ts.isTemplateExpression(node)) {
        // One finding per template, not one per static part: the sentence is
        // the unit a translator keys.
        polishLiteral(node, templateText(node));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return findings;
}

/**
 * Attributes whose value the user reads or hears, for the storefront's strict
 * shapes: the admin's four, the ARIA attributes that carry text, and `label`
 * (a `<track>`/`<option>`/`<optgroup>` attribute, and the prop name the
 * storefront's own components use for a button or field caption — ten string
 * values in the tree when this was measured). A component prop named for copy
 * (`removeLabel`, `emptyAriaLabel`) is visible too; see {@link namesRenderedCopy}.
 */
const STRICT_VISIBLE_ATTRS = new Set([
  ...USER_VISIBLE_ATTRS,
  'label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'aria-braillelabel',
  'aria-brailleroledescription',
]);

/**
 * Property and prop names that hold rendered copy. Next's `metadata` is
 * `title`/`description`; a component's props and a label table use the rest.
 * Measured on the storefront: `title` (23 string values), `label` (22),
 * `heading` (12), `description`, `placeholder`, `body`, `message`, `text`.
 * `text` also names a colour token in the theme tables (`text: '#7c4a03'`),
 * which the value filter ({@link isNonCopyValue}) answers, not the name.
 */
const COPY_NAMES = new Set([
  'title',
  'subtitle',
  'description',
  'label',
  'heading',
  'subheading',
  'message',
  'placeholder',
  'ariaLabel',
  'alt',
  'text',
  'caption',
  'hint',
  'body',
]);

/**
 * The last word of a camelCase name that makes it copy: `qtyLabel`,
 * `cardHeading`, `notePlaceholder`, `convertToQrHint`, `lockedPricingNote` —
 * the storefront's label tables name their entries this way (36 such names
 * carried a literal when this was measured).
 */
const COPY_NAME_SUFFIXES = new Set([
  'Label',
  'Title',
  'Heading',
  'Message',
  'Placeholder',
  'Description',
  'Text',
  'Caption',
  'Hint',
  'Note',
  'Body',
]);

function namesRenderedCopy(name: string): boolean {
  if (COPY_NAMES.has(name)) return true;
  const last = /[a-z0-9]([A-Z][a-z]+)$/.exec(name);
  return last !== null && COPY_NAME_SUFFIXES.has(last[1]!);
}

/** Attributes whose value is styling — never copy, whatever it looks like. */
const STYLING_ATTRS = new Set(['className', 'class', 'style']);

/** CSS properties whose value is a list of names (`'Inter, Helvetica Neue'`), never copy. */
const CSS_NAME_PROPERTIES = new Set(['fontFamily', 'font', 'font-family']);

/** Whether `object` is the literal written as a JSX `style` attribute: `style={{ … }}`. */
function isStyleObject(object: ts.ObjectLiteralExpression): boolean {
  let p: ts.Node | undefined = object.parent;
  while (
    p &&
    (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p))
  ) {
    p = p.parent;
  }
  return (
    p !== undefined &&
    ts.isJsxExpression(p) &&
    p.parent !== undefined &&
    ts.isJsxAttribute(p.parent) &&
    p.parent.name.getText() === 'style'
  );
}

/** Calls whose arguments are class names, never copy. */
const CLASS_NAME_CALLS = new Set(['cn', 'clsx', 'cx', 'cva', 'twMerge', 'classNames']);

/** Calls whose argument is a catalogue key, never copy. */
const CATALOGUE_CALLS = new Set(['t', 'tForLocale']);

/**
 * Elements whose text is not prose for a translator: technical text
 * (`code`, `kbd`, `samp`), content that is not rendered as text (`script`,
 * `style`), and SVG text, which in this storefront is a logo glyph (the payment
 * icons' `<tspan>G</tspan>`), not a sentence.
 */
const NON_PROSE_ELEMENTS = new Set(['code', 'kbd', 'samp', 'script', 'style', 'text', 'tspan']);

const LETTER = /\p{L}/u;

/** `&nbsp;`, `&amp;`, `&#8212;` — a JSX entity is a character, not a word. */
const JSX_ENTITY = /&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g;

/**
 * A value that is not copy whatever property or attribute holds it: a
 * catalogue key or another dotted/snake/kebab identifier (`nav.cart`,
 * `pwa:skip-waiting`, `not-allowed`), a URL or path, a MIME type, a colour, a
 * CSS function. Starts lower-case, so `E-mail` and `Cart` stay copy.
 */
function isNonCopyValue(text: string): boolean {
  const t = text.trim();
  if (!LETTER.test(t)) return true;
  // No `@`: an example address in a placeholder (`adres@firma.pl`) is copy,
  // and a localised one at that.
  if (/^[a-z_$][\w$]*(?:[.:/_\-[\]*]+[\w$\]*]+)+$/.test(t)) return true;
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:|data:|\/|\.\.?\/|#[\w-]*$|\?)/i.test(t)) return true;
  if (/^[a-z]+\/[a-z0-9.+-]+(?:\s*;.*)?$/.test(t)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(t)) return true;
  if (/^(?:var|rgba?|hsla?|calc|url|clamp|min|max|color-mix|linear-gradient)\(/.test(t)) {
    return true;
  }
  // SVG path data (`M12 22s8-4 8-10V5l-8-3z`): 90 icon paths read as two-word
  // capitalised "prose" before this line.
  if (/^[Mm][\d\s.,MmLlHhVvCcSsQqTtAaZz-]*$/.test(t)) return true;
  return false;
}

/**
 * Whether a literal outside every named context is shaped like prose: it
 * starts with a capital and has two or more words (`Continue shopping`), or it
 * ends like a sentence (`Saved.`, `Loading…`, `the cart is empty.`) and starts
 * with a capital or has two or more words. A single lower-case word, a code
 * token and a capitalised identifier (`Escape`, `ItemList`) are not.
 */
function isProseShaped(text: string): boolean {
  const t = text.trim();
  if (isNonCopyValue(t)) return false;
  // A tagged diagnostic (`[page-builder] … was ignored.`) is for a developer.
  if (/^\[[\w:.-]+\]/.test(t)) return false;
  const words = t.split(/\s+/).filter((word) => LETTER.test(word));
  if (words.length === 0) return false;
  const capital = /^\p{Lu}/u.test(t);
  const sentenceEnd = /[.!?…]$/u.test(t);
  if (capital && words.length >= 2) return true;
  if (sentenceEnd && (capital || words.length >= 2)) return true;
  return false;
}

/** The text a translator would see: a template's static parts around `${…}`. */
type TextLiteral = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function literalText(node: TextLiteral): string {
  return ts.isTemplateExpression(node) ? templateText(node) : node.text;
}

/**
 * Climb from a literal through the expressions that pass its value on
 * unchanged — parentheses, type assertions, both branches of a conditional,
 * `&&`'s right operand, either operand of `||`, `??` and `+`, a template's
 * substitution, and the `{…}` around an attribute value — and return the
 * outermost node reached. Its parent is the context that decides the kind.
 *
 * A call argument does not pass through: `{t('cart.title')}` and
 * `{format(x, 'pl-PL')}` hand the literal to code, not to the reader.
 */
function passThroughTop(node: ts.Node): ts.Node {
  let cur = node;
  for (;;) {
    const p = cur.parent;
    if (!p) return cur;
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isSatisfiesExpression(p) ||
      ts.isNonNullExpression(p) ||
      ts.isTypeAssertionExpression(p)
    ) {
      cur = p;
    } else if (ts.isConditionalExpression(p) && cur !== p.condition) {
      cur = p;
    } else if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      const passes =
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        (op === ts.SyntaxKind.AmpersandAmpersandToken && cur === p.right);
      if (!passes) return cur;
      cur = p;
    } else if (ts.isTemplateSpan(p)) {
      cur = p.parent;
    } else if (ts.isJsxExpression(p) && p.parent !== undefined && ts.isJsxAttribute(p.parent)) {
      cur = p;
    } else {
      return cur;
    }
  }
}

function isInsideElement(node: ts.Node, tags: ReadonlySet<string>): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) {
      const tag = p.openingElement.tagName;
      if (ts.isIdentifier(tag) && tags.has(tag.text)) return true;
    }
  }
  return false;
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  // `tForLocale(locale)('key')` — the callee is itself a catalogue call.
  if (ts.isCallExpression(expression)) return calleeName(expression.expression);
  return null;
}

/** The receiver's last name: `console` for `console.warn`, `headers` for `response.headers.set`. */
function receiverName(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const receiver = expression.expression;
  if (ts.isIdentifier(receiver)) return receiver.text;
  if (ts.isPropertyAccessExpression(receiver)) return receiver.name.text;
  return null;
}

/** `headers.set('Vary', 'Accept-Language, Cookie')` — an HTTP header, not copy. */
const HEADER_METHODS = new Set(['set', 'append', 'get', 'has', 'delete']);

const COMPARISON_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword,
]);

/**
 * Whether the context a prose-shaped literal sits in says it is not rendered:
 * a developer's diagnostic (`console.*`, `new …Error(…)`, `throw`), a value
 * compared against rather than shown (`===`, `case`, `in`), a key (an object
 * key, an element access, an enum member), a catalogue key (`t(…)`), styling
 * (`cn(…)`, `className`, a `style={{…}}` object, a font family), an HTTP
 * header or status body.
 */
function isNonRenderedContext(literal: ts.Node, top: ts.Node): boolean {
  const own = literal.parent;
  if (own) {
    const named =
      ts.isPropertyAssignment(own) || ts.isPropertySignature(own) || ts.isMethodDeclaration(own);
    if (named && own.name === literal) return true;
    if (ts.isElementAccessExpression(own) && own.argumentExpression === literal) return true;
    if (ts.isComputedPropertyName(own)) return true;
  }
  const ctx = top.parent;
  if (!ctx) return false;
  if (ts.isThrowStatement(ctx)) return true;
  if (ts.isPropertyAssignment(ctx) && ctx.initializer === top) {
    const key = propertyKeyText(ctx.name);
    if (key !== null && CSS_NAME_PROPERTIES.has(key)) return true;
    if (ts.isObjectLiteralExpression(ctx.parent) && isStyleObject(ctx.parent)) return true;
  }
  if (ts.isCaseClause(ctx) && ctx.expression === top) return true;
  if (ts.isEnumMember(ctx)) return true;
  if (ts.isBinaryExpression(ctx) && COMPARISON_OPERATORS.has(ctx.operatorToken.kind)) return true;
  if (ts.isJsxAttribute(ctx) && STYLING_ATTRS.has(ctx.name.getText())) return true;
  if (ts.isCallExpression(ctx) && ctx.arguments.includes(top as ts.Expression)) {
    const name = calleeName(ctx.expression);
    if (name !== null && (CATALOGUE_CALLS.has(name) || CLASS_NAME_CALLS.has(name))) return true;
    const receiver = receiverName(ctx.expression);
    if (receiver === 'console') return true;
    if (
      receiver !== null &&
      /headers$/i.test(receiver) &&
      name !== null &&
      HEADER_METHODS.has(name)
    ) {
      return true;
    }
  }
  if (ts.isNewExpression(ctx) && ctx.arguments?.includes(top as ts.Expression)) {
    const name = calleeName(ctx.expression);
    // A developer's error, and an HTTP body that is a status text
    // (`new NextResponse('Not Found', { status: 404 })`).
    if (name !== null && (/Error$/.test(name) || name === 'Response' || name === 'NextResponse')) {
      return true;
    }
  }
  return false;
}

/**
 * The storefront's strict shapes (issue #85). The admin's two shapes miss most
 * of what the storefront renders: a single word of JSX text (`Koszyk`) read as
 * "code-like", a visible attribute written `{'…'}` or `{a ? 'X' : 'Y'}`, a
 * literal rendered as a JSX child, a label table, Next's `metadata`, and any
 * English sentence outside JSX. Each literal is reported once, under the first
 * kind that claims it; a Polish literal none of them claims is `polish-literal`
 * as before.
 */
function analyzeStrict(
  sf: ts.SourceFile,
  filePath: string,
  findings: Finding[],
  polishFallback: (node: ts.Node, text: string) => boolean,
  options: AnalyzeOptions,
): void {
  const first = findings.length;
  // Every literal reported, so the label-table pass below can find its siblings.
  const reported = new Set<ts.Node>();
  const push = (node: ts.Node, text: string, kind: FindingKind): void => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ filePath, line: line + 1, column: character + 1, text, kind });
    reported.add(node);
  };

  const classify = (literal: TextLiteral, text: string): FindingKind | null => {
    if (isNonValueLiteral(literal) || insidePerLanguageStructure(literal)) return null;
    const top = passThroughTop(literal);
    const ctx = top.parent;
    if (ctx && ts.isJsxAttribute(ctx)) {
      const name = ctx.name.getText(sf);
      if (STYLING_ATTRS.has(name)) return null;
      if (STRICT_VISIBLE_ATTRS.has(name) || namesRenderedCopy(name)) {
        return isNonCopyValue(text) ? null : 'jsx-attr';
      }
    } else if (
      ctx &&
      ts.isJsxExpression(ctx) &&
      ctx.parent !== undefined &&
      (ts.isJsxElement(ctx.parent) || ts.isJsxFragment(ctx.parent))
    ) {
      if (isNonCopyValue(text) || isInsideElement(ctx, NON_PROSE_ELEMENTS)) return null;
      return 'jsx-expression';
    } else if (ctx && ts.isPropertyAssignment(ctx) && ctx.initializer === top) {
      const key = propertyKeyText(ctx.name);
      if (key !== null && namesRenderedCopy(key)) {
        return isNonCopyValue(text) ? null : 'copy-property';
      }
    }
    if (!isProseShaped(text) || isNonRenderedContext(literal, top)) return null;
    // A Polish literal no named context claims stays `polish-literal`, the kind
    // it had before these shapes existed.
    if (options.polishLiterals && POLISH_DIACRITIC.test(text)) return null;
    return 'prose-literal';
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const trimmed = node.text.replace(JSX_ENTITY, ' ').trim();
      if (LETTER.test(trimmed) && !isInsideElement(node, NON_PROSE_ELEMENTS)) {
        push(node, node.text.trim(), 'jsx-text');
      }
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const text = literalText(node);
      const kind = classify(node, text);
      if (kind !== null) push(node, text, kind);
      else if (options.polishLiterals && polishFallback(node, text)) reported.add(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // A label table: an object literal one of whose values was reported is a
  // table of copy, so its other values are copy too whatever their keys are
  // called — `{ heading: 'Your cart', install: 'Install', close: 'Close' }`.
  // Only a value that reads as a word does (a capital and a lower-case letter,
  // or two words): the same tables carry slugs, icon names, paths and class
  // names beside their copy (`slug: 'fasteners'`, `cls: 'status--paid'`).
  const siblings = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const values = node.properties
        .filter(ts.isPropertyAssignment)
        .map((property) => property.initializer)
        .filter(
          (value): value is TextLiteral =>
            ts.isStringLiteral(value) ||
            ts.isNoSubstitutionTemplateLiteral(value) ||
            ts.isTemplateExpression(value),
        );
      if (values.some((value) => reported.has(value))) {
        for (const value of values) {
          if (reported.has(value) || insidePerLanguageStructure(value)) continue;
          const text = literalText(value);
          if (isNonCopyValue(text)) continue;
          const words = text.trim().split(/\s+/).filter((word) => LETTER.test(word)).length;
          if (/^\p{Lu}\p{Ll}/u.test(text.trim()) || words >= 2) push(value, text, 'copy-property');
        }
      }
    }
    ts.forEachChild(node, siblings);
  };
  siblings(sf);
  const own = findings.splice(first).sort((a, b) => a.line - b.line || a.column - b.column);
  findings.push(...own);
}

/**
 * The standing debt, as measured on 2026-08-16: **274 findings across 47 files**
 * of the 321 `.tsx` files under `admin/src`.
 *
 * ## Why a per-file count rather than a per-string ledger
 *
 * The other ledgers in the repository (`PORT_CATCHES_TO_DRAIN`,
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`, `UNTRANSLATED_ERROR_CODES`) key on a site and
 * carry a reason per entry, because each of their entries is a decision somebody
 * has to defend. An untranslated string is not a decision — there is exactly one
 * reason for all 274 of them, and it is "this screen predates the rule". Writing
 * that sentence 274 times, against keys built from the string bodies (one of
 * them is 207 characters across three lines), would produce a ledger nobody
 * reads and a diff nobody can review.
 *
 * The unit of the debt is the **screen**, so the entry is the screen and the
 * value is how much of it is left. It is a **two-way ratchet**: a file over its
 * number fails, a file with no number fails, and a file **under** its number
 * fails too — translate a string and the ledger has to come down with it, which
 * is what stops the number from describing a debt that was already paid.
 *
 * Keys are paths relative to `admin/src`. It is meant to reach `{}`.
 */
export const HARDCODED_STRINGS_BASELINE: Readonly<Record<string, number>> = {
  // Issue #193 lifted the two federated-provider labels into
  // `preauth-login-copy.ts`; the four left are the second-step MFA screen.
  //
  // Re-keyed, not drained: feature 110's T120 moved `admin/src` into
  // `@endora-commerce/admin-shell` and this walk's roots moved with it, so the
  // same four strings in the same component are read at the path they now sit
  // at. The count is unmoved, which is what says nothing was translated.
  'packages/admin-shell/src/components/LoginPage.tsx': 4,
  // Feature 091's P4c published the asset cluster into the kit; its one
  // finding, AssetFieldPicker's `aria-label="Clear asset"`, became feature
  // 163's translatable `clearLabel` prop (English stays only as its default
  // for callers with no bundle), and the entry went with it.
  'packages/admin-kit/src/components/rule-builder/RuleBuilder.tsx': 6,
  'packages/admin-kit/src/ui/color-picker.tsx': 1,
  // Feature 091's P5b published the shared page-builder chrome and the e-mail
  // builder as `@endora-commerce/page-builder-admin`, and these **six** entries
  // are **re-keyed**, not raised and not dropped. Every count is unmoved: the
  // same strings in the same components, under the paths the walk reads them at
  // now. Four of them were `_shared/email-builder`'s (9 + 1 + 2 + 4 = 16, the
  // figure P5c's widening was sized against) and two are `cms`' — `AssetPickers`
  // and `CatalogPickers` moved with the chrome, which the plan's count of the
  // e-mail half did not include. The walk reaches them because the package
  // declares `endora: { type: 'admin-ui' }`; forget that block and all six go
  // *stale* in the same run rather than silently unread, which is the property
  // that makes a self-declared population safe here.
  'packages/page-builder-admin/src/email/EmailEditorPane.tsx': 9,
  'packages/page-builder-admin/src/email/EmailRichTextField.tsx': 1,
  'packages/page-builder-admin/src/email/EmailRowLayoutPicker.tsx': 2,
  'packages/page-builder-admin/src/email/EmailVariablesProvider.tsx': 4,
  // Feature 163, R17 (T201): the picker's Change / Select / Clear selection and
  // the source's two options read the `core` bundle; lowered from 5.
  'packages/page-builder-admin/src/chrome/AssetPickers.tsx': 2,
  'packages/page-builder-admin/src/chrome/CatalogPickers.tsx': 13,
  // Feature 091, Phase 4 batch 16 — re-keyed, not raised and not dropped:
  // `cms` took its admin surface into its package and these files went with
  // it. Every count is unmoved; the same strings in the same components, under
  // the paths the walk reads them at now. This baseline is a ledger *about* the
  // files it names rather than one of them, so the merge request that moves a
  // file is structurally the one that cannot see the entry go stale — the shape
  // the six entries above record for P5b, and the reason both halves are
  // corrected here rather than one of them going red later.
  //
  // Feature 163, T016 — drained, not re-keyed: the button link picker's file
  // (4 findings) was deleted, and its successor, `page-builder-admin`'s
  // `LinkField.tsx`, reads every string from the `core` bundle.
  'packages/modules/cms/src/admin/components/ComponentDragHandle.tsx': 1,
  'packages/modules/cms/src/admin/components/RowLayoutPicker.tsx': 2,
  // Feature 091, Phase 4 batch 12 — re-keyed, not dropped: `invoices` took its
  // admin surface into its package and this file went with it. The count is
  // untouched; nothing about the strings changed, only their address. This
  // baseline is a ledger *about* the files it names rather than one of them,
  // so the merge request that moves a file is structurally the one that
  // cannot see the entry go stale.
  'packages/modules/invoices/src/admin/templates/invoice-puck-config.tsx': 4,
  // `specs/134-paid-module-extraction/` T063 re-keyed two of the six strings
  // above to the KSeF block's editor preview in the module that declares the
  // block; T069 then took that module out of this repository, and the entry
  // with it.
  // Feature 091, Phase 4 batch three: the screen moved into its module's
  // package and the entry is **re-keyed**, not raised and not dropped. The
  // finding is one LinkedIn URN format example in a `placeholder`, and it is
  // the same finding at a new address — this check's two-way ratchet reported
  // both halves in one run (unaccounted here, over-baselined there), which is
  // the laundering FR-017 refuses arriving one check over. It is not drained
  // here because `urn:lla:llaPartnerConversion:…` is a wire-format example and
  // not a sentence: putting it in a bundle would invite a translator to
  // translate a LinkedIn identifier.
  'packages/modules/linkedin_ads/src/admin/pages/ConversionMappingEditPage.tsx': 1,
  // Feature 091, Phase 4 batch four: the screen moved into `mfa`'s package and
  // the entry is **re-keyed**, not raised and not dropped — the same sixteen
  // strings at a new address. This check's two-way ratchet reported both halves
  // in one run again (unaccounted at the new key, over-baselined at the old
  // one), which is what the ratchet is for. The debt itself is untouched and is
  // real: `/security` is the signed-in admin's own two-factor screen and every
  // one of its sixteen strings is English-only, so a Polish-speaking operator
  // sets up their second factor in English. Translating them is a screen's
  // worth of keys and belongs to whoever is repairing this screen, not to a
  // batch whose subject is where the file lives.
  'packages/modules/mfa/src/admin/pages/AdminSecuritySettings.tsx': 16,
  // Feature 091, Phase 4, the plan's batch 7 — the same four counts under the
  // same four files, **re-keyed rather than re-baselined**. The ratchet is
  // two-way and keyed by path, so moving a directory strands the old key as a
  // stale entry and reports the new one as a regression; both halves fired here
  // and both are the move, not a change to a single string.
  'packages/modules/product_feeds/src/admin/components/FeedDeliveryPanel.tsx': 1,
  'packages/modules/promotions/src/admin/components/CouponGeneratorForm.tsx': 2,
  'packages/modules/promotions/src/admin/pages/PromotionEditPage.tsx': 1,
  'packages/modules/promotions/src/admin/pages/PromotionStatsPage.tsx': 2,
  // Feature 091, Phase 4, the plan's batch 8 — five files, 30 findings, the
  // same counts under new keys. `delivery_methods`' list screen and four of
  // `returns`' five screens moved into their modules' packages; the ratchet is
  // two-way and keyed by path, so each move stranded the old key and reported
  // the new one as a regression. Both halves of all five fired in one run,
  // which is what the ratchet is for: a re-key is visible as a re-key rather
  // than as a debt that quietly moved house.
  'packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage.tsx': 5,
  'packages/modules/returns/src/admin/pages/ReturnDeliveryMethodsPage.tsx': 5,
  'packages/modules/returns/src/admin/pages/ReturnDetail.tsx': 12,
  'packages/modules/returns/src/admin/pages/ReturnReasonsPage.tsx': 4,
  'packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage.tsx': 4,
  // Feature 091, Phase 4 batch five: the screen moved into `stripe`'s package
  // and the entry is **re-keyed**, not raised and not dropped — the same
  // twenty-nine strings at a new address, which this check's two-way ratchet
  // reported in one run as a regression at the new key and a drain at the old
  // one. `stripe` is the one member of that batch whose screen calls no
  // `useTranslation` at all: the other six render every sentence through their
  // module's bundle, and this one renders its credentials, its payment-method
  // table and its display-mode explanation in English whatever language the
  // operator chose. Translating them is a screen's worth of keys and belongs to
  // whoever repairs this screen, not to a batch whose subject is where the file
  // lives.
  // Feature 091, Phase 4 batch 10 — three entries **re-keyed**, not raised and
  // not dropped: the same 17, 22 and 1 findings at new addresses, which the
  // two-way ratchet reported in one run as three regressions at the new keys
  // and three drains at the old ones.
  //
  // Two of the three moved further than the rest of their directory.
  // `PwaPage.tsx` and `PushAudienceRuleBuilder.tsx` sat under
  // `admin/src/modules/settings/` and are `pwa`'s screen and its rule builder;
  // batch six moved that module's sidebar entry alone and said the route would
  // follow when `settings` moved, so they are `@endora-commerce/mod-pwa`'s now
  // rather than `settings`'. The debt travels with the file and is untouched:
  // between them they render the whole push-notification screen — the icon
  // uploader, the VAPID controls, the audience builder's operators — in English
  // whatever language the operator chose. Translating it is a screen's worth of
  // keys and belongs to whoever repairs that screen, not to a batch whose
  // subject is where the file lives.
  //
  // `dictionaries` and `credentials` moved in the same batch and get no entry,
  // because none of their nine files carries a finding.
  // Feature 091, Phase 4 batch 11 — fifteen entries **re-keyed**, not raised
  // and not dropped: the same 6, 4, 8, 14, 3, 4, 7, 6, 9, 5, 3, 3, 1, 3 and 4
  // findings at new addresses, which the two-way ratchet reported in one run as
  // fifteen regressions at the new keys and fifteen drains at the old ones.
  //
  // The debt travels with the file and is untouched. Between them these fifteen
  // render the whole newsletter surface — subscribers, campaigns, automations,
  // tags, blocks, the sending provider — and the transactional-email editors
  // and branding panel, in English whatever language the operator chose.
  // Translating them is two screens' worth of keys per module and belongs to
  // whoever repairs those screens, not to a batch whose subject is where the
  // file lives.
  'packages/modules/newsletter/src/admin/pages/AutomationBuilder.tsx': 6,
  'packages/modules/newsletter/src/admin/pages/AutomationsPage.tsx': 4,
  'packages/modules/newsletter/src/admin/pages/BlocksPage.tsx': 8,
  'packages/modules/newsletter/src/admin/pages/CampaignEditor.tsx': 14,
  'packages/modules/newsletter/src/admin/pages/CampaignStats.tsx': 3,
  'packages/modules/newsletter/src/admin/pages/CampaignsPage.tsx': 4,
  'packages/modules/newsletter/src/admin/pages/ProviderSettingsPage.tsx': 7,
  'packages/modules/newsletter/src/admin/pages/SubscribersPage.tsx': 6,
  'packages/modules/newsletter/src/admin/pages/TagsPage.tsx': 9,
  'packages/modules/transactional_emails/src/admin/components/BrandingPanel.tsx': 5,
  'packages/modules/transactional_emails/src/admin/pages/EmailBlocksPage.tsx': 3,
  'packages/modules/transactional_emails/src/admin/pages/EmailTemplatesPage.tsx': 3,
  'packages/modules/transactional_emails/src/admin/pages/EmailsList.tsx': 4,
  'packages/modules/pwa/src/admin/components/PushAudienceRuleBuilder.tsx': 17,
  'packages/modules/pwa/src/admin/pages/PwaPage.tsx': 22,
  'packages/modules/settings/src/admin/components/AssetIdSettingInput.tsx': 1,
  // Feature 091, Phase 4 batch 14 — re-keyed, not dropped: `organizations`
  // took its admin surface into its package and this panel went with it. The
  // finding is unchanged, and this ledger is one **about** the files it names
  // rather than one of them, so the batch that moves a screen is structurally
  // the batch that cannot see the entry go stale — which is why it is
  // corrected here, in the same merge request.
  'packages/modules/organizations/src/admin/panels/RestrictionsPanel.tsx': 1,
};

/**
 * The storefront's standing debt (issue #85), the same per-file two-way ratchet
 * as {@link HARDCODED_STRINGS_BASELINE} and judged in the same run.
 *
 * Kept as its own constant rather than merged into the admin's because the two
 * are counted by different rules — the storefront's by the strict shapes
 * ({@link STOREFRONT_ANALYSIS}) the admin's were never measured against — and
 * because it is drained by a different stream of work. Keys are
 * repository-relative and every one starts with `storefront/`; the companion
 * test holds both halves of that.
 *
 * Measured when the root was added (2026-10-30, on `master` at e7da5e453):
 * 547 findings across 90 files, of which the first slices keyed 15, leaving
 * 532 across 85. Re-measured when the strict shapes landed (2026-10-31):
 * **1029 findings across 107 files** — 531 of the 532 are still here (the
 * one gone is the footer's `&copy;`, an entity the first rule read as a
 * word), plus single-word JSX text, visible attributes written through `{…}`,
 * literals rendered as JSX children, label tables, Next `metadata`, and English
 * outside JSX, none of which the first rule could see.
 *
 * **Grouped by area, one section per namespace file under
 * `storefront/lib/i18n/messages/`**, so the slices draining it can run in
 * parallel: a branch keys files of one area into that area's namespace and
 * edits that area's section here and nothing else, and the comment line
 * between two sections keeps two such edits from touching the same hunk. Keep
 * an entry in its section when you lower it; a file that is new to the ledger
 * goes in the section of the area that renders it, and anything that fits no
 * area goes in `chrome`.
 *
 * It is meant to reach `{}`. Never raise a number: key the string into both
 * locales of the area's namespace instead.
 */
export const STOREFRONT_HARDCODED_STRINGS_BASELINE: Readonly<Record<string, number>> = {
  // ── commerce: cart, checkout, catalog, product page and listings, compare, quick order and the quote-request draft.
  //    Keyed into `storefront/lib/i18n/messages/commerce.ts`.

  // ── account: account pages, orders, quote requests, shopping lists, returns, addresses, preferences, organization.
  //    Keyed into `storefront/lib/i18n/messages/account.ts`.
  'storefront/app/(account)/account/page.tsx': 10,
  'storefront/app/(account)/account/password/page.tsx': 6,
  'storefront/app/(account)/addresses/page.tsx': 29,
  'storefront/app/(account)/layout.tsx': 12,
  'storefront/app/(account)/newsletter/page.tsx': 8,
  'storefront/app/(account)/orders/[id]/page.tsx': 36,
  'storefront/app/(account)/orders/page.tsx': 10,
  'storefront/app/(account)/organization/addresses/page.tsx': 23,
  'storefront/app/(account)/organization/carts/page.tsx': 14,
  'storefront/app/(account)/organization/members/page.tsx': 27,
  'storefront/app/(account)/organization/page.tsx': 4,
  'storefront/app/(account)/organization/settings/cart-approval/page.tsx': 10,
  'storefront/app/(account)/preferences/page.tsx': 13,
  'storefront/app/(account)/quote-requests/[id]/page.tsx': 40,
  'storefront/app/(account)/quote-requests/page.tsx': 16,
  'storefront/app/(account)/returns/[id]/page.tsx': 13,
  'storefront/app/(account)/returns/page.tsx': 9,
  'storefront/app/(account)/shopping-lists/[id]/page.tsx': 34,
  'storefront/app/(account)/shopping-lists/page.tsx': 15,
  'storefront/components/AddToShoppingListButton.tsx': 5,
  'storefront/components/CreditLimitWidget.tsx': 7,
  'storefront/components/orders/OrderItemRows.tsx': 1,
  'storefront/components/shopping-lists/ClearListButton.tsx': 6,
  'storefront/components/shopping-lists/DeleteShoppingListButton.tsx': 7,

  // ── auth: login, registration, verification, password reset, invitations, security pages, MFA.
  //    Keyed into `storefront/lib/i18n/messages/auth.ts`.
  'storefront/app/(auth)/invitations/[token]/accept/page.tsx': 12,
  'storefront/app/(auth)/login/mfa/page.tsx': 2,
  'storefront/app/(auth)/login/page.tsx': 12,
  'storefront/app/(auth)/login/setup/page.tsx': 7,
  'storefront/app/(auth)/password-reset/confirm/page.tsx': 10,
  'storefront/app/(auth)/password-reset/request/page.tsx': 11,
  'storefront/app/(auth)/register-customer/page.tsx': 13,
  'storefront/app/(auth)/register/page.tsx': 23,
  'storefront/app/(auth)/verify/page.tsx': 10,
  'storefront/app/account/organization-security/page.tsx': 6,
  'storefront/app/account/security/page.tsx': 18,
  'storefront/components/account/SignOutButton.tsx': 1,
  'storefront/components/MfaCodeForm.tsx': 4,

  // ── chrome: home, header, footer, not-found, offline, PWA, analytics and consent, pickers, mobile overlays, the rest.
  //    Keyed into `storefront/lib/i18n/messages/chrome.ts`.
  'storefront/app/layout.tsx': 2,
  'storefront/app/manifest.webmanifest/route.ts': 1,
  'storefront/app/not-found.tsx': 18,
  'storefront/app/offline/page.tsx': 3,
  'storefront/app/page.tsx': 45,
  'storefront/components/analytics/CookieConsentMessage.tsx': 1,
  'storefront/components/analytics/GoogleTagManager.tsx': 1,
  'storefront/components/Breadcrumbs.tsx': 1,
  'storefront/components/Footer.tsx': 34,
  'storefront/components/Header.tsx': 19,
  'storefront/components/HeaderPreferenceSwitchers.tsx': 1,
  'storefront/components/ImpersonationBanner.tsx': 4,
  'storefront/components/MiniCartBadge.tsx': 1,
  'storefront/components/mobile/BottomSheet.tsx': 1,
  'storefront/components/mobile/MobileSearchOverlay.tsx': 4,
  'storefront/components/mobile/MobileTabBar.tsx': 1,
  'storefront/components/pwa/InstallPrompt.tsx': 10,
  'storefront/components/pwa/PushOptIn.tsx': 5,
  'storefront/components/PwaRegister.tsx': 2,
  'storefront/components/SearchAutocomplete.tsx': 1,
  'storefront/lib/api/pwa-server.ts': 1,
  'storefront/lib/dictionary/pickers/CountryPicker.tsx': 3,
  'storefront/lib/dictionary/pickers/CurrencyPicker.tsx': 3,
  'storefront/lib/dictionary/pickers/LanguagePicker.tsx': 3,
  'storefront/lib/seo/llms-txt-base.ts': 1,

  // ── content: blog, contact, newsletter pages and components, CMS pages.
  //    Keyed into `storefront/lib/i18n/messages/content.ts`.
  'storefront/app/(content)/[...slug]/page.tsx': 1,
  'storefront/app/blog/_components/BlogCategoryPage.tsx': 1,
  'storefront/app/blog/_components/BlogIndexPage.tsx': 4,
  'storefront/app/blog/_components/BlogTagPage.tsx': 1,
  'storefront/app/blog/_components/CategoryTree.tsx': 2,
  'storefront/app/blog/_components/Pagination.tsx': 3,
  'storefront/app/blog/_components/RelatedPostsStrip.tsx': 1,
  'storefront/app/blog/_components/RelatedProductsStrip.tsx': 1,
  'storefront/app/blog/[[...slug]]/page.tsx': 7,
  'storefront/app/kontakt/page.tsx': 7,
  'storefront/app/newsletter/confirm/page.tsx': 3,
  'storefront/app/newsletter/subscribed/page.tsx': 4,
  'storefront/app/newsletter/unsubscribe/page.tsx': 8,
  'storefront/components/contact/ContactForm.tsx': 10,
  'storefront/components/newsletter/NewsletterConsent.tsx': 2,
  'storefront/components/newsletter/NewsletterSignup.tsx': 4,
};

/** One file's measured count against its baseline. */
export interface BaselineDrift {
  /** Path relative to `admin/src`. */
  readonly file: string;
  readonly baseline: number;
  readonly actual: number;
}

export interface BaselineVerdict {
  /** Files carrying more hard-coded strings than the baseline allows. */
  readonly regressions: readonly BaselineDrift[];
  /** Files carrying fewer — the ledger describes a debt that was paid. */
  readonly drained: readonly BaselineDrift[];
}

/**
 * Findings grouped by the file they were found in, keyed relative to `root`.
 *
 * Taken as a parameter rather than read from disk so the ratchet can be driven
 * over counts the repository does not contain — a check whose comparison only
 * ever sees the real tree agrees with a function that returns nothing.
 */
export function countByFile(findings: readonly Finding[], root: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = relative(root, finding.filePath).split('\\').join('/');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The two-way comparison: what grew, and what shrank without the ledger moving. */
export function compareToBaseline(
  counts: ReadonlyMap<string, number>,
  baseline: Readonly<Record<string, number>> = HARDCODED_STRINGS_BASELINE,
): BaselineVerdict {
  const regressions: BaselineDrift[] = [];
  const drained: BaselineDrift[] = [];

  for (const [file, actual] of counts) {
    const allowed = baseline[file] ?? 0;
    if (actual > allowed) regressions.push({ file, baseline: allowed, actual });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const actual = counts.get(file) ?? 0;
    if (actual < allowed) drained.push({ file, baseline: allowed, actual });
  }

  const byFile = (a: BaselineDrift, b: BaselineDrift): number => a.file.localeCompare(b.file);
  return { regressions: regressions.sort(byFile), drained: drained.sort(byFile) };
}

export function collectTsxFiles(root: string, out: string[]): void {
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build' || entry.startsWith('.')) continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsxFiles(full, out);
    } else if (st.isFile() && entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  // The default root is resolved against the repository, not the working
  // directory. `admin/src` was relative to `process.cwd()`, and the documented
  // invocation runs with `backend/` as the cwd, where no such directory exists.
  // The baseline is measured over the whole default population, so it can only
  // judge a run that scanned all of it. Given a path, every file the ledger
  // names but the walk never opened would read as drained — so an explicit path
  // means "report everything", the mode used while draining one screen.
  // `--strict` says the same thing about the full scan.
  const strict = argv.includes('--strict') || positional.length > 0;

  let scan: DefaultTreeScan | null = null;
  let files: readonly string[];
  let findings: readonly Finding[];
  let roots: readonly string[];
  if (positional.length === 0) {
    scan = scanDefaultTree();
    files = scan.files;
    findings = scan.findings;
    roots = [...scan.adminRoots.map((root) => root.dir), ...(scan.storefront ? [scan.storefront] : [])];
  } else {
    // The draining mode: each path is walked the way its family is — a path
    // inside the storefront reads `.ts` too and asks the Polish-literal
    // question, any other path is an admin path.
    const storefront = storefrontScanRoot();
    const inStorefront = (path: string): boolean =>
      storefront !== null && !relative(storefront, resolve(path)).startsWith('..');
    const collected: string[] = [];
    const found: Finding[] = [];
    for (const r of positional) {
      const sf = inStorefront(r);
      const here: string[] = [];
      try {
        const st = statSync(r);
        if (st.isDirectory()) (sf ? collectStorefrontFiles : collectTsxFiles)(r, here);
        else if (sf ? isStorefrontSource(r) : r.endsWith('.tsx')) here.push(r);
      } catch {
        process.stderr.write(`[i18n:hardcoded] path not found: ${r}\n`);
      }
      for (const f of here) walkFile(f, found, sf ? STOREFRONT_ANALYSIS : {});
      collected.push(...here);
    }
    files = collected;
    findings = found;
    roots = positional;
  }
  const declared = scan === null ? null : scan.adminRoots;
  const perRoot = scan === null ? [] : scan.perAdminRoot;

  if (files.length === 0) {
    // `admin/src` is resolved against the current directory, so running this
    // from `backend/` (which is where the package script runs) found no file at
    // all and still printed a 0-finding summary and exit 0. "Nothing to report"
    // and "nothing was read" must not share an exit code (issue #113).
    process.stderr.write(
      `[i18n:hardcoded] no source file under ${roots.join(', ')} — refusing to report a vacuous pass\n`,
    );
    process.exit(2);
  }

  // The module-admin floor. It is resolved here rather than inside
  // `adminScanRoots` because it is deliberately **not** part of the population:
  // the roots are this walk's own listing, and this is the second program's
  // answer they are reconciled against. See `coveredModuleAdminLayers`.
  //
  // An explicit path (the draining mode) reads a deliberate subset and declares
  // no coverage at all, so nothing is resolved for it — which also keeps the
  // draining mode free of the manifest index, as it has always been.
  let adminLayers: readonly ModuleAdminLayer[] | null = null;
  if (declared !== null) {
    const registryFile = adminRegistryPathOf(workspaceMembers(REPO_ROOT, nodeWorkspaceFs()));
    // The gate is the registry file and nothing else — `check:admin-zones`' T4
    // repair, for the reason `admin-kit-surface.md` §7.5 measured: a gate that
    // can go false for a reason having nothing to do with the registry omits
    // this token over every layer while the check prints a clean line. A
    // workspace with no admin application has no registry and no token; one
    // whose registry is there and names none is the refusal below.
    if (adminRegistryPresent(registryFile)) {
      const layout = await requireModuleLayout('[i18n:hardcoded]');
      adminLayers = moduleAdminLayers(layout, registryFile!);
      const refusal = moduleAdminFloorRefusal(adminLayers);
      if (refusal !== null) {
        process.stderr.write(`[i18n:hardcoded] ${refusal}\n`);
        process.exit(2);
      }
    }
  }

  // What was read, in the shared grammar (issue #244) — before the `--strict`
  // branch below, so both modes disclose the same walk.
  //
  // Two corroborations, one per root family that has a second author. **admin-ui**:
  // the workspace manifests say how many packages ship a tree of admin UI, this
  // walk says how many of them produced a file, and a package that declared
  // itself and contributed nothing is a `short-walk` refusal rather than a
  // quietly narrowed scan. It replaced a by-name refusal ("no member is
  // `@endora-commerce/admin-kit`") and is strictly wider: the kit going missing
  // still exits 2, and so does the second admin-ui package's tree moving out
  // from under the walk (feature 091, P5c). **module-admin**: the generated
  // contribution registry's answer, reconciled against the roots this walk
  // opened — the floor the third and largest family had none of until feature
  // 091's drain made the absence measurable.
  //
  // The application's own `admin/src` still has no second author and is not
  // reconciled here; the companion test's ledger case is what floors it, since
  // every entry `HARDCODED_STRINGS_BASELINE` names has to be a file this walk
  // opened.
  reportReadSize({
    prefix: '[i18n:hardcoded]',
    files: files.length,
    coverage:
      declared === null
        ? []
        : [
            {
              source: 'admin-ui',
              expected: declared.filter((root) => root.adminUi).length,
              covered: declared.filter((root, index) => root.adminUi && perRoot[index]! > 0)
                .length,
            },
            // Omitted rather than printed `0/0` where the registry is not on
            // disk, which `read-size.ts` refuses as `no-expectation`.
            ...(adminLayers === null
              ? []
              : [
                  {
                    source: 'module-admin',
                    expected: adminLayers.length,
                    covered: coveredModuleAdminLayers(
                      adminLayers,
                      declared.map((root) => root.dir),
                    ),
                  },
                ]),
            // The storefront (issue #85): the workspace's own member list says
            // whether there is one, and the walk says whether it opened a file
            // in it. A storefront whose sources moved out from under the walk
            // reads `storefront:0/1` and exits 2 rather than draining its
            // ledger. Omitted where the workspace has no storefront member.
            ...(scan === null || scan.storefront === null
              ? []
              : [{ source: 'storefront', expected: 1, covered: scan.storefrontFiles > 0 ? 1 : 0 }]),
          ],
  });

  const cwd = process.cwd();
  const print = (f: Finding): void => {
    const rel = relative(cwd, f.filePath);
    const flat = f.text.replace(/\s*\n\s*/g, ' ');
    const text = flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
    process.stdout.write(`${rel}:${f.line}:${f.column} → "${text}" (${f.kind})\n`);
  };

  if (strict) {
    for (const f of findings) print(f);
    process.stdout.write(
      `\n[i18n:hardcoded] ${findings.length} finding(s) across ${files.length} file(s)\n`,
    );
    if (findings.length > 0) process.exit(1);
    return;
  }

  const counts = countByFile(findings, REPO_ROOT);
  const { regressions, drained } = compareToBaseline(counts, {
    ...HARDCODED_STRINGS_BASELINE,
    ...STOREFRONT_HARDCODED_STRINGS_BASELINE,
  });

  if (argv.includes('--list')) for (const f of findings) print(f);

  process.stdout.write(
    `[i18n:hardcoded] findings=${findings.length} files=${files.length} ` +
      `ledger-size=${Object.keys(HARDCODED_STRINGS_BASELINE).length}` +
      `+${Object.keys(STOREFRONT_HARDCODED_STRINGS_BASELINE).length} ` +
      `regressions=${regressions.length} drained=${drained.length}\n`,
  );

  if (regressions.length > 0) {
    process.stderr.write(
      '\nThese files carry a hard-coded user-visible string the baseline does not\n' +
        'account for. Wrap it in `t(...)` and ship the key in en.json AND pl.json —\n' +
        'for the storefront, in both locales of the area\'s namespace under\n' +
        '`storefront/lib/i18n/messages/` (Principle VIII) — do not raise the number:\n',
    );
    for (const d of regressions) {
      process.stderr.write(`  - ${d.file}: ${d.actual} finding(s), baseline ${d.baseline}\n`);
      for (const f of findings.filter(
        (x) => relative(REPO_ROOT, x.filePath).split('\\').join('/') === d.file,
      )) {
        print(f);
      }
    }
  }

  if (drained.length > 0) {
    process.stderr.write(
      '\nThese files are in HARDCODED_STRINGS_BASELINE with a number that is too\n' +
        'high — the strings were translated and the ledger was not lowered. Lower\n' +
        'it, or delete the entry when it reaches zero; it may only shrink:\n',
    );
    for (const d of drained) {
      process.stderr.write(
        `  - ${d.file}: baseline ${d.baseline}, now ${d.actual}` +
          `${d.actual === 0 ? ' — delete the entry' : ''}\n`,
      );
    }
  }

  if (regressions.length > 0 || drained.length > 0) process.exit(1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
