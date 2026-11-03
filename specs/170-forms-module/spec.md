# Feature Specification: Forms — a form builder whose forms are placed on pages as Page Builder blocks

**Feature Branch**: `feat/170-forms-module` (spec directory `specs/170-forms-module/`)
**Created**: 2026-11-02
**Status**: Draft
**Input**: Owner brief (owner decisions final). A new domain module `forms`, inspired by the
feature set of established form-builder plugins: operators build reusable forms on their own admin
screen and place them on pages through the Page Builder as a block; shoppers' submissions are
stored as entries, notified by e-mail, protected against spam, and announced to integrators as a
domain event and a webhook. This specification covers **Phase 1 plus the event/webhook**; later
phases are listed under *Out of scope*.

## Context

`specs/169-page-builder-contact-form/` shipped `cms.ContactForm`: a fixed field set, e-mail only,
nothing stored, a honeypot, a per-address rate limit, recipients per sales channel kept out of page
data, a no-JavaScript fallback and an inline outcome with JavaScript. It answers "a contact page"
and nothing beyond it: an operator cannot add a field it does not foresee, cannot read past
submissions, cannot branch a form on an answer and cannot hand a submission to another system.

`newsletter` is the precedent for a module that contributes a Page Builder block from its own
manifest (`newsletter.Signup`, in the `forms` block category,
`packages/modules/newsletter/src/manifest.ts`) and for a stored row submitted on the storefront
with a nullable organisation (`NewsletterSubscriber`,
`packages/modules/newsletter/src/backend/entities/newsletter-subscriber.entity.ts`).

**Binding rules for every story** (owner):

- *Extend, don't narrow.* `cms.ContactForm` stays exactly as it is; converting it into a `forms`
  form is out of scope. Every stored page renders as before.
- *A form is a module resource.* It is built on the forms screen and reused across pages. The block
  only **picks** a form and sets block-level look options. No form definition lives in block
  properties.
- *Visually close.* Look options are presets and tokens (sizes S/M/L, colour schemes, existing
  button looks), never per-element pixel values or free colour pickers.
- *Generic.* No client, site, address, person or measured value in any tracked file.
- Every admin label ships in English and Polish; nothing a shopper sees is hard-coded English.

## Clarifications

### Session 2026-11-02

- Q: Should anonymising a customer account also erase that customer's form entries in Phase 1?
  → A: Yes — entries attributed to the account are deleted; anonymous entries sharing its e-mail
  are not matched (FR-047).
- Q: Should the `forms.entry.submitted` webhook payload include the submitted answers? → A: Only
  the answers of fields the operator marks "Share with integrations" (per field, off by default)
  (FR-064).

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Form** | A reusable, operator-built definition: its fields, layout, logic, messages, notifications and restrictions. Identified by a stable key and a name. |
| **Form version** | An immutable snapshot of a form's definition. Publishing creates a new version; entries point at the version they were submitted against. |
| **Working copy** | The editable state of a form on the forms screen. On a published form it is not visible to shoppers until it is published as the next version. |
| **Field** | One element of a form: an input (text, choice, consent…), a composite (address), a hidden value, or a layout element (content, section break). Every input field has a stable **field key** that survives across versions. |
| **Section** | A group of fields laid out in 1, 2 or 3 columns. A section can be shown or hidden by conditional logic as a whole. |
| **Condition group** | A set of conditions combined with AND or OR that decides whether a field or section is shown. |
| **Entry** | One accepted submission of a form: the answers, the form version, the sales channel, the language, the page, the submitter's attribution and its processing state. |
| **Submitter e-mail field** | The one e-mail field a form designates as the submitter's address, used as Reply-To and as the confirmation recipient. |
| **Form block** | The Page Builder block `forms.Form`, which renders one chosen form on a page. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Build a form and publish it (Priority: P1)

An operator opens **Forms** in the admin, creates a form, drags fields from a palette onto a canvas,
groups them into sections laid out in one, two or three columns, sets each field's label,
placeholder, help text, required flag, default and validation, sees a live preview, and publishes
it. Later they change a label and add a field; publishing creates a new version and the entries
already received stay readable exactly as they were submitted.

**Why this priority**: without a publishable form nothing else in the feature has a subject.

**Independent Test**: create a form with one field of every type across a one-column and a
three-column section, publish it, edit it, publish again; the form has two versions, the second is
the one served, and the first is still readable.

**Acceptance Scenarios**:

1. **Given** an operator with the permission to manage forms, **When** they create a form, **Then**
   it starts as a draft with a name, a stable key, a default language and an empty canvas.
2. **Given** the builder, **When** the operator drags a field type into a section or reorders
   fields and sections, **Then** the canvas and the live preview update; the same reordering is
   possible with the keyboard alone.
3. **Given** a section, **When** the operator chooses 1, 2 or 3 columns and sets a field's width
   within those columns, **Then** the preview lays the fields out accordingly and collapses to a
   single column on a narrow screen.
4. **Given** a draft whose definition is invalid (for example two fields with the same key, a
   choice field without options, a condition referencing a removed field), **When** the operator
   publishes, **Then** publishing is refused with the reasons listed next to the offending fields.
5. **Given** a published form, **When** the operator edits it, **Then** shoppers keep seeing the
   published version until the operator publishes again, which creates the next version.
6. **Given** entries submitted against version 1, **When** version 2 renames a label and removes a
   field, **Then** an entry from version 1 still shows its original labels and the removed field's
   answer.
7. **Given** a published form, **When** the operator closes it, **Then** the form block shows the
   form's "closed" message instead of the form and the server refuses submissions to it; reopening
   restores it.
