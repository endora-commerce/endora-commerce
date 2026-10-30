# Feature Specification: Page builder — contact form, page navigation, block fixes and newsletter attributes

**Feature Branch**: `feat/169-page-builder-contact-form`
**Created**: 2026-10-30
**Status**: Draft
**Input**: Owner brief for feature 169 (owner decisions final). Seven items: two listing/carousel
defects, two look presets on existing blocks, a page-navigation (jump links) block, a contact-form
block that sends e-mail only, and topic/attribute pickers for the newsletter sign-up block. Generic
product capability only; the bar is "visually close", not pixel-perfect.

## Context

Feature 163 (`specs/163-page-builder-marketing-pages/`) gave the Page Builder the blocks a
corporate marketing site needs. Rebuilding typical corporate pages on it left four gaps:

- a carousel option and the empty listings misbehave on the storefront;
- the accordion and the download tile lack one common look each;
- long pages have no in-page navigation bar;
- a contact page cannot be built: the only contact block (`cms.ContactFormEmbed`) embeds an
  external form or shows a `mailto:` link.

The newsletter sign-up block also asks the editor to type tag codes from memory and cannot collect
the subscriber attributes the newsletter module already stores.

**Binding rules for every story** (owner):

- *Extend, don't narrow.* Every new option is optional. With it unset a block renders today's
  markup byte for byte, and every stored page renders as before. The option-parity and
  fallback-parity tests stay green and are extended honestly.
- *Visually close.* Presets (S/M/L), colour schemes, brand tokens and existing primitives, never
  per-element px or free colour pickers. Nothing that `specs/163-page-builder-marketing-pages/`
  data-model §7 (R23) removed comes back.
- *Generic.* No reference website, client, text, address, person or measured value in any tracked
  file.
- Every label and every shopper-visible string ships in English and Polish; nothing shown to a
  shopper is hard-coded English.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Carousel arrows kept when every slide fits (Priority: P1)

An editor turns on **Keep the arrows when all slides fit** on a carousel. On the storefront, with
fewer slides than fit in the view, the shopper still sees both arrows (inactive), so the block
looks the same as its siblings that do scroll.

**Why this priority**: a shipped option that does not visibly work is a defect.

**Independent Test**: render each carousel block with the option on and every slide fitting, on
the light and the dark scheme; both arrows are present, not hidden, and drawn with a visible look.

**Acceptance Scenarios**:

1. **Given** a `cms.ContentSlider`, `catalog.ProductSlider` or `blog.LatestPosts` with the option
   on and every slide fitting, **When** the page renders, **Then** both arrows are in the DOM, not
   hidden, `disabled`, and drawn with a look whose contrast against the scheme background meets the
   non-text contrast the rest of the carousel controls meet.
2. **Given** a `cms.ContentSlider` whose slides are `cms.CarouselSplit` blocks drawing the controls
   inside the slide, **When** every slide fits, **Then** the arrows inside the slide are visible
   and inactive.
3. **Given** the option off, **When** every slide fits, **Then** the controls hide exactly as today.
4. **Given** a dark colour scheme, **When** the kept arrows render, **Then** they remain visible.

---

### User Story 2 — An empty listing disappears from the storefront (Priority: P1)

A product, category or post listing that resolves to no items renders nothing at all on the
storefront — no heading, no "No products found" sentence. In the editor it keeps the helpful note
saying why it is empty.

**Why this priority**: shoppers today read an untranslated English sentence on a Polish page.

**Independent Test**: render each listing block with an empty result on the storefront (no
markup) and in the editor (the note).

**Acceptance Scenarios**:

1. **Given** a `catalog.ProductSlider` or `catalog.ProductGrid` with no products, **When** the
   storefront renders it, **Then** the block contributes no element (no box, no header, no text).
2. **Given** a `catalog.CategoryGrid` or `catalog.CategoryList` with no categories, **When** the
   storefront renders it, **Then** the block contributes no element.
