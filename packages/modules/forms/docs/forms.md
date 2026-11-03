---
title: Forms
description: A form builder — forms with sections, conditional logic and translations, placed on pages with the Form block, with stored entries, notes, CSV export, e-mail notifications, retention and a webhook event
---

# Forms

**Forms** lets you build your own forms — a contact form, a quote request, a survey, a
registration for an event — and place them on any Page Builder page with the **Form** block
(`forms.Form`). Every submission is stored as an **entry** that your team reads, processes and
exports in the admin, and each entry can notify the shop by e-mail, confirm receipt to the
person who sent it and reach another system through a webhook.

The module is optional: an operator switches it on and off on the **Modules** screen of the admin
(`/platform/modules`). While it is off nothing is lost (see
[Switching the module off](#switching-the-module-off)).

## Forms and the Contact form block

The CMS's **Contact form** block (`cms.ContactForm`) stays as it is and keeps working. The two
serve different needs:

| | Contact form (`cms.ContactForm`) | Form (`forms.Form`) |
| --- | --- | --- |
| Fields | A fixed set | Any fields you build, in sections and columns |
| Submissions | E-mailed only, **nothing is stored** | Stored as entries, with statuses, notes and export |
| Logic | None | Fields and sections shown or hidden by earlier answers |
| Translations | Built-in texts only | Every text of the form, per storefront language |
| Recipients | One setting per sales channel | Per form, with a list per sales channel |
| Integrations | None | The `forms.entry.submitted.v1` event and webhook |

Pages that already use the Contact form block render exactly as before. Nothing converts one
into the other.

## Where to find it

- **Sidebar**: **Forms** (the list of forms) and **Form entries**.
- **Command palette** (⌘K / CTRL+K): "Forms", "New form" and "Form entries".
- **Permissions**:

| Permission | Allows |
| --- | --- |
| View forms (`forms:read`) | The list of forms, the builder read-only, the form picker of the block |
| Create and edit forms (`forms:write`) | Create, edit, publish, close, reopen, duplicate and delete forms |
| View form entries (`forms:entries_read`) | The entries list and an entry's detail |
| Process and delete form entries (`forms:entries_write`) | Statuses, notes and deleting entries |
| Export form entries (`forms:entries_export`) | The CSV export |

Deleting a form **with** its entries and changing a form's **retention period** each need
*Create and edit forms* **and** *Process and delete form entries*, and an administrator who can
see every organisation — see [Entries and organisations](#entries-and-organisations).

## Building a form

Open **Forms → New form**, give the form a name and its default language (one of the languages
your storefronts serve). The form gets a **key** derived from the name — a stable identifier used
by the export and by integrations. You can change the key, but every key is unique among forms.

A new form is a **draft**: it is not available to shoppers until you publish it. The builder has
four tabs — *Fields*, *Settings*, *Notifications* and *Versions* — and, above them, the
[content language](#translations) switch they share.

### Fields

The *Form* card at the top holds the form's name — seen only by administrators — and the texts
shoppers see around the fields: the title, the description and the text of the send button.

Drag a field from the palette onto a section, or press it to add it to the section you are
editing; every move is also possible with the keyboard. Select a field to edit it in the panel
beside the canvas, grouped into basics, validation, conditional logic and integrations. Sections are laid out in 1, 2 or 3
columns, and each field takes a width in those columns. On a narrow screen the storefront stacks
every field in one column.

The field types:

- **Single-line text**, **multi-line text**, **e-mail**, **phone** (international numbers),
  **number**;
- **select** (drop-down), **radio buttons**, **checkbox group**, **single checkbox** — each choice
  with a stable value and a translatable label;
- **date/time** — a date, a time, or a date with a time;
- **country** — country names in the shopper's language, optionally limited to some countries;
- **address** — street and number, additional line, postal code, city and country, each part with
  its own label and required flag;
- **hidden** — a fixed value, or a value taken from the page: its address, its title, a URL query
  parameter you name, or the referring address. The value is shortened to the field's limit and
  is always stored and shown as plain text;
- **content** (formatted text) and **section break**, which ask for nothing;
- **privacy consent**, **marketing consent** and **terms acceptance** — a checkbox with formatted
  text that may contain links. The entry records whether each was given **and the exact text that
  was shown**, so the consent can be proven later. Privacy consent and terms acceptance are always
  required when they are shown; marketing consent is never required and never pre-ticked.

Every input field has a label, an optional placeholder, an optional help text, a required flag,
an optional default value and its width. Validation options depend on the type: the length of a
text, the minimum, maximum and step of a number, the earliest and latest date, how many options
of a checkbox group may be chosen, and for single-line text a pattern chosen from presets (digits
only, letters only, letters and digits, a web address). Each built-in error message can be
replaced per field.

One e-mail field may be marked as **the submitter's e-mail**. Its answer becomes the Reply-To of
the shop notification and the address of the confirmation e-mail.

A field can also be marked **Share with integrations** — see
[Integrations: the webhook event](#integrations-the-webhook-event).

The **preview** beside the builder shows the form as the storefront renders it, including the
conditional logic, evaluated against what you type in the preview.

### Conditional logic

A field or a whole section can be shown only when earlier answers say so. A rule is made of
**condition groups**: inside a group the conditions are combined with *and* or with *or*, as you
choose, and the groups are combined with the other one — so "(A and B) or C" can be written.

The operators are *equals*, *does not equal*, *greater than*, *less than*, *contains*, *does not
contain*, *is empty* and *is not empty*, each offered only where it makes sense for the type of
the field it refers to.

A field hidden by its rule, or by its section's rule, is never required; whatever was typed into
it is discarded and not stored, and other rules see it as empty. The storefront and the server
evaluate the rules the same way, so a shopper cannot submit an answer to a field they were not
shown.

### Versions — publishing

**Publish** freezes the working copy as a new, numbered **version**; shoppers are always served
the latest published version. Editing a published form changes nothing for shoppers until you
publish again. Every entry records the version it was accepted against, and its detail and the
export show it with that version's labels and options.

Publishing is refused, with the reason shown on the element concerned, when the form is not
valid: a duplicate or missing field key, a choice field without options, a rule that refers to a
field that does not exist or that depends on itself in a circle, more than one submitter e-mail
field, a minimum above its maximum, or a redirect address that is not a web address.

The builder also **warns**, without refusing to publish, when nobody is notified of new entries
on some channel, when the form asks for a CAPTCHA that is not set up, and when texts are missing
in a storefront language.

A published form can be **closed** — it stays on its pages and shows its closed message — and
**reopened** later. A form can be **duplicated** as a new draft. A form without entries can be
deleted outright; a form with entries asks you to confirm that its entries will be deleted too.
If somebody else saved the form since you opened it, your save is refused: reload it and make the
change again.

The *Versions* tab lists every published version with its time and author.

### Notifications

- **Shop notification** — up to 10 addresses that receive an e-mail for every new entry, with
  the visible answers, the form's name and the page it was sent from, in the default language of
  the entry's sales channel. A sales channel can have **its own list**, which replaces the
  default list on that channel; an empty list sends nothing there. The recipients are saved on
  their own and apply to the next entry at once — no publish needed. They never appear on the
  storefront or in the public form.
- **Reply-To** — when the form has a submitter e-mail field and it was answered, replying to the
  notification writes to the person who sent the form.
- **Confirmation e-mail** — optionally, the submitter receives an e-mail with your subject and
  text, in the language they used, with a summary of their answers if you choose so. It is sent at
  most once per entry and never for an entry marked as spam.

E-mails are sent in the background; a mail failure never fails the submission. Every attempt is
listed in the platform's e-mail delivery log. The delivery records never hold the answers.

### Settings

- **After sending** — a message (yours, or the built-in thanks), a redirect to another address,
  or a CMS page shown in the shopper's language. Without the CMS module, or when the page cannot
  be shown, the message is shown instead.
- **Restrictions** — a maximum number of entries (spam does not count), an availability window
  (from, until, either may stay open) and **signed-in customers only**. The server enforces each
  one; the block shows the matching message — closed, not yet open, full or "sign in to send this
  form" — which you can write and translate, with built-in translated defaults.
- **Spam protection** — see [Spam protection](#spam-protection).
- **Retention** — see [Retention](#retention).

### Translations

Every text you write — the title and description, labels, placeholders, help texts, option
labels, content, consent texts, messages, the confirmation and the e-mail subject and text — can
be written per storefront language. The **content language** switch at the top of the builder
lists your storefront languages, the form's default language first; the *Fields*, *Settings* and
*Notifications* tabs and the preview all follow it.

In the default language you edit everything. In another language you edit only the texts, each
where it sits in the builder: the fields, sections, the stored values of options, rules,
validation and the other settings are locked, so the form has the same fields, options and rules
in every language. An empty text shows the default-language text as its placeholder, because that
is what shoppers see; clearing a text makes it fall back again.

Next to the switch, each language with missing texts is marked with how many are missing; select
the mark to open that language at its first missing text. Built-in texts — validation messages,
the submit button, outcomes — come translated with the storefront.

## Placing a form on a page

In the Page Builder, add the **Form** block from the *Forms* category and pick a form. The picker
lists the forms you can see with their status, and **Create a new form** opens the forms screen;
a form created there can be picked without reloading the editor. An editor without *View forms*
sees a note instead of the list.

The block holds only the reference to the form and its look: the field look (boxed, underline or
pill), the size (S, M, L), the submit button's look, the alignment, and whether the form's title
and description are shown. It follows the page's colours. Everything else — fields, logic,
recipients, messages — belongs to the form, so a change to the form reaches every page that shows
it once you publish, within about a minute.

The same form may appear on several pages, and twice on one page: each block shows its own
outcome and errors.

A draft form shows nothing to shoppers; in the editor, a note in the block says why it is not shown.

### Without JavaScript

A form works without JavaScript: it is sent to the storefront, which returns the shopper to the
same page and block with the outcome and, if something was wrong, their answers and the errors.
Every conditional field is then shown, and the server discards the answers of fields the rules
hide. With JavaScript the outcome is shown in place.

A form that **requires a CAPTCHA** cannot be sent without JavaScript, because both providers need
their script: the block shows a translated note that the form needs JavaScript to check that the
sender is not a robot. Forms without a CAPTCHA work fully without JavaScript.

## Spam protection

- Every form has a hidden **trap field**. A submission that fills it is answered as accepted, and
  nothing is stored, sent or published.
- Submissions are **limited per address**: 10 in 10 minutes. Beyond it the shopper is asked to
  try again later.
- A submission is limited in size (256 KB) and every answer in length.
- **CAPTCHA** — one provider for the whole shop, **Cloudflare Turnstile** or **hCaptcha**, set in
  **Settings → group Forms**: *CAPTCHA provider*, *CAPTCHA site key* and *CAPTCHA secret key* (the
  secret is stored encrypted and never shown again). Then switch on **Require a CAPTCHA check** on
  each form that needs it. While a form requires it and a provider is set up, the server refuses a
  submission the provider has not verified, and asks the shopper to try again shortly when the
  provider cannot be reached. A form that requires a CAPTCHA while no provider is set up is sent
  without the check, and the builder warns about it.

The provider's script is loaded only on pages that show a form requiring it. It is third-party
content: name the provider in your privacy notice.

## Entries

**Form entries** lists every entry you may see, newest first. Filter it by form, status, date and
sales channel, and search the submitter's e-mail and the text answers.

An entry holds the answers to the fields that were shown, the form and version, the sales
channel, the language, the page it was sent from, the time, the consents with the texts shown,
and — when a signed-in customer sent it — their customer account and organisation. That
attribution comes from the session, never from an e-mail address typed into the form.

- **Statuses** — *new*, *read*, *closed* and *spam*. Opening an entry moves it from *new* to
  *read*; you can set any status, including back to *new*, and undo the change.
- **Notes** — internal notes with their author and time. Notes are never shown to the shopper and
  never sent in an e-mail or an event.
- **Export** — *Export CSV* downloads the entries of the chosen form with your filters: entry id,
  form, version, status, channel, language, submission time and page, then one column per field
  key across all versions of the form. A value a spreadsheet would run as a formula is neutralised.
  Notes are not exported. Large exports stream, so they do not block the admin.
- **Deleting** — one entry or a selection, after a confirmation. Deleting is final: the entry and
  its notes are gone, and nothing about the answers stays in the audit log.

Every change — to a form, an entry's status, a note, a deletion, an export — is recorded in the
audit log without the answers.

### Entries and organisations

An administrator who can see only some organisations (a sales representative, for example) sees
only the entries of customers of those organisations, and no anonymous entry. An entry they may
not see looks exactly like one that does not exist.

Two changes remove entries of **every** organisation at once — deleting a form together with its
entries, and changing its retention period. They are refused to such an administrator with the
message that only an administrator who can see every organisation may do this
(`FORM_SCOPE_REQUIRED`).

## Retention

On the *Settings* tab, **Retention** sets how long the form's entries are kept. With **Delete
entries automatically** on and a period from 1 to 3,650 days, a background job that runs every
15 minutes deletes the entries older than the period, together with their notes. Without a period
entries are kept until somebody deletes them.

The period applies as soon as you save it — it is not part of a version and needs no publish.
Before saving, the admin tells you how many existing entries the new period would delete and
saves only once you confirm, because deleted entries cannot be restored. Each batch the job
deletes is recorded in the audit log with the form, the cutoff date and the count.

## Deleted and anonymised customers

When a customer account is **anonymised** — the irreversible step that removes a deleted account's
personal data once it can no longer be restored — every entry attributed to that account is
deleted, with its notes, in the same step. A customer
account that is only deleted and can still be restored keeps its entries, which come back with it.

**Entries sent without signing in are not matched**, even when they carry the same e-mail
address: the platform does not link an entry to a person by a typed address. To honour an erasure
request for such entries, search the entries list for the address and delete what you find by
hand.

If the account was anonymised while Forms was switched off, its entries are deleted by the first
run of the background job after Forms is switched back on.

## Integrations: the webhook event

For every accepted entry the module publishes the event **`forms.entry.submitted.v1`**, which you
can subscribe to on the **Webhooks** screen. Its payload carries the entry id, the form id and
key, the version, the sales channel, the organisation (or none), the language, the page and the
submission time. It never carries notes, recipients or consent texts.

**Answers are included only for the fields marked _Share with integrations_** in the builder, keyed
by field key — the setting is per field, off by default, and recorded in each version. With no field
marked, the payload carries no answers, and an integration reads the entry through the admin API
with *View form entries*. No event is published for a trap-field hit or a refused submission.

Shared answers leave the shop with the webhook, and **they are also kept in the webhook delivery
records and the delivery job until the webhooks module clears them**. Deleting the entry does not
remove those copies. Share only answers you would send outside the shop.

## Switching the module off

While Forms is off it behaves as if it were not installed: the Form block is not offered in the
editor, and a page holding one shows nothing in its place on the storefront (the editor marks the
block as missing); the forms screens, the sidebar entries, the palette actions and the Forms
settings group disappear; every forms address of the API is refused; the background jobs and the
e-mails stop; and the webhook event is neither offered nor sent.

Nothing is deleted. Forms, versions, entries, notes and settings are kept, and everything comes
back when you switch the module on again — the e-mails that were waiting are sent then, and
the first run of the background job applies the retention periods and the customer
anonymisations that happened in the meantime.