8. **Given** the command palette (⌘K / CTRL+K), **When** an operator with the right permission
   searches for forms, **Then** "Open forms", "New form" and "Open form entries" are offered.

---

### User Story 2 — Place a form on a page and receive submissions (Priority: P1)

An editor adds the **Form** block to a page in the Page Builder, picks a published form from a list,
chooses a look (field look, size, button look, alignment) and publishes the page. A shopper fills
in the form on the storefront and submits it; the entry is stored, the shop is notified, the
shopper sees the confirmation.

**Why this priority**: the headline of the feature; with Story 1 it is the minimum viable product.

**Independent Test**: place a published form on a page, submit it with JavaScript on and off; an
entry exists for each submission with the right form version, sales channel, language and page.

**Acceptance Scenarios**:

1. **Given** the Page Builder, **When** the editor opens the block palette, **Then** the Form block
   is offered in the *Forms* category.
2. **Given** the Form block's settings, **When** the editor opens the form picker, **Then** it lists
   the forms (name, status) the editor may see, and offers a shortcut **Create a new form** that
   opens the forms screen; after returning, the new form can be picked without reloading the
   editor.
3. **Given** a block whose form is a draft, closed, deleted, or not visible to the editor, **When**
   the canvas renders, **Then** the editor sees a note saying why; **When** the storefront renders,
   **Then** a draft or deleted form contributes nothing and a closed form shows its closed message.
4. **Given** a published form on a page, **When** the shopper submits valid answers, **Then** an
   entry is stored with status *new* and the confirmation configured on the form is applied.
5. **Given** JavaScript off, **When** the shopper submits, **Then** the browser returns to the same
   page, in the same language, scrolled to the block, showing the outcome; on a validation error
   the shopper's answers are shown again with the errors.
6. **Given** JavaScript on, **When** the shopper submits, **Then** the outcome is shown inline
   without a page reload and the typed answers are kept on error.
7. **Given** a page holding two Form blocks (two forms, or the same form twice), **When** one is
   submitted, **Then** only that block shows the outcome.
8. **Given** the confirmation type *message*, *redirect to a URL* or *go to a CMS page*, **When** a
   submission is accepted, **Then** the shopper sees the message, is redirected to the URL, or is
   taken to the chosen page in their language; when the chosen page cannot be shown (missing, or
   the CMS module is off) the message is shown instead.
