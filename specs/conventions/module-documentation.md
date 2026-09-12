# Module documentation (feature 100)

**Open this before writing or moving a module's documentation page**, or when
`check:module-docs` reports against your module. One of the bodies `AGENTS.md` routes to; it
is the single home for these rules, so never restate them in `AGENTS.md` or in a tool-specific
pointer file.

**A module's page appears in the navigation because the module exists, not because
somebody remembered two shared files.** `docs/sidebars.js`' Modules category and the module
map are **generated** — `docs/sidebars.modules.generated.js` and
`docs/docs/modules/module-map.generated.md`, artefacts six and seven of
`composer:generate`. Never hand-edit either, and never add an entry to `sidebars.js` for a
module.

1. **Write the page in the module's own `docs/` layer**, and declare it —
   `docs: { dir: 'docs' }` in `manifest.ts`, `docs` in the package's `files` (which
   `manifests:generate` renders for you). It is `i18n/`'s mechanism unchanged: a
   package-root directory, no `exports` subpath, located by joining the declared directory
   to `dirname(manifestPath)`, so nothing in the module names a package, a repository root
   or a build directory to find its own pages.

   **`docs/` is the module's fragment of the site's modules category, copied verbatim** —
   a file at `docs/<p>` is served at `/docs/modules/<p>` — which is what lets a module own
   more than one slug (`organizations` ships `organizations.md` *and*
   `organization-hierarchy.md`) with nothing declared anywhere. Name the page after the
   module: a hyphenated slug folds onto a snake_case id, and a **leading underscore is
   stripped**, so `google-analytics` documents `google_analytics` and `i18n.md` documents
   `_i18n` (D-200). The underscore may not survive into the file name — **Docusaurus
   excludes an underscore-prefixed file from routing by design**, making it a partial that
   generates no route and cannot be found from the sidebar, which is `unroutable-page`.
   A module with sub-pages gets a directory and an `index.md`.

   The copies are **not committed**: `composer:generate` places them (and
   `pnpm --filter docs run build` does it for you), `.gitignore` covers them, and the
   source of every page is the module's. `_lifecycle` is the one page still in the site's
   own tree, because its manifest resolves inside the platform package's **build output**
   and documentation is not a compiled asset.

1a. **Do not link a sibling module's page with a relative link.** A sibling may not be
   installed in the reader's instance, so the link names a page that is not there and
   `onBrokenLinks: 'throw'` is what that client's own build says about it. Refer to the
   module by name, or link the module map. `foreign-module-link` is the finding, and its
   per-consumer shards under `backend/scripts/ledgers/foreign-module-links/` are the 24
   links standing, expected to empty.
1b. **And do not link the site's own tree either** — `../architecture/…`,
   `../integrations/…`, anything above the modules category. A sibling module is
   at least *sometimes* there; a page above the category travels with no package
   at all, so it is absent from **every** reader's instance whatever they
   installed, and their own build fails on it under `onBrokenLinks: 'throw'`.
   Name the guide in prose, or link the module map. Where the content genuinely
   belongs to the module, move it into the module's own `docs/` layer, where it
   becomes a page the module ships and a relative link can reach it.
   `site-tree-link` is the finding and it has **no ledger**: unlike
   `foreign-module-link` there is no instance in which such a link resolves, so
   an entry could only license one. It landed at zero, the eight links then
   standing in six module packages repaired with it.
2. **Front matter is Docusaurus's own and nothing this repository invented** — `title`
   (required), `description` (one sentence naming the capability; it is the module map's
   summary column and the page's meta description), and optionally `sidebar_label` and
   `sidebar_position`. That is deliberate: a third-party module author writes ordinary
   Docusaurus markdown and learns nothing from us.
3. **Regenerate** — `pnpm --filter backend run composer:generate` — and commit both
   artefacts. `overlay:check` holds them to its `missing`, `stale`, `empty` and `foreign`
   verdicts like the other five.
4. **A module with genuinely nothing to document declares `docs: false`** in its manifest.
   Absent and `false` are not the same state: `false` is a decision and owes nothing,
   absent is a module nobody has decided about and is a `check:module-docs` finding.
5. **CI** — `pnpm --filter backend run check:module-docs` (in `quality`, and its row in
   `check-inventory.md` says what it refuses) and the `build:docs` job, which is what makes a
   sidebar entry naming no page and a link to a page that moved fail the pipeline rather
   than a developer's machine.

**A mixed tree is supported and is not a transitional accident**: a page in the site's own
tree and a page in a module package are attributed by the same derivation, which is what
let Phase 2 land in batches and what keeps `_lifecycle`'s page working where it is.

