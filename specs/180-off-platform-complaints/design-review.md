# Design review: feature 180, complaints without a platform order (storefront and admin UI)

**Feature**: `specs/180-off-platform-complaints/` | **Date**: 2026-11-13 | **Reviewer**: `endora-commerce-designer`
**Scope**: WP A-6 (admin, slice A), WP B-7 and B-9 (admin and storefront, slice B), and the designer
review that B-10 asks for. This is a review before implementation. It changes no spec, plan or task.
**Basis**: `spec.md`, `plan.md`, `research.md` (R-12 … R-19), `contracts/customer-api.md`,
`contracts/admin-api.md`, `.claude/skills/ux-laws/SKILL.md`, and the code as it stands at
`defd3e2e0`.

The document has two parts:

- **Part 1: findings.** These are problems in the spec, plan or contracts, numbered `D-n`. Each one
  says which artefact should change. The ones that need a spec, plan or contract change come first.
- **Part 2: recommendations.** This is the design for each surface, written so it can be built from
  directly. It does not need any artefact to change except where a finding says so.

---

## Part 1: findings

### Findings that need a spec, plan or contract change

**D-1. Clauses on every submission would also gate the statutory withdrawal (FR-B30, Clarification 3).**
As written, a consumer could not exercise a withdrawal (kind `return`, `consumerWithdrawal`) without
ticking the shop's clauses. Making a statutory right conditional on accepting terms is a legal risk.
It is also friction on a flow that has worked without clauses until now (Flow and Cognitive Load). A
second problem: a *personal-data notice* (one of the spec's own examples) is information to be
**shown**, not a consent to be **ticked**. A mandatory tick on it misrepresents the legal basis.
→ **Change**:
1. Give the clause an `appliesTo` (`return` | `complaint` | `both`) and optionally an origin scope
   (`any` | `off_platform`). This is the shape `return_reasons.applies_to` already has.
2. Give it a `mode`: `must_accept` (checkbox) or `inform` (shown, no checkbox, still stored with the
   case as shown).
3. Never render a `must_accept` clause on a consumer-withdrawal submission.

**Human (legal) decision required.** Affects FR-B30/B31, contracts admin B5 and customer C1/C3, and
research R-14.

**D-2. The initial status would e-mail twice at submission (FR-A30–A32).**
A case is created in the initial status (`new`). If an operator marks `new` as *notify the customer
on entry*, the customer gets the confirmation (FR-A10) **and** a status e-mail for the same event.
That breaks SC-003's one-e-mail-per-transition intent.
→ **Change**: treat the initial status like `authorized`/`rejected`. Refuse it in contract A2
(`dedicated_email_status`) and disable it in the UI with the reason "Covered by the confirmation
e-mail". Alternatively, define creation as *not* an entry in FR-A31. One of the two must be written
down.

**D-3. The customer list cannot show what FR-B36 asks for.**
FR-B36 says the customer's own **list** shows an off-platform case "with its products and purchase
data instead of an order reference". But `returnCaseSummarySchema` (`packages/contracts/src/returns.ts:162`)
carries no product or purchase field, and contract B1 only adds `offPlatform`. The list also shows no
order reference today (`storefront/app/(account)/returns/page.tsx:49-81`), so there is nothing to
replace.
→ **Change**: add `productLabel` (the first line's name plus "+N more", resolved at read) and
`purchaseDate` (nullable) to the summary. Otherwise, narrow FR-B36 to the case page. The admin row
inherits the summary, so `productLabel` also fixes D-4 for operators.

**D-4. A case has no human-readable identifier until it is authorized.**
Today:
- The list link text is `—` (`ReturnsList.tsx:237`, customer `returns/page.tsx:65`).
- The customer detail title is the generic "Return case" (`[id]/page.tsx:75`).
- The spec's e-mails identify a case only by kind, products and date (spec Assumptions).

An off-platform customer is the one most likely to phone in, and has no order number to quote either.
A link whose name is `—` also fails WCAG 2.4.4 (link purpose).
→ **Change (minimum)**: add a display reference derived from the id (for example the first 8 hex
characters, upper-cased, `#3F9A21C0`). Show it wherever `rmaNumber` is null: the list, the detail,
both e-mails, and the customer's success panel. Moving the RMA number to submission stays out of
scope, as the Assumptions say. **Human decision**: accept the derived reference, or leave it out.

**D-5. The settlement card exists only in `received`, but an outside settlement may involve no goods.**
`ReturnDetail.tsx:117` loads the prefill only when `statusCode === 'received'`. For *settled outside
the platform* (the customer was refunded in a shop, the distributor replaced it), nothing may ever be
shipped back. The operator would then have to walk the case through shipment states that never
happened just to reach the settlement.
→ **Change**: state in FR-B33a, R-19 and contract B4 from which statuses a `settled_outside`
settlement may be made. The recommendation is any non-terminal status after authorization. If the
answer is "only `received`", the spec should say so deliberately. **Human decision.**

**D-6. FR-B35 says the filter is "in the URL", but no filter on that list is.**
`ReturnsList.tsx:53-57` holds status, kind and RMA in component state only. Putting `origin` alone in
the URL would make one filter shareable and three not, which breaks the Law of Similarity: same-looking
controls should behave the same.
→ **Change**: either sync **all** list filters and the sort to the query string in B-7 (small, and
saved views keep working), or drop "and in the URL" from FR-B35. Recommendation: the former.

**D-7. "The settings screen says that no recipient is configured" (US1 scenario 2) cannot be built as specified.**
`returns.new_case_recipients` is edited on the generic `/settings` screen (`?group=returns`), which
renders no per-setting warnings.
→ **Change**: move the notice to a returns-owned screen. The recommendation is a one-line `Alert`
(`variant="warning"`) on `ReturnStatusesConfigPage`, the screen where operators configure e-mails:
"New-case e-mails go to nobody: no recipient is configured for {channel | any channel}", with a link
to `/settings?group=returns`. This needs a read of the effective setting, which the page can get
through the settings admin API it may already call. Otherwise, drop the clause from the scenario.

**D-8. The erased state needs a date, and attachments need to tell "erased" from "never sent".**
Contract B2 has `personalDataErased: boolean`. The data model has `personal_data_erased_at`. Without
the date the operator cannot answer "since when". After erasure the attachments list is empty, and
"No attachments" would mislead the operator into thinking the customer never sent proof.
→ **Change**: expose `personalDataErasedAt: isoDateTime.nullable()` instead of, or beside, the
boolean. The UI copy in R-8 below depends on it.

**D-9. A no-JavaScript submission over 30 MB loses everything the customer typed.**
R-13 refuses an oversized body *before reading it*. So the attempt cookie cannot be written: the
typed answers, the line descriptions and the purchase data are all lost, and the customer lands on an
empty form. This is the worst error peak in the flow (Peak-End Rule).
→ **Change (plan R-13)**: state the outcome and its copy explicitly. The refusal must still 303 to
the form with a reason (`too_large`) that renders: "Your files together were over 30 MB, so nothing
was sent. Please fill in the form again and attach fewer or smaller files; you can add more files
from the case page after submitting." Also consider one of these:
- (a) Render the no-JS form's file inputs **last** in document order. Text parts then precede file
  parts in the multipart body, and a streaming read could keep them.
- (b) Keep the per-file `<input type="file">` controls but say the total limit next to each.

The JavaScript path never hits this, because it uploads file by file (R-13).

**D-10. "The `ReturnReasonsPage` pattern" (plan, Constitution IX row) is too small for clauses.**
`ReturnReasonsPage.tsx:93-122` is a one-line inline "Label (EN)" add row with no edit and one
language. A clause has a label and up to 5 000 characters of text **per language**, a channel, a
weight and an active flag, and an edit bumps its revision.
→ **Change (plan wording, IX row and B-5)**: name the primitives the page actually needs. These are
`ModalDialog`, `ContentLanguageTabs`, `Textarea`, `SalesChannelPicker`, `ConfirmDialog`, `Checkbox`
and `ResponsiveTable`. See R-9 below.

**D-11. The success copy may promise an e-mail the operator has switched off (US2 scenario 1 vs FR-A11).**
"The page they land on says a confirmation was sent" contradicts a deactivated template. The
storefront cannot know the template's state.
→ **Change**: add `confirmationEmailEnabled: boolean` to `form-config` (C1) and word the panel by it.
Otherwise, make the spec's sentence conditional.

**D-12. The purchase-date "today" must come from the server.**
Rule 3 of C3 judges "not in the future" in `returns.time_zone`. The form's `max` attribute and its
client-side message must use the same day. Near midnight, the storefront server's time zone and the
shop's can disagree.
→ **Change**: add `today: isoDate` (in `returns.time_zone`) to `returnFormConfigSchema`.

**D-13. A status e-mail for the customer's own action (FR-A31 "whoever moved it").**
If a customer can cancel their own case and *cancelled* is marked notifying, they get an e-mail
telling them what they just did. That is noise that trains them to ignore case e-mails
(Signal-to-Noise).
→ **Change**: exclude customer-initiated transitions from the status e-mail, or record in the spec
that this is intended. **Human decision**; low stakes.

### Findings that need no artefact change (fix in implementation)

**D-14.** `storefront/app/(account)/returns/new/page.tsx:50` redirects to `/login?next=/returns/new`
and drops the query. A CMS link to the no-order form (`/returns/new?origin=elsewhere`) then lands a
signed-out customer on the order picker after login. Keep the full path and query in `next`.

**D-15.** `page.tsx:144`: a submission with no selected line silently 303s back to the same form,
with no message. The route handler that replaces the server action (R-13) must answer every refusal
with the error summary from R-2.6, on **both** paths.

**D-16.** `ReturnDetail.tsx:85` defaults *Visible to customer* to **on**. Until now nothing was sent
on a comment. With FR-A20, an internal note typed with the default settings becomes visible and, if
*Notify* is ticked, gets e-mailed. Recommendation: default to internal (off). **Human decision**,
because it changes the operator habit the screen has today.

**D-17.** The comment textarea at `ReturnDetail.tsx:663` has only a placeholder, no label (WCAG
1.3.1/3.3.2). Several cards there have hard-coded English titles ("Actions", "Returned items",
"Comments", "Back to returns"). WP A-6 and B-7 touch these blocks, so give them labels and move their
copy to `packages/modules/returns/i18n/{en,pl}.json` in the same change. FR-B41 and `i18n:hardcoded`
would otherwise flag the new strings next to the old ones.

**D-18.** The checkout's `NewAddressFields` (`components/checkout/AddressSection.tsx:66-131`) labels
its inputs with placeholders only, and uses a hard-coded `rgba(...)` focus shadow. Do **not** reuse
it for the ship-back address. Reuse `AddressForm`'s labelled markup instead (R-2.4).

---

## Part 2: recommendations by surface

Conventions used below: *(law)* names the UX law behind a decision. Storefront classes are the
account-area ones already in use (`b2b-auth__form`, `b2b-auth__field`, `b2b-auth__row`,
`b2b-auth__error`, `b2b-auth__notice`, `b2b-auth__success`, `b2b-account__table`) and the semantic
tokens only. There are no new colours and no hex values.

### R-1. Storefront entry point (`/returns/new`, step 1)

1. **One entry, two paths.** On `/returns`, rename *Start a new return* (`account.returns.startNew`,
   `returns/page.tsx:43`) to **"Start a return or complaint"**, which matches the step-1 heading
   `returns.new.heading`. Do not add a second link on the list *(Hick: the branch happens on the next
   step, one decision per step, as feature 155 does)*.
2. **On step 1** (`page.tsx:73-97`), when `form-config.offPlatformComplaintsEnabled` is true, render
   one `b2b-auth__notice`-styled line **above** the order list:
   *"Bought it somewhere else? **File a complaint without an order** →"*. The link goes to
   `/returns/new?origin=elsewhere`.
   - It goes above the list because the list can be long, and a path at the end of 50 orders is never
     seen *(Serial Position)*.
   - It is a link, not a filled button. The order list is the main path, and a second primary
     competes with it *(Von Restorff)*.
3. **No orders yet** (`returns.new.noOrders`): when enabled, the no-order path becomes the main
   content. Show the sentence "You haven't ordered from us yet. If you bought one of our products
   somewhere else, you can still file a complaint." with an outline button to the form. This replaces
   a dead end *(Peak-End)*.
4. **Toggle off**: render none of this, and treat `?origin=elsewhere` as absent (fall back to step 1
   silently), as the brief asks. Option for the owner: a one-line note instead, for a customer who
   followed a CMS link.
5. **Copy**: never "off-platform" in the storefront. Use "bought elsewhere" and "without an order"
   *(Mental Model: the buyer's words, not the module's)*. Keep the URL value `elsewhere` as the
   customer-facing spelling. The admin keeps `off_platform`.
6. No kind switch on the no-order form. It is always a complaint (R3), so the feature-155 kind `nav`
   is not rendered.

### R-2. The no-order complaint form (`/returns/new?origin=elsewhere`)

**Shape**: a single page with numbered, titled sections. It is not a multi-step wizard. Uploads, a
no-JS post and an attempt cookie across several steps would multiply the failure paths. With prefill,
one page meets SC-005 (under 4 minutes). Each section is a `<fieldset>` with a `<legend>` of the form
"2 · When and where you bought it" *(Chunking; the numbers give the progress cue a wizard would,
Zeigarnik)*.

Page skeleton (Server Component; `'use client'` only on the leaves marked ◆):

```
← Choose an order instead                                      (link)
h1  Complaint for a product bought elsewhere
p   One sentence: what happens after submitting.
[ErrorSummary]  (empty and mounted; filled after a refusal)
<form method="post" action="/returns/submit" encType="multipart/form-data" noValidate>
  hidden: origin=elsewhere, submissionKey, attemptId?, clause ids+revisions
  1 · The product              ◆ ProductField, quantity, reason, description, serial, ◆ photos
     [+ Add another product]   (lines 2..5 in <details>, see 2.1)
  2 · When you bought it       date*, receipt/invoice number, ◆ proof-of-purchase upload
  3 · Contact and return address   summary card + <details> "Change"
  4 · Other documents (optional)   ◆ "other" upload, collapsed
  5 · Terms                    clause checkboxes (only if any are configured)
  [Submit complaint]  ◆ pending state          Cancel (link)
</form>
```

#### 2.1 Section 1: the product (per line)

| Field | Control | Rules and copy |
| --- | --- | --- |
| Product | ◆ `ProductField`: **one** text input that is also a combobox | With JS, typing queries `getSuggestions()` (`lib/api/search.ts`, the same API and keyboard model as `SearchAutocomplete`: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, listbox `role="option"`, ↑/↓/Enter/Esc). Each option shows the image (40 px), name and SKU, and **no price** (prices are noise here, Signal-to-Noise). Picking one sets a hidden `productId` and shows a chip ("Name · SKU", *Change* button with `aria-label="Change product"`). Editing the text after a pick clears `productId`. Without JS, it is a plain text input posted as `modelName`. The route handler sends `productId` when present, otherwise `modelName`, never both (contract refine). Label "Product"; hint "Search our catalogue, or type the model name exactly as it is written on the product." *(Hick and Tesler: one field instead of "catalog or free text" radio + two fields; the no-JS path is the same field.)* |
| Quantity | `<input type="number" inputMode="numeric" min=1>`, default 1 | Server clamps or refuses `< 1` with "Enter at least 1." |
| Reason | `<select>` of reasons with `appliesTo ∈ {complaint, both}` | If exactly one reason applies, preselect it and render it as text plus a hidden input *(Tesler)*. Placeholder option "Choose a reason". Error: "Choose what is wrong with the product." |
| What's wrong | `<textarea maxLength=2000 rows=4>` required | Hint "Describe the defect: what happens, and since when." Character counter (◆, shown only from 1 800 characters on, `aria-live="polite"`, throttled) *(Doherty, without noise)*. Error: "Describe the defect so we can assess it." |
| Serial number | `<input>` optional, `autoComplete="off"`, `spellCheck={false}` | Label "Serial number (optional)"; hint "Usually on a label on the back or underside." Trim only; never change its case *(Postel)*. |
| Photos | ◆ `AttachmentField type="photo"` (2.5) | Placed under the defect description, because a photo shows the defect *(Proximity)*. One photos control per **case**, under line 1, not per line (attachments carry no required line). |

**More than one product.** "One purchase per case" still allows several lines. Without JS, lines
2–5 are each rendered inside a closed `<details><summary>Add another product</summary>…</details>`.
An unopened `<details>` posts empty fields, and the handler ignores a line that is entirely empty.
With JS, the same markup is used. Optionally, ◆ the summary is upgraded to a button that reveals the
next one. A cap of 5 lines on the form is enough. The contract's 200 is an API bound, not a form
target *(Hick: one line is the 90% case and the others stay out of sight)*. Every line after the
first has a *Remove* button (`aria-label="Remove product 2"`) that clears it.

#### 2.2 Section 2: when you bought it

| Field | Control | Rules and copy |
| --- | --- | --- |
| Purchase date * | Native `<input type="date" max={config.today}>` (D-12) | Native control *(Jakob)*. Without native date support, the handler also accepts `DD.MM.YYYY` and `D.M.YYYY` *(Postel)*. Errors: "Enter the date you bought the product." and "The purchase date can't be in the future." |
| Receipt or invoice number | `<input>` optional, max 100 | Label "Receipt or invoice number (optional)". |
| Proof of purchase | ◆ `AttachmentField type="proof_of_purchase"` | Placed **here**, next to the number it documents *(Proximity)*. Label "Receipt or invoice": "(required)" when `proofOfPurchaseRequired`, otherwise "(optional, but it speeds up the decision)". Error: "Attach a receipt or invoice: we need it to accept a complaint for a product bought elsewhere." The error links to this control. |

**Typed attachments without a type picker.** The type is **derived from the control a file was added
to**: photos, proof of purchase, or other. The customer never chooses a type from a list *(Tesler:
the system knows the type from the context)*. The API still receives `type` per upload (C2), so this
needs no contract change.

#### 2.3 Section 3: contact and return address

Prefilled from `getMe()` and `listAddresses(session, 'delivery')` (R-13 *Prefill*). The section
renders **as a summary**, because most customers change nothing *(Tesler, Hick)*:

```
We'll contact you at                 Return the product to
Anna Nowak                           Anna Nowak · Endora sp. z o.o.
anna@firma.pl · +48 600 100 200      ul. Długa 5, 00-001 Warszawa, PL
<details> Change contact details     <details> Change return address
```

- **Contact (inside `<details>`)**: Name* (`autoComplete="name"`), E-mail* (`type="email"
  autoComplete="email"`), Phone (`type="tel" autoComplete="tel"`, optional). The inputs post whether
  the `<details>` is open or not. The server re-renders it with `open` when a field inside it was
  refused.
- **Return address**:
  - If the address book has delivery addresses, show a radio list. Each address is one radio, and
    the whole row is the `<label>` *(Fitts)*. The default delivery address is preselected, followed
    by an "A different address" radio.
  - The new-address fields sit under that radio. Without JS they are always visible and are used
    only when that radio is checked. With JS (◆) they are shown only while it is checked.
  - If the address book is empty, the fields are shown directly and are required (spec edge case).
- **Fields**: reuse `AddressForm`'s labelled field markup (`components/account/AddressForm.tsx`:
  `b2b-auth__field`, `autoComplete="street-address" | "postal-code" | "address-level2"`,
  `CountryPicker`). Extract it into a presentational, server-renderable `AddressFields({ prefix,
  defaults, errors })` used by both `AddressForm` and this form *(Constitution IX: extend, don't fork;
  D-18)*.
- **Company**: prefill with the organization's name, except for a personal (B2C) organization (issue
  #759's rule in `AddressSection`).
- **One phone, not two.** The snapshot's optional `phone` is filled from the contact phone. The form
  does not ask for it twice *(Tesler)*.
- A visible line under the section says: "Changes here apply to this complaint only; your account
  and address book stay as they are." This states FR-B16's guarantee where the doubt arises.

#### 2.4 Section 5: terms (clauses)

- The section is rendered only when `config.clauses.length > 0`. Otherwise it is absent and the
  section numbering closes up (US7 scenario 3).
- Per clause:
  - A bounded, scrollable text region holds the full `text`: `max-h-48 overflow-y-auto`,
    `whitespace-pre-line`, `border-line rounded-md bg-surface-alt p-3`. It has `tabIndex={0}`,
    `role="region"` and `aria-label={label}`, so a keyboard user can scroll it (WCAG 2.1.1; axe
    `scrollable-region-focusable`).
  - Under the region is a checkbox whose `<label>` is the clause `label` ("I accept the complaint
    terms"). It has `aria-describedby` pointing to the region's id. It is **never pre-ticked**.
  - The whole label row is the hit area, at least 44 px *(Fitts)*.
- The clause text is plain text with no markup. This matches what the case stores. See *Not done*
  for links.
- Hidden inputs carry `{id, revision}` for every clause shown.
- Error: "Accept "{label}" to submit."
- `clauses_changed`: the page re-renders with the **new** clauses unticked and a `b2b-auth__notice`
  at the top of the section: "The terms changed while you were filling in the form. Please read and
  accept them again." Every other answer is kept.
- With D-1's `inform` mode, the same region is shown with no checkbox, under the heading "Please
  read".

#### 2.5 `AttachmentField` (◆ client leaf, new: `components/returns/AttachmentField.tsx`)

**No existing storefront primitive fits.** `components/FileDropzone.tsx` reads one file into a base64
hidden input and auto-submits the form. The contact form's input is a bare `<input type="file">`. The
admin kit's `AttachmentUploader` is admin-only. The new field follows `AttachmentUploader`'s rules:
the button is the keyboard path, and drop is an addition, never the only way.

- **Server-rendered baseline (no JS)**: `<label>` plus `<input type="file" name="files_{type}"
  multiple accept="image/jpeg,image/png,image/webp,application/pdf">` and a hint "JPEG, PNG, WebP or
  PDF · up to 10 MB each · up to 30 MB and 10 files in total".
  - List explicit MIME types, not `image/*`. iOS then converts HEIC photos to JPEG on selection.
  - Never set `capture`: it would block choosing from the gallery.
- **Enhanced (JS)**: on choose or drop, check each file **before** uploading it, against the size
  and MIME limits from `form-config.attachmentLimits`. Then `POST /returns/uploads` (R-13) and add
  a hidden `uploadId` per accepted file. The native input is cleared, so the post carries no bytes.
- **Per-file row**: file icon (`aria-hidden`), name, size, and a state:
  - *Uploading*: a native `<progress>` with `aria-label="Uploading {name}"`.
  - *Attached*: a check icon **and** the text "Attached".
  - *Refused*: an error icon **and** the reason in text.

  The state is never shown by colour alone. Each row has a *Remove* button (`aria-label="Remove
  {name}"`, at least 44×44 px).
- **Shared budget**: one line for the whole form, "3 of 10 files · 12.4 of 30 MB". It sits in a
  `role="status"` region mounted empty on first render (WCAG 4.1.3) *(Goal-Gradient: visible
  progress against the limit)*. When the budget is exhausted, the remaining controls are disabled and
  the hint says why.
- **Refusal copy** (specific, never blaming the customer):
  - "{name} is 14.2 MB; files can be up to 10 MB."
  - "{name} isn't a JPEG, PNG, WebP or PDF file."
  - "You can attach up to 10 files to a complaint."
  - "These files together are over 30 MB. Add the rest from the complaint page after you submit."
  - Expired upload (`unknown_upload`, open for over 24 h): "{name} needs to be attached again."
- **After a no-JS refusal**: the files accepted so far are listed by name as "Already attached"
  rows, each with a remove checkbox, carried as `keepUpload` hidden ids (R-13). Their bytes are never
  in the cookie.
- **Logic** (limit checks, byte formatting, budget) goes in pure exported functions in
  `lib/returns/attachments.ts`, so the SSR-only tests can assert them.

#### 2.6 Errors, submission, success

- **Error summary**:
  - Shape: reuse the `FormErrorSummary` shape from `packages/cms-components/src/components/forms/FormErrorSummary.tsx`.
    It has a title "There is a problem", one link per refused field to its control id, an icon plus
    text, and `role="alert"` with `tabIndex={-1}`. Before using the component itself, check that
    `@endora-commerce/cms-components/styles.css` reaches the account route. If it does not, lift the
    25 lines into `components/forms/ErrorSummary.tsx` styled with tokens. Either way it is one shape
    for every storefront form.
  - Behaviour: rendered on the server from the attempt cookie for the no-JS path. With JS it is
    focused first, then the first refused field (the `forms` FR-069 order).
- **Field errors**: a `<p id="{field}-error" className="b2b-auth__error">` directly under the
  control, plus `aria-invalid` and `aria-describedby` on the control, the `AddressForm` pattern. A
  hint and an error both go in `aria-describedby`, in that order. Validate on submit, not on
  keystroke *(Postel)*.
- **Error copy by API refusal**:
  - `RETURN_OFF_PLATFORM_DISABLED`: a page-level notice, "Complaints for products bought elsewhere
    aren't accepted here any more.", with a link to the order path.
  - `unknown_product`: on that line's product field, "We couldn't find this product in our
    catalogue. Type its model name instead." The handler moves the product name into `modelName` so
    only one click is needed *(Tesler)*.
  - `RETURN_PROOF_OF_PURCHASE_REQUIRED`: on the proof field.
  - `RETURN_CLAUSES_NOT_ACCEPTED`: on each clause.
  - Network or 5xx: "We couldn't send your complaint. Nothing was lost; try again." *(Peak-End)*
- **Submit**: one filled primary button, "Submit complaint" (`returns.new.submit.complaint`), full
  width under 640 px. *Cancel* is a plain link beside or under it *(Von Restorff; Fitts on mobile)*.
  With JS, ◆ a `useFormStatus` pending state on the `CartSubmitButton` model: disabled, inline
  spinner, "Submitting…", `aria-busy` on the form *(Doherty)*. `submissionKey` (R-18) protects the
  no-JS double post.
- **Success**: 303 to `/returns/{id}?submitted=1`. The case page shows a `b2b-auth__success` panel
  (`role="status"`) *(Peak-End: the designed ending)*:
  - "We've received your complaint {ref}." (D-4)
  - "A confirmation is on its way to {email}." Only when the e-mail is enabled (D-11).
  - "What happens next: we review it, usually within N working days, and tell you by e-mail whether
    to send the product back."
  - One action: "View your returns and complaints".

  N is operator copy, or the sentence is omitted. It is never hard-coded.
- **Mobile**:
  - Sections stack. `b2b-auth__row` pairs (postcode/city, date/number) collapse to one column under
    480 px.
  - Every control is at least 44 px tall.
  - The native date picker and the native file chooser (camera or gallery) are used as they are.
  - No sticky bar. The form ends at its button, and a sticky submit over a long form would hide the
    terms the customer must read *(Fitts vs Flow: the terms win)*.

### R-3. Customer case page (`/returns/[id]`), off-platform case

Changes to `app/(account)/returns/[id]/page.tsx`. It stays a Server Component. The only client
leaves are the enhanced `AttachmentField` in the add form, and that form works without it.

1. **Header**:
   - Title: `rmaNumber`, otherwise "Complaint {ref}" (D-4) instead of "Return case".
   - Under it: status · kind · a muted tag "Bought elsewhere" (text, not colour).
2. **Products**: for off-platform cases, drop the refund column (`[id]/page.tsx:90,98` shows
   `0.00`, which reads as "you get nothing"). Render each line as a `<dl>` block instead of a table
   row, because there are five fields and a long description: product or model name (the name at
   submission, FR-B14; a free-text model is marked "(model as you typed it)"), quantity, reason,
   serial number, description. It reads well at 360 px.
3. **Purchase**: a `<dl>` with the date (locale format) and the receipt or invoice number, or "Not
   given".
4. **Contact and return address**: the snapshot, read-only, with the line "As given with this
   complaint".
5. **Attachments** (all cases):
   - A list grouped in the order proof of purchase, photos, other. Each entry is filename, size and
     date, as a link to `/returns/{id}/attachments/{attachmentId}` (download, C5).
   - No thumbnails for the customer: they are their own files, and C5 always answers
     `attachment`.
   - Under the list, on an open case filed by the viewer, an **Add a file** form: `<form
     method="post" encType="multipart/form-data" action="/returns/{id}/attachments">`, a radio group
     for the type (Photo / Receipt or invoice / Other, default Photo, whole row as label), the file
     input, and a secondary (outline) "Upload" button. Sending a message stays the page's only
     primary *(Von Restorff)*.
   - Show the budget "7 of 10 files".
   - At 10 files, terminal status, or a colleague's case, replace the form with one line saying why
     (the existing `colleagueReadOnly` and `closed` lines).
6. **Terms you accepted**: one `<details>` per clause, with summary "{label}, accepted {datetime}"
   and body = the stored text (`whitespace-pre-line`). The section is shown only when there are
   clauses.
7. **Customer list** (`returns/page.tsx`):
   - The kind cell gets "· Bought elsewhere".
   - The refund cell shows `—` with `<span className="sr-only">Not applicable</span>` for
     off-platform rows.
   - With D-3, a product column replaces the bare RMA as the row's recognisable text.

### R-4. Admin list (`ReturnsList.tsx`)

1. **Origin filter**: a `Select` beside the kind `Select` (`ReturnsList.tsx:353-363`), the same
   control, so it reads the same *(Similarity)*. Options: "Origin" (all), "Platform order",
   "Off-platform".
   - Add a chip "Origin: Off-platform" to `filterChips`.
   - Add `origin` to `currentView.filters` and `applyView`. A saved value outside the enum is
     dropped, as for `kind`.
   - Add it to `clearAllFilters` and to the page-reset effect deps.
   - Put it in the URL with the rest (D-6).
2. **Row marker**: in the *Kind* cell, the kind text followed by `<Badge variant="outline">` with an
   icon (`lucide-react` `Store`, `aria-hidden`) and the text "Off-platform". Text plus icon, never
   colour alone. It lives in the kind cell because off-platform only ever qualifies a complaint
   *(Common Region)*. `ResponsiveTable` keeps the kind column on mobile.
3. **Refund cell**: `—` with sr-only "Not applicable" for `offPlatform` rows (`ReturnsList.tsx:257-264`
   would print `0.00 PLN`).
4. **Authorized by column** (A-6): `hideOnMobile`, after *Status*, no sort affordance (it is not in
   `SORTS`, which is correct). Values:
   - The name.
   - "Former administrator" (`text-muted-foreground italic`).
   - "Unknown" (muted) with `title` and sr-only "Authorized before this was recorded".
   - `—` while not authorized.
5. **RMA cell link text**: when `rmaNumber` is null, use the D-4 reference or "New · {date}", never
   `—` (WCAG 2.4.4).
6. **Header actions** (`ReturnsList.tsx:289-315`) already hold four outline buttons. Adding *Clauses*
   and a *Settings* link would make six *(Hick)*. Instead, collapse the configuration links into one
   `DropdownMenu` (admin-kit `ui/dropdown-menu`), labelled "Configure" with the `Settings` icon:
   Workflow and e-mails, Reasons, Return methods, Clauses, Settings (`/settings?group=returns`).
   Keep *Export CSV* as the only other button.

### R-5. Admin detail (`ReturnDetail.tsx`)

**Card order for an off-platform case**: the operator's first question is "is this claim
legitimate?", so the evidence comes before the workflow *(Serial Position, Pareto)*.
Header → Actions → **Case** → **Purchase and contact** → Items → **Attachments** → **Accepted
clauses** → Settlement → Shipments → Comments. For order cases, the new cards slot into the same
order, and the cards that are empty for them are not rendered.

1. **Header**:
   - `description` (`ReturnDetail.tsx:234`, today `Order {uuid}`): for order cases, keep the order
     reference but as the order's business number with a link, if the detail carries it (otherwise
     unchanged). For off-platform cases, show `<Badge variant="outline"><Store/> Off-platform</Badge>`
     followed by "No order in this shop".
   - Translate the kind badge (`rc.kind` is printed raw at `:230`).
2. **Case card** (new, `Card` with a `<dl className="grid grid-cols-[max-content_1fr] gap-x-4
   gap-y-1 text-sm">`): Submitted, Customer (account), Organization, Channel, and **Authorized**.
   - Authorized shows "{datetime} by {name}", "{datetime} by former administrator" or "{datetime},
     authorizer unknown", or "Not yet".
   - This is the "beside the authorization time" of FR-A41. Today the time is not shown anywhere on
     the detail.
3. **Purchase and contact card** (off-platform only): two columns (`md:grid-cols-2`), one column on
   mobile.
   - Left: purchase date, receipt or invoice number ("Not given").
   - Right: contact name, e-mail as `mailto:`, phone as `tel:`, and the ship-back address as a
     formatted block. A ghost "Copy address" button (`Copy` icon plus text) copies it, since the
     operator types it into a carrier form *(Tesler)*.
   - **Erased state** (D-8): the right column is replaced by an `Alert` (default variant, `ShieldOff`
     icon): "The customer's personal data was erased on {date}. Contact details, the return address
     and attachments are no longer available." The purchase data stays.
4. **Items card**:
   - Title "Products" (it is "Returned items" today, which is wrong for complaints).
   - Off-platform columns: Product, Qty, Reason, Serial no., Description.
   - Product cell: the stored name. If `productId` is set, a link to `/catalog/products/{productId}`
     opening in the same tab. A free-text model gets a muted "Model as typed by customer" line.
   - Description cell: the first ~120 characters with a `<details>` "Show all".
   - The refund columns are hidden.
   - Order cases also get *Serial no.* when any line has one.
5. **Attachments card** (all cases, F6 fix):
   - Grouped in the order **Proof of purchase**, **Photos**, **Other**, with the group heading
     showing the count.
   - Photos: a grid of `<img loading="lazy">` thumbnails (`h-24 w-24 object-cover rounded-md
     border`), each a link to the B3 route in a new tab (`target="_blank" rel="noopener"`), with
     `alt="{filename}"`.
   - PDFs and other files: a `FileText` icon, filename, size and date, with a ghost
     "Open" / "Download" button.
   - Empty: "The customer attached no files." Erased: "Attachments were deleted with the customer's
     personal data on {date}." (D-8)
   - Proof-required context: when `offPlatform` and the proof group is empty, show `Badge
     variant="warning"` with the text "No proof of purchase".
   - Not built here: the full-size images are served unscaled (up to 10 MB). Thumbnails are
     nice-to-have.
6. **Accepted clauses card**: the header line "Accepted {datetime}, in {language name}". Then one
   `<details>` per clause, with summary "{label} · revision {n}" and body = the stored text,
   `whitespace-pre-line`, `max-h-64 overflow-y-auto`, `tabIndex={0}`. The text is in the language
   accepted (US7 scenario 2). Above the list, the line "Shown as the customer accepted it; later
   edits to the clause do not change it."
7. **Settlement card, off-platform variant** (B-6):
   - `ResolutionRadioGroup` with `options={prefill.resolutionOptions}` instead of the constant
     `RESOLUTIONS` (`:20`), so the server decides the list.
   - Above it, a muted line explains the absence: "This case has no platform order, so refunds,
     credit and corrective invoices aren't available." *(the "explain why, don't silently hide"
     state)*.
   - Hide the payment-method field, the approved-amounts table (`:406-468`) and the corrective-invoice
     checkbox (`:472-479`). The API refuses them anyway.
   - When `settled_outside` is chosen, show a required `Textarea` labelled "How was it settled?",
     with hint "For example: refunded in the store on 12 Nov, replaced by the distributor." and a
     counter `n / 2000`.
   - The *Settle* button stays enabled. On click with an empty note, show the error under the field
     (`aria-invalid`, `aria-describedby`, focus moved to it): "Describe how the case was settled."
     A disabled button would not say why.
   - After settling, the card's place shows "Settled outside the platform" plus the note
     (`resolutionNote`) on the Case card.
   - Reachability: see D-5.
