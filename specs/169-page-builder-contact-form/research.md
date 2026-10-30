# Research: feature 169 — contact form, page navigation, block fixes, newsletter attributes

Every finding below was read in the tree at `origin/master` `4b670e6a4` (2026-10-30). Paths are
repository-relative; line numbers are as read and only a guide.

Each decision is written **decision → rationale → alternatives rejected**.

---

## R-1. Carousel `arrowsWhenFit`: the code path, and where it can go invisible

**Read.**

- The option is a toggle inside `controls`: `packages/cms-components/src/components/carousel/carousel-parts.tsx:128`
  (`arrowsWhenFit: createToggleField(...)`).
- `carouselShellOptions()` (`carousel-parts.tsx:424-452`) turns it into the shell prop
  `keepArrowsWhenFit: true` only when `controls.arrowsWhenFit === true && controls.arrows !== false`
  (line 449); `endsOptions()` (lines 459-472) passes `disabledArrowLook` only when it is not `dim`.
- All three carousel blocks go through it: `ContentSlider.tsx:107`, `ProductSlider.tsx:151`,
  `LatestPosts.tsx:353` — so **no block drops the option** (suspect "a block path not passing the
  option" is ruled out by reading; WP-A's RED test still asserts it per block).
- `CarouselShell.tsx`:
  - `fits` is measured in `measure()` (lines 683-703): slide effect `track.scrollWidth <=
    track.clientWidth + 1`, fade `total <= 1`.
  - `keptOff = keepArrowsWhenFit && showArrows && fits && !editorPreview && !grid` (line 817);
    both arrows get `disabled` (lines 818-819, 917).
  - `controlsHidden = fits && !editorPreview && !keptOff` (line 962) — kept arrows leave every
    control group un-hidden (header 971, dots rows 989, slide 1029, overlay 1090, below 1112,
    slide fallback 1128); the dots alone are `hidden` (line 947).
  - `offLook` (lines 844-851) is `dim` unless `disabledArrowLook` is `outline-light` or `color`.
  - `arrows = showArrows && !editorPreview && !grid` (line 873): **the editor canvas never draws
    arrows at all**, kept or not, so an editor checking the option on the canvas sees nothing.
- Stylesheet `packages/cms-components/styles/cms-components.css`:
  - base arrow (1235-1251): `background: #fff; border: 1px solid var(--cmsb-n-200, #e2e8f0);
    color: var(--pb-arrow-color, var(--cmsb-n-700, #334155))`;
  - disabled (1797-1800): `opacity: 0.4` — a `#e2e8f0` ring at 40 % on a white or muted
    (`#f8fafc`) section is effectively invisible, and the overlay placement (1274-1281) puts that
    faint circle on top of the first and last slide;
  - controls hidden keep their box (`[hidden] { display: flex; visibility: hidden }`, 1220-1225).

**Finding.** The only path that makes kept arrows near-invisible in published markup is the
**dimmed disabled look** (0.4 opacity of an already light ring), worst on the light/muted schemes
and over an overlay. The secondary cause of "I turned it on and see nothing" is the **editor canvas,
which never renders arrows**. WP-A's first task reproduces both before deciding.

**Decision.** Kept arrows (arrows disabled *because everything fits*, not because the carousel
stopped at an end) get their own resting look: the shell adds `cmsc-pb-carousel--arrows-kept` to
the root while `keptOff` is true, and the stylesheet draws a disabled arrow under that class at full
opacity with the scheme's border and muted text colour (`var(--cmsb-border, #d9e0e7)`,
`var(--cmsb-fg-muted, #64748b)`), `cursor: default`. An explicit `disabledArrowLook`
(`outline-light`, `color`) still wins. The editor canvas is **not** changed: it deliberately draws
no arrows and pages with its own preview navigation
(`packages/modules/cms/src/admin/components/CarouselPreviewNav.tsx`, an action-bar pager). If WP-A's reproduction shows the report
came from the canvas rather than the storefront, it records that under T001 and stops for an owner
decision instead of changing the canvas ([NEEDS CLARIFICATION] only in that case).

