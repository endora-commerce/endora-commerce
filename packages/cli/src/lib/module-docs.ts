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
 * ## Attribution, and the one thing that is not derivable
 *
 * A page attributes to a module when its **slug** names one: `google-analytics`
 * is `google_analytics`, because a URL segment is conventionally hyphenated and
 * a module id is snake_case. That covers 62 of the 66 slugs standing today.
 *
 * Four do not, and they are `spec.md` Q2 — an **open owner question** whose
 * answer changes a public URL:
 *
 *   * `dictionary` documents `dictionaries`;
 *   * `admin-i18n` documents `_i18n`;
 *   * `module-lifecycle` documents `_lifecycle`;
 *   * `organization-hierarchy` documents a feature of `organizations`.
 *
 * Nothing in the tree derives those four. A heuristic could be written for three
 * of them — strip a leading underscore, then match a slug's tail — and it would
 * be a rule invented to fit four cases, which is how a check acquires a
 * population defined by the habits of whoever wrote it (issue #244). So the
 * attribution is **declared** instead, in {@link PAGES_ATTRIBUTED_BY_ALIAS}: a
 * two-way ledger, one entry per page, each naming the module, saying why the
 * slug disagrees and naming its retiring condition.
 *
 * **It is an attribution input and not an exemption**, and the difference is the
 * reason it is allowed to exist beside `contracts/docs-registry.md` R3.4's
 * "`unlocated-page` carries no ledger". A page with no alias and no matching
 * slug is still `unlocated-page` with nothing to write that makes it pass;
 * declaring an alias is not permission to be unattributed, it is the attribution
 * itself, reviewable in the diff and refused the moment it stops being true.
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

/** Extensions Docusaurus reads as a documentation page. */
export const PAGE_EXTENSIONS: readonly string[] = ['.md', '.mdx'];

/** Raised when the documentation layout cannot be resolved; a caller exits 2. */
export class DocsLayoutUnresolvableError extends Error {
  override readonly name = 'DocsLayoutUnresolvableError';
}

/**
 * A page whose slug does not name its module, and the module it documents.
 *
 * Two-way and expected to **empty**, not to stand: every entry retires when
 * `spec.md` Q2 is answered and the rename lands with its inbound citations
 * repaired (Phase 2, `plan.md` item 11). Until then this is what keeps the
 * generated module map *true* — `_lifecycle` has a 17.9K page, and a map
 * deriving attribution from the slug alone would print it as undocumented.
 *
 * An entry may not say "this page needs no module": that is `unlocated-page`,
 * which has no ledger by design. It says which module the page is about.
 */
export type PageAliases = Readonly<Record<string, { moduleId: string; reason: string }>>;

export const PAGES_ATTRIBUTED_BY_ALIAS: PageAliases =
  {
    dictionary: {
      moduleId: 'dictionaries',
      reason:
        'The page documents the `dictionaries` module and its slug is the singular. Retires ' +
        'with the rename (feature 100 Phase 2, spec.md Q2); the URL is cited by 2 documents ' +
        'and 2 specs, so it moves with them or not at all.',
    },
    'admin-i18n': {
      moduleId: '_i18n',
      reason:
        'The page documents the `_i18n` module under a slug chosen for the URL, a leading ' +
        'underscore reading badly in one. Whether it is renamed to the module id or keeps a ' +
        'display slug is spec.md Q2 — an open owner question, not a defect this check may decide.',
    },
    'module-lifecycle': {
      moduleId: '_lifecycle',
      reason:
        'The page documents the `_lifecycle` module, under the same display-slug arrangement as ' +
        '`admin-i18n` and blocked on the same open question (spec.md Q2).',
    },
    'organization-hierarchy': {
      moduleId: 'organizations',
      reason:
        'A second page about `organizations` — its hierarchy feature — written at the top level ' +
        "rather than inside that module's own tree. Retires when it becomes " +
        '`organizations/hierarchy` (feature 100 Phase 2, spec.md Q2).',
    },
  };

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

/** Every page the modules category holds, sorted by doc id. */
export function collectDocPages(modulesRoot: string): DocPage[] {
  if (!existsSync(modulesRoot)) return [];
  const pages: DocPage[] = [];
  const isPage = (name: string): boolean => PAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  const stem = (name: string): string => name.replace(/\.mdx?$/, '');

  for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
    const full = join(modulesRoot, entry.name);
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
        });
      }
      continue;
    }
    if (!entry.isFile() || !isPage(entry.name)) continue;
    // Two files under this root are the **category's**, not a module's, and
    // both are skipped rather than judged: the landing page a reader arrives
    // at, and the generated map itself. The map is an artefact — `overlay:check`
    // owns whether it is current, and reading it back as a page would make it
    // `unlocated-page` for naming no module, which is a finding about this
    // walk's population dressed as one about the tree.
    if (stem(entry.name) === 'README') continue;
    if (entry.name === MODULE_MAP_ARTEFACT) continue;
    pages.push({
      docId: `${MODULES_CATEGORY}/${stem(entry.name)}`,
      path: full,
      relativePath: entry.name,
      slug: stem(entry.name),
      isEntry: true,
      inDirectory: false,
      frontMatter: parseFrontMatter(readFileSync(full, 'utf8')),
    });
  }
  return pages.sort((a, b) => a.docId.localeCompare(b.docId));
}

