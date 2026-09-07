/**
 * "Which module is this documentation page about, and where does the site keep
 * it?" — one derivation, two readers (feature 100 / roadmap F12, Phase 1).
 *
 * `backend/scripts/generate-composer.ts` emits the navigation from it and
 * `backend/scripts/check-module-docs.ts` refuses the population defects it
 * cannot see. They are deliberately not two walks: three hand-maintained lists
 * already described one population — the docs sidebar, the module map and the
 * pages on disk — and all three disagreed with the generated manifest index and
 * with each other, which is the whole of `spec.md` § 0.2. A second derivation is
 * two answers waiting to disagree, which is the state this feature ends.
 *
 * ## What is derived, and from whose declaration
 *
 * Nothing here is a repository path written down (D-100):
 *
 *   * **the site** is the workspace member holding a `docusaurus.config.*`.
 *     Zero is a refusal and two is a refusal — an ambiguous site silently
 *     narrows every walk to whichever sorted first, which is the failure
 *     `lib/module-roots.ts` records for the manifest index;
 *   * **the content root** is that config's own `path` for the docs preset,
 *     defaulting to Docusaurus's own `docs` when the config declares none, as
 *     this site's does;
 *   * **the module ids** are the generated manifest index's, through
 *     `lib/module-population.ts`, so a module that became a package is followed
 *     rather than dropped (issue #215);
 *   * **the front matter** is Docusaurus's own — `title`, `sidebar_label`,
 *     `sidebar_position`, `description`. No field this repository invented, so a
 *     third-party module author writes ordinary Docusaurus markdown and learns
 *     nothing from us (`contracts/module-documentation-layer.md` R3.4).
 *
 * The one name this feature does own is {@link MODULES_CATEGORY}, the directory
 * under the content root that holds a module's pages. It is a decision rather
 * than a derived fact — a category has to be called something — so it is
 * declared once, here, and read by both consumers.
 *
 * ## Attribution — the shipper, then the slug
 *
 * A page a **module ships** is that module's: the walk knows which `docs/`
 * layer it came out of, and no derivation from the file name can be more
 * authoritative than the module's own declaration. A page in the **site's own
 * tree** has no shipper, so its slug answers — `google-analytics` is
 * `google_analytics`, and `lifecycle` is `_lifecycle`, by
 * {@link slugNamesModule}'s two derivations (D-200).
 *
 * The two can disagree, and the disagreement is a **finding** rather than a
 * silent re-attribution: a module shipping a page under a *sibling's* slug
 * takes an address the sibling owns, which is Constitution I applied to prose
 * and the same shape `check:admin-zones` refuses as `foreign-module-id`.
 *
 * A module may own **more than one slug** — `organizations` ships both
 * `organizations.md` and `organization-hierarchy.md` — and that costs nothing,
 * because the slug is how a reader finds a page and the shipper is who owns it.
 * A four-entry table of hand-declared attributions used to stand here for
 * exactly the cases the two rules above now cover; D-200 answered the question
 * it was waiting on and it retired with the answer.
 *
 * ## What this file cannot see, stated here rather than discovered later
 *
 *   * **Front matter is a leading `---`-delimited block** and is read as
 *     `key: value` lines. A page whose front matter is produced at build time by
 *     a remark plugin has none as far as this is concerned, and a value spanning
 *     lines is read as its first line.
 *   * **A doc id is a file path**, so a page that overrides its own `id` or
 *     `slug` in front matter is followed for neither. Nothing in the tree does;
 *     if something starts to, this file is where the reader goes.
 *   * **It says nothing about whether a page is good, current or complete.** It
 *     answers reachability and attribution.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { workspaceMembers, nodeWorkspaceFs, type WorkspaceMember } from './workspace-packages.js';

/**
 * The directory under the site's content root that holds a module's pages.
 *
 * The one name this feature owns rather than derives. It is declared here so
 * that the generator and the check cannot come to disagree about it, and so a
 * reader looking for "where does `modules/` come from" finds one answer.
 */
export const MODULES_CATEGORY = 'modules';

/** The page every reader of a module's category lands on. */
export const CATEGORY_INDEX = 'index';

/**
 * The generated sidebar fragment, at the site's root beside `sidebars.js`.
 *
 * Named here rather than in the generator so that the generator, `overlay:check`
 * and `check:module-docs` cannot come to disagree about which file they mean.
 */
export const DOCS_SIDEBAR_ARTEFACT = 'sidebars.modules.generated.js';

/** The generated module map, inside the modules category it indexes. */
export const MODULE_MAP_ARTEFACT = 'module-map.generated.md';