**Rationale.** Generic (one class, one rule), scheme-aware through tokens that already exist,
touches no markup when the option is off (FR-002).

**Rejected.** Changing the `dim` look for every disabled arrow — changes carousels that stop at an
end and were never reported. A new "kept arrow colour" option — a per-element colour (R23).

---

## R-2. Empty listing blocks

**Read.**

- `ProductSlider.tsx:126-141` and `ProductGrid.tsx:120-135` render a `BoxStyled` wrapper holding
  `<p class="cmsc-pb-product-grid__empty">` with the editor notes or, on the storefront, the
  literal English `'No products found'`.
- `CategoryGrid.tsx:84-87` and `CategoryList.tsx:53` do the same with `'No categories found'`.
- `LatestPosts.tsx:270-278` already returns `null` on the storefront (`if (!preview) return null`)
  and keeps a `role="note"` in the editor.
- `storefront/test/ssr/catalog-blocks.test.tsx:240-242` and `:332-333` assert the English strings
  are in the SSR HTML — those assertions are **deliberately changed** (standing rule 13).
- `ProductCard`'s `'Product unavailable'` (single product block) is a different case and out of
  scope.

**Decision.** Storefront: the five blocks return `null` when they resolve no items (no box, no
header, no lead). Editor: unchanged notes. One small shared helper is not worth adding; each block
gets the same two-line guard.

**Rejected.** Translating "No products found" through the storefront catalogue — the owner chose
"render nothing", and an empty box with a heading is noise either way.

---

## R-3. Accordion `filled`

**Read.** `Accordion.tsx`: `isBoxed()` (93-97), `lookClasses()` (100-106, root class
`cmsc-pb-accordion--<itemStyle>` only for `plain`/`boxed`), field `itemStyle` (513-520),
`resolveFields` hides `dividers`/`dividerPosition` when boxed (581-583). CSS: plain/boxed rules
`cms-components.css:3193-3210`. Type `AccordionItemStyle = 'plain' | 'boxed'`
(`component-types.ts:899`). The scheme surface tokens: `[data-cmsb-scheme] { --cmsc-surface-tint:
rgb(15 23 42 / 6%) }`, dark `rgb(255 255 255 / 10%)` (`cms-components.css:4326-4337`); the boxed
tab already fills with `var(--cmsc-surface-tint, var(--cmsb-n-100, #f1f5f9))` (2911-2914).

**Decision.** `filled` → root class `cmsc-pb-accordion--filled`; the title bar (trigger) gets
`background: var(--cmsc-surface-tint, var(--cmsb-n-100, #f1f5f9))`, 8 px corners, 16 px inline
padding, items 8 px apart, no item border; panel inset 16 px. `isBoxed()` stays boxed-only; a new
`hasNoDividers()` (boxed or filled) drives the field hiding and `hasItemLines()`.

**Rejected.** Brand primary as the fill — the title text colour would then need its own option; a
free colour picker (owner: no).

---

## R-4. Download tile icon presets

**Read.** `DownloadTile.tsx`: icon look flag (`linkLook === 'icon'`, 135), class
`cmsc-pb-download-tile--icon-link` (145), button span `cmsc-pb-download-tile__icon-button` (184),
`ICON_BUTTON_KEYS` show/hide in `resolveFields` (278-300). CSS 6133-6154: 48 × 48 px circle,
`border: 1px solid currentColor`, glyph 40 %. R23 removed `iconButtonSizePx` and
`iconButtonBorderColor` (data-model §7 of 163) — presets are the sanctioned replacement.