9. **Given** the block's look options, **When** the editor changes them, **Then** only presets are
   offered (field look boxed / underline / pill, size S / M / L, the existing button looks,
   alignment, show or hide the form's title and description); the block inherits the page's colour
   scheme. No pixel or colour field is offered.

---

### User Story 3 — Server-side validation and conditional logic (Priority: P1)

An operator makes a "Company name" field appear only when "I am buying as" equals "a company", and
a whole "Delivery address" section appear only when "Delivery needed" is ticked and the country is
not empty. The shopper's form reacts as they type; the server applies the same rules to whatever it
receives.

**Why this priority**: conditional logic is the core difference between a form builder and a fixed
contact form, and server-side authority is what makes stored entries trustworthy.

**Independent Test**: post submissions directly to the server, bypassing the storefront, that
violate each rule (missing required visible field, value for a hidden field, out-of-range number,
unknown option, too-long text); each is refused or corrected exactly as specified.

**Acceptance Scenarios**:

1. **Given** a field with a condition group, **When** the operator sets conditions combined with
   AND or with OR using equals, not equals, greater than, less than, contains, does not contain,
   is empty or is not empty, **Then** the preview shows or hides the field as the conditions
   change.
2. **Given** a section with a condition group, **When** its conditions are not met, **Then** the
   whole section and every field in it is hidden.
3. **Given** a required field that is conditionally hidden, **When** the form is submitted, **Then**
   the field is not required and any value sent for it is discarded, not stored.
4. **Given** a submission that omits a required visible field, sends an option that is not on the
   list, exceeds a length, falls outside a numeric or date range, or fails a pattern preset,
   **When** it reaches the server, **Then** it is refused with a per-field error whatever the
   storefront did, and nothing is stored.
5. **Given** a submission that names a field the form does not have, **When** it reaches the
   server, **Then** the unknown value is ignored.
6. **Given** a condition that depends on a field that is itself hidden, **When** conditions are
   evaluated, **Then** the hidden field counts as empty.
7. **Given** a condition graph in which a field's visibility depends, directly or indirectly, on
   itself, **When** the operator publishes, **Then** publishing is refused.

---

### User Story 4 — Read and process entries (Priority: P1)

A shop employee opens **Form entries**, filters by form, status, date range and sales channel,
searches for an e-mail address, opens an entry, reads it, adds an internal note, marks it closed or
as spam, and exports the filtered list as CSV for a spreadsheet.

**Why this priority**: entries that cannot be read are worth nothing; it is what distinguishes this
module from `cms.ContactForm`.

**Independent Test**: seed entries across two forms, two channels and all statuses; every filter,
the search, each status change, a note and the CSV export behave as specified, and each change is
recorded in the audit log.

**Acceptance Scenarios**:

1. **Given** entries, **When** the employee filters by form, status, submission date range and
   sales channel and searches free text, **Then** the list shows only matching entries, newest
   first, paginated.
2. **Given** an entry with status *new*, **When** the employee opens its detail, **Then** it is
   shown with the labels of the version it was submitted against, the page it came from, the
   language, the channel, the submission time, the consents with the text shown at the time, and
   its attribution; the entry becomes *read*.
3. **Given** an entry, **When** the employee changes its status (new, read, closed, spam) or adds
   an internal note, **Then** the change is saved, attributed to them in the audit log, and can be
   undone where the platform offers undo.
4. **Given** a filtered list, **When** the employee exports it, **Then** they receive a CSV of the
   matching entries with one column per field key across all versions of the form, metadata
   columns, and values that a spreadsheet cannot execute as formulas.
5. **Given** an employee without the permission to read entries, **When** they open the entries
   screen or its address directly, **Then** they are refused, and the palette does not offer it.
6. **Given** an employee whose admin scope is limited to a set of organisations, **When** they open
   the list, **Then** they see only entries attributed to those organisations (see *Tenancy*).
7. **Given** the employee deletes an entry (or a selection of entries), **When** they confirm,
   **Then** the entries are gone and no longer appear in the list, the export or the detail view.

---

### User Story 5 — E-mail notifications (Priority: P1)

The shop receives an e-mail for each entry at the addresses configured on the form, with a
different list for a particular sales channel when the operator sets one; replying to it answers
the shopper. The shopper optionally receives a confirmation e-mail.

**Why this priority**: most operators process submissions from their inbox; a form without a
notification is silently ignored.

**Independent Test**: submit a form whose recipients have a channel override; each configured
recipient of that channel receives the notification with Reply-To the submitter's address; with
confirmation on, the submitter receives one confirmation.

**Acceptance Scenarios**:

1. **Given** a form with recipients and a channel-specific override, **When** an entry is accepted
   on that channel, **Then** each override recipient receives one notification listing the visible
   answers, the form name and the page, with Reply-To set to the submitter e-mail field's value
   when there is one; on any other channel the form's default recipients receive it.
2. **Given** a form with no recipients for the channel, **When** an entry is accepted, **Then** the
   entry is stored and no shop notification is sent; the forms screen warns that the form has no
   recipients.
3. **Given** confirmation e-mail on and a submitter e-mail field answered, **When** an entry is
   accepted, **Then** the submitter receives one confirmation in the language of the page they
   used, with the operator's subject and text and, if the operator chose so, a summary of their
   answers.
4. **Given** any client reads page data or the public form definition, **When** the response is
   inspected, **Then** no recipient address, internal note or secret appears in it.
5. **Given** the mail transport fails, **When** an entry is accepted, **Then** the entry is still
   stored, the shopper still sees the confirmation, and the failed delivery is visible to the
   operator in the existing delivery records.
6. **Given** an entry flagged as spam, **When** it is stored, **Then** no notification and no
   confirmation is sent.

---

### User Story 6 — Spam protection and restrictions (Priority: P2)

An operator turns on a CAPTCHA for a public form, limits it to 500 entries, opens it from the first
to the last day of a campaign, and makes another form available to signed-in customers only.

**Why this priority**: stored entries and outgoing e-mail make an unprotected form an abuse target;
it is P2 only because a honeypot and a rate limit (part of Story 2's baseline) already stop the
common case.

**Independent Test**: for each protection, submit a request that violates it directly to the
server and check the outcome; with each restriction lifted the same submission is accepted.

**Acceptance Scenarios**:

1. **Given** a bot fills the hidden honeypot field, **When** it submits, **Then** it is answered as
   if accepted, nothing is stored and nothing is sent.
2. **Given** one client address exceeds the submission rate limit, **When** it submits again,
   **Then** it is refused with a "too many attempts" outcome, translated.
3. **Given** a CAPTCHA provider configured by the operator and the form requiring CAPTCHA, **When**
   a submission arrives without a valid CAPTCHA response, **Then** it is refused; with a valid one
   it is accepted; the provider's widget is loaded only on pages holding such a form.
4. **Given** a form requiring CAPTCHA while no provider is configured, **When** the operator views
   the form, **Then** the builder warns that CAPTCHA is not active.
5. **Given** a form with a maximum number of entries, **When** that number of non-spam entries is
   reached, **Then** the block shows the closed message and the server refuses further
   submissions.
6. **Given** an availability window, **When** the current time is before its start or after its
   end, **Then** the block shows the corresponding "not yet open" or "closed" message and the
   server refuses submissions.
7. **Given** a form for signed-in customers only, **When** a guest views it, **Then** the block
   shows a sign-in prompt instead of the form, and the server refuses a guest submission.

---

### User Story 7 — Forms in the shopper's language (Priority: P2)

An operator writes the form in the default language and translates every label, placeholder, help
text, option, message and e-mail text into each storefront language. A shopper on the Polish
storefront sees the Polish form; a language with no translation shows the default language.

**Why this priority**: a multilingual storefront cannot use a form that speaks one language, but a
single-language deployment gets full value from Stories 1–6 alone.

**Independent Test**: translate a form into one of two storefront languages; render it in both and
submit in both; the shopper-facing text, validation messages, confirmation and confirmation e-mail
follow the page's language, and the untranslated language falls back to the default.

**Acceptance Scenarios**:

1. **Given** a form, **When** the operator switches the builder's content language (in the
   builder's header, shared by the *Fields*, *Settings* and *Notifications* tabs) to another
   storefront language, **Then** they edit only the text of that language, each in its own place
   in the builder; structure, logic and validation are shared by every language and are locked
   there, with a note that they are edited in the default language.
2. **Given** a text left untranslated, **When** the storefront renders that language, **Then** the
   form's default-language text is shown; in the builder that text's empty input shows the
   default-language text as its placeholder, and the language switch marks the language as
   incomplete with the number of missing texts and a way to go to the first one.
   *(2026-11-03 owner review: the former *Translations* tab was replaced by this in-builder
   language switch.)*
3. **Given** validation errors, **When** they are shown to a shopper, **Then** built-in messages
   (required, invalid e-mail, too long, out of range…) are in the shopper's language, and an
   operator-written message overrides the built-in one where the operator set it.
4. **Given** the country field, **When** it renders, **Then** country names are in the shopper's
   language.
5. **Given** the admin screens, **When** an operator uses them in English or Polish, **Then** every
   label is translated.

---

### User Story 8 — Integrations: domain event and webhook (Priority: P3)

An integrator subscribes a webhook to **Form entry submitted** and receives a notification each
time an entry is accepted, enough to fetch and process it in their own system.

**Why this priority**: it opens the module to integrations and to the Phase 2 actions, but no
operator journey in Phase 1 depends on it.

**Independent Test**: subscribe a webhook to the event, submit a form, and check the delivered
payload against the contract; with the forms module off, the event type is not offered.

**Acceptance Scenarios**:

1. **Given** the webhooks screen, **When** an operator creates a subscription, **Then**
   `forms.entry.submitted` is offered among the event types while the forms module is present.
2. **Given** an accepted, non-spam entry, **When** it is stored, **Then** the domain event
   `forms.entry.submitted` is published once and a subscribed webhook receives the payload
   described in FR-064.
3. **Given** an entry flagged as spam or a honeypot submission, **When** it is handled, **Then** no
   event is published.
4. **Given** the forms module off, **When** the webhooks screen lists event types, **Then**
   `forms.entry.submitted` is not offered and no such event is delivered.

---

### User Story 9 — Retention (Priority: P3)

An operator sets a form to delete its entries automatically 90 days after submission.

**Why this priority**: data minimisation is a legal expectation for personal data, but manual
deletion (Story 4) covers it until volumes grow.

**Independent Test**: create entries older and newer than the retention period, run the retention
job, and check that only the older ones are gone.

**Acceptance Scenarios**:

1. **Given** a retention period of N days on a form, **When** the retention job runs, **Then**
   entries older than N days are deleted, together with their notes.
2. **Given** no retention period, **When** the job runs, **Then** the form's entries are kept.
3. **Given** the forms module off, **When** the retention time comes, **Then** nothing is deleted;
   the job resumes when the module is switched back on.

---

### User Story 10 — Switching the module off (Priority: P2)

An operator switches **Forms** off on the modules screen. The block disappears from the Page
Builder, pages that hold it render without it, the admin screens and actions vanish, submissions
are refused and the retention job stops. Switching it back on restores everything with no data
lost.

**Why this priority**: required of every operator-toggleable module (Principle XVII).

**Independent Test**: with stored forms, entries and pages holding the block, switch the module
off and on; check every surface in both states.

**Acceptance Scenarios**:

1. **Given** the module off, **When** an editor opens the Page Builder, **Then** the Form block is
   not offered, and existing blocks on the canvas show a note that the module is off.
2. **Given** the module off, **When** a shopper opens a page holding a Form block, **Then** the
   block contributes nothing to the page.
3. **Given** the module off, **When** any client calls a forms endpoint (admin, public or storefront
   handler), **Then** it is refused as every switched-off module's routes are.
4. **Given** the module off, **When** an operator looks for Forms in the sidebar, palette, settings
   or webhooks event list, **Then** it is not there.
5. **Given** the module switched back on, **When** anyone uses it, **Then** forms, versions,
   entries, notes, settings and pages holding the block are exactly as they were.
6. **Given** the CMS module off and Forms on, **When** an operator uses the forms and entries
   screens, **Then** they work; only placement on pages is unavailable.

---

### User Story 11 — Operator documentation (Priority: P3)

An operator reads the module's documentation in English or Polish to build a form, place it, set
notifications, CAPTCHA and retention, and process entries.

**Acceptance Scenarios**:

1. **Given** the documentation site, **When** an operator opens the Forms page in either language,
   **Then** it covers building, placing, translating, notifications, spam protection,
   restrictions, entries, export, retention, the webhook event and what switching the module off
   does.

### Edge Cases

- **Editing while shoppers fill in an old version.** A submission is validated against the form's
  currently published version and records that version; when the change makes it invalid the
  shopper sees the per-field errors and can correct them.
- **The same form placed twice on a page**: each instance's outcome, answers and errors are its own.
- **A form block on a page of a channel where the form has no recipients**: the entry is stored, no
  notification is sent (Story 5, scenario 2).
- **A hidden field filled from a URL parameter that is missing, too long or contains markup**: the
  stored value is empty or truncated to the field's limit, and is always stored and shown as plain
  text, never interpreted.
- **A submitter e-mail field hidden by a condition**: no Reply-To and no confirmation e-mail.
- **A field deleted from the working copy that a condition still references**: the reference is
  shown as broken in the builder and publishing is refused (Story 3).
- **Retention shortened on a form with old entries**: the next retention run deletes the entries
  now beyond the period; the builder warns before saving how many entries that will delete.
- **A form deleted while pages still hold blocks for it**: the storefront renders nothing for those
  blocks; the editor shows "form not found" with a shortcut to pick another.
- **A customer signed in on one browser tab and signed out on another**: attribution is taken from
  the session at the moment the server accepts the submission.
- **A customer account later deleted or anonymised**: its attributed entries are deleted (FR-047);
  anonymous entries carrying the same e-mail address stay until the operator deletes them.
- **Concurrent edits of one form by two operators**: the second save is refused with a "changed by
  someone else" message instead of silently overwriting.
- **Very large input**: a submission above the size limit is refused before validation, with the
  generic error outcome.
- **Mail queued while the module is switched off**: notifications already handed to the mail
  infrastructure are delivered by it; no new ones are created while the module is off.

## Requirements *(mandatory)*

### Functional Requirements

**Module and placement**

- **FR-001**: The capability MUST be a new, operator-toggleable, deactivatable domain module
  `forms` that owns forms, form versions, entries and entry notes.
- **FR-002**: The module MUST NOT require the CMS module to be present. It MUST contribute the
  Page Builder block `forms.Form` in the existing *Forms* block category from its own declaration,
  as `newsletter` contributes `newsletter.Signup`; while either `forms` or `cms` is absent the block
  is not offered and not rendered.
- **FR-003**: The block's properties MUST hold only a reference to a form and block-level look
  presets. They MUST NOT hold fields, logic, recipients, messages or any other part of a form.
- **FR-004**: The block's form picker MUST list the forms visible to the editor (name and status)
  and offer a **Create a new form** shortcut that opens the forms screen; a form created there
  MUST become pickable without reloading the editor. An editor without the permission to view
  forms MUST see an explanatory note instead of the list.
- **FR-005**: The block's look options MUST be presets only: field look (boxed, underline, pill),
  size (S, M, L), the submit button's look from the existing button look options, alignment, and
  whether to show the form's title and description. It MUST inherit the page's colour scheme.
- **FR-006**: `cms.ContactForm` MUST remain unchanged in behaviour and markup.

**Form definition and versions**

- **FR-007**: A form MUST have a name, a stable key unique among forms, a default language, a
  status, and a definition made of sections and fields. The definition MUST be described by a
  versioned, shared contract that the admin, the storefront and the server all validate against.
- **FR-008**: Form statuses MUST be *draft* (never published, not available to shoppers),
  *published* (available) and *closed* (published before, not accepting submissions, shows its
  closed message). A closed form MUST be reopenable.
- **FR-009**: Publishing MUST create a new immutable version from the working copy; shoppers MUST
  be served the latest published version only. Editing a published form MUST NOT change what
  shoppers see until the next publish.
- **FR-010**: Every entry MUST record the version it was accepted against, and the entry detail
  and export MUST present an entry with that version's labels and options.
- **FR-011**: Publishing MUST be refused, with the reasons attached to the offending elements,
  when the definition is invalid: duplicate or missing field keys, a choice field without options,
  a condition referencing a field that does not exist, a cyclic condition, more than one submitter
  e-mail field, invalid validation bounds (minimum above maximum), or a redirect URL that is not a
  valid web address.
- **FR-012**: A field's key MUST stay the same across versions unless the operator changes it
  explicitly, so that exports and integrations map answers consistently.
- **FR-013**: A form without entries MAY be deleted outright; deleting a form with entries MUST
  require an explicit confirmation stating that its entries will be deleted too. Concurrent saves
  of one form MUST be detected and the later one refused.
- **FR-014**: A form MUST be duplicable as a new draft.

**Builder**

- **FR-015**: The forms screen MUST let an operator add fields from a palette by drag and drop,
  reorder fields within and between sections, reorder sections, and do all of the above with the
  keyboard.
- **FR-016**: A section MUST be laid out in 1, 2 or 3 columns; a field MUST take a width in those
  columns (one column up to the full row). On narrow screens the storefront MUST stack fields in
  one column.
- **FR-017**: The builder MUST show a live preview that renders the form as the storefront would,
  including conditional logic evaluated against values typed in the preview.
- **FR-018**: The builder MUST warn (without refusing to publish) when a form has no recipients,
  requires CAPTCHA without a configured provider, or has untranslated texts in a storefront
  language.

**Field types**

- **FR-019**: The module MUST offer these field types: single-line text, e-mail, phone, number,
  multi-line text, select (drop-down), radio buttons, checkbox group, single checkbox, date/time,
  country, address, hidden, content (formatted text), section break, privacy consent, marketing
  consent and terms acceptance.
- **FR-020**: Every input field MUST have a label, optional placeholder, optional help text, a
  required flag, an optional default value and a width; content and section-break elements carry
  their own text only.
- **FR-021**: Validation options MUST be: minimum and maximum length for text fields; minimum,
  maximum and step for numbers; earliest and latest date for date/time; minimum and maximum number
  of selected options for a checkbox group; and, for single-line text, a pattern chosen from
  presets (digits only, letters only, letters and digits, web address). A free-form pattern MUST
  NOT be offered in this phase. An operator MAY override each built-in error message per field.
- **FR-022**: Choice fields (select, radio, checkbox group) MUST have an ordered list of options,
  each with a stable value and a translatable label.
- **FR-023**: The date/time field MUST support the modes date, time, and date with time.
- **FR-024**: The country field MUST offer the countries' names in the shopper's language and MAY
  be restricted by the operator to a subset of countries.
- **FR-025**: The address field MUST be a composite of street and number, additional line, postal
  code, city and country, each part with its own label and required flag, stored as one answer with
  named parts.
- **FR-026**: The hidden field MUST take either a static value set by the operator or a value from
  the page context: the page's address, the page's title, the value of a named URL query
  parameter, or the referring address. Its value MUST be length-capped and treated as plain text.
- **FR-027**: The e-mail field MUST be validated as an e-mail address; exactly zero or one e-mail
  field per form MAY be designated the submitter e-mail field.
- **FR-028**: The phone field MUST accept international phone numbers (digits with an optional
  leading plus and common separators) and refuse anything else.
- **FR-029**: The privacy consent, marketing consent and terms acceptance fields MUST each render a
  checkbox with formatted text that may contain links. An entry MUST record whether each was
  given and the exact text shown, so the consent can be proven later. Privacy consent and terms
  acceptance, when placed and visible, MUST be required; marketing consent MUST never be required
  and MUST never be pre-ticked.

**Conditional logic**

- **FR-030**: A field or a section MAY carry a visibility rule made of condition groups; within a
  group conditions combine with AND or with OR as the operator chooses, and groups combine with
  the opposite connective, so that "(A and B) or C" is expressible.
- **FR-031**: Conditions MUST support the operators equals, not equals, greater than, less than,
  contains, does not contain, is empty and is not empty, each offered only where it makes sense for
  the referenced field's type.
- **FR-032**: The storefront and the server MUST evaluate visibility identically. A field hidden by
  its rule or by its section's rule MUST NOT be required, its submitted value MUST be discarded and
  not stored, and it MUST count as empty in other conditions.
- **FR-033**: Cyclic visibility dependencies MUST be refused at publish (FR-011).

**Submission and validation**

- **FR-034**: The server MUST validate every submission against the published version's
  definition and visibility rules independently of the client, and refuse it with per-field error
  codes and translated messages when invalid. Nothing is stored for a refused submission.
- **FR-035**: The server MUST resolve the sales channel and the language of each submission from
  the request, as for every storefront request, and MUST refuse a submission for which no channel
  can be resolved.
- **FR-036**: Every answer MUST have a maximum length; single-line answers MUST carry no line
  break; the whole submission MUST have a size limit.
- **FR-037**: The storefront MUST work without JavaScript: the form posts to the storefront, which
  returns the shopper to the same page, language and block showing the outcome and, on error, the
  submitted answers and errors. With JavaScript the outcome MUST be shown inline. The outcome MUST
  be addressed to one block instance so two forms on one page never show each other's outcome.
- **FR-038**: After acceptance the confirmation configured on the form MUST be applied: a
  formatted message, a redirect to a web address, or a CMS page in the shopper's language (falling
  back to the message when the page cannot be shown).
- **FR-039**: A headless client MUST be able to read the public definition of a published form and
  submit to it through the same public contract the reference storefront uses.

**Spam protection and restrictions**

- **FR-040**: Every form MUST carry a honeypot field; a submission that fills it MUST be answered
  as accepted while nothing is stored, sent or published.
- **FR-041**: Submissions MUST be rate limited per client address, following the approach of
  `cms.ContactForm`; an exceeded limit MUST yield a translated "too many attempts" outcome.
- **FR-042**: The operator MUST be able to configure one CAPTCHA provider for the deployment —
  Cloudflare Turnstile or hCaptcha — with its public site key and its secret key stored as a
  secret; each form MUST be able to require CAPTCHA. While required and configured, the server
  MUST refuse a submission without a CAPTCHA response the provider verifies, and MUST refuse it
  (with a retryable error outcome) when the provider cannot be reached. The provider's script MUST
  be loaded only on pages that render a form requiring it.
- **FR-043**: A form MAY set a maximum number of entries (non-spam entries count), an availability
  window (from, to, either open-ended) and "signed-in customers only". Each restriction MUST be
  enforced by the server and reflected by the block (closed, not-yet-open or sign-in message, each
  operator-editable and translatable, with translated defaults).

**Entries and tenancy**

- **FR-044**: An accepted submission MUST be stored as an entry holding the answers to visible
  fields, the form and version, the sales channel it was submitted on, the language, the page
  address, the submission time, the consents with their shown texts, and the attribution of
  FR-045.
- **FR-045**: Attribution MUST follow the newsletter-subscriber precedent exactly: when the
  submitter is a signed-in customer, the entry records their customer account and that account's
  organisation, stamped by the server at the write from the session and never from the request
  body; an anonymous entry records neither. An entry naming an account MUST name an organisation;
  an entry naming none carries no organisation. Attribution is never derived from a typed e-mail
  address.
- **FR-046**: Entry reads in the admin MUST pass through the platform's tenancy guard: an admin
  scoped to a set of organisations sees only entries attributed to those organisations; anonymous
  entries are visible only to admins with unrestricted scope. An out-of-scope entry MUST be
  indistinguishable from one that does not exist. **The architect's Principle XI review of this
  ownership rule (classification, the nullable organisation, the attribution constraint, the
  scoped-admin answer) MUST be recorded in the plan or research before implementation.**
- **FR-047**: When a customer account is deleted or anonymised, the entries attributed to that
  account MUST be deleted, with their notes, in the same lifecycle step and without the module
  importing the accounts module's internals. Anonymous entries that merely share the account's
  e-mail address are not matched; the operator documentation MUST say so and point to deleting
  them by hand. While the forms module is off, the deletion MUST still reach its entries once the
  module is next present, so that no attributed entry outlives the anonymisation.
- **FR-048**: Entry statuses MUST be *new*, *read*, *closed* and *spam*; opening an entry's detail
  MUST move it from *new* to *read*; an employee MUST be able to set any status, including back to
  *new*.
- **FR-049**: An employee MUST be able to add internal notes to an entry (text, author, time).
  Notes MUST never be shown to shoppers or sent in any e-mail or event.
- **FR-050**: The entries list MUST filter by form, status, submission date range and sales channel,
  search free text across the submitter e-mail and text answers, sort newest first and paginate.
- **FR-051**: An employee MUST be able to delete one entry or a selection of entries.
- **FR-052**: An employee MUST be able to export the filtered entries as CSV with metadata columns
  (entry id, form, version, status, channel, language, submitted at, page) and one column per field
  key across all versions; values MUST be neutralised against spreadsheet formula execution. Large
  exports MUST not block the admin (the plan decides whether the existing import/export
  infrastructure is reused).
- **FR-053**: Every admin and domain write — form create, edit, publish, close, reopen, duplicate,
  delete; entry status change, note, deletion, export; settings — MUST run through the Command Bus
  so it is audited uniformly. Audit records MUST NOT copy submitted answers.
- **FR-054**: A form MAY set a retention period in days; a background job MUST delete entries older
  than it (with their notes) and MUST NOT run while the module is off.
- **FR-055**: Submitted answers MUST be stored only in the entry: e-mail delivery records, audit
  records, logs and event payloads MUST NOT hold copies of the answers beyond what FR-057 and
  FR-064 state, so that deleting an entry deletes its data.

**Notifications**

- **FR-056**: A form MUST have a list of shop notification recipients (at most 10 e-mail addresses)
  and MAY have a different list per sales channel, which replaces the default list on that channel.
  Recipients MUST never appear in page data, the public form definition or any public read.
- **FR-057**: For each accepted, non-spam entry the shop recipients of the entry's channel MUST
  receive a notification through the platform's existing mail infrastructure, listing the visible
  answers, the form name and the page, with Reply-To set to the submitter e-mail answer when
  present, composed in the channel's default language. The delivery record MUST NOT hold the
  answers.
- **FR-058**: A form MAY enable a confirmation e-mail to the submitter e-mail answer, with an
  operator-written, translatable subject and text and an optional summary of the answers, sent in
  the language of the submission. It MUST be sent at most once per entry and never for spam.
- **FR-059**: A mail failure MUST NOT fail the submission; it MUST be visible in the existing
  delivery records.

**Configuration, admin surfaces and discoverability**

- **FR-060**: The module MUST register its admin permissions per the permissions convention, at
  least: view forms (`forms:read`), manage forms (`forms:write`), view entries
  (`forms:entries_read`), process and delete entries (`forms:entries_write`) and export entries
  (`forms:entries_export`), each labelled in English and Polish.
- **FR-061**: The module MUST be reachable from the command palette with at least "Open forms",
  "New form" and "Open form entries", each gated by the permission of its target, and from a
  sidebar entry.
- **FR-062**: Deployment-wide configuration — the activation control, the CAPTCHA provider, site
  key and secret key — MUST be Settings of the module, the secret key stored as a secret.
- **FR-063**: A change to a published form or its status MUST reach the storefront within the
  platform's usual cache-invalidation delay, across every running instance.

**Event and webhook**

- **FR-064**: For each accepted, non-spam entry the module MUST publish the domain event
  `forms.entry.submitted` and contribute it as a webhook event type. The webhook payload MUST carry:
  event type, entry id, form id, form key, form version, sales channel id, organisation id (or
  none), language, page address and submission time, and MUST NOT carry internal notes, recipients
  or consent texts. It MUST carry, keyed by field key, the answers of exactly those visible fields
  the operator marked **Share with integrations** in the form builder; the flag is per field, off
  by default, recorded in the form version, and applies to the version the entry was submitted
  against. With no field marked, the payload carries no answers, and the integrator reads the entry
  through the authenticated admin API (`forms:entries_read`).
- **FR-065**: The event type MUST be offered on the webhooks screen only while the forms module is
  present, and no event of the type is delivered while it is off.

**Off-state**

- **FR-066**: While the module is off it MUST behave as if never installed: no block offered or
  rendered, every forms route refused, the storefront handler answering not-found, the retention
  job and any timers stopped, no sidebar entry, palette action, settings group or webhook event
  type. Switching off MUST drop no data and switching back on MUST restore everything.

**Internationalisation, accessibility, documentation**

- **FR-067**: Every admin label MUST ship in English and Polish. Every shopper-visible built-in
  string (validation messages, button default, outcomes, closed / not-yet-open / sign-in messages,
  CAPTCHA prompts) MUST be translated through the storefront's message catalogue, never hard-coded
  English.
- **FR-068**: Every operator-written text of a form (title, description, labels, placeholders, help
  texts, option labels, content blocks, consent texts, messages, confirmation, e-mail subject and
  text) MUST be translatable per storefront language, sharing one structure across languages and
  falling back to the form's default language, consistently with how Page Builder content is
  translated.
- **FR-069**: The rendered form MUST meet WCAG 2.2 AA: every input has a programmatic label
  (visually hidden labels only where the look requires it), required state and help text are
  exposed to assistive technology, errors are listed in a summary that is announced, focus moves to
  the first invalid field on a refused submission, every control is operable by keyboard, and
  colour is never the only error signal. The admin builder's drag and drop MUST have a keyboard
  alternative.
- **FR-070**: The module MUST ship operator documentation in English and Polish covering Story 11.

### Tenancy *(binding note for planning)*

The owner's ownership rule is: **an entry belongs to the sales channel it was submitted on**
(always set) **and to the submitter's organisation when the submitter is a signed-in customer**
(nullable otherwise), with the same "account implies organisation" attribution rule as
`NewsletterSubscriber`. A form itself is operator content, not tenant data. Principle XI forbids a
"no-organization" *scoping path* for transacting customers; an anonymous entry is not a transacting
customer's record, which is the same reasoning the newsletter precedent rests on. The plan MUST
record the architect's Principle XI review (entity classification, the nullable column, the
attribution constraint, the scoped-admin and cross-tenant tests) in `plan.md` or `research.md`;
FR-046 is the behaviour that review must confirm or amend.