3. **Given** `blog.LatestPosts` with no posts, **When** the storefront renders it, **Then** it
   contributes no element (today's behaviour, kept and now asserted beside the others).
4. **Given** any of these blocks empty in the editor, **When** the canvas renders, **Then** the
   editor note explaining how to fill it is shown.
5. No new option is added for this.

---

### User Story 3 — Accordion with filled title bars (Priority: P2)

An editor chooses a third accordion item style, **Filled**: each item's title bar sits on a filled
background taken from the colour scheme (its muted surface), beside today's Plain and Boxed.

**Independent Test**: set `itemStyle: 'filled'` and check the root class and the stylesheet rule;
unset and `plain`/`boxed` render as today.

**Acceptance Scenarios**:

1. **Given** item style Filled, **When** the accordion renders, **Then** each title bar has the
   scheme's surface fill, the panel is inset to match, and dividers are not offered.
2. **Given** a dark scheme, **When** Filled renders, **Then** the fill is the dark scheme's surface
   tint and the title text stays legible.
3. No colour picker is offered.

---

### User Story 4 — Download tile icon size and filled icon (Priority: P2)

With the round icon link, an editor picks the icon's size (S, M, L — L about a 112 px circle) and
its style: Outline (today's) or Filled (a filled circle with the glyph inverted).

**Acceptance Scenarios**:

1. **Given** link look Icon and size L, **When** the tile renders, **Then** the circle is about
   112 px.
2. **Given** style Filled, **When** the tile renders, **Then** the circle is filled with the
   tile's text colour and the glyph takes the tile's background colour, on any scheme.
3. **Given** neither option set, **When** the tile renders, **Then** the markup is today's.
4. The size and style fields show only with link look Icon. No px field, no ring colour.

---

### User Story 5 — Page navigation (jump links) (Priority: P2)

An editor adds a **Page navigation** block: a row of links to sections of the same page. While the
shopper scrolls, the link of the section in view is highlighted. It can stick to the top, scrolls
sideways on phones, and comes in two looks: a single rounded **pill** track whose active item is
filled, and an **underline** (tabs) look.

**Independent Test**: render the block with three anchors; without JavaScript it is a `nav` of
plain anchor links; with JavaScript the item whose section is in view carries `aria-current`.

**Acceptance Scenarios**:

1. **Given** items pointing at section anchors, **When** the page renders on the server, **Then**
   the block is a `<nav>` with an accessible label containing a list of `<a href="#anchor">` links,
   working with JavaScript off.
2. **Given** JavaScript on, **When** a section scrolls into view, **Then** its link becomes active
   (`aria-current="true"` and the active look); exactly one link is active at a time.
3. **Given** the sticky option, **When** the shopper scrolls past the block, **Then** it stays at
   the top below the storefront header, and a jumped-to section's heading is not hidden behind it.
4. **Given** a phone width and more links than fit, **When** the block renders, **Then** the list
   scrolls horizontally and the active link is scrolled into view.
5. **Given** the shopper prefers reduced motion, **When** a link is followed, **Then** the jump is
   instant; otherwise it scrolls smoothly.
6. **Given** an item whose anchor matches no element on the page, **When** the page renders,
   **Then** the link is still rendered (the editor shows a warning in its preview).

---

### User Story 6 — Contact form that e-mails the shop (Priority: P1)

An editor adds a **Contact form** block to a page, chooses which of a fixed set of fields to show
(name, e-mail, phone, company, subject, a select with editor-defined options, message, privacy
consent, marketing consent), sets their labels, placeholders and whether they are required, picks
one or two columns, a field look and the button look, and edits the success and error messages. A
shopper fills it in and the shop receives an e-mail; nothing is stored.

**Why this priority**: a contact page is part of every corporate site and the feature's headline.

**Independent Test**: submit the form against a test channel with recipients configured; one
e-mail per recipient is handed to the platform mailer with Reply-To set to the shopper, and no row
is written outside the mailer's existing delivery record.

**Acceptance Scenarios**:

1. **Given** recipients configured for the request's sales channel, **When** a shopper submits a
   valid form, **Then** each recipient receives an e-mail listing the submitted fields, the page it
   was sent from and the consents, with Reply-To set to the shopper's address, and the block shows
   its success message.
2. **Given** the submission is missing the e-mail, the message or the privacy consent, or a field
   exceeds its length, **When** it reaches the server, **Then** it is refused with a validation
   error whatever the block's own "required" flags said.
3. **Given** a bot filled the hidden honeypot field, **When** it submits, **Then** the answer looks
   like success and no e-mail is sent.
4. **Given** one address submits more than the rate limit allows, **When** it submits again,
   **Then** it is refused with `429` and the block shows its error message.
5. **Given** no recipients configured for the channel, **When** a shopper submits, **Then** the
   server answers `CMS_CONTACT_FORM_UNAVAILABLE` and the block shows its error message.
6. **Given** JavaScript off, **When** the shopper submits, **Then** the browser returns to the same
   page (same language, scrolled to the block) showing the outcome; with JavaScript on, the outcome
   is shown inline and the typed values are kept on error.
7. **Given** the marketing consent ticked and the newsletter module present, **When** the e-mail is
   sent, **Then** the address is also subscribed to the channel's newsletter with the channel's
   opt-in mode (double opt-in sends its confirmation). **Given** the newsletter module off, **Then**
   the consent is only stated in the e-mail.
8. **Given** recipients are configured per sales channel, **When** the page data is read by any
   client, **Then** no recipient address appears in it.
9. **Given** the CMS module off, **When** anything posts to the contact endpoint, **Then** it is
   refused as for every other CMS route, and no page renders the block.
10. **Given** a corporate contact page, **When** an editor composes it, **Then** a heading and lead
    beside the form, a contact-details column and tabs "Contact form | Newsletter" (the existing
    Tabs block holding `cms.ContactForm` and `newsletter.Signup`) can be built from existing blocks.

---

### User Story 7 — Newsletter sign-up picks topics and collects attributes (Priority: P3)

In the newsletter sign-up block, the editor picks each topic's tag from the list of existing
newsletter tags instead of typing its code, and may add subscriber attributes — the newsletter's
custom fields — to the form: a yes/no field as a checkbox, a text, number or date field as an input,
each with a label override and a required flag.

**Acceptance Scenarios**:

1. **Given** newsletter tags exist, **When** the editor edits a topic, **Then** the tag is chosen
   from a list of tag names; a stored code the list does not hold stays selected; when the list
   cannot be loaded (no permission, module off) the code is edited as text, as today.
2. **Given** the editor adds an attribute from the existing custom fields, **When** the shopper
   sees the form, **Then** a boolean field is a checkbox and a text, number or date field is the
   matching input, with the editor's label or the field's own label.
3. **Given** a required attribute left empty, **When** the shopper submits, **Then** the form
   refuses it with a translated message (client side and in the storefront handler).
4. **Given** a value of the wrong type for a field (e.g. text for a number), **When** it reaches the
   newsletter module, **Then** it is not stored; a known key with a valid value is stored on the
   subscriber.
5. **Given** no attributes configured, **When** the block renders, **Then** its markup is today's.

### Edge Cases

- A page holding two contact forms: an outcome on the URL is shown by the block it belongs to only.
- A contact submission while the mail transport is the console driver (no SMTP): it is reported as
  sent to the shopper; the delivery record says `logged` (existing behaviour of the mailer).
- A partial mailer failure (one of two recipients fails): the shopper sees the error message only
  when no recipient accepted the message.
- A newsletter subscription failing after the e-mail was sent: the shopper still sees the contact
  success message; the failure is logged.
- A page navigation item whose anchor names a column anchor rather than a section: it works, any
  element id on the page is a valid target.
- A page navigation block placed inside a tab panel or a carousel slide: allowed; sticky applies to
  its nearest scroll container only (documented).

## Requirements *(mandatory)*

### Functional Requirements

**Carousel (US1)**

- **FR-001**: With `controls.arrowsWhenFit` on and every slide fitting, every carousel block
  (`cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`, and `cms.CarouselSplit` slides
  drawing the controls in the slide) MUST render both arrows visible, disabled and legible on the
  light, muted and dark schemes.
- **FR-002**: The fix MUST be generic (in the shared carousel shell or stylesheet), not per block,
  and MUST NOT change the markup of a carousel with the option off.

**Empty listings (US2)**

- **FR-003**: On the storefront, `catalog.ProductSlider`, `catalog.ProductGrid`,
  `catalog.CategoryGrid`, `catalog.CategoryList` and `blog.LatestPosts` MUST render nothing when
  they resolve no items — no box, header, lead or sentence.
- **FR-004**: In the editor those blocks MUST keep an explanatory note when empty.
- **FR-005**: No new block option is introduced for this.

**Accordion (US3)**

- **FR-006**: `cms.Accordion.itemStyle` MUST accept `filled`; the title bar's fill is the scheme's
  surface tint (`--cmsc-surface-tint`) with today's neutral as the fallback outside a scheme.
- **FR-007**: The dividers fields MUST be hidden for `filled`, as for `boxed`.

**Download tile (US4)**

- **FR-008**: `cms.DownloadTile` MUST accept `iconButtonSize: 's' | 'm' | 'l'` and
  `iconButtonStyle: 'outline' | 'filled'`, shown only with `linkLook: 'icon'`.
- **FR-009**: Unset, the icon button MUST render as today (48 px outline).

**Page navigation (US5)**

- **FR-010**: A new block `cms.PageNavigation`, owned by `cms`, MUST render a `<nav>` with an
  accessible label and a list of same-page anchor links.
- **FR-011**: It MUST highlight the link of the section in view (IntersectionObserver), as a
  progressive enhancement, with `aria-current` on the active link.
- **FR-012**: It MUST offer the looks `pill` and `underline`, `sticky`, and alignment
  (start/center/end); on narrow screens the list scrolls horizontally.
- **FR-013**: Following a link MUST scroll smoothly unless the shopper prefers reduced motion; a
  sticky bar MUST NOT cover the target's top edge.
- **FR-014**: The editor MUST pick each item's anchor from the anchors on the page (or type one).

**Contact form (US6)**

- **FR-015**: A new block `cms.ContactForm`, owned by `cms`, MUST render a form from the fixed field
  set name, email, phone, company, subject, choice (a select with editor-defined options), message,
  privacy consent and marketing consent. E-mail, message and privacy consent are always shown and
  required; the others have show, label, placeholder and required settings.
- **FR-016**: The block MUST offer columns (1 or 2) with a per-field span, a field look preset
  (`boxed`, `underline`, `pill`), a label position (`above`, `hidden`), the submit button's look
  through the existing button look options (no link), and editable success and error messages. It
  inherits the colour scheme.
- **FR-017**: Submission MUST go storefront handler → backend public endpoint
  `POST /api/v1/storefront/cms/contact-form`, validated by a Zod contract in
  `packages/contracts`, rate limited, honeypot-protected, with the sales channel resolved per
  request.
- **FR-018**: The backend MUST validate independently of the block: e-mail (valid, ≤ 320), message
  (1–5 000 characters), privacy consent `true`; every other field has a length cap; single-line
  fields carry no line break.
- **FR-019**: The backend MUST send one e-mail per configured recipient through the platform mailer
  (`EmailMailerPort`), with Reply-To the submitter, composed in the channel's default language. It
  MUST store nothing: no entity, no admin list, and the submitted content kept out of the mailer's
  delivery record (fixed subject, no `meta`).
- **FR-020**: Recipients MUST be a CMS setting per sales channel, editable on the Settings screen,
  validated as e-mail addresses (at most 10), and never present in page data or any public read.
- **FR-021**: With marketing consent ticked and the newsletter module present, the storefront
  handler MUST subscribe the address through the existing public newsletter subscribe endpoint for
  the request's channel (source `cms-contact-form`); it MUST NOT import newsletter internals. The
  e-mail states the consent either way.
- **FR-022**: With `cms` off the endpoint MUST be refused by the module route gate and the
  storefront handler MUST answer 404.
- **FR-023**: A command-palette action MUST open the Settings screen where the recipients are
  edited (Principle XVI).

**Newsletter sign-up (US7)**

- **FR-024**: Each `newsletter.Signup` topic's `tagCode` MUST be picked from the newsletter tags
  (admin list); the stored value stays the free-text code, and a code the list lacks stays
  selectable; the field falls back to text when the list cannot load.
- **FR-025**: `newsletter.Signup` MUST accept up to 10 `attributes`, each naming a newsletter custom
  field (key and type, picked in the editor), with an optional label override, placeholder and
  required flag; rendered by type (boolean → checkbox; text/number/date → input).
- **FR-026**: The storefront handler MUST pass attribute values as `customFields`, refuse a missing
  required attribute with reason `fields`, and the newsletter module MUST store only values whose
  type matches the field definition.

**Cross-cutting**

- **FR-027**: Every new field label and option ships in `en` and `pl` in the declaring module's
  bundle; every new shopper-visible default string is translated through the storefront message
  catalogue.
- **FR-028**: Module documentation (EN + PL mirror, translation cache) and one changeset per
  meaning ship with each work package.

### Key Entities

- **Contact-form submission** — transient: validated, e-mailed, discarded. Not an entity.
- **Contact-form recipients** — a CMS setting (`cms.contact_form_recipients`, `string_list`), per
  sales channel.
- **Newsletter custom field / tag** — existing newsletter entities, read by the editor only.

## Success Criteria *(mandatory)*

- **SC-001**: Every acceptance scenario above has an automated test (Constitution III).
- **SC-002**: Every stored page renders byte-identically with the new options unset (parity tests
  green).
- **SC-003**: A corporate contact page (heading and lead, form, contact details, tabs with the
  newsletter sign-up) can be built from blocks alone in under 10 minutes by an editor following the
  module documentation.
- **SC-004**: A contact submission never writes a row other than the mailer's existing delivery
  record, and that record holds no submitted text.
- **SC-005**: No shopper-visible string introduced by this feature is English-only.

## Assumptions

- "Visually close" (owner) — presets and tokens only.
- The storefront is the reference Next.js storefront; a headless client calls the same backend
  endpoint with the same contract.
- The recipients are operators; their language is the sales channel's default language.
- Rate limiting is per client IP; behind the storefront the backend sees the shopper's IP only when
  the deployment trusts the storefront as a proxy (`TRUSTED_PROXY_*`), which the documentation says.