/**
 * The module a slug names, or `null`.
 *
 * A URL segment is hyphenated and a module id is snake_case, so the comparison
 * folds one into the other. It is not a heuristic that guesses: the folded slug
 * must equal a registered id exactly.
 */
export function moduleOfSlug(
  slug: string,
  registered: ReadonlySet<string>,
  aliases: PageAliases = PAGES_ATTRIBUTED_BY_ALIAS,
): string | null {
  const folded = slug.split('-').join('_');
  if (registered.has(folded)) return folded;
  const alias = aliases[slug];
  if (alias !== undefined && registered.has(alias.moduleId)) return alias.moduleId;
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
  /** Pages under a slug that names no module and carries no alias. */
  readonly unlocated: readonly DocPage[];
  /** Every page the walk opened. */
  readonly pages: readonly DocPage[];
  /**
   * Slugs whose alias entry describes no page on disk — the stale direction of
   * {@link PAGES_ATTRIBUTED_BY_ALIAS}, reported so the entry retires with the
   * merge request that made it stale rather than with the next one.
   */
  readonly staleAliases: readonly string[];
  /**
   * Slugs whose alias entry is no longer needed because the slug now names the
   * module directly — the other stale direction, and the one Q2's rename
   * produces.
   */
  readonly redundantAliases: readonly string[];
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
  aliases: PageAliases = PAGES_ATTRIBUTED_BY_ALIAS,
): DocsAttribution {
  const registeredSet = new Set(registered);
  // Grouped by **module**, not by slug. One module can hold two slugs — a page
  // reached by an alias sits beside the module's own (`organization-hierarchy`
  // beside `organizations`) — and grouping by slug would emit that module twice,
  // which the module map's "one row per registered module" cannot represent.
  const byModule = new Map<string, DocPage[]>();
  const unlocated: DocPage[] = [];

  for (const page of pages) {
    const moduleId = moduleOfSlug(page.slug, registeredSet, aliases);
    if (moduleId === null) {
      unlocated.push(page);
      continue;
    }
    const group = byModule.get(moduleId);
    if (group === undefined) byModule.set(moduleId, [page]);
    else group.push(page);
  }

  const documented: ModuleDocs[] = [];
  for (const [moduleId, group] of byModule) {
    // The page a reader lands on, in three falling steps and never a guess: the
    // module's *own* entry page (a slug that folds to the id, marked entry by
    // `collectDocPages`), then any entry page — which is what answers for a
    // module reached only through an alias — then whatever there is.
    const entry =
      group.find((page) => page.isEntry && page.slug.split('-').join('_') === moduleId) ??
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
  const slugsOnDisk = new Set(pages.map((page) => page.slug));
  return {
    documented,
    undocumented: registered.filter((id) => !covered.has(id)).sort(),
    unlocated,
    pages,
    staleAliases: Object.keys(aliases)
      .filter((slug) => !slugsOnDisk.has(slug))
      .sort(),
    redundantAliases: Object.keys(aliases)
      .filter((slug) => slugsOnDisk.has(slug) && registeredSet.has(slug.split('-').join('_')))
      .sort(),
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