### Key Entities

- **Form** — operator content: name, key, default language, status, working copy, current published
  version, restrictions (max entries, availability window, signed-in only, CAPTCHA required),
  retention period, notification settings (default recipients, per-channel recipients,
  confirmation e-mail), confirmation behaviour. Not tenant data.
- **Form version** — immutable snapshot of a form's definition and translations at publish, with a
  sequence number. Many per form.
- **Form definition** — sections (column count, visibility rule) holding fields (type, key, texts
  per language, required, default, validation, width, visibility rule, type-specific settings).
  Described by the shared contract.
- **Entry** — one accepted submission: form, version, sales channel, language, page, submitted at,
  answers by field key, consents with shown texts, status, customer account and organisation
  (nullable together, account implies organisation).
- **Entry note** — internal note on an entry: text, author, time.
- **Forms settings** — activation control, CAPTCHA provider, site key, secret key.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario and every functional requirement above traces to an
  automated test (Constitution III).
- **SC-002**: An operator following the documentation can build, translate into one more language,
  and place on a page a ten-field form with one conditional section in under 15 minutes.
- **SC-003**: 100 % of server-validation test cases that bypass the storefront (missing required
  visible field, value for a hidden field, unknown option, out-of-range value, over-long text,
  pattern mismatch) are refused or discarded exactly as specified.
