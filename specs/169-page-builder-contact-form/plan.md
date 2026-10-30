# Implementation Plan: Page builder — contact form, page navigation, block fixes and newsletter attributes

**Branch**: `feat/169-page-builder-contact-form` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/169-page-builder-contact-form/spec.md`

## Summary

Seven owner-decided items on the Page Builder, delivered as four independent work packages:

- **WP-A** fixes the kept-arrows look of carousels (one shell class + one stylesheet rule), makes
  empty listings render nothing on the storefront, and adds two presets (`cms.Accordion` `filled`,
  `cms.DownloadTile` icon size/style).
- **WP-B** adds `cms.PageNavigation`: server-rendered anchor links with a scroll-spy island.
- **WP-C** adds `cms.ContactForm`: a fixed-field form posting to a storefront handler, which calls a
  new public, rate-limited `cms` endpoint that e-mails per-channel recipients through the platform
  mailer (`emailMailer`, with a new optional `replyTo`) and stores nothing; marketing consent
  subscribes through the existing public newsletter endpoint when `newsletter` is present.
- **WP-D** gives `newsletter.Signup` an admin-fed tag picker and subscriber attributes (newsletter
  custom fields), and makes the newsletter module store only type-correct attribute values.

No migration, no new entity, no new runtime dependency.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17, React 19
**Primary Dependencies**: existing only — Fastify (+ `@fastify/rate-limit`, already registered), Zod, MikroORM (read only), Puck (`@puckeditor/core`), Next.js 15; no new dependency
**Storage**: none new — one `string_list` setting in the settings store; e-mail delivery record unchanged
**Testing**: Vitest (package unit tests, backend unit/contract/integration, storefront, admin)
**Target Platform**: backend (Fastify), storefront (Next.js App Router, SSR), admin (Vite SPA)
**Project Type**: web monorepo (pnpm workspaces)
**Performance Goals**: no extra request on a page render; the scroll-spy uses one IntersectionObserver per block
**Constraints**: stored pages render byte-identically with new options unset; SSR-capable (Principle VII); no shopper-visible English-only string
**Scale/Scope**: 2 new blocks, 4 extended blocks, 1 public endpoint, 1 setting, 1 error code, 1 contract field

## Constitution Check

*GATE: checked before research and after design. Verdict at the end.*

| Principle | How this design meets it |
| --- | --- |
| I. Modular architecture (NN) | `cms` owns both new blocks, the endpoint, the setting, the error code, its i18n, docs and tests. It reaches `email` and `_i18n` only through ports (`lazyPort<EmailMailerPort>(ctx, 'emailMailer')`, `lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService')`) and declares both in `dependencies` (both non-deactivatable — the edges cost the operator nothing). The newsletter opt-in is the storefront calling `newsletter`'s public endpoint; `cms` gains no edge to `newsletter`. `newsletter`'s change (type check) is inside `newsletter`. The editor pickers read `newsletter`'s admin API over HTTP, as `BlogCategoryPicker` reads `blog`'s. |
| II. API-first | `contactFormSubmissionSchema` in `packages/contracts/src/cms-contact-form.ts` first; `EmailMailerSendInput.replyTo` is additive (no version bump). |
| III. TDD (NN) | Every FR maps to a RED task in tasks.md; RED notes recorded honestly per task. |
| IV. YAGNI & minimal dependencies | No new dependency. No CAPTCHA, no submissions table, no admin list, no dedicated settings screen (the generic Settings screen edits the list per channel). |
| V / VI / VIII | TypeScript; block names `cms.ContactForm`, `cms.PageNavigation` follow `<module>.<PascalCase>`; English specs, code, comments. |
| VII. SEO & performance | Both blocks render on the server; the nav works without JavaScript; the form posts without JavaScript (303 back). |
| IX. UI reuse | Button look reuses `BUTTON_SPEC_OBJECT_FIELDS`/`cmsc-btn`; anchor picker reuses `AnchorControl`; pickers follow `BlogCategoryPicker`; scheme tokens only. |
| X. Queue consumers | Not applicable — a single synchronous send per submission (≤ 10 recipients), as every other in-request mail in the tree. A queue would be the answer if recipients grew; recorded under *Rejected*. |
| XI. Multi-tenant isolation (NN) | No tenant-scoped entity is read or written; the submitter is anonymous and nothing is persisted. No organization path exists to bypass. |
| XII. Sales-channel scoping (NN) | Recipients read per request from the resolved channel (`getResolvedChannel`, `settingsReadPort.get(code, channelId)`); newsletter subscription uses the request's channel code. |
| XIII. Auditing via Command Bus (NN) | No admin/domain write is added. The recipients setting is written through `settings`' existing audited write path; the public submission changes no state (the mailer's delivery record is `email`'s existing behaviour). |
| XIV. Extensibility | Not applicable (no "add a field" requirement on an entity). |
| XV. Untouched core | Generic capability; a deployment customises through settings and blocks. |
| XVI. Command palette | `open-contact-form-settings` → `/settings` (`settings:read`). `cms.PageNavigation` has no admin surface of its own. |
| XVII. Operator-toggleable modules (NN) | Blocks are declared in manifests (filtered by owner presence). Endpoint registered through `ctx.routes` (503 when `cms` off). Storefront handler: 404 when `cms` off; newsletter step skipped when `newsletter` off. The setting group disappears with `cms` (settings of an absent module are not editable). Off-state tests extend `backend/test/integration/cms/off-state.test.ts` and the storefront handler test. |