/**
 * The category holding one generated reference page per module (Phase 3,
 * FR-022/FR-024).
 *
 * A category of its own, **outside** {@link MODULES_CATEGORY}, and the
 * separation is the design rather than a filing preference. Three things follow
 * from it, none of which would if the pages sat beside the prose:
 *
 *   * **a generated page can never collide with a hand-written one.** A module's
 *     prose page is `modules/<slug>`, its reference page `module-reference/<slug>`.
 *     There is no name a page author can choose that takes an address the
 *     generator writes, and no rule anybody has to remember;
 *   * **the attribution walk's population does not move.** `undocumented-module`
 *     asks whether anybody *wrote* about a module, and a generated table is not
 *     an answer to it — a reference page inside the modules category would have
 *     made every registered module documented and retired that whole ledger in
 *     the merge request that added the generator;
 *   * **it is committed on ordinary terms.** `docs/docs/modules/**` is
 *     git-ignored, because the module-owned pages are copied there at build
 *     time, so a committed artefact under that tree would need `git add -f` for
 *     ever after.
 *
 * The pages are still *reached* from the Modules category: the generated
 * sidebar fragment names each module's reference page beside its prose, so a
 * reader never has to know that the two live in different directories.
 */
export const MODULE_REFERENCE_CATEGORY = 'module-reference';

/**
 * The documentation slug that names a module — {@link slugNamesModule}'s
 * inverse, and the one place that choice is made.
 *
 * A slug is hyphenated where an id is snake_case, and a **leading underscore is
 * dropped**: Docusaurus excludes an underscore-prefixed file from routing by
 * design, so `_i18n` is documented at `i18n` and `_lifecycle` at `lifecycle`
 * (D-200). Both transformations are {@link slugNamesModule}'s applied the other
 * way round, so a page this names is a page that derivation attributes back —
 * asserted as a round trip over every registered id rather than left to the two
 * staying in step by inspection.
 */
export function slugForModule(moduleId: string): string {
  return moduleId.replace(/^_/, '').split('_').join('-');
}

/** Extensions Docusaurus reads as a documentation page. */
export const PAGE_EXTENSIONS: readonly string[] = ['.md', '.mdx'];

/** Raised when the documentation layout cannot be resolved; a caller exits 2. */
export class DocsLayoutUnresolvableError extends Error {
  override readonly name = 'DocsLayoutUnresolvableError';
}

/** Where the documentation site is and what it holds. */
export interface DocsLayout {
  /** The workspace member that is the Docusaurus site. */
  readonly member: WorkspaceMember;
  /** Absolute path of the site's docs content root — `docs/docs`. */
  readonly contentRoot: string;
  /** Absolute path of `<contentRoot>/modules`. */
  readonly modulesRoot: string;
  /** Absolute path of the site's `sidebars.js`. */
  readonly sidebarPath: string;
}

/** Docusaurus config file names, in the order Docusaurus itself accepts them. */
const CONFIG_FILENAMES: readonly string[] = [
  'docusaurus.config.js',
  'docusaurus.config.mjs',
  'docusaurus.config.cjs',
  'docusaurus.config.ts',
];

/**
 * The docs content root the config declares, or Docusaurus's own default.
 *
 * Read as a literal `path:` inside the docs preset options. A computed value is
 * not followed — it is reported as absent, which lands on the default, and the
 * bound is stated here rather than discovered later.
 */
export function contentPathOf(configText: string): string {
  const match = /\bdocs\s*:\s*\{[^}]*?\bpath\s*:\s*['"]([^'"]+)['"]/s.exec(configText);
  return match?.[1] ?? 'docs';
}

/**
 * Where the site is, from this repository's own workspace declaration.
 *
 * Zero members holding a Docusaurus config and more than one are both
 * refusals, for `lib/module-roots.ts`' reason: an ambiguous root narrows the
 * walk to whichever sorted first and says nothing about having done so.
 */