8. **Comments card** (A-6):
   - Add a visible `<Label htmlFor>` "New comment" to the textarea (D-17) and use the kit's
     `Textarea` and `Checkbox`.
   - Order the two checkboxes as *Visible to customer*, then *Notify customer by e-mail*.
   - While *Visible* is unchecked, *Notify* is `disabled`, forced unchecked, and described
     (`aria-describedby`) by a visible hint: "Only customer-visible comments can be e-mailed."
   - Re-checking *Visible* does **not** re-check *Notify*.
   - On success the info reads "Comment added; the customer will be e-mailed." or "Comment added."
   - In the thread, a comment posted with notify shows a `Mail` icon with the text "E-mail
     requested". It says "requested", not "sent", because delivery is asynchronous and may fail
     (FR-A50).
   - Translate `authorKind` and the "internal" badge, which are printed raw today.
   - The default of *Visible*: see D-16.

### R-6. Status configuration (`ReturnStatusesConfigPage.tsx`), notify on entry (A-6)

- Add a column **"E-mail customer on entry"** after *Flags* (`:86-116`). Each cell holds a kit
  `Checkbox` with `aria-label="E-mail customer on entry: {status name}"`.
  - It saves immediately on change, like the reasons' active toggle: optimistic, reverted with the
    `Alert` on failure, with `aria-busy` on the row while saving *(Doherty)*.
  - The change is audited (FR-A52), so no extra confirm is needed.