**Cross-cutting checklist (architect brief)**: admin permission manifest — no new permission (the
setting uses `settings:*`, the endpoint is public, the pickers use `newsletter:read`); command
palette — one action; pl + en — module bundles + storefront catalogue + `cms` e-mail keys; Settings
module — `cms.contact_form_recipients`, not `secret` (R-8); Command Bus — no new write; tenant
scoping — none needed; Redis invalidation — none: `settings` owns its cache, the blocks add no cached
read.

**Verdict: PASS** — no violation; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/169-page-builder-contact-form/
├── spec.md
├── plan.md               # this file
├── research.md           # R-1 … R-13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── contact-form-api.md
│   └── blocks.md
└── tasks.md              # four work packages, disjoint ID ranges
```

### Source code touched (by work package)

```text
packages/cms-components/
├── src/components/carousel/{CarouselShell.tsx,carousel-parts.tsx}         A
├── src/components/{ProductSlider,ProductGrid,CategoryGrid,CategoryList,LatestPosts}.tsx  A
├── src/components/{Accordion,DownloadTile}.tsx                            A
├── src/components/PageNavigation.tsx (+ page-navigation-spy.ts)           B (new)
├── src/components/ContactForm.tsx (+ ContactFormFields.tsx)               C (new)
├── src/components/ButtonView.tsx                                          C (submit rendering)
├── src/components/NewsletterSignupForm.tsx                                D
├── src/components/render-context.tsx                                      B, C, D (one optional entry each)
├── src/schema/component-types.ts                                          A, B, C, D (own blocks only)
├── src/index.ts                                                           B, C (one registration each)
├── styles/cms-components.css + dist/cms-components.css                    A, B, C, D (own sections)
packages/page-builder-admin/src/
├── chrome/LinkField.tsx (export the anchor control as a field)           B
├── chrome/NewsletterPickers.tsx                                           D (new)
└── index.ts                                                               B, D (one export line each)
packages/contracts/src/
├── cms-contact-form.ts (+ .test.ts), index.ts, email.ts, errors.ts        C
packages/modules/cms/
├── src/manifest.ts                                                        B (block), C (block, setting, error, action, deps)
├── src/backend/routes.storefront.ts, index.ts, services/contact-form/*    C
├── src/admin/components/PageNavigationFields.tsx                          B (new)
├── src/admin/components/NewsletterSignupFields.tsx                        D (new)
├── src/admin/components/PageBuilderEditor.tsx                             B, D (one loop line each)
├── i18n/{en,pl}.json                                                      A, B, C (own key blocks)
└── docs/cms/{index.md | page-navigation.md | contact-form.md}             A | B | C
packages/modules/email/src/backend/services/{smtp-mailer,mailer,recording-mailer}.ts  C
packages/modules/newsletter/
├── src/backend/services/subscriber.service.ts                             D
├── src/manifest.ts, i18n/{en,pl}.json, docs/newsletter.md                 D
storefront/
├── app/forms/contact/route.ts, app/reserved-segments.ts                   C
├── app/newsletter/subscribe/route.ts, lib/api/newsletter.ts               D (C calls subscribeNewsletter unchanged)
├── components/CmsPageRenderer.tsx                                         B, C, D (one prop each)
├── lib/page-builder/{page-navigation-text,contact-form-text,newsletter-signup-text}.ts  B | C | D (new)
├── lib/i18n/messages.ts                                                   B, C, D (own keys)
└── test/ssr/catalog-blocks.test.tsx                                       A
backend/test/{contract,integration}/cms/…, backend/test/fixtures/error-code-routing/reference-ledgers.ts   C
docs/docs/module-reference/cms.md + PL mirror + cache                      C (regenerated)
.changeset/169-*.md                                                        each WP its own files
```

**Structure decision**: extend `cms`, `cms-components`, `page-builder-admin`, `newsletter`,
`email` (one optional field), `contracts` and the storefront; no new module or package.

## Work packages and merge plan

Four developers, four worktrees branched from this branch's spec commit. ID ranges are disjoint;
each package owns its files, and the **shared files** are edited only inside the package's own
hunk, at the insertion point named here, so a merge conflict is mechanical.

| WP | Tasks | Owns (exclusive) | Shared, own hunk only |
| --- | --- | --- | --- |
| A | T001–T049 | carousel shell/parts, the five listing blocks, Accordion, DownloadTile, `storefront/test/ssr/catalog-blocks.test.tsx`, `packages/modules/cms/docs/cms/index.md` (+ PL + cache) | `component-types.ts` (Accordion/DownloadTile types in place), CSS (carousel, accordion, download-tile sections), `cms` bundles (next to `blocks.accordion.*` / `blocks.downloadTile.*`) |
| B | T050–T089 | `PageNavigation.tsx`, `page-navigation-spy.ts`, `PageNavigationFields.tsx`, `page-navigation-text.ts`, `docs/cms/page-navigation.md` (+ PL + cache) | `component-types.ts` (after `TabsProps`), `index.ts` (after `'cms.Tabs'`), CSS (new section after Tabs), `render-context.tsx` (after `carouselLabels`), `LinkField.tsx`, `page-builder-admin/src/index.ts`, `PageBuilderEditor.tsx`, `cms` manifest (after `cms.Tabs`), `cms` bundles (after `blocks.tabs.*`), `messages.ts`, `CmsPageRenderer.tsx` |
| C | T090–T169 | contracts file, `ContactForm*.tsx`, backend `services/contact-form/*`, storefront `app/forms/contact/route.ts`, `contact-form-text.ts`, `docs/cms/contact-form.md` (+ PL + cache), module reference | `ButtonView.tsx`, `email` mailers, `contracts/src/{index,email,errors}.ts`, `component-types.ts` (after `ContactFormEmbedProps`), `index.ts` (after `'cms.ContactFormEmbed'`), CSS (new section after the contact embed's), `render-context.tsx` (after `localizePath`), `cms` manifest (settings, `errorCodes`, `actions`, `dependencies`, block after `cms.ContactFormEmbed`), `routes.storefront.ts`, `backend/index.ts` of cms, `cms` bundles (after `blocks.contactFormEmbed.*`, `errors.*`, `actions.*`), `reserved-segments.ts`, `messages.ts`, `CmsPageRenderer.tsx` |
| D | T170–T219 | `NewsletterPickers.tsx`, `NewsletterSignupFields.tsx`, `newsletter-signup-text.ts`, `subscriber.service.ts`, newsletter manifest/bundles/docs | `NewsletterSignupForm.tsx`, `component-types.ts` (inside the newsletter types), CSS (newsletter section), `render-context.tsx` (after `location`), `page-builder-admin/src/index.ts`, `PageBuilderEditor.tsx`, `storefront/app/newsletter/subscribe/route.ts`, `storefront/lib/api/newsletter.ts`, `messages.ts`, `CmsPageRenderer.tsx` |

Shared **test** files, each package adding its own `describe`/case at the end:
`admin/test/modules/cms/page-builder-field-i18n.test.ts` (A, B, C, D),
`packages/cms-components/src/components/styles.test.ts` (A, B, C),
`backend/test/integration/cms/off-state.test.ts` (B, C), and
`packages/cms-components/src/components/option-parity.test.ts` (any package that moves a field).

`render-context.tsx`, `CmsPageRenderer.tsx`, `messages.ts`, `index.ts` files and the module
bundles are small or alphabetical enough that two packages' hunks may still touch adjacent lines;
such a conflict is resolved by **keeping both sides** — no package deletes or reorders another's
lines.

**Merge order**: A → B → D → C (smallest first; C rebases last and owns the regenerated module
reference). Two artefacts are **never hand-merged**:

- `packages/cms-components/dist/cms-components.css` — after resolving the source CSS, run
  `pnpm --filter @endora-commerce/cms-components run build` and commit the output;
- any `docs/translation-cache/pl/*.json` touched by two packages (by design none is) — re-run the
  rehash with `hashSourceBody()`.

## Decisions where the brief left room

| Topic | Decision | Where argued |
| --- | --- | --- |
| Block names | `cms.ContactForm`, `cms.PageNavigation` (existing `cms.ContactFormEmbed` unchanged) | data-model §2–3 |
| Setting | `cms.contact_form_recipients`, `string_list`, per channel, group `cms_contact_form`, not secret | R-8 |
| E-mail seam | `emailMailer` (`EmailMailerPort`, owner `email`) + new optional `replyTo`; text via `adminI18nService` in the channel's default language | R-6 |
| Backend endpoint | `POST /api/v1/storefront/cms/contact-form` | contracts/contact-form-api.md §2 |
| Storefront handler | `POST /forms/contact` (`forms` reserved) | R-10 |
| Newsletter opt-in | storefront handler → existing `subscribeNewsletter`, source `cms-contact-form` | R-7 |
| Download tile names | `iconButtonSize` (`s`=48, `m`=72, `l`=112 px), `iconButtonStyle` | R-4 |
| Kept arrows | root class `cmsc-pb-carousel--arrows-kept`, scheme-token resting look | R-1 |
| Attribute type | snapshotted in page data; newsletter drops type-mismatched values | R-11 |
| Error code | `CMS_CONTACT_FORM_UNAVAILABLE` (409) | data-model §3.2 |

## Rejected at plan level

- **A submissions table / admin inbox** — owner: e-mail only.
- **A BullMQ job per submission** (Principle X) — the send is one short call per recipient,
  bounded at 10; a queue adds a worker, retries that could double-send, and persistence of the
  message body (forbidden). Revisit if recipients become unbounded.
- **`transactional_emails`' `templateEmailPort`** — switchable owner, system-default channel only,
  no Reply-To (R-6).

## Complexity Tracking

No Constitution violation and no new runtime dependency — nothing to justify.