- **SC-004**: A shopper can complete and submit a form with JavaScript disabled and with JavaScript
  enabled, on desktop and phone widths, and an automated accessibility audit of the rendered form
  reports no WCAG 2.2 AA violation.
- **SC-005**: Every stored page renders byte-identically to before the feature, `cms.ContactForm`
  included.
- **SC-006**: A published change to a form is visible on the storefront within one minute.
- **SC-007**: No recipient address, internal note or secret is present in any public response, and
  after an entry is deleted (manually or by retention) no copy of its answers remains in the
  module's data, delivery records, audit records or event payloads beyond what FR-064 permits.
- **SC-008**: With the module off, every surface listed in FR-066 is absent; switching it back on
  restores 100 % of forms, versions, entries and notes.
- **SC-009**: No shopper-visible or admin string introduced by this feature is English-only.

## Out of scope

**Phase 2 (later feature):** post-submit actions creating a CRM lead or opportunity, a task, or a
newsletter subscription (marketing consent is recorded in Phase 1 but does not subscribe anyone);
prefilling fields from the signed-in customer's account; product context on product pages ("ask
about this product"); multi-step forms; file uploads; calculated fields.

**Not planned:** payments in forms, quizzes and survey scoring, conversational (one question at a
time) forms, save and resume, PDF generation from an entry, creating posts or content from an
entry, user registration through a form, AI form generation. Converting `cms.ContactForm` into a
`forms` form. A customer-facing "my submissions" view.