export function resolveDocsLayout(repoRoot: string): DocsLayout {
  const found: { member: WorkspaceMember; configPath: string }[] = [];
  for (const member of workspaceMembers(repoRoot, nodeWorkspaceFs())) {
    for (const name of CONFIG_FILENAMES) {
      const configPath = join(member.dir, name);
      if (existsSync(configPath)) {
        found.push({ member, configPath });
        break;
      }
    }
  }
  if (found.length === 0) {
    throw new DocsLayoutUnresolvableError(
      'no workspace member holds a Docusaurus configuration — the documentation site is ' +
        'derived from that file, and there is nothing to derive it from',
    );
  }
  if (found.length > 1) {
    throw new DocsLayoutUnresolvableError(
      `${found.length} workspace members hold a Docusaurus configuration ` +
        `(${found.map((entry) => entry.member.name).join(', ')}) — the documentation site is ` +
        'ambiguous, and picking one narrows every walk to it without saying so',
    );
  }
  const { member, configPath } = found[0]!;
  const contentRoot = join(member.dir, contentPathOf(readFileSync(configPath, 'utf8')));
  return {
    member,
    contentRoot,
    modulesRoot: join(contentRoot, MODULES_CATEGORY),
    sidebarPath: join(member.dir, 'sidebars.js'),
  };
}

/** Docusaurus front matter, as much of it as this feature reads. */
export interface FrontMatter {
  readonly title: string | null;
  readonly sidebarLabel: string | null;
  readonly sidebarPosition: number | null;
  readonly description: string | null;
}

const EMPTY_FRONT_MATTER: FrontMatter = {
  title: null,
  sidebarLabel: null,
  sidebarPosition: null,
  description: null,
};

/** A `key: value` line's value, unquoted. */
function scalarOf(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1).split("\\'").join("'").split('\\"').join('"');
  }
  return trimmed;
}

/**
 * The leading `---`-delimited block, read as top-level `key: value` lines.
 *
 * Deliberately not a YAML parser: a direct dependency on one would be a new
 * runtime edge in the package that runs the check estate (`plan.md` §
 * Complexity Tracking), and the four fields this feature reads are scalars. The
 * bound is that a nested or multi-line value is read as its first line, which is
 * stated rather than discovered later.
 */
export function parseFrontMatter(source: string): FrontMatter {
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  if (!text.startsWith('---')) return EMPTY_FRONT_MATTER;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return EMPTY_FRONT_MATTER;
  const block = text.slice(text.indexOf('\n') + 1, end);
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    fields.set(match[1]!, scalarOf(match[2]!));
  }
  const position = fields.get('sidebar_position');
  const parsedPosition = position === undefined ? Number.NaN : Number(position);
  return {
    title: fields.get('title') ?? null,
    sidebarLabel: fields.get('sidebar_label') ?? null,
    sidebarPosition: Number.isFinite(parsedPosition) ? parsedPosition : null,
    description: fields.get('description') ?? null,
  };
}

/** One documentation page under the modules category. */
export interface DocPage {
  /**
   * The page's Docusaurus doc id — `modules/catalog/attributes`. The site's own
   * identity for it, and what a sidebar entry names.
   */
  readonly docId: string;
  /** Absolute path of the file. */
  readonly path: string;
  /**
   * The file's path relative to the modules category — `catalog/attributes.md`.
   *
   * Carried beside the doc id because a **link** and an **id** are not the same
   * string: `assets-library/index` is the doc id and `/modules/assets-library/`
   * is the route, so a markdown link written from the id 404s under
   * `onBrokenLinks: 'throw'`. Docusaurus resolves a link that names the `.md`
   * file to that file's permalink, whatever the permalink turns out to be, so
   * the file path is the spelling that cannot go wrong.
   */
  readonly relativePath: string;
  /**
   * The module slug this page sits under: its own basename for a top-level
   * page, its directory's name for a page inside one.
   */
  readonly slug: string;
  /** True when the page is the one a reader of this slug lands on. */
  readonly isEntry: boolean;
  /** True when the page sits inside a directory of its own slug's name. */
  readonly inDirectory: boolean;
  readonly frontMatter: FrontMatter;
  /** Which tree the walk found it in — see {@link DocPageOrigin}. */
  readonly origin: DocPageOrigin;
}

/**
 * A module's own position in the Modules category, or `null` for alphabetical.
 *
 * Read from the entry page's `sidebar_position` **only when that page is not a
 * directory index**, and the distinction is Docusaurus's own rather than this
 * feature's: `sidebar_position` orders a page among its *siblings*, so an
 * `index.md`'s is its place inside its own directory and says nothing about
 * where its module belongs among 65 others. Every such value in the tree today
 * is `1` — an intra-directory ordering that has been inert under a manual
 * sidebar — and reading it would have hoisted five modules to the top of the
 * category for a reason nobody wrote.
 */
export function categoryPositionOf(entry: DocPage): number | null {
  return entry.inDirectory ? null : entry.frontMatter.sidebarPosition;
}

