# Tasks: Page builder — contact form, page navigation, block fixes and newsletter attributes (`specs/169-page-builder-contact-form/`)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md) (R-1 … R-13),
[data-model.md](./data-model.md), [contracts/contact-form-api.md](./contracts/contact-form-api.md),
[contracts/blocks.md](./contracts/blocks.md), [quickstart.md](./quickstart.md).

**Organisation**: four **independent work packages** for four developers in four worktrees. Each
package has a disjoint task-ID range, its own branch, its own changesets, and can merge alone.

| WP | IDs | Items | Branch (suggested) |
| --- | --- | --- | --- |
| A | T001–T049 | 1 carousel kept arrows, 2 empty listings, 3 Accordion `filled`, 4 DownloadTile icon presets | `feat/169a-block-fixes` |
| B | T050–T089 | 5 `cms.PageNavigation` | `feat/169b-page-navigation` |
| C | T090–T169 | 6 `cms.ContactForm` (contract, endpoint, setting, mailer `replyTo`, storefront handler, block, newsletter opt-in, docs) | `feat/169c-contact-form` |
| D | T170–T219 | 7 `newsletter.Signup` tag picker + attributes | `feat/169d-newsletter-attributes` |

IDs not used inside a range are spare; do not borrow another package's range.

## Format

`- [ ] T### [P?] [US?] Description — path(s)`

- **[P]**: may be written in parallel with its neighbours (different files, no unfinished
  dependency).
- **[US1] … [US7]**: the spec's user story.
- **RED**: the deliverable is a failing test. Run it and see it fail **for the reason named** before
  the task that turns it green (Constitution III, NN). Record under the task, honestly:
  `**RED (date):** <command> → <failure as printed>` and later `**GREEN:** …`. A RED that failed for
  a different reason is written down as such and fixed before going on.

## Standing rules for every package

1. **Worktree.** `git worktree add ../wt-169<x> -b feat/169<x>-… feat/169-page-builder-contact-form`
   then `bash ../wt-169<x>/scripts/setup-worktree.sh` and `pnpm run build:packages`. Never a
   symlinked `node_modules`; never touch the main checkout; never stop docker or the owner's dev
   services; never `db:fresh`/`setup`.
2. **Rebuild what you edit.** Tests read each package's `dist`; after editing anything under
   `packages/`, `pnpm --filter <package> run build` before a test that imports it.
3. **Commands.**
   - package unit test: `pnpm --filter <package> exec vitest run <path>`;
   - backend unit: `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <file>`;
   - storefront: `pnpm --filter storefront exec vitest run <file>`;
   - admin: `pnpm --filter admin exec vitest run <file>`;
   - **[PG]** Postgres-backed (contract/integration), one file per invocation, against the test
     database on port 5441:
     `(cd backend && TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5441/b2b_test pnpm exec vitest run <file>)`
     (add `REDIS_URL` / `MEILISEARCH_*` from the root `.env` when the file needs them).
   - Any piped command starts with `set -o pipefail;`. Never run `pnpm -r …`, a whole test tree,
     `test:unit:fast` as a whole, or the docs build locally; those run on CI.
4. **Extend, don't narrow.** Every new prop optional; unset → today's markup byte for byte. Add a
   case to `packages/cms-components/src/components/option-parity.test.ts` when a field moves or its
   options change, and keep `fallback-parity` green; never weaken a parity case.
5. **Puck fields** (feature 163): module-level constants; `resolveFields` returns cached objects;
   hide fields that do not apply; order content → layout → style → spacing → visibility; labels in
   the style of existing ones; switches for booleans.
6. **Tokens.** Every `--cmsb-*` use carries today's literal as its fallback. No px option, no free
   colour picker (R23 stays removed).
7. **i18n.** Every new field label/option in `en` and `pl` of the declaring module's bundle, at the
   key stem `blocks.<stem>.fields.<field>.(label|options.<v>)`; extend
   `admin/test/modules/cms/page-builder-field-i18n.test.ts` for new fields. Every shopper-visible
   default through `storefront/lib/i18n/messages.ts` (a missing Polish string is a `tsc` error).
8. **A new error code lands in one commit with its four places**: `ERROR_CODES`
   (`packages/contracts/src/errors.ts`), `MINTED_ERROR_CODES`
   (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), the owning manifest's
   `errorCodes`, both bundles' `errors.<CODE>`.
9. **Regenerated artefacts are committed with their input**: `pnpm --filter backend run
   composer:generate` (manifest index, module reference) after a manifest change;
   `packages/cms-components/dist/cms-components.css` rebuilt after a stylesheet change.
10. **Docs**: EN page in the module's `docs/`, the PL materialisation under
    `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/…`, and the cache entry
    `docs/translation-cache/pl/<sourceKey>.json` with `sourceHash = hashSourceBody(<EN>)`
    (`backend/scripts/lib/docs-translation-cache.ts`); then `pnpm --filter backend run
    check:docs-translations`. No link to a sibling module's page or the site tree (module-documentation 1a/1b).
11. **Changesets**: one per meaning, `.changeset/169-<wp-letter>-<slug>.md`, naming every package
    whose published behaviour changes (`release-intent.md`).
12. **Generic only.** No reference website, client, text, address, person or measured value in any
    tracked file, test fixture or commit message. `example.com`, `Acme`.
13. **Every deliberately changed existing assertion is named in its task.** A red in an existing
    test no task names is a defect.
14. **Deleting or moving a file**: grep `backend/test/**`, `storefront/test`, `admin/test` for it
    (AGENTS.md traps).
15. **Commits**: `git commit -s`, English conventional message, **no AI trailer**, never push.
16. **Shared files** (plan § *Work packages and merge plan*): edit only your own hunk at the named
    insertion point; never reorder or reformat another block's lines. On a merge conflict keep both
    sides; rebuild `dist/cms-components.css` instead of merging it.
17. **Verify before reporting done**: filtered `typecheck` + `lint` of every workspace touched, the
    package's own tests, the derived-artefact tests its inputs feed, its `[PG]` files and named
    `check:*` scripts.

---

## WP-A — Block fixes and presets (T001–T049)

**Owns**: `packages/cms-components/src/components/carousel/{CarouselShell.tsx,carousel-parts.tsx}`,
`ProductSlider.tsx`, `ProductGrid.tsx`, `CategoryGrid.tsx`, `CategoryList.tsx`, `LatestPosts.tsx`,
`Accordion.tsx`, `DownloadTile.tsx` and their tests; `storefront/test/ssr/catalog-blocks.test.tsx`;
`packages/modules/cms/docs/cms/index.md` (+ PL + cache).
**Shared (own hunk)**: `component-types.ts` (the `Accordion*`/`DownloadTile*` types in place);
`styles/cms-components.css` (the carousel arrow rules near line 1797, the accordion rules near 3193,
the download-tile rules near 6133) + `dist/cms-components.css`; `packages/modules/cms/i18n/{en,pl}.json`
(next to the existing `blocks.accordion.fields.itemStyle.*` and `blocks.downloadTile.fields.*` keys).

### A1. Setup