- For `authorized`, `rejected` and the initial status (D-2), the checkbox is `disabled` and the cell
  shows the reason as text ("Has its own e-mail" / "Covered by the confirmation"). This is
  `ResolutionRadioGroup`'s closed-option pattern: the reason is beside the control, not in a
  tooltip.
- Under the table, one muted line: "Turning this on doesn't e-mail cases already in that status."
  (FR-A33).
- The D-7 recipients notice goes at the top of this page.
- Translate the hard-coded headers while here: Statuses, Code, Name, Flags, In use, "Add status".

### R-7. Settings (generic screen)

The three settings appear on `/settings?group=returns`. No custom UI is needed. Their manifest
descriptions should carry the dependency:
- *Proof of purchase required*: "Applies to complaints without a platform order only. Has no effect
  while those are switched off."
- *New-case recipients*: "Up to 10 addresses. An invalid address is skipped and reported in the
  e-mail log."

These descriptions do the explaining the generic screen cannot *(Mental Model)*. The *Configure*
menu links there (R-4.6).

### R-8. Erased-state copy, summarised

| Where | Copy |
| --- | --- |
| Admin, Purchase and contact card | "The customer's personal data was erased on {date}. Contact details, the return address and attachments are no longer available." |
| Admin, Attachments card | "Attachments were deleted with the customer's personal data on {date}." |
| Admin list | Nothing. Erasure is not a list-level fact. |