/**
 * Where a page came from, which is not the same question as which module it
 * documents.
 *
 * `'site'` is a page in the documentation site's own tree — the state every
 * page was in through Phase 1 and the state `_lifecycle`'s page is still in,
 * because its manifest resolves inside the platform package's **build output**
 * and documentation is not a compiled asset (`scripts/lib/runtime-assets.mjs`).
 * `'module'` is a page a module ships in its own `docs/` layer.
 *
 * Attribution is the *slug's* answer and stays so; this is the *shipper's*.
 * They are kept apart because they can disagree, and a module publishing under
 * a sibling's slug is a finding rather than a silent re-attribution.
 */
export interface DocPageOrigin {
  readonly kind: 'site' | 'module';
  /** The module that ships the page, or `null` for a page in the site's tree. */
  readonly moduleId: string | null;
  /** The directory the walk that produced the page was rooted at. */
  readonly root: string;
}

/** A module's own documentation layer, resolved. */
export interface ModuleDocsSource {
  readonly moduleId: string;
  /** Absolute path of `dirname(manifestPath)/<docs.dir>`. */
  readonly root: string;
}

/**
 * Every page one fragment of the modules category holds, sorted by doc id.
 *
 * The **fragment** is the unit, and that is the mechanism rather than an
 * implementation detail: a module's `docs/` directory is its own fragment of
 * this category, laid out exactly as the category lays it out, so one walk
 * reads the site's tree and a module's alike and the two produce identical doc
 * ids for the same page. It is what makes the Phase 2 move invisible — no URL
 * changes, no doc id changes, and no ledger key keyed on `(module id, page
 * slug)` goes stale (`contracts/docs-registry.md` R4.1).
 *
 * It also lets a module own **more than one slug** (`organizations` ships both
 * `organizations.md` and `organization-hierarchy.md`) and publish under a slug
 * that is not its id (`_i18n` ships `admin-i18n.md`), neither of which a
 * one-directory-per-module rule can express without renaming a public URL —
 * which is `spec.md` Q2 and nobody's to decide here.
 */
export function collectPagesUnder(root: string, origin: DocPageOrigin): DocPage[] {
  if (!existsSync(root)) return [];
  const pages: DocPage[] = [];
  const isPage = (name: string): boolean => PAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  const stem = (name: string): string => name.replace(/\.mdx?$/, '');

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const child of readdirSync(full, { withFileTypes: true })) {
        if (!child.isFile() || !isPage(child.name)) continue;
        const file = join(full, child.name);
        pages.push({
          docId: `${MODULES_CATEGORY}/${entry.name}/${stem(child.name)}`,
          path: file,
          relativePath: `${entry.name}/${child.name}`,
          slug: entry.name,
          isEntry: stem(child.name) === CATEGORY_INDEX,
          inDirectory: true,
          frontMatter: parseFrontMatter(readFileSync(file, 'utf8')),
          origin,
        });
      }
      continue;
    }
    if (!entry.isFile() || !isPage(entry.name)) continue;
    // Two files under the **site's** root are the category's, not a module's,
    // and both are skipped rather than judged: the landing page a reader
    // arrives at, and the generated map itself. The map is an artefact —
    // `overlay:check` owns whether it is current, and reading it back as a page
    // would make it `unlocated-page` for naming no module, which is a finding
    // about this walk's population dressed as one about the tree.
    //
    // A module's own fragment is not exempted from either name: a module that
    // ships `docs/README.md` is shipping a page for the category's landing
    // slug, which is a finding and not a file to skip.
    if (origin.kind === 'site' && stem(entry.name) === 'README') continue;
    if (origin.kind === 'site' && entry.name === MODULE_MAP_ARTEFACT) continue;
    pages.push({
      docId: `${MODULES_CATEGORY}/${stem(entry.name)}`,
      path: full,
      relativePath: entry.name,
      slug: stem(entry.name),
      isEntry: true,
      inDirectory: false,
      frontMatter: parseFrontMatter(readFileSync(full, 'utf8')),
      origin,
    });
  }
  return pages.sort((a, b) => a.docId.localeCompare(b.docId));
}

/**
 * Every page the site's own tree holds, sorted by doc id.
 *
 * `copies` is the set of absolute paths the collection step writes into this
 * tree, and it is excluded rather than judged. The copies are **not committed**
 * — one editable page and one that looks editable and is not is the state this
 * feature exists to end — but a developer who has run the docs build has them
 * on disk, and a walk that counted them would report every module's page as
 * claimed by two sources: a finding about the copy step dressed as one about
 * the tree.
 *
 * Passing an empty set is the fresh-checkout state and reads the tree as it is.
 */