## Assumptions

- **A-1 Permissions.** Five codes (FR-060) separate form authoring from reading personal data and
  from exporting it, because entries hold personal data and export is the riskiest read. The plan
  may rename them within the permissions convention but should keep the separation.
- **A-2 Recipients.** Per-form recipients with an optional per-channel replacement list (not a
  merge), at most 10 addresses, as in 169. Recipients are form configuration, not a Setting, because
  they differ per form. A form without recipients still stores entries.
- **A-3 Notification language.** The shop notification is composed in the channel's default
  language (as in 169); the confirmation e-mail follows the submission's language.
- **A-4 Honeypot submissions are discarded**, not stored as spam (as in 169), so a bot cannot fill
  the entries table. *Spam* is an employee's manual classification; a CAPTCHA failure is a refusal,
  not a stored entry.
- **A-5 CAPTCHA.** Both Turnstile and hCaptcha are supported, one active provider per deployment;
  verification is a server-side call to the provider, so no new runtime dependency is expected.
  The provider's widget is third-party content, which the documentation states for privacy
  notices. When required and the provider is unreachable, submissions are refused (fail closed).
- **A-6 Validation against the current version.** A submission is validated against the version
  published at the moment of acceptance, not the one the shopper loaded.
- **A-7 Translation model.** One shared structure per form with per-language texts, falling back to
  the form's default language — the shape Page Builder content uses. AI translation of form texts
  (feature 151's tool) is not part of this feature.
- **A-8 Pattern presets instead of free patterns.** A free-form pattern is a denial-of-service and
  usability risk and is not needed by the brief's use cases; presets cover them.
- **A-9 Country list.** The platform's existing country list and its translated names are used;
  restricting to a subset is per field.
- **A-10 Entry search** matches the submitter e-mail and text answers by substring; the plan decides
  how, within the existing infrastructure.
- **A-11 Form scope.** A form is not bound to sales channels; where it appears is decided by the
  pages it is placed on, and its entries carry the channel. Per-channel availability of a form is
  not required.
- **A-12 Default retention.** No retention period unless the operator sets one; the documentation
  recommends setting one.
- **A-13 Limits.** At most 100 fields per form, 200 options per choice field, 10 000 characters per
  multi-line answer, 1 000 per single-line answer and hidden value; the plan may adjust the numbers
  but not drop the limits.
- **A-14 Storefront handler path.** The reference storefront already reserves the top-level segment
  `forms` for `cms.ContactForm`'s handler (`/forms/contact`, feature 169). This module's storefront
  handler lives under the same segment without colliding with `/forms/contact`; the plan chooses
  the path.
- **A-15 Mail infrastructure.** Notifications go through the always-present platform mailer, so
  they do not depend on a switchable module; whether operator-editable templates from
  `transactional_emails` are used is a plan decision, with built-in translated defaults required
  either way.
- **A-16 Delete versus close.** Closing is the normal end of a form's life; deleting a form with
  entries is possible only with an explicit confirmation (FR-013).
- **A-17 Admin placement.** The forms and entries screens sit in the admin sidebar next to the
  content/marketing entries; the designer decides the exact place.
- **A-18 Dependencies.** The drag-and-drop library already used by the admin is reused; no new
  runtime dependency is expected (Principle IV). The plan's Complexity Tracking must justify any.