**Decision.** `iconButtonSize: 's' | 'm' | 'l'` → class `cmsc-pb-download-tile--icon-s|m|l` with
48 / 72 / 112 px (S equals today's size, so a stored tile is unchanged whether unset or `s`);
`iconButtonStyle: 'filled'` → class `cmsc-pb-download-tile--icon-filled` with `background:
currentColor` and the glyph in `var(--pb-dl-bg, var(--cmsb-bg, #fff))`. Names follow the existing
`iconButtonIcon`.

**Rejected.** The brief's example name `iconSize` — the tile has other icons (the file type), and
`iconButton*` is the prefix the block already uses.

---

## R-5. Page navigation building blocks that exist

**Read.**

- Section anchors: `Section.tsx:486, 537` (`id={anchor}` when `SECTION_ANCHOR_RE` matches),
  `SECTION_ANCHOR_RE = /^[a-z][a-z0-9-]{0,63}$/` (`packages/contracts/src/page-builder-values.ts:23`);
  sections already carry `scroll-margin-top: var(--cmsb-header-offset, 0px)`
  (`cms-components.css:4350, 4895`).
- Editor anchor picker: `AnchorControl` in `packages/page-builder-admin/src/chrome/LinkField.tsx:184-245`
  using `collectAnchors(data)` from `@endora-commerce/page-builder-core` — reusable as a field.
- Horizontal-scrolling tab list precedent: `.cmsc-pb-tabs` (`overscroll-behavior-x: contain`,
  `cms-components.css:2990`); pill active look inverting the scheme: 2906-2909.
- Storefront words for blocks: `CmsRenderContext.carouselLabels`
  (`packages/cms-components/src/components/render-context.tsx:38-56, 64-65`), filled by
  `storefront/components/CmsPageRenderer.tsx:67` from `storefront/lib/page-builder/carousel-labels.ts`
  and `storefront/lib/i18n/messages.ts` (`cms.carousel.*`, 420-432, 822-…).

**Decision.** `cms.PageNavigation` in `packages/cms-components/src/components/PageNavigation.tsx`,
a server-renderable `<nav aria-label>` + `<ul>` of `<a href="#anchor">`, with a client island
(`'use client'` hook) for scroll-spy via `IntersectionObserver` (rootMargin from the sticky
offset); smooth scrolling is CSS (`scroll-behavior: smooth` on the document while the block is
present, inside `@media (prefers-reduced-motion: no-preference)`); the sticky offset is written as
`--cmsc-page-nav-h` so `:root:has(.cmsc-pb-page-nav--sticky) :is(.cmsc-section, [id])` gets
`scroll-margin-top: calc(var(--cmsb-header-offset, 0px) + var(--cmsc-page-nav-h, 0px))`. The
accessible label's default comes from a new optional `pageNavigationText` in the render context,
filled by the storefront catalogue (`cms.pageNavigation.label`); absent (editor) it is English.

**Rejected.** Auto-generating items from the page's sections — the owner asked for a list of
links; auto-generation needs the whole page's data at render and section titles that do not exist.
A JS-only nav — breaks progressive enhancement.

---

## R-6. The e-mail sending seam for `cms`

**Read.**

- `email` owns the platform mailer: `ctx.di.register({ emailMailer: … new RecordingMailer(
  emailTransport, emailDeliveryRecorder) })` (`packages/modules/email/src/backend/index.ts`),
  contract `EmailMailerPort` / `EmailMailerSendInput` (`packages/contracts/src/email.ts:106-196`).
  `email` is `nonDeactivatable` (`packages/modules/email/src/manifest.ts:187`).
- Consumers resolve it as `lazyPort<EmailMailerPort>(ctx, 'emailMailer')` and list `email` in
  `dependencies` (e.g. `packages/modules/inventory/src/backend/index.ts:187`,
  `packages/modules/inventory/src/manifest.ts:199`; returns, customers, organizations alike).
- **`EmailMailerSendInput` has no `replyTo`.** `SmtpMailer` maps `from/to/subject/text/html/
  attachments` only (`packages/modules/email/src/backend/services/smtp-mailer.ts:21-35`).
- The delivery record (D-59) stores `recipient`, `kind`, `subject`, `salesChannelId`, `document`,
  `meta` as `context` (`recording-mailer.ts` `contextOf`), never the body.
- The alternative seam, `templateEmailPort` (`transactional_emails`, `packages/contracts/src/
  transactional-emails.ts:438-446`): gated (switchable module), resolves the **system-default**
  channel, takes no Reply-To.
- Backend translation: `adminI18nService` → `AdminI18nTranslatePort.translate(moduleId, key,
  language, params)` (`packages/contracts/src/admin-i18n.ts:122-128`), owner `_i18n`
  (`nonDeactivatable`), used the same way by customers, quote_requests, projects.

**Decision.** `cms` sends through **`emailMailer`** (`EmailMailerPort`), adding an optional
`replyTo?: string` to `EmailMailerSendInput` (additive contract change), honoured by `SmtpMailer`
(nodemailer `replyTo`) and logged by `ConsoleMailer`; `RecordingMailer` passes it through and does
**not** record it. The body is composed by `cms` in the channel's default language through
`adminI18nService` with keys `contactForm.mail.*` in `packages/modules/cms/i18n/{en,pl}.json`. One
`send` per recipient, `kind: 'cms.contact_form'`, `salesChannelId` the request's, a **fixed
translated subject** (`contactForm.mail.subject` with the channel name), and **no `meta`** — so the
delivery record holds the operator's address, a fixed subject and the outcome, and nothing the
shopper typed (FR-019, SC-004). `cms` adds `email` and `_i18n` to `dependencies`; both are
non-deactivatable, so the edges cost the operator nothing.

**Rationale.** The sanctioned, always-present port; per-request channel; the only change is one
optional field that every existing caller ignores.

**Rejected.**

- `templateEmailPort` — makes the contact form depend on a switchable module (a degrade to design
  and a `nonBindingDependencies` entry), sends on the system-default channel, has no Reply-To, and
  an operator-editable template is not asked for.
- Putting the shopper's subject into the e-mail subject — it would be persisted in
  `email_deliveries.subject`, which the owner's "no database storage" forbids.
- Constructing a nodemailer transport in `cms` — a second transport and a new dependency.

**Risk recorded.** The `replyTo` addition touches `packages/contracts` and the `email` module (a
module `cms` does not own). It is additive and owned by WP-C; the `email` module's mailer tests are
extended in the same commit.

---

## R-7. Gating on module activation

**Read.** `specs/conventions/module-activation.md` items 1, 3, 5; `module-composition.md` items
3-5. Blocks are declared in a manifest's `blocks` and the Page Builder registry filters a declared
block by its owner's presence (`packages/modules/cms/src/backend/plugin.ts`, `isModulePresent`);
`newsletter.Signup` is declared by `newsletter` (`packages/modules/newsletter/src/manifest.ts:186`)
and rendered from `cms-components`. Routes registered through `ctx.routes` are gated by
`defineModuleRoutes` (503 `MODULE_DISABLED`). The storefront handler pattern:
`storefront/app/newsletter/subscribe/route.ts` calls `getModulePresence().isPresent('newsletter')`
and answers 404.

**Decision.** `cms.ContactForm` and `cms.PageNavigation` are declared in `cms`' manifest (owner
`cms`); the backend route is added in `routes.storefront.ts` (already registered through
`ctx.routes`); the storefront handler checks `isPresent('cms')` (404) and, for the newsletter
opt-in, `isPresent('newsletter')`. The newsletter call is the storefront's existing
`subscribeNewsletter` (`storefront/lib/api/newsletter.ts`) → public `POST
/api/v1/newsletter/subscribe` — no import of newsletter internals, no backend edge from `cms` to
`newsletter`.