export function collectDocPages(
  modulesRoot: string,
  copies: ReadonlySet<string> = new Set(),
): DocPage[] {
  return collectPagesUnder(modulesRoot, {
    kind: 'site',
    moduleId: null,
    root: modulesRoot,
  }).filter((page) => !copies.has(page.path));
}

/** Every page the modules ship, sorted by doc id. */
export function collectModuleDocPages(sources: readonly ModuleDocsSource[]): DocPage[] {
  return sources
    .flatMap((source) =>
      collectPagesUnder(source.root, {
        kind: 'module',
        moduleId: source.moduleId,
        root: source.root,
      }),
    )
    .sort((a, b) => a.docId.localeCompare(b.docId));
}

/**
 * Two pages claiming one doc id — the site's tree and a module's, or two
 * modules'.
 *
 * A **mixed** tree is the supported state (`plan.md` § Phasing: the check
 * accepts a page in the site tree and a page in a package on the same terms),
 * so a batch that has moved half the pages is not a defect. Two sources for one
 * id is, and it is not a silent one: the copy would write one over the other
 * and whichever ran second would win, which is a build whose output depends on
 * a directory read order.
 */
export function duplicateDocIds(pages: readonly DocPage[]): { docId: string; paths: string[] }[] {
  const byId = new Map<string, string[]>();
  for (const page of pages) {
    const group = byId.get(page.docId);
    if (group === undefined) byId.set(page.docId, [page.path]);
    else group.push(page.path);
  }
  return [...byId]
    .filter(([, paths]) => paths.length > 1)
    .map(([docId, paths]) => ({ docId, paths: [...paths].sort() }))
    .sort((a, b) => a.docId.localeCompare(b.docId));
}

/**
 * Does this slug name this module? — **D-200**, and the one place the rule
 * lives.
 *
 * Two steps, and both are derivations rather than a table:
 *
 *   * a URL segment is conventionally hyphenated and a module id is
 *     snake_case, so one is folded into the other;
 *   * a **leading underscore is stripped**, because an infrastructure module's
 *     id carries one and a documentation page's file name may not:
 *     **Docusaurus excludes an underscore-prefixed file from routing by
 *     design** — it becomes a *partial* for import into another page, generates
 *     no route, and cannot be found from `sidebars.js` at all. So `_i18n` is
 *     documented at `i18n` and `_lifecycle` at `lifecycle`.
 *
 * The underscore stays where it means something — in the module id, where
 * `check:naming` enforces the convention — instead of leaking into a public URL.
 * The rule covers every future infrastructure module with nothing to add, which
 * is what retired the alias table Phase 1 shipped: a four-entry table of
 * hand-declared attributions, in the feature whose whole subject is that three
 * hand-maintained lists disagreed with one population and with each other.
 *
 * It is not a heuristic that guesses. Only these two transformations are
 * applied, and the result must equal a registered id exactly.
 */
export function slugNamesModule(slug: string, moduleId: string): boolean {
  const folded = slug.split('-').join('_');
  return folded === moduleId || `_${folded}` === moduleId;
}

/**
 * The module a slug names, or `null`, over the registered set.
 *
 * {@link slugNamesModule} in the direction a walk needs it: the candidates are
 * derived from the slug rather than by scanning every registered id, so the
 * cost does not grow with the platform.
 */
export function moduleOfSlug(slug: string, registered: ReadonlySet<string>): string | null {
  const folded = slug.split('-').join('_');
  if (registered.has(folded)) return folded;
  if (registered.has(`_${folded}`)) return `_${folded}`;
  return null;
}

/** One module's documentation, as the site holds it today. */
export interface ModuleDocs {
  readonly moduleId: string;
  /** The slug its pages sit under. */
  readonly slug: string;
  /** The page a reader lands on. */
  readonly entry: DocPage;
  /** Sub-pages, sorted by their own position then label. */
  readonly children: readonly DocPage[];
}

/** The label a navigation entry carries, from the page's own front matter. */
export function labelOf(page: DocPage, fallback: string): string {
  return page.frontMatter.sidebarLabel ?? page.frontMatter.title ?? fallback;
}

/** Ordering: a declared `sidebar_position` first, then alphabetical by label. */
export function comparePages(
  a: { position: number | null; label: string },
  b: { position: number | null; label: string },
): number {
  if (a.position !== null || b.position !== null) {
    const left = a.position ?? Number.POSITIVE_INFINITY;
    const right = b.position ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
  }
  return a.label.localeCompare(b.label, 'en');
}