### R-9. New admin page `/returns/clauses` (`ReturnClausesPage.tsx`, B-5)

- **Route**: declare it **before** `/returns/:id` in `src/admin/index.ts`. The file's own comment
  explains why route order is load-bearing. Gate: `returns:read`; writes need `returns:write`.
  Palette action `return-clauses` (plan). Reached from the *Configure* menu (R-4.6).
- **Header**: `PageHeader` with the title "Case clauses" and the description "Text a customer must
  accept (or read) to file a return or complaint. Each case keeps the text exactly as accepted." The
  primary action is `Button` "Add clause", the page's only filled button.
- **List**: `ResponsiveTable` with these columns:
  - Order (weight, with the kit's `TouchReorderButtons` ↑/↓ instead of typing numbers, if the reorder
    endpoint allows it; otherwise the weight is edited in the dialog).
  - Label, in the admin language, falling back to the default language. A muted "Missing: pl" when a
    shipped language has no text.
  - Channel ("All channels" or the channel name).
  - Applies to (with D-1).
  - Active (`Badge` with text).
  - Revision ("v3").
  - Updated.
  - Row actions via `RowActionMenu`: Edit, Activate/Deactivate, Delete.
- **Empty state**: an icon (`ScrollText`), then "No clauses. Customers file cases without accepting
  any terms.", and the "Add clause" button.