- [X] T001 Drift check and reproduction of the carousel report (R-1). Confirm the symbols R-1 cites
  (`keepArrowsWhenFit`, `keptOff`, `controlsHidden`, `.cmsc-pb-carousel__arrow:disabled`) are at
  the cited places. Reproduce in a browser (local storefront, a light, a muted and a dark section;
  overlay, below and slide placements) and record what is seen. **Stop and report** to the owner if
  the reproduction shows the arrows absent from the published DOM for a reason R-1 does not list, or
  if the report concerns the editor canvas only (R-1 *Decision*).
  **Done (2026-10-30).** Symbols confirmed where R-1 cites them (`keepArrowsWhenFit`, `keptOff`,
  `controlsHidden`, `.cmsc-pb-carousel__arrow:disabled` at `cms-components.css:1797`). Reproduced in
  headless Chrome (no local storefront started, to leave the owner's services alone): the
  post-measure DOM of a `cms.ContentSlider` with `arrowsWhenFit` (mounted in jsdom, every slide
  fitting) placed in light, muted and dark sections with the stylesheet, `below` and `overlay`
  placements. Both arrows present, `disabled`, `visibility: visible`, no `[hidden]` ancestor, but
  `opacity: 0.4` on a `#fff` disc with a `#e2e8f0` ring: near-invisible on light/muted, a grey disc
  on dark. Cause = R-1's dimmed disabled look; not the editor canvas; no second cause.

### A2. Carousel kept arrows (US1, FR-001, FR-002)

- [X] T002 [P] [US1] **RED** `packages/cms-components/src/components/carousel/carousel-kept-arrows.test.tsx`:
  for `cms.ContentSlider`, `catalog.ProductSlider` (catalog preview provider), `blog.LatestPosts`
  and a `cms.ContentSlider` holding two `cms.CarouselSplit` slides with `controlsPlacement: 'slide'`,
  with `controls.arrowsWhenFit: true` and a track measuring `scrollWidth === clientWidth` (jsdom
  stubs): both arrows present, `disabled`, no ancestor `[hidden]`, root carries
  `cmsc-pb-carousel--arrows-kept`. Fails today on the class (the arrows themselves are expected
  present — if not, record it: that is a second cause).
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/carousel/carousel-kept-arrows.test.tsx` → all five
  carousels (ContentSlider below/overlay, ProductSlider, LatestPosts, ContentSlider with CarouselSplit
  `slide` controls) `AssertionError: expected false to be true` on the `--arrows-kept` class; arrows
  present and disabled in every case (no second cause). The split case first failed on four shown
  arrows: the test did not discount the fallback row the stylesheet removes with `:has()` — a test
  defect, fixed in the test. **GREEN** after T004.
- [X] T003 [P] [US1] **RED** stylesheet assertion in
  `packages/cms-components/src/components/styles.test.ts` (existing file, new case): a rule for
  `.cmsc-pb-carousel--arrows-kept .cmsc-pb-carousel__arrow:disabled` sets `opacity: 1` and uses
  `--cmsb-border` / `--cmsb-fg-muted` with literal fallbacks; and the option off leaves no
  `--arrows-kept` class (markup snapshot of an existing fitting carousel unchanged).
  **RED (2026-10-30):** stylesheet cases live in `carousel-kept-arrows.test.tsx` (`styles.test.ts` tests the
  `styles.ts` helpers, not the stylesheet) → `expected '' to contain 'opacity: 1;'`. The option-off
  cases (no `--arrows-kept`, controls hidden as today) were green from the start. **GREEN** after T004.
- [X] T004 [US1] GREEN: add the class while `keptOff` in `CarouselShell.tsx` (`carouselClass`) and the
  rule in `styles/cms-components.css` (after the T171 disabled-arrow rules); an explicit
  `disabledArrowLook` (`light`/`color`) keeps winning (selector order). Rebuild the package.
  Rule also sets `background: var(--cmsb-bg, #fff)` so the kept arrow sits on the scheme background.
- [X] T005 [US1] Dark-scheme check: extend T003 with `[data-cmsb-scheme='dark']` — the kept look reads
  the dark scheme's tokens (no `#fff` background left on a disabled kept arrow).
  **RED (2026-10-30)** with T003 (`expected '' to contain 'background: var(--cmsb-bg, #fff);'`); **GREEN**.
  Chrome after the fix: dark → `#0f172a` disc, `#334155` ring, `#cbd5e1` glyph; light → `#64748b` glyph.

### A3. Empty listings (US2, FR-003–FR-005)

- [X] T006 [P] [US2] **RED** `packages/cms-components/src/components/catalog/empty-listings.test.tsx`
  (new): server render (no editor) of `catalog.ProductSlider`, `catalog.ProductGrid`,
  `catalog.CategoryGrid`, `catalog.CategoryList` with an empty block-data result renders `''`
  (no `cmsc-pb-product-grid__empty`, no box, no heading); `blog.LatestPosts` likewise (already green
  — kept as the reference case); editor render keeps each note. Fails on the four catalog blocks.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/catalog/empty-listings.test.tsx` → the four catalog blocks
  `expected 1 to be +0` (one child in the block's hide-on wrapper; Puck's `Render` always leaves the
  drop zone and that wrapper, so "renders ''" is asserted as an empty wrapper); `blog.LatestPosts`
  green as the reference; editor notes green (ProductSlider's editor hook mocked outside `<Puck>`).
- [X] T007 [US2] GREEN: return `null` on the storefront when empty in `ProductSlider.tsx`,
  `ProductGrid.tsx`, `CategoryGrid.tsx`, `CategoryList.tsx`; editor branch unchanged.
  **GREEN.** `CategoryList`'s render is a `PuckComponent` (must return an element): it returns an
  empty fragment.
- [X] T008 [US2] Deliberately changed assertions (standing rule 13):
  `storefront/test/ssr/catalog-blocks.test.tsx:240-242` and `:332-333` — `'No products found'` and
  `'No categories found'` now **absent**; assert the block contributes no element instead.
  **GREEN:** `pnpm --filter storefront exec vitest run test/ssr/catalog-blocks.test.tsx` → 16 passed.

### A4. Accordion `filled` (US3, FR-006, FR-007)

- [X] T009 [P] [US3] **RED** in `packages/cms-components/src/components/Accordion.test.tsx`:
  `itemStyle: 'filled'` → root class `cmsc-pb-accordion--filled`, no `--dividers-*` class even with
  `dividers` stored; `resolveFields` hides `dividers` and `dividerPosition`; the `itemStyle` field
  offers `filled`; unset/`plain`/`boxed` markup unchanged.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/Accordion.test.tsx` → 4 new cases fail (no `--filled` class,
  no Filled option, item gap `0px`, no stylesheet rule). **Deliberately changed** (rule 13):
  `Accordion.test.tsx` T175 case `itemStyle` options `['plain','boxed']` → `['plain','boxed','filled']`.
- [X] T010 [P] [US3] **RED** stylesheet case (styles test): `.cmsc-pb-accordion--filled` trigger
  background `var(--cmsc-surface-tint, var(--cmsb-n-100, #f1f5f9))`.
  **RED (2026-10-30)** in `Accordion.test.tsx` (the stylesheet case, see T003) → `expected '' to contain
  'background: var(--cmsc-surface-tint, …'`. **GREEN** after T011.
- [X] T011 [US3] GREEN: `AccordionItemStyle` + `'filled'` (`component-types.ts`), `lookClasses`,
  `hasItemLines`, `resolveFields` (a `hasNoDividers()` for boxed or filled), the select option
  "Filled", CSS rules (after the boxed rules). Option-parity: add the new option to the Accordion
  case if one exists, else none needed (no field moved).
  **GREEN.** Option-parity: the R12/R13/R14 Accordion cases compare their baseline **plus**
  `F169_ACCORDION_ADDED` (`filled`, appended last) — baselines untouched — and a new feature-169 parity
  case asserts it; they failed on `filled` before that (`expected ['plain','boxed','filled'] to
  deeply equal ['plain','boxed']`). Filled also keeps an 8 px unset item-gap tier and a 12 px unset
  panel-gap tier.
- [X] T012 [US3] i18n: `blocks.accordion.fields.itemStyle.options.filled` in `cms` `en`/`pl`.

### A5. DownloadTile icon presets (US4, FR-008, FR-009)

- [X] T013 [P] [US4] **RED** in `packages/cms-components/src/components/download-tile-options.test.tsx`:
  `iconButtonSize: 'l'` → class `cmsc-pb-download-tile--icon-l`; `iconButtonStyle: 'filled'` →
  `cmsc-pb-download-tile--icon-filled`; `'outline'` and unset add nothing; both fields shown only with
  `linkLook: 'icon'` (cached field objects); stored tile without them renders byte-identically.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/download-tile-options.test.tsx` → 3 new cases fail (no
  `--icon-*`/`--icon-filled` class, fields absent, no stylesheet rule). Class tokens asserted with
  `classList`: `--icon-l` is a prefix of today's `--icon-link`. Size `s` writes `--icon-s` (48 px, the
  same look as unset).
- [X] T014 [P] [US4] **RED** stylesheet case: sizes 48/72/112 px; filled = `background: currentColor`,
  glyph `var(--pb-dl-bg, var(--cmsb-bg, #fff))`.
  **RED (2026-10-30)** in `download-tile-options.test.tsx` (see T003) → `expected … to contain
  '.cmsc-pb-download-tile--icon-s …'`. A filled disc keeps its fill on hover (rule after the base
  hover rule). **GREEN** after T015.
- [X] T015 [US4] GREEN: props in `DownloadTileProps`, fields after `iconButtonIcon`,
  `ICON_BUTTON_KEYS`, classes, CSS (after `.cmsc-pb-download-tile__icon`).
  **GREEN**, plus a feature-169 case in `option-parity.test.ts` (fields after `iconButtonIcon`).
- [X] T016 [US4] i18n: `blocks.downloadTile.fields.iconButtonSize.*`, `.iconButtonStyle.*` in `cms`
  `en`/`pl`; extend `admin/test/modules/cms/page-builder-field-i18n.test.ts` for the three new
  field/option sets of WP-A.
  **RED (2026-10-30):** `pnpm --filter admin exec vitest run test/modules/cms/page-builder-field-i18n.test.ts`
  → `cms.Accordion`/`cms.DownloadTile` walks and the new feature-169 case fail; **GREEN** (85 passed).

### A6. Docs, release, verification

- [X] T017 [P] Docs: in `packages/modules/cms/docs/cms/index.md` § *"Read more" placement, accordion
  look and highlight colours* add *Filled*; § *Carousel controls, buttons, download tiles…* add the
  kept-arrows look and the icon size/style; § *Blocks* note that an empty listing shows nothing on the
  storefront. PL mirror + cache entry rehash (standing rule 10).
  The kept-arrows look is documented beside the option itself (§ *Split slides, carousel controls and
  block spacing*), not repeated in § *Carousel controls … look options*; the empty-listing note sits
  under the § *Blocks* tables. Cache rehashed; `check:docs-translations` → findings=0.
- [X] T018 [P] Changesets: `.changeset/169-a-carousel-kept-arrows.md` (`@endora-commerce/cms-components`:
  patch), `.changeset/169-a-empty-listings.md` (cms-components: patch, behaviour change for
  storefronts), `.changeset/169-a-accordion-download-tile-presets.md` (cms-components: minor,
  `@endora-commerce/mod-cms`: patch for bundles).
- [X] T019 Verification: rebuild `cms-components` and commit `dist/cms-components.css`;
  `pnpm --filter @endora-commerce/cms-components run typecheck && … run lint`; the package's tests
  touched (T002–T016 files, `option-parity.test.ts`, `styles.test.ts`, `carousel-hydration.test.tsx`,
  `split-layout-and-block-spacing.test.tsx`); `pnpm --filter storefront exec vitest run
  test/ssr/catalog-blocks.test.tsx`; the admin field-i18n test;
  `pnpm --filter backend run check:docs-translations`.
  **Done (2026-10-30).** typecheck + lint green for cms-components, mod-cms, admin, storefront;
  cms-components whole suite 2210 passed; mod-cms 337 passed; storefront whole suite 1997 passed;
  admin whole suite 4817 passed, 1 failed — `test/modules/quick_order/quick-order-zones.test.tsx`
  "renders the defaults panel with the organization scope" (`getSpy` not called), a file WP-A does not
  touch, green when re-run alone (9 passed): load-dependent. Checks green: block-names,
  class-vocabulary, docs-translations, module-docs, language, i18n:hardcoded, block-renderers,
  bundle-pairing, default-language-prose, rsc-discipline, release-intent `--since 09d48c47f`.

---

## WP-B — Page navigation (T050–T089)

**Owns**: `packages/cms-components/src/components/PageNavigation.tsx`,
`packages/cms-components/src/components/page-navigation-spy.ts` (client hook), their tests;
`packages/modules/cms/src/admin/components/PageNavigationFields.tsx`;
`storefront/lib/page-builder/page-navigation-text.ts`; `packages/modules/cms/docs/cms/page-navigation.md`
(+ PL + cache).
**Shared (own hunk)**: `component-types.ts` (append `PageNavigationItem`/`PageNavigationProps` after
`TabsProps`); `packages/cms-components/src/index.ts` (registration after `'cms.Tabs'`); CSS (new
section `/* ── Page navigation */` after the Tabs section) + dist; `render-context.tsx` (entry
`pageNavigationText` after `carouselLabels` in the interface, the provider props, the value and a
hook after `useCmsRenderCarouselLabels`); `packages/page-builder-admin/src/chrome/LinkField.tsx` and
`packages/page-builder-admin/src/index.ts` (one export); `PageBuilderEditor.tsx` (one loop after the
listing loop); `packages/modules/cms/src/manifest.ts` (block declaration after `cms.Tabs`);
`packages/modules/cms/i18n/{en,pl}.json` (after `blocks.tabs.*`); `storefront/lib/i18n/messages.ts`
(key `cms.pageNavigation.label` after the `cms.carousel.*` keys in the union and both maps);
`storefront/components/CmsPageRenderer.tsx` (one prop after `carouselLabels`).

### B1. Setup

- [X] T050 Drift check: `SECTION_ANCHOR_RE`, `collectAnchors`, `AnchorControl`, `CmsRenderContext`
  `carouselLabels`, `scroll-margin-top: var(--cmsb-header-offset` still where R-5 cites them; `ls
  packages/cms-components/src/components/PageNavigation.tsx` fails.
  **Done (2026-10-30):** `SECTION_ANCHOR_RE` (`packages/contracts/src/page-builder-values.ts:23`),
  `collectAnchors` (`page-builder-core/src/editor/anchors.ts:28`), `AnchorControl`
  (`LinkField.tsx:184`), `carouselLabels` (`render-context.tsx:66`) and both
  `scroll-margin-top: var(--cmsb-header-offset, 0px)` rules (`cms-components.css:4350, 4895`) where R-5
  cites them; `PageNavigation.tsx` absent. No drift.

### B2. Block (US5, FR-010–FR-013)

- [X] T051 [P] [US5] **RED** `packages/cms-components/src/components/PageNavigation.test.tsx`: server
  render → `<nav aria-label>` (prop label, else render-context text, else English "On this page") +
  `<ul>` of `<a href="#anchor">`; invalid items (empty label, anchor failing `SECTION_ANCHOR_RE`)
  skipped; > 20 items capped; no valid item → storefront `''`, editor note; classes for `look`
  (`--pill` default, `--underline`), `--sticky`, alignment per breakpoint; no `aria-current` in the
  server HTML. Fails: module not found.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/PageNavigation.test.tsx`
  → `Failed to resolve import "./PageNavigation.js"` (module not found).
  **GREEN:** 15/15. Deviations, recorded: the alignment class is `cmsc-pb-page-nav--align-<v>` (+ `-md-`/`-lg-`, as
  `cms.Tabs`) rather than data-model's abbreviated `--al-…`; the field-order case reads the registry's order,
  which puts the per-breakpoint fields (`align`, spacing) after `sticky`. The editor's missing-anchor warning case
  (US5 scenario 6) was written with the implementation, not before it (no RED observed for that one case).
- [X] T052 [P] [US5] **RED** `packages/cms-components/src/components/page-navigation-spy.test.tsx`:
  with a stubbed `IntersectionObserver`, entering sections set exactly one active link
  (`aria-current="true"`, `--active` class); the topmost intersecting section wins; leaving all keeps
  the last; no observer (old browser) → no error, plain links; the active link is scrolled into view
  inside the list (`scrollIntoView({ block: 'nearest', inline: 'nearest' })`) without moving the page;
  sticky writes `--cmsc-page-nav-h` on `document.documentElement` and removes it on unmount.
  **RED (2026-10-30):** `… vitest run src/components/page-navigation-spy.test.tsx` → 8 of 9 fail
  (`expected [] to have a length of 1` / `Cannot read properties of undefined (reading 'callback')`: no block
  registered, no observer); the "not sticky writes nothing" case passed vacuously. **GREEN:** 9/9. The active
  link is brought into view with `scrollIntoView({ block: 'nearest', inline: 'nearest' })` only while the list
  overflows **and** the bar is fully on screen, so the page never moves (asserted).
- [X] T053 [P] [US5] **RED** hydration test (pattern: `carousel/carousel-hydration.test.tsx`): server
  HTML hydrates without a mismatch.
  **RED (2026-10-30):** `… vitest run src/components/page-navigation-hydration.test.tsx` → `expected '<div></div>' to
  contain 'aria-label="Na tej stronie"'` (block not registered). **GREEN:** 2/2 (sticky off and on), no
  hydration error.
- [X] T054 [P] [US5] **RED** stylesheet cases (`styles.test.ts`): pill track (one rounded track,
  active item filled with `var(--cmsb-fg, …)` text `var(--cmsb-bg, …)` inside a scheme, primary
  outside); underline look; `overflow-x: auto` + `overscroll-behavior-x: contain` on the list;
  sticky `top: var(--cmsb-header-offset, 0px)`;
  `@media (prefers-reduced-motion: no-preference) { :root:has(.cmsc-pb-page-nav) { scroll-behavior: smooth } }`;
  `:root:has(.cmsc-pb-page-nav--sticky) :is(.cmsc-section, [id]) { scroll-margin-top: calc(var(--cmsb-header-offset, 0px) + var(--cmsc-page-nav-h, 0px)) }`;
  focus-visible outline as the tabs'.
  **RED (2026-10-30):** written as `packages/cms-components/src/components/page-navigation-styles.test.ts`
  (own file, so WP-A's `styles.test.ts` hunk cannot conflict) → 11/11 fail (`no rule for …`, section absent).
  **GREEN:** 11/11. Sticky applies to the block's own "Hide on" wrapper
  (`.cmsc-pb-hide-on:has(> .cmsc-pb-page-nav-box--sticky)`) as well as its box: a sticky element only sticks
  inside its parent, and the box is as tall as the bar.
  **Added during T065 (2026-10-30):** the pill look's other links use `var(--cmsb-fg, #0f172a)` — the muted
  grey on the tinted track measured about 4.3:1, under the 4.5:1 floor. **RED:** `expected 'border-radius:999px;'
  to contain 'color:var(--cmsb-fg,#0f172a)'`; **GREEN:** 12/12.
- [X] T055 [US5] GREEN: `PageNavigation.tsx` (server component markup + `'use client'` island
  `page-navigation-spy.ts`), types in `component-types.ts`, `PageNavigationText` in
  `render-context.tsx`, registration in `index.ts` (`contexts: ['cms']`, `responsiveFields:
  ['align', 'margin', 'padding', 'border']`), CSS section. Fields per `contracts/blocks.md` §3
  (package default anchor field: text normalised to the grammar on blur). Rebuild.
  **GREEN (2026-10-30):** `PageNavigation.tsx`, `page-navigation-spy.ts`, types after `TabsProps`,
  `pageNavigationText` + `useCmsRenderPageNavigationText` in `render-context.tsx`, registration after `'cms.Tabs'`
  (plus the two `export *` lines of the barrel), CSS section between Tabs and Accordion; dist rebuilt.
- [X] T056 [US5] Manifest: `cms.PageNavigation` in `packages/modules/cms/src/manifest.ts` (after
  `cms.Tabs`; `category: 'interactive'`, translatable `label`, `items[].label`, label/description
  keys); `composer:generate`. **RED first**: extend
  `backend/test/unit/cms/block-translatable-declarations.test.ts` (or the registry test that lists
  bundled vs declared blocks) so an undeclared bundled block fails.
  **RED (2026-10-30):** new describe in `backend/test/unit/cms/block-translatable-declarations.test.ts` (every
  `'<module>.<Name>': definePageBuilderComponent(` in `cms-components/src/index.ts` is declared by a manifest)
  → `expected [ 'cms.PageNavigation' ] to deeply equal []`. **GREEN:** 52/52 after the declaration (weight 35).
  `composer:generate` produced no diff for the manifest change.
  **Deliberately changed existing assertion (standing rule 13), found in T065:**
  `packages/modules/cms/src/backend/services/translation/block-declarations.test.ts` ("cover every block this
  module declares") went red on the new declaration; it gains a `cms.PageNavigation` fixture (prose: `label`,
  `items[].label`; never the anchor, look or alignment). mod-cms 338/338.

### B3. Editor anchor picker (US5, FR-014)

- [X] T057 [P] [US5] **RED** `admin/test/modules/cms/page-navigation-fields.test.tsx`: in the editor
  harness (`page-builder-editor-harness.tsx`), an item's anchor field lists the page's section
  anchors (`collectAnchors`) and accepts free text normalised to the grammar; the field object is
  stable across renders.
  **RED (2026-10-30):** `pnpm --filter admin exec vitest run test/modules/cms/page-navigation-fields.test.tsx` →
  `Failed to resolve import ".../PageNavigationFields"`. **GREEN:** 2/2 — the swap is one stable object; in the
  real editor the anchor select lists `about`, `offer` and storing works; typed `  Our Contact ` is stored
  `our-contact`.
- [X] T058 [US5] GREEN: export the anchor control as `createAnchorField(label)` from
  `packages/page-builder-admin/src/chrome/LinkField.tsx` (no behaviour change for the link field;
  `admin/test/modules/cms/link-field.test.tsx` stays green), export it from
  `packages/page-builder-admin/src/index.ts`; `PageNavigationFields.tsx` swaps
  `items[].anchor`; one loop line in `PageBuilderEditor.tsx`.
  **GREEN (2026-10-30):** `createAnchorField` in `LinkField.tsx` (reuses `AnchorControl`, link field
  untouched; `link-field.test.tsx` green), exported from `page-builder-admin`; `PageNavigationFields.tsx`; one
  loop (and its import) in `PageBuilderEditor.tsx` after the listing loop.

### B4. Storefront text and i18n

- [X] T059 [P] [US5] **RED** `storefront/test/lib/page-navigation-text.test.ts`: `pageNavigationText('pl')`
  returns the Polish label; `CmsPageRenderer` passes it to the provider.
  **RED (2026-10-30):** `pnpm --filter storefront exec vitest run test/lib/page-navigation-text.test.ts` →
  `Cannot find module '../../lib/page-builder/page-navigation-text'`. **GREEN:** 3/3.
- [X] T060 [US5] GREEN: `storefront/lib/page-builder/page-navigation-text.ts`, key
  `cms.pageNavigation.label` in `storefront/lib/i18n/messages.ts` (en "On this page", pl "Na tej
  stronie"), prop in `CmsPageRenderer.tsx`.
  **GREEN (2026-10-30):** `page-navigation-text.ts`, `cms.pageNavigation.label` (en/pl) after the
  `cms.carousel.*` keys, the prop in `CmsPageRenderer.tsx`.
- [X] T061 [P] i18n: `blocks.pageNavigation.label|description` and every field/option key in `cms`
  `en`/`pl`; extend `admin/test/modules/cms/page-builder-field-i18n.test.ts`.
  **Done (2026-10-30):** `blocks.pageNavigation.*` (14 keys) en/pl after `blocks.tabs.*`;
  `cms.PageNavigation` added to `NEW_AND_RESHAPED` of `page-builder-field-i18n.test.ts` (all 100 green; the
  block was also already walked by `ALL_BLOCKS`). No new `core` keys: the picker reuses
  `pageBuilder.linkField.*`.

### B5. Off-state, docs, release, verification

- [X] T062 [US5] Off-state: extend `backend/test/integration/cms/off-state.test.ts` **[PG]** so the
  descriptor served with `cms` off lists no `cms.PageNavigation` (with every other cms block).
  **Done (2026-10-30) [PG]:** new case in `backend/test/integration/cms/off-state.test.ts` — on, the descriptor
  lists `cms.PageNavigation`; off on each axis the descriptor route answers 503 and names nothing; back after.
  3/3 green on :5441. Written after T056 had landed, so no RED was observed for it.
- [X] T063 [P] Docs: new `packages/modules/cms/docs/cms/page-navigation.md` (what it does, anchors,
  looks, sticky, reduced motion, placing it inside a tab or slide) + PL + cache.
  **Done (2026-10-30):** `packages/modules/cms/docs/cms/page-navigation.md` + PL mirror + cache entry
  (`sourceHash` from `hashSourceBody`); `composer:generate` adds the page to `docs/sidebars.modules.generated.js`.
  `check:docs-translations` and `check:module-docs`: 0 findings.
- [X] T064 [P] Changeset `.changeset/169-b-page-navigation.md` (`@endora-commerce/cms-components`:
  minor, `@endora-commerce/page-builder-admin`: minor, `@endora-commerce/mod-cms`: minor).
  **Done (2026-10-30):** `.changeset/169-b-page-navigation.md`.
- [X] T065 Verification: rebuild `cms-components`, `page-builder-admin`, `mod-cms`; commit dist css
  and regenerated files; filtered typecheck + lint (cms-components, page-builder-admin, mod-cms,
  admin, storefront, backend); T051–T061 test files; T062 **[PG]**; `check:docs-translations`,
  `check:module-docs`.
  **Done (2026-10-30):** `pnpm run build:packages` 0. Typecheck + lint 0 for cms-components,
  page-builder-admin, mod-cms, storefront, admin, backend. Tests: cms-components 102 files / 2221, storefront
  185 / 2000, admin 476 / 4821, mod-cms 29 / 338 (after the fixture above), backend
  `block-translatable-declarations` 52; page-builder-admin has no test files (`vitest run` exits 1 with "No
  test files found" — its tests live in `admin/test/page-builder-admin`). T062 [PG] 3/3. Checks, all 0:
  `block-names`, `class-vocabulary`, `docs-translations`, `module-docs`, `language`, `i18n:hardcoded`,
  `block-renderers`, `bundle-pairing`, `default-language-prose`, `release-intent --since 09d48c47f`.
  `composer:generate` leaves no diff. Not run: `check:naming` (known macOS failure), the full backend suites.

---

## WP-C — Contact form (T090–T169)

**Owns**: `packages/contracts/src/cms-contact-form.ts` (+ test);
`packages/cms-components/src/components/ContactForm.tsx`, `ContactFormFields.tsx` (+ tests);
`packages/modules/cms/src/backend/services/contact-form/` (`contact-form.service.ts`,
`contact-form-mail.ts`, `recipients-validator.ts`, tests); `storefront/app/forms/contact/route.ts`;
`storefront/lib/page-builder/contact-form-text.ts`; `storefront/lib/api/contact-form.ts`;
`packages/modules/cms/docs/cms/contact-form.md` (+ PL + cache); regenerated
`docs/docs/module-reference/cms.md` (+ PL + cache).
**Shared (own hunk)**: `packages/contracts/src/{index.ts,email.ts,errors.ts}`;
`packages/modules/email/src/backend/services/{smtp-mailer.ts,mailer.ts,recording-mailer.ts}` (+ their
tests); `ButtonView.tsx` (additive `submit` rendering); `component-types.ts` (after
`ContactFormEmbedProps`); `packages/cms-components/src/index.ts` (after `'cms.ContactFormEmbed'`);
CSS (new `/* ── Contact form */` section after the contact-embed rules) + dist; `render-context.tsx`
(`contactFormText` after `localizePath`); `packages/modules/cms/src/manifest.ts` (setting + group,
`errorCodes`, `actions`, `dependencies`, block after `cms.ContactFormEmbed`);
`packages/modules/cms/src/backend/{routes.storefront.ts,index.ts}`; `cms` bundles (after
`blocks.contactFormEmbed.*`, in `errors.*`, `actions.*`, new `contactForm.mail.*`);
`backend/test/fixtures/error-code-routing/reference-ledgers.ts`; `storefront/app/reserved-segments.ts`;
`storefront/lib/i18n/messages.ts` (`cms.contactForm.*`); `storefront/components/CmsPageRenderer.tsx`;
`backend/test/integration/cms/off-state.test.ts`.

### C1. Setup

- [X] T090 Drift check: `EmailMailerSendInput` still has no `replyTo`; `emailMailer` and
  `adminI18nService` registered as in R-6; `cms` `dependencies` lack `email` and `_i18n`;
  `settingWriteValidatorRegistry` hook in `packages/modules/cms/src/backend/index.ts`; no `forms`
  entry in `RESERVED_TOP_LEVEL_SEGMENTS`; `CMS_CONTACT_FORM_UNAVAILABLE` unused. Stop on a mismatch.
  Drift check (2026-10-30): all six facts held at `09d48c47f`; nothing to stop on.

### C2. Contract (US6, FR-017, FR-018)

- [X] T091 [P] [US6] **RED** `packages/contracts/src/cms-contact-form.test.ts`: the schema of
  `contracts/contact-form-api.md` §1 — minimum (email + message + `privacyConsent: true`) passes;
  missing any of the three fails; each length cap (+1) fails; CR/LF in single-line fields fails, in
  the message passes; `''` optional fields read as absent; `choice` without `choiceLabel` fails;
  unknown key fails (`.strict()`); `pagePath` `//evil` fails. Fails: module not found.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/contracts exec vitest run src/cms-contact-form.test.ts` → `Cannot find module './cms-contact-form.js'`. **GREEN:** 24 passed.
- [X] T092 [US6] GREEN: `packages/contracts/src/cms-contact-form.ts`, export from `index.ts`; build
  contracts.
  **GREEN:** as above; also exported `contactFormEmailSchema` and `CONTACT_FORM_MAX_RECIPIENTS` (reused by the recipients validator).

### C3. Mailer `replyTo` (US6, FR-019)

- [X] T093 [P] [US6] **RED** `packages/modules/email/src/backend/services/smtp-mailer.test.ts`: a
  `replyTo` is handed to `sendMail` as `replyTo`; absent → no key. `recording-mailer.test.ts`: the
  recorder input never carries `replyTo`. `mailer-outcome.test.ts` (console): logs it.
  **RED (2026-10-30):** `vitest run smtp-mailer.test.ts recording-mailer.test.ts mailer-outcome.test.ts` → 2 failed: console `expected undefined to be 'shopper@example.com'`, SMTP `expected 'From: …' to match /^Reply-To: …/m`. The recording-mailer case was green at RED (it passes input through and `contextOf` names its fields) — kept as a guard. **GREEN:** 13 passed.
- [X] T094 [US6] GREEN: `replyTo?: string` on `EmailMailerSendInput` (`packages/contracts/src/email.ts`,
  doc comment per data-model §5.3); `SmtpMailer`, `ConsoleMailer`; nothing in `RecordingMailer`'s
  `contextOf`. Build contracts and `mod-email`.
  **GREEN:** see T093. `RecordingMailer`: comment only, no code change needed.

### C4. Setting, error code, manifest (US6, FR-020, FR-022, FR-023)

- [X] T095 [P] [US6] **RED** `packages/modules/cms/src/backend/services/contact-form/recipients-validator.test.ts`:
  validator for `cms.contact_form_recipients` accepts `[]` and ≤ 10 valid addresses, refuses 11, a
  non-address, a non-array (HttpError 400 `VALIDATION_FAILED`).
  **RED (2026-10-30):** module not found (`./recipients-validator.js`); after the stub-free GREEN the first run failed on stale contracts `dist` (`at most undefined`) — rebuilt contracts. **GREEN:** 7 passed.
- [X] T096 [P] [US6] **RED** `packages/modules/cms/src/backend/manifest.test.ts` (existing, new
  cases): the setting (`string_list`, `[]`, group `cms_contact_form`), `errorCodes` holds
  `CMS_CONTACT_FORM_UNAVAILABLE`, `dependencies` hold `email` and `_i18n`, action
  `open-contact-form-settings` (`/settings`, `settings:read`, icon from `KnownIconNameSchema`), block
  `cms.ContactForm` declared (category `forms`, translatable paths of data-model §3).
  **RED (2026-10-30):** 6 failed (setting undefined, error code, dependencies, action, block, and the deliberately changed action-id list). Deliberately changed existing assertion (standing rule 13): *"declares one navigation entry per list screen, right after new-page"* now ends with `open-contact-form-settings`. Icon is `Inbox` (no `Mail` in `KnownIconNameSchema`). **GREEN:** 26 passed (after the block keys of T114). The whole-suite run also named `translation/block-declarations.test.ts` ("cover every block this module declares"): a `cms.ContactForm` fixture was added there (an extension, no existing case changed).
- [X] T097 [US6] GREEN: manifest changes; validator registered in the existing
  `settingWriteValidatorRegistry` contribution hook (unprobed — module-activation item 3);
  `CMS_CONTACT_FORM_UNAVAILABLE` in its four places (standing rule 8); bundle keys
  `actions.openContactFormSettings.*`, `errors.CMS_CONTACT_FORM_UNAVAILABLE` (en/pl);
  `composer:generate`; if `manifests:generate` rewrites a package manifest (it derives package
  dependencies from specifiers), run `pnpm install --lockfile-only` beside it and commit both
  (AGENTS.md trap 5).
  **GREEN:** manifest, validator registered in the existing hook, error code in its four places, bundle keys; `manifests:generate` added `@fastify/rate-limit` to `mod-cms` peer/dev deps (the route's type-only import) — `pnpm install --lockfile-only` committed beside it; `composer:generate` rewrote `docs/docs/module-reference/cms.md` and `docs/sidebars.modules.generated.js`.
- [X] T098 [US6] Checks: `pnpm --filter backend run check:port-dependencies`, `check:module-boundary`,
  `check:entry-presence`; `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts`;
  `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`;
  the error-code routing ledger test.
  Checks green: `check:port-dependencies`, `check:module-boundary`, `check:entry-presence`, `check:action-route-permissions`, `registered-bundles-shape`, `error-code-routing-equality`, `error-code-collision`, `manifest-error-code-commentary`, `platform-error-code-block`, `error-code-migration-progress`. Admin palette coverage ran inside the whole admin suite.

### C5. Backend service and route (US6, FR-017–FR-019, FR-022)

- [X] T099 [P] [US6] **RED** `packages/modules/cms/src/backend/services/contact-form/contact-form-mail.test.ts`:
  the composed message for `en` and `pl` (fake translator returning `key|params`): fixed subject with
  the channel name; one line per submitted field only; choice uses the submitted label; consents
  stated (marketing yes/no); page path; HTML escaped (`<script>` in the message appears escaped);
  `text` always present.
  **RED (2026-10-30):** module not found (`./contact-form-mail.js`). **GREEN:** 7 passed.
- [X] T100 [P] [US6] **RED** `packages/modules/cms/src/backend/services/contact-form/contact-form.service.test.ts`:
  with a fake `EmailMailerPort`, settings reader and translator — no recipients → throws 409
  `CMS_CONTACT_FORM_UNAVAILABLE`; two recipients → two `send` calls, `replyTo` = submitter, `kind:
  'cms.contact_form'`, `salesChannelId`, **no `meta`**, subject containing none of the submitted
  text; honeypot filled → no send, resolves `sent`; one recipient throws, the other sends → `sent`;
  all throw → rethrows (500); language: channel `pl-PL` → `pl`, `de-DE` → `en`.
  **RED (2026-10-30):** module not found (`./contact-form.service.js`). All-failed sends answer `HttpError 500 INTERNAL` with no transport detail (the mailer records each failure). **GREEN:** 10 passed.
- [X] T101 [US6] GREEN: `contact-form-mail.ts`, `contact-form.service.ts` (registered in
  `packages/modules/cms/src/backend/index.ts` with `lazyPort<EmailMailerPort>(ctx, 'emailMailer')`,
  `lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService')` resolved per call, `settingsReadPort`
  per request); cms bundle keys `contactForm.mail.*` (en/pl).
  **GREEN:** registered as `cmsContactFormService`; mailer and translator via `lazyPort`, recipients via `settingsReadPort` per request.
- [X] T102 [P] [US6] **RED [PG]** `backend/test/contract/cms/storefront-contact-form.contract.test.ts`:
  `POST /api/v1/storefront/cms/contact-form` — 200 `{data:{status:'sent'}}` with recipients set for
  the test channel (a capturing mailer through `emailMailer`, as the newsletter tests capture);
  400 `VALIDATION_FAILED` for each server minimum; 409 with no recipients; recipients of another
  channel are not used (Principle XII); honeypot → 200 and nothing captured; the response never
  contains a recipient; 11th request from one IP in the window → 429 (rate limit enabled in this
  file's app); the `email_deliveries` row (if the harness records) has the fixed subject and no
  context. Setting read first and restored in `afterAll`; fixtures `pb169_<uuid8>`.
  **RED (2026-10-30) [PG]:** honest order note — the route source was written before this file ran; RED was observed against the not-yet-rebuilt `mod-cms` dist: `beforeAll` `expected 404 to be 200` (setting not declared), 17 skipped. **GREEN:** 17 passed after `build` + `composer:generate`.
- [X] T103 [US6] GREEN: the route in `routes.storefront.ts` (deps gain the service), rate-limit config
  with the type-only `@fastify/rate-limit` import, `getResolvedChannel`.
  **GREEN:** see T102. Registered from `index.ts`'s `ctx.routes` (`registerCmsContactFormRoute`), so `plugin.ts` is untouched.
- [X] T104 [US6] **RED → GREEN [PG]** `backend/test/integration/cms/off-state.test.ts`: with `cms`
  off the endpoint answers 503 `MODULE_DISABLED` and the descriptor lists no `cms.ContactForm`;
  restored on reactivation.
  **[PG]** green on its first run: the probe was added after the route already existed in `ctx.routes` (no RED observable). 2 passed.

### C6. Storefront handler (US6, FR-017, FR-021, FR-022)

- [X] T105 [P] [US6] **RED** `storefront/test/contact-form/contact-form-route.test.ts` (pattern:
  `storefront/test/newsletter/subscribe-route.test.ts`): `cms` absent → 404; JSON and 303 answers for
  sent / invalid / unavailable; the block's `required` keys enforced; `returnTo` sanitised (absolute,
  `//host`, `/\host` → `/`); `form` and `anchor` validated; outcome query
  `contact=…&reason=…&form=…#anchor`; `x-forwarded-for` forwarded; backend 409/429/500/network →
  `unavailable`; marketing consent + `newsletter` present → `subscribeNewsletter` called once with
  `source: 'cms-contact-form'` and the channel code; newsletter absent or consent unticked → not
  called; newsletter failure → still `sent`.
  **RED (2026-10-30):** route test → 15× `Cannot find module '/app/forms/contact/route'` (23 failed). Honest note: `contact-form-api.test.ts` (the backend call's mapping, 8 cases) was written together with `lib/api/contact-form.ts` and not run RED first. **GREEN:** 31 passed (one fix: an empty honeypot is not sent).
- [X] T106 [US6] GREEN: `storefront/lib/api/contact-form.ts` (backend call), `storefront/app/forms/contact/route.ts`;
  `forms` in `storefront/app/reserved-segments.ts`, then `pnpm --filter backend run
  check:storefront-indexability` (it reconciles that list against the route tree).
  **GREEN:** `check:storefront-indexability` findings=0 with `forms` reserved.

### C7. Block (US6, FR-015, FR-016)

- [X] T107 [P] [US6] **RED** `packages/cms-components/src/components/ContactForm.test.tsx`: server
  render with defaults → name, email, message, privacy consent, submit; phone/company/subject/choice
  off; `show`/`required`/`label`/`placeholder` honoured; email/message cannot be hidden or optional;
  choice without options not rendered; `columns: 2` + spans → classes; `fieldLook`/`labelPosition`
  classes; `labelPosition: 'hidden'` keeps a visually hidden `<label for>`; autocomplete attributes;
  honeypot present, off-screen, `tabindex="-1"`, `aria-hidden`; hidden `returnTo`, `anchor` (inside an
  anchored Section), `form`, `choiceLabel`, `required` entries; action = localized `/forms/contact`;
  outcome from `?contact=sent&form=<id>` shown only for the matching block id; render-context text
  used when props unset, English without context.
  **RED (2026-10-30):** `expected undefined to be defined` (block not registered) and the rest. **GREEN:** 23 passed.
- [X] T108 [P] [US6] **RED** `packages/cms-components/src/components/ContactForm.client.test.tsx`
  (jsdom): JS submit posts with `Accept: application/json`; client-side required/email checks set
  `aria-invalid` + `aria-describedby` and focus the first invalid field; success replaces nothing the
  shopper typed until success, then clears; error keeps values; outcome region `role="status"`.
  **RED (2026-10-30):** block not registered. **GREEN:** 5 passed.
- [X] T109 [P] [US6] **RED** `ButtonView` case (`ButtonView.test.tsx`): `submit` renders `<button
  type="submit">` with the same classes as the link rendering; existing renderings unchanged.
  **RED (2026-10-30):** 2 failed — `expected '<a href="/contact" …' to match /^<button type="submit"/`, `… to contain 'disabled=""'`. **GREEN:** 13 passed.
- [X] T110 [P] [US6] **RED** fields/resolveFields case: cached field objects; hidden-when rules of
  `contracts/blocks.md` §4; order content → layout → style → spacing → visibility; button fields are
  `BUTTON_SPEC_OBJECT_FIELDS` minus `link`.
  **RED (2026-10-30):** in `ContactForm.test.tsx` (block undefined). **GREEN:** 5 passed. Deviation: a field's `span` sits inside that field's group (its stored path `fields.<key>.span`), shown only with two columns, not in a separate Layout group.
- [X] T111 [P] [US6] **RED** stylesheet cases: field looks (`boxed`, `underline`, `pill` with textarea
  radius 16 px) from scheme tokens with literal fallbacks; 2-column grid collapsing to one under the
  tablet breakpoint; honeypot off-screen rule; focus-visible ring.
  **RED (2026-10-30):** 6 failed (`expected -1 to be greater than or equal to 0`, rules absent). **GREEN:** 6 passed; dist css rebuilt.
- [X] T112 [US6] GREEN: `ContactForm.tsx` + `ContactFormFields.tsx`, types after
  `ContactFormEmbedProps`, `contactFormText` in `render-context.tsx`, registration after
  `'cms.ContactFormEmbed'` in `index.ts`, `ButtonView` `submit`, CSS section; editor notes (recipients
  are configured in Settings; privacy label unset warning). Rebuild.
  **GREEN:** whole `cms-components` suite green; one fix found by `panel-consistency.test.ts` (editor label "E-mail" → "Email"). Two extra render-context words beyond data-model §5.2: `fieldRequired`, `fieldEmail` (per-field messages with JavaScript).
- [X] T113 [US6] Storefront text: **RED** `storefront/test/lib/contact-form-text.test.ts` then GREEN
  `storefront/lib/page-builder/contact-form-text.ts`, keys `cms.contactForm.*` (data-model §5.4) in
  `messages.ts` en/pl, prop in `CmsPageRenderer.tsx`.
  **RED (2026-10-30):** `Cannot find module '../../lib/page-builder/contact-form-text'`. **GREEN:** 3 passed.
- [X] T114 [P] i18n: `blocks.contactForm.*` field and option keys in `cms` en/pl; extend
  `admin/test/modules/cms/page-builder-field-i18n.test.ts`.
  RED observed through the existing walk: `cms.ContactForm: every field and option label resolves …` failed with 66 missing keys. The added "every setting shown" case was written after the keys and was green on first run. **GREEN:** 86 passed. Polish block label is "Formularz kontaktowy (e-mail)" because `cms.ContactFormEmbed` already reads "Formularz kontaktowy" in Polish.
- [X] T115 [US6] SSR: **RED → GREEN** `storefront/test/ssr/contact-form.test.tsx` — a published page
  with the block renders the form in the server HTML with Polish defaults on a `pl` page, and no
  recipient address anywhere in the page payload (FR-020).
  Green on its first run (the block and the text helper preceded it). 6 passed. The recipient check is structural: a stored `recipients` prop renders nowhere; the page read never reads the setting.

### C8. Corporate contact page composition (US6 scenario 10)

- [X] T116 [US6] **RED → GREEN** `admin/test/modules/cms/contact-page-composition.test.tsx`: in the
  editor harness, a `cms.Tabs` panel accepts `cms.ContactForm` and `newsletter.Signup`; a Row/Column
  holds the form beside a Heading and RichContent. (No new code expected; a failure is a defect to
  record.)
  Green on its first run, as expected (no new code). 4 passed.

### C9. Docs, release, verification

- [X] T117 [P] Docs: new `packages/modules/cms/docs/cms/contact-form.md` — building a contact page,
  fields, looks, recipients per channel (Settings → Contact form, ⌘K action), what is (not) stored,
  the newsletter opt-in, rate limit and the `TRUSTED_PROXY_*` note, the endpoint and its errors. PL +
  cache. Regenerate the module reference (`composer:generate`) and mirror its PL + cache entry
  (`generated:module-reference--cms.json`).
  Docs: `packages/modules/cms/docs/cms/contact-form.md` + PL materialisation + cache; module reference PL mirror + cache rehashed with `hashSourceBody()`. `check:docs-translations` findings=0, `check:module-docs` findings=0 (after `composer:generate` placed the page in `docs/sidebars.modules.generated.js`).
- [X] T118 [P] Changesets: `.changeset/169-c-contact-form.md` (`@endora-commerce/cms-components`:
  minor, `@endora-commerce/mod-cms`: minor, `@endora-commerce/contracts`: minor);
  `.changeset/169-c-mailer-reply-to.md` (`@endora-commerce/contracts`: minor,
  `@endora-commerce/mod-email`: minor).
  Changesets `.changeset/169-c-contact-form.md`, `.changeset/169-c-mailer-reply-to.md`; `check:release-intent --since 09d48c47f` green.
- [X] T119 Verification: rebuild contracts, cms-components, mod-email, mod-cms; commit dist css and
  generated files; filtered typecheck + lint (contracts, cms-components, mod-email, mod-cms, backend,
  storefront, admin); every T091–T116 file; T102 and T104 **[PG]**; `check:port-dependencies`,
  `check:module-boundary`, `check:entry-presence`, `check:docs-translations`, `check:module-docs`,
  `check:naming`, `check:language`; `pnpm --filter '!backend' run test` scoped to the touched
  packages (`--filter @endora-commerce/contracts --filter @endora-commerce/mod-email …`).

---
  See the merge request report for the full verification list; `test/contract/kernel/openapi-baseline.test.ts` is red on this base for nine catalog routes besides this feature's one, so it was not re-recorded.

## WP-D — Newsletter sign-up topics and attributes (T170–T219)

**Owns**: `packages/page-builder-admin/src/chrome/NewsletterPickers.tsx` (+ admin test);
`packages/modules/cms/src/admin/components/NewsletterSignupFields.tsx`;
`storefront/lib/page-builder/newsletter-signup-text.ts`;
`packages/modules/newsletter/src/backend/services/subscriber.service.ts` (`mergeCustomFields`) and its
test; `packages/modules/newsletter/{src/manifest.ts,i18n/*,docs/newsletter.md}` (+ PL + cache).
**Shared (own hunk)**: `NewsletterSignupForm.tsx`; `component-types.ts` (inside
`NewsletterSignupTopic`/`NewsletterSignupMessages`/`NewsletterSignupFormProps` only); CSS (the
newsletter sign-up section) + dist; `render-context.tsx` (`newsletterSignupText` after `location`);
`packages/page-builder-admin/src/index.ts` (one export); `PageBuilderEditor.tsx` (one loop after
WP-B's position, i.e. after the listing loop — keep both on conflict);
`storefront/app/newsletter/subscribe/route.ts`; `storefront/lib/api/newsletter.ts`;
`storefront/lib/i18n/messages.ts` (`newsletter.signup.fields`); `storefront/components/CmsPageRenderer.tsx`;
`packages/modules/_i18n/i18n/{en,pl}.json` (`pageBuilder.newsletterTag.*`, `pageBuilder.newsletterField.*`).

### D1. Setup

- [X] T170 Drift check: `mergeCustomFields` still keys-only (R-11); admin `GET …/newsletter/tags` and
  `…/custom-fields` shapes as R-11; `subscribeNewsletter` takes no `customFields`.
  **Result (2026-10-30):** no drift at 09d48c47f — keys-only merge (`subscriber.service.ts`), both admin lists
  answer `{ data: { items } }` under `newsletter:read`, `subscribeNewsletter` had no `customFields`.

### D2. Newsletter keeps only type-correct values (US7, FR-026)

- [X] T171 [P] [US7] **RED** `packages/modules/newsletter/src/backend/services/subscriber-custom-fields.test.ts`
  (new, fake EM or the module's existing test helpers): defined `age` number, `vip` boolean, `born`
  date, `company` text — valid values stored; `'abc'` for number, `'yes'` for boolean, `'2026-13-40'`
  and `'tomorrow'` for date, a 501-character text dropped; unknown key dropped (today's); `null`
  clears.
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/mod-newsletter exec vitest run src/backend/services/subscriber-custom-fields.test.ts`
  → 7 failed: `TypeError: mergeTypedCustomFields is not a function` (6) and the service case storing
  `{ age: 'abc', born: 'tomorrow', … }` (the keys-only merge).
- [X] T172 [US7] GREEN: type check in `mergeCustomFields`.
  **GREEN:** exported pure `mergeTypedCustomFields` (also rejects a non-existent date such as
  `2026-02-30`), `mergeCustomFields` delegates to it → 7 passed.
- [X] T173 [US7] **[PG]** extend `backend/test/contract/newsletter/routes.storefront.contract.test.ts`:
  public subscribe with mixed valid/invalid `customFields` → 200; the subscriber holds only valid
  values. Deliberately changed behaviour noted in the changeset (admin create and self subscribe
  share the merge).
  **RED (2026-10-30):** run against the stale `mod-newsletter` dist → 1 failed: stored
  `{ c169_age: 'abc', c169_born: '2026-13-40', … }`. **GREEN** after rebuilding the package → 9 passed.

### D3. Storefront handler and API (US7, FR-026)

- [X] T174 [P] [US7] **RED** extend `storefront/test/newsletter/subscribe-route.test.ts`: `attrSpec` +
  `attr.<key>` coerced per data-model §4 and passed as `customFields`; > 10 specs ignored beyond 10;
  a required attribute missing → `error: 'fields'` (JSON and 303 `reason=fields`); no attributes →
  request body identical to today's.
  **RED (2026-10-30):** `pnpm --filter storefront exec vitest run test/newsletter/subscribe-route.test.ts` → 5 of
  the 7 new cases failed (`expected { email, … } to match object { customFields: … }`, no `fields`
  refusal); the two that only assert absence passed already.
- [X] T175 [US7] GREEN: `subscribeNewsletter` accepts `customFields`; the route parses and coerces.
  **GREEN:** 25 passed. An unticked box is sent as `false`; a value its type rejects (or an empty one)
  is not sent and counts as missing when required; a duplicate key's second spec is ignored.

### D4. Block (US7, FR-025)

- [X] T176 [P] [US7] **RED** in `packages/cms-components/src/components/NewsletterSignupForm.test.tsx`:
  `attributes` render by type (checkbox / number / date / text with `maxlength=500`), label override
  else `fieldLabel` else key, required → `required` + marker, hidden `attrSpec`; invalid items
  skipped; > 10 capped; client-side required check with the `fields` message (prop, else render-context
  text, else English); outcome `reason=fields` from the URL shows it; **no `attributes` → markup
  byte-identical to today's** (snapshot of a stored block from `origin/master`).
  **RED (2026-10-30):** `pnpm --filter @endora-commerce/cms-components exec vitest run src/components/NewsletterSignupForm.test.tsx`
  → 14 failed (no `attr.*` inputs, no `attrSpec`, no `attributes` field, no
  `attributePlaceholderApplies`); the snapshot of the stored block was **written by this run from the
  base code** (09d48c47f), so it records the markup of before.
- [X] T177 [P] [US7] **RED** fields: `attributes` array (item summary label/key), `placeholder` hidden
  for boolean, `messages.fields` shown only with attributes; cached objects; the package default
  `key` is text + `type` select.
  **RED:** recorded with T176 (same file, same run).
- [X] T178 [US7] GREEN: types, rendering, fields, CSS (attribute rows reuse the topic/field styles),
  `newsletterSignupText` in `render-context.tsx`. Rebuild.
  **GREEN:** 28 passed, snapshot unchanged. The placeholder is a custom field that reads the item's
  type from the selected block (a field of an array item is not handed its siblings) and renders
  nothing for a box; `messages.fields` is dropped by `resolveFields` without attributes (a cached copy
  per host field). `fields` is not in `defaultProps.messages`, so a new block reads the page
  language's text.
- [X] T179 [US7] Storefront text: **RED** `storefront/test/lib/newsletter-signup-text.test.ts` then
  GREEN `storefront/lib/page-builder/newsletter-signup-text.ts`, key `newsletter.signup.fields`
  (en/pl), prop in `CmsPageRenderer.tsx`.
  **RED (2026-10-30):** `Cannot find module '../../lib/page-builder/newsletter-signup-text'`. **GREEN:** 3 passed.

### D5. Editor pickers (US7, FR-024, FR-025)

- [X] T180 [P] [US7] **RED** `admin/test/page-builder-admin/newsletter-pickers.test.tsx` (StrictMode):
  tag field loads `GET /api/v1/admin/newsletter/tags`, lists names, stores the code; keeps a stored
  unknown code as an option; falls back to text on 403 / network error; custom-field field loads
  `…/custom-fields`, writes `key`, `type`, `fieldLabel` together; fallback to key text + type select.
  **RED (2026-10-30):** `pnpm --filter admin exec vitest run test/page-builder-admin/newsletter-pickers.test.tsx` →
  10 failed: `createNewsletterTagCodeField is not a function`, `withNewsletterAttributePick is not a
  function`, `Element type is invalid … got: undefined` for the controls.
- [X] T181 [US7] GREEN: `NewsletterPickers.tsx` (`createNewsletterTagCodeField`,
  `createNewsletterCustomFieldField`) on `BlogCategoryPicker`'s pattern; export from
  `packages/page-builder-admin/src/index.ts`; `pageBuilder.newsletterTag.*` /
  `pageBuilder.newsletterField.*` keys in `packages/modules/_i18n/i18n/{en,pl}.json`.
  **GREEN:** 10 passed. Two cases first waited on the loading-state fallback select and were corrected
  to wait for the loaded list (a test wait, not a behaviour change). An empty list falls back to the
  text box like a failed one. The multi-prop write replaces the selected block's item through Puck's
  `replace` action (`withNewsletterAttributePick`), falling back to the key alone outside a block.
- [X] T182 [P] [US7] **RED** `admin/test/modules/cms/newsletter-signup-fields.test.tsx`: in the editor
  harness, `newsletter.Signup`'s `topics[].tagCode` and `attributes[]` carry the pickers; the swap is
  stable (same field object across renders).
  **RED (2026-10-30):** `Failed to resolve import "…/NewsletterSignupFields"`.
- [X] T183 [US7] GREEN: `packages/modules/cms/src/admin/components/NewsletterSignupFields.tsx` + one
  loop line in `PageBuilderEditor.tsx`.
  **GREEN:** 5 passed, including the mounted editor: picking a tag stores its code; picking a custom
  field writes `{ key, type, fieldLabel }` into the item and keeps its `label`. (The mounted cases first
  failed on `findByRole('option')`, which skips the hidden inactive tab; they query the option text
  instead.) The admin item drops the package's `type` select — the picker owns the type.

### D6. Manifest, i18n, docs, release, verification

- [X] T184 [P] Manifest: translatable paths `attributes[].label`, `attributes[].placeholder`,
  `messages.fields` in `packages/modules/newsletter/src/manifest.ts`; **RED first** in
  `packages/modules/newsletter/src/backend/manifest.test.ts`; `composer:generate`.
  **RED (2026-10-30):** `… exec vitest run src/backend/manifest.test.ts` → 1 failed (`expected [ 'heading', … ]
  to deeply equal ArrayContaining{…}`). **GREEN:** 8 passed; `composer:generate` produced no diff.
- [X] T185 [P] i18n: `blocks.signup.fields.attributes.*`, `blocks.signup.fields.messages.fields.fields.label`
  in `newsletter` en/pl; extend `admin/test/modules/cms/page-builder-field-i18n.test.ts`.
  **RED (2026-10-30):** with the base bundles, `… page-builder-field-i18n.test.ts -t newsletter` → 3 failed
  (findings for the new labels; `text: expected undefined to be truthy`). **GREEN:** 86 passed. Also
  `blocks.signup.fields.attributes.fields.type.options.*` for the package's own type select.
- [X] T186 [P] Docs: `packages/modules/newsletter/docs/newsletter.md` § sign-up block — picking topics,
  attributes by type, required, what the module stores (type-checked) + PL + cache.
- [X] T187 [P] Changesets: `.changeset/169-d-signup-attributes.md` (`@endora-commerce/cms-components`:
  minor, `@endora-commerce/page-builder-admin`: minor, `@endora-commerce/mod-cms`: patch,
  `@endora-commerce/mod-newsletter`: minor); `.changeset/169-d-custom-field-types.md`
  (`@endora-commerce/mod-newsletter`: patch — behaviour change: type-mismatched custom-field values
  are no longer stored).
- [X] T188 Verification: rebuild cms-components, page-builder-admin, mod-cms, mod-newsletter; commit
  dist css + generated files; filtered typecheck + lint (those + admin, storefront, backend);
  T171–T185 files; T173 **[PG]**; `check:docs-translations`, `check:module-docs`.
  **Result (2026-10-30):** see the WP-D hand-off report; whole `admin` suite 1 failure in
  `test/kit/kit-comments.test.tsx` (typed text order under load), which passes alone and is not
  touched by this package.

---

## Integration (orchestrator, after the four merges)

These are not developer tasks and carry no ID in a work-package range.

1. Merge order A → B → D → C into `feat/169-page-builder-contact-form`; resolve shared-file
   conflicts by keeping both sides (standing rule 16); rebuild `dist/cms-components.css`.
2. `pnpm run build:packages`; filtered typecheck + lint of every touched workspace; the union of the
   four packages' test files; the `[PG]` files; `composer:generate` produces no diff.
3. Check that the docs cache entries are fresh (`check:docs-translations`) — no two packages share
   one by design.
4. Full suites on CI (standing rule 3).