/** What the walk produced, split into what it could place and what it could not. */
export interface DocsAttribution {
  /** One entry per module that has documentation, sorted by module id. */
  readonly documented: readonly ModuleDocs[];
  /** Registered modules no page documents, sorted. */
  readonly undocumented: readonly string[];
  /**
   * Pages with no shipper whose slug names no registered module.
   *
   * A page in the **site's own tree** only. A page a module ships has a
   * shipper, so it is attributed whatever its slug says; where its slug names a
   * *different* module that is {@link DocsAttribution.misowned}, and where it
   * names none it is simply a second slug that module owns.
   */
  readonly unlocated: readonly DocPage[];
  /**
   * Pages a module ships under a **different** registered module's slug.
   *
   * Shipper and subject are two questions (see {@link DocPageOrigin}) and this
   * is the state where they disagree. It is Constitution I applied to prose,
   * and the same shape `check:admin-zones` refuses as `foreign-module-id`: a
   * module publishing under a sibling's slug takes an address the sibling owns,
   * and if the sibling ever ships that page too the copy step has two sources
   * for one target. The page stays attributed to its **shipper** — the module's
   * own declaration outranks a derivation from a file name — and the
   * disagreement is reported rather than resolved.
   */
  readonly misowned: readonly { page: DocPage; namesModule: string }[];
  /**
   * Pages Docusaurus will not route: a path segment beginning with `_`.
   *
   * An underscore-prefixed file is a **partial** by design — intended for
   * import into another page, generating no route, and unfindable from
   * `sidebars.js`. D-200 is what keeps a module id's leading underscore out of
   * its slug; this is the refusal that makes the rule hold for a page nobody
   * ran that derivation over.
   */
  readonly unroutable: readonly DocPage[];
  /** Every page the walk opened. */
  readonly pages: readonly DocPage[];
}

/**
 * Place every page against the registered module set.
 *
 * Pure over the two inputs, so a red proof enters where a real run enters
 * (issue #130): the pages a walk produced and the ids the index registers.
 */
export function attributeDocs(
  pages: readonly DocPage[],
  registered: readonly string[],
): DocsAttribution {
  const registeredSet = new Set(registered);
  // Grouped by **module**, not by slug. One module can own two slugs —
  // `organizations` ships `organizations.md` and `organization-hierarchy.md` —
  // and grouping by slug would emit that module twice, which the module map's
  // "one row per registered module" cannot represent.
  const byModule = new Map<string, DocPage[]>();
  const unlocated: DocPage[] = [];
  const misowned: { page: DocPage; namesModule: string }[] = [];

  for (const page of pages) {
    const named = moduleOfSlug(page.slug, registeredSet);
    // The **shipper** first. A module's own declaration of what it ships
    // outranks any derivation from a file name, and it is what lets a module
    // own a second slug without a hand-declared attribution anywhere.
    const shipper =
      page.origin.kind === 'module' && page.origin.moduleId !== null
        ? page.origin.moduleId
        : null;
    const moduleId = shipper ?? named;
    if (moduleId === null) {
      unlocated.push(page);
      continue;
    }
    if (shipper !== null && named !== null && named !== shipper) {
      misowned.push({ page, namesModule: named });
    }
    const group = byModule.get(moduleId);
    if (group === undefined) byModule.set(moduleId, [page]);
    else group.push(page);
  }

  const documented: ModuleDocs[] = [];
  for (const [moduleId, group] of byModule) {
    // The page a reader lands on, in three falling steps and never a guess: the
    // module's *own* entry page (a slug that names the id by D-200's rule,
    // marked entry by the walk), then any entry page — which is what answers
    // for a module whose only page sits at a slug of its own — then whatever
    // there is.
    const entry =
      group.find((page) => page.isEntry && slugNamesModule(page.slug, moduleId)) ??
      group.find((page) => page.isEntry) ??
      group[0]!;
    const slug = entry.slug;
    const children = group
      .filter((page) => page !== entry)
      .sort((a, b) =>
        comparePages(
          { position: a.frontMatter.sidebarPosition, label: labelOf(a, basename(a.path)) },
          { position: b.frontMatter.sidebarPosition, label: labelOf(b, basename(b.path)) },
        ),
      );
    documented.push({ moduleId, slug, entry, children });
  }
  documented.sort((a, b) => a.moduleId.localeCompare(b.moduleId));

  const covered = new Set(documented.map((entry) => entry.moduleId));
  return {
    documented,
    undocumented: registered.filter((id) => !covered.has(id)).sort(),
    unlocated,
    misowned: misowned.sort((a, b) => a.page.docId.localeCompare(b.page.docId)),
    // Every segment of the page's own path inside the category, because
    // Docusaurus excludes an underscore-prefixed **directory** from routing on
    // the same terms as a file.
    unroutable: pages.filter((page) =>
      page.relativePath.split('/').some((segment) => segment.startsWith('_')),
    ),
    pages,
  };
}