- **Editor**: `ModalDialog` (wide, `widthClassName="max-w-3xl"`), with `ContentLanguageTabs` over
  the platform's content languages. Per language, Label (`Input`, max 120) and Text (`Textarea`,
  `rows={12}`, max 5 000, with counter). Below the tabs: `SalesChannelPicker` with an "All channels"
  empty value, Applies to (D-1), Mode (D-1), Active `Checkbox`, and Weight.
  - The default language is required. Its tab shows a required marker, and the
    `default_language_required` error switches to that tab and focuses the field.
  - **On editing an active clause's label or text**, show a warning `Alert` inside the dialog:
    "Saving creates revision {n+1}. Customers with the form open will be asked to accept the new
    text. Cases already filed keep the text they accepted." That spells out the `clauses_changed`
    consequence before the operator commits.
- **Delete**: `ConfirmDialog` with "Cases already filed keep their accepted copy. Customers stop
  seeing this clause immediately." It is a destructive button in the dialog only, and is never next
  to *Edit* in the row *(Fitts: destructive actions get distance)*.

---

## States covered

| Surface | States |
| --- | --- |
| Entry (R-1) | toggle on / off; with orders / no orders; no `returns.create` (existing `notAllowed`); signed out (login and back, D-14); module off (layout's `requireModulePresent`) |
| Form (R-2) | pristine with prefill; no address on file; several addresses; one vs several reasons; catalog product picked / free text / no JS; 1–5 lines; uploads idle / uploading / attached / refused (size, type, count, total, expired); proof required on / off; clauses none / some / changed mid-way; every field error; refusal round trip with kept answers and kept uploads; over-30 MB no-JS refusal (D-9); toggle switched off mid-way; network failure; pending submit; double submit (`submissionKey`); success |
| Customer case page (R-3) | off-platform vs order case; with and without attachments; add-file budget, limit reached, terminal, colleague read-only; clauses present / absent; just submitted (success panel) |
| Admin list (R-4) | origin all / platform / off-platform; saved view restore; authorized by name / former / unknown / not yet; RMA missing; loading, empty, error (existing) |
| Admin detail (R-5) | off-platform vs order; erased; no proof attachment; no attachments; clauses present / absent; settlement option set; note missing; settled outside; notify disabled for internal comments |
| Status config (R-6) | toggle saving / failed; closed for the dedicated and initial statuses; no recipients warning |
| Clauses page (R-9) | empty; list; missing translation; edit of an active clause (revision warning); default-language error; delete confirm |

## Not done here, and what needs a human decision

**Not done**: no production code, no edits to spec, plan or tasks, no mockups, no contrast
measurements. Every colour above is an existing token or kit variant, so contrast follows the theme.

**Human decisions**:

1. D-1: clause `appliesTo` and `inform` mode, and above all whether a consumer withdrawal may ever
   be gated by clauses. This is a legal question.
2. D-4: a derived case reference before authorization.
3. D-5: from which statuses *settled outside the platform* may be chosen.
4. D-13: whether customer-initiated transitions e-mail the customer.
5. D-16: the default visibility of a new admin comment.
6. Whether a clause may contain a link to a full terms page. The stored text would then not include
   the linked content, which weakens the "exactly as shown" guarantee (FR-B31). The recommendation is
   plain text only, with the full terms pasted into the clause.
7. The "usually within N working days" sentence on the success panel: operator-editable copy, or
   omit it.