**Rejected.** A backend `cms` → `newsletter` port call — a new cross-module edge into a switchable
module (a `nonBindingDependencies` entry, a degrade) for something the storefront already does in
one call.

---

## R-8. A CMS setting per channel, and how it is edited

**Read.** `defineModuleSettingsManifest` in `packages/modules/cms/src/manifest.ts:57-155`;
`cms.default_share_image_asset_id` is the per-channel precedent ("Can be overridden per sales
channel", read per request for the request's channel). Value types
(`packages/contracts/src/settings.ts:16-26`): `string_list` exists. Write validation is
contributed through `settingWriteValidatorRegistry`; `cms` already registers one in
`ctx.onBoot` (`packages/modules/cms/src/backend/index.ts:561-565`). Reading: `settingsReadPort.get(
code, channelId, schema)` (same file, 353-389). The generic Settings screen
(`packages/modules/settings/src/admin/components/SettingRowEditor.tsx`) edits `string_list` and
per-channel overrides. Palette precedent: `open-page-builder-translation-settings` →
`/settings`, `settings:read` (`manifest.ts:385-393`). The only public settings reads are named
routes (`routes.storefront.ts`, `routes.homepage.ts`, `routes.product-card-buttons.ts` in
`packages/modules/settings/src/backend/`) — none enumerates arbitrary codes.

**Decision.** Setting `cms.contact_form_recipients`, `valueType: 'string_list'`, default `[]`,
group `cms_contact_form` ("Contact form"), edited on the generic Settings screen with per-channel
overrides; a write validator refuses anything but 0-10 valid e-mail addresses; read per request
with the resolved channel id. Not `secret`: an address is not a credential, and `secret` would hide
it from the operator who needs to read it back. Palette action `open-contact-form-settings` →
`/settings`, `settings:read`.

**Rejected.** A dedicated admin screen — the generic screen already edits lists per channel
(Principle IX, YAGNI). Recipients as a block prop — the owner forbids them in page data.

---

## R-9. Public endpoint protection

**Read.** Per-route rate limits: `config: { rateLimit: { max, timeWindow, keyGenerator } }` with the
type-only import `import type {} from '@fastify/rate-limit'`
(`packages/modules/analytics/src/backend/routes.ts:1-43`); the plugin is registered globally
(`packages/platform/src/http/server.ts:158-163`). `request.ip` honours `trustProxy` only when the
deployment sets `TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES` (`backend/src/index.ts:33-37`).
The reference storefront calls the backend server-side, so without that setting every shopper
shares the storefront's IP.

**Decision.** `rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: (r) =>
\`cms-contact:${r.ip}\` }`; the storefront handler forwards the shopper's `x-forwarded-for`; the
docs tell a deployment to trust the storefront as a proxy. Honeypot field `website` — filled → the
backend answers `200 { status: 'sent' }` and sends nothing. No CAPTCHA (a third-party dependency).

**Rejected.** A per-channel global cap in Redis — YAGNI until abuse is observed; a CAPTCHA
provider — new runtime dependency and a privacy question.

---

## R-10. Storefront route for the form

**Read.** `storefront/app/newsletter/subscribe/route.ts` (303 back to the page with the outcome in
the query and the section anchor as fragment; JSON with `Accept: application/json`), the block
posts to `localizePath('/newsletter/subscribe')` (`NewsletterSignupForm.tsx`, feature 167). First
path segments the storefront owns are listed in `RESERVED_TOP_LEVEL_SEGMENTS`
(`storefront/app/reserved-segments.ts`), reconciled by `check:storefront-indexability`.

**Decision.** `POST /forms/contact` → `storefront/app/forms/contact/route.ts`, the same 303/JSON
contract as the newsletter handler, outcome on `?contact=sent|error&reason=…&form=<blockId>#anchor`
(the block id so two forms on one page do not both show it); `forms` is added to
`RESERVED_TOP_LEVEL_SEGMENTS`. The block posts to `localizePath('/forms/contact')`.

**Rejected.** A server action — needs JavaScript for the no-JS path to work reliably across the
CMS renderer and gives no 303 contract to a headless client. `/api/...` — the middleware's
language handling of `/api` paths is untested for form posts; `forms` mirrors `newsletter`.

---

## R-11. Newsletter tags and custom fields the editor can read

**Read.**

- `GET /api/v1/admin/newsletter/tags` → `{ data: { items: NewsletterTag[] } }` and `GET
  /api/v1/admin/newsletter/custom-fields` → `{ data: { items: NewsletterCustomField[] } }`, both
  `newsletter:read` (`packages/modules/newsletter/src/backend/routes.admin.ts:135, 148`).
- Shapes (`packages/contracts/src/newsletter.ts`): tag `{ id, code, name, description }` (73-78),
  custom field `{ id, key, label, type: 'text'|'number'|'boolean'|'date' }` (94-99); a field's type
  cannot change after creation (`custom-field.service.ts` `update` sets `label` only).
- Public subscribe: `newsletterSubscribeRequestSchema` accepts `customFields:
  Record<string, string|number|boolean|null>` (`newsletter.ts:420-426`);
  `routes.storefront.ts` passes it on; `subscriber.service.ts:332-345` `mergeCustomFields` keeps
  **known keys only and does not check the type** — a text value lands in a number field.
- Storefront: `subscribeNewsletter` (`storefront/lib/api/newsletter.ts`) takes no `customFields`;
  the handler `storefront/app/newsletter/subscribe/route.ts` forwards none.
- Editor picker precedent: `BlogCategoryPicker.tsx` (`packages/page-builder-admin/src/chrome/`)
  loads an admin list, falls back to free text on failure, keeps an unknown stored value, and is
  swapped in by `packages/modules/cms/src/admin/components/ListingFields.tsx`.

**Decision.** `page-builder-admin` gains `NewsletterPickers.tsx` (`createNewsletterTagCodeField`,
`createNewsletterCustomFieldField`) on the blog picker's pattern; `cms` admin swaps them into
`newsletter.Signup` in a new `NewsletterSignupFields.tsx`. The attribute stores `{ key, type }`
(type snapshotted — safe because a field's type is immutable). `mergeCustomFields` drops a value
whose type does not match (`boolean` → boolean, `number` → finite number, `date` → `YYYY-MM-DD`,
`text` → string ≤ 500; `null` clears) — a value is dropped rather than refused, so no existing
caller gets a new 400.

**Rejected.** A public custom-field definitions endpoint for the storefront — page data already
carries the type; a 400 on type mismatch — a breaking change for the self and admin create paths.

---

## R-12. Where translations live for new strings

**Read.** `specs/conventions/module-i18n.md`: field labels translated in the declaring module's
bundle under the block's label-key stem (`blocks.<stem>.fields.<field>.label|options.*`, e.g.
`blocks.accordion.fields.itemStyle.options.boxed` in `packages/modules/cms/i18n/en.json`);
shopper-visible platform prose in the storefront catalogue (`storefront/lib/i18n/messages.ts`, a
total `Record` — a missing Polish string is a `tsc` error); backend-composed e-mail translated by the
backend (case 1: reader language resolvable — here the channel's default language).

**Decision.** Editor labels → module bundles (`cms`, `newsletter`); shopper defaults (form labels,
messages, nav label) → storefront catalogue keys `cms.contactForm.*`, `cms.pageNavigation.*`,
`newsletter.signup.fields` handed to the blocks through new optional render-context entries; the
e-mail → `cms` bundle keys `contactForm.mail.*` via `adminI18nService`. Absent context (the editor),
blocks fall back to English, as the carousel labels do.

---

## R-13. Documentation layout (merge-friendly)

**Read.** `specs/conventions/module-documentation.md` item 1: every file under a module's `docs/`
is served; `cms` ships `docs/cms/{index,brand,extending-page-builder}.md`; each page has its own
translation-cache entry `docs/translation-cache/pl/packages--modules--cms--docs--cms--<page>.md.json`
whose `content` is the whole Polish page in one JSON string.

**Decision.** New pages per work package so no two packages edit one cache entry:
`packages/modules/cms/docs/cms/page-navigation.md` (WP-B), `.../contact-form.md` (WP-C); WP-A edits
`index.md`; WP-D edits `packages/modules/newsletter/docs/newsletter.md`. The generated module
reference `docs/docs/module-reference/cms.md` (settings, palette, dependencies) changes in WP-C only.