/**
 * Where a module ships its own documentation, or `null` when it declares none.
 *
 * The anchor is `dirname(manifestPath)` — the same one the `_i18n` boot
 * reconciler joins `bundlesDir` to, which `resolveManifestPath` already makes
 * correct for a core-relative module, a workspace package and an installed
 * package alike (`contracts/module-documentation-layer.md` R2.2). Nothing in a
 * module names a package, a repository root or a build directory to find its own
 * pages; the platform supplies the anchor.
 *
 * `false` and absent are **not** the same state and this returns the same
 * `null` for both deliberately: the distinction is the *manifest's*, and the
 * consumer that needs it (`undocumented-module`) reads the declaration itself.
 */
export function declaredDocsDirectory(
  manifestPath: string,
  declaration: { dir: string } | false | undefined,
): string | null {
  if (declaration === undefined || declaration === false) return null;
  return join(manifestPath.replace(/[/\\][^/\\]*$/, ''), declaration.dir);
}

/** True when `path` is a directory that exists. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Raised when a module declares a documentation directory that is not there. */
export class DeclaredDocsDirectoryMissingError extends Error {
  override readonly name = 'DeclaredDocsDirectoryMissingError';
}

/** One module, as a caller of {@link moduleDocsSources} describes it. */
export interface ModuleDocsDeclarant {
  readonly moduleId: string;
  /** The module's entry in the generated manifest index. */
  readonly manifestPath: string;
  /** What the manifest declares — `{ dir }`, `false`, or absent. */
  readonly declaration: { dir: string } | false | undefined;
}

/**
 * Where every module that declares documentation keeps it.
 *
 * **A declared directory that is not on disk is a refusal, naming the module**
 * (FR-017, `module-documentation-layer.md` R2.4). It must not read as "this
 * module ships no documentation", and the reason is a measured one rather than
 * a stylistic preference: `backend/src/manifest-locations.ts`' header records
 * that the `_i18n` boot reconciler *logs and skips* an absent bundles
 * directory, so a packaged module would have rendered every command-palette
 * entry as its raw i18n key with no error anywhere. The distinction between
 * *declared and absent* and *not declared* is the whole of that repair.
 */
export function moduleDocsSources(
  modules: readonly ModuleDocsDeclarant[],
): readonly ModuleDocsSource[] {
  const sources: ModuleDocsSource[] = [];
  const missing: string[] = [];
  for (const module of modules) {
    const root = declaredDocsDirectory(module.manifestPath, module.declaration);
    if (root === null) continue;
    if (!isDirectory(root)) {
      missing.push(`${module.moduleId} declares ${JSON.stringify(module.declaration)} at ${root}`);
      continue;
    }
    sources.push({ moduleId: module.moduleId, root });
  }
  if (missing.length > 0) {
    throw new DeclaredDocsDirectoryMissingError(
      `${missing.length} module(s) declare a documentation directory that is not on disk:\n` +
        missing.map((entry) => `  - ${entry}`).join('\n') +
        '\nA declared directory that is absent is a refusal and never "this module ships no ' +
        'documentation" — declare `docs: false` if that is the decision, or ship the directory.',
    );
  }
  return sources.sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

/**
 * Where the site keeps the copy of a page a module ships.
 *
 * The module's fragment lands at the same relative path inside the category, so
 * the copy preserves the page's doc id, its permalink and every relative link
 * written against it (`module-documentation-layer.md` R5.2).
 */
export function copyTargetOf(page: DocPage, modulesRoot: string): string {
  return join(modulesRoot, page.relativePath);
}

/** One relative markdown link, as written. */
export interface RelativeLink {
  /** The target exactly as the page spells it — `./payments.md`, `../catalog.md`. */
  readonly target: string;
  /** The doc id the target resolves to, or `null` when it leaves the category. */
  readonly docId: string | null;
}

/**
 * Every relative markdown link a page writes, resolved to a doc id.
 *
 * Read as `](…)` with a `./` or `../` prefix, in the literal-text discipline
 * the rest of the estate uses. The bounds are stated here rather than
 * discovered later (`docs-registry.md` R3.10): a link built by an MDX
 * expression or a component is invisible, a raw `<a href>` is invisible, and a
 * `@site/`-prefixed absolute link is not a relative sibling link and is outside
 * the population by construction.
 *
 * An anchor or a query is stripped, and a target that resolves outside the
 * modules category resolves to `null` — a link into `../operations/runbooks/…`
 * is a link to the site, not to a sibling module.
 */
export function relativeLinksIn(page: DocPage, source: string): RelativeLink[] {
  const fromDir = page.relativePath.includes('/')
    ? page.relativePath.slice(0, page.relativePath.lastIndexOf('/'))
    : '';
  const links: RelativeLink[] = [];
  for (const match of source.matchAll(/\]\((\.{1,2}\/[^)\s]+)\)/g)) {
    const raw = match[1]!;
    const target = raw.split('#')[0]!.split('?')[0]!;
    if (target === '') continue;
    const segments = [...fromDir.split('/').filter((part) => part !== ''), ...target.split('/')];
    const resolved: string[] = [];
    let escaped = false;
    for (const segment of segments) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') {
        if (resolved.length === 0) {
          escaped = true;
          break;
        }
        resolved.pop();
        continue;
      }
      resolved.push(segment);
    }
    if (escaped || resolved.length === 0) {
      links.push({ target: raw, docId: null });
      continue;
    }
    const last = resolved[resolved.length - 1]!.replace(/\.mdx?$/, '');
    resolved[resolved.length - 1] = last;
    links.push({ target: raw, docId: `${MODULES_CATEGORY}/${resolved.join('/')}` });
  }
  return links;
}

/**
 * What a manifest's **source text** declares for `docs`.
 *
 * The generator reads the tree and the check reads the emitted manifest, so the
 * two answer this question from two different artefacts — which is the estate's
 * independent-author pattern rather than a duplication: a generator that
 * imported the index it is about to render would be reading its own previous
 * answer.
 *
 * `'unreadable'` is a **finding and never a skip** (issue #113). A computed
 * `dir` is a directory this walk cannot place, and treating it as "declares
 * nothing" is the direction that agrees with the defect — the module's pages
 * would simply not be collected, with no error anywhere, which is the failure
 * `manifest-locations.ts` was written to end.
 */
export function docsDeclarationIn(source: string): { dir: string } | false | undefined | 'unreadable' {
  const match = /^\s{0,4}docs\s*:\s*(false|\{[^}]*\})\s*,/m.exec(source);
  if (match === null) return undefined;
  const value = match[1]!;
  if (value === 'false') return false;
  const dir = /\bdir\s*:\s*['"]([^'"]+)['"]/.exec(value);
  return dir === null ? 'unreadable' : { dir: dir[1]! };
}

/**
 * The `docs` declaration of every module the generated index registers.
 *
 * The index is **imported**, because a module package resolves through its own
 * `exports` map at its build output and the declaration a running platform sees
 * is the emitted one. Every reader that needs "where does each module keep its
 * pages" starts here, so the population is derived once: two walks over one
 * population are two answers waiting to disagree, which is the state this whole
 * feature ends.
 */
export async function moduleDocsDeclarantsFrom(
  manifestIndexPath: string,
): Promise<ModuleDocsDeclarant[]> {
  const loaded = (await import(pathToFileURL(manifestIndexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifestPath?: string;
      manifest?: { docs?: { dir: string } | false };
    }>;
  };
  const declarants: ModuleDocsDeclarant[] = [];
  for (const entry of loaded.DISCOVERED_MANIFESTS ?? []) {
    if (entry.manifestPath === undefined) continue;
    declarants.push({
      moduleId: entry.id,
      manifestPath: entry.manifestPath,
      declaration: entry.manifest?.docs,
    });
  }
  return declarants;
}

/**
 * Every page a module owns, and where the site keeps its copy.
 *
 * `copies` is the set every walk over the site's tree has to leave alone: the
 * copies are not committed, so a fresh checkout has none and a developer who
 * has run the site build has all of them — and a population that counted them
 * would be a different size on the two machines.
 */
export async function resolveModuleDocs(
  repoRoot: string,
  manifestIndexPath: string,
): Promise<{
  readonly docs: DocsLayout;
  readonly sources: readonly ModuleDocsSource[];
  readonly modulePages: readonly DocPage[];
  readonly copies: ReadonlySet<string>;
}> {
  const docs = resolveDocsLayout(repoRoot);
  const sources = moduleDocsSources(await moduleDocsDeclarantsFrom(manifestIndexPath));
  const modulePages = collectModuleDocPages(sources);
  return {
    docs,
    sources,
    modulePages,
    copies: new Set(modulePages.map((page) => copyTargetOf(page, docs.modulesRoot))),
  };
}
