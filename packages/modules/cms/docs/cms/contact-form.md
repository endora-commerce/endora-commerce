---
title: Contact form
sidebar_label: Contact form
sidebar_position: 5
description: A Page Builder block that e-mails a visitor's message to the addresses set per sales channel, with optional newsletter sign-up, and stores nothing
---

# Contact form

The **Contact form** block (`cms.ContactForm`) puts a contact form on any Page Builder page.
A visitor fills it in, and the shop receives the message by e-mail at the addresses you set
for the sales channel. **Nothing is stored**: there is no list of submissions in the admin
and no table of messages — the e-mail in your inbox is the only copy.

The block is different from **Contact / form embed** (`cms.ContactFormEmbed`), which shows a
form hosted somewhere else in a frame.

## Before you start: who receives the messages

The recipients are a setting, not part of the page, so an address never appears in the
page's content or anywhere on the storefront.

- **Where**: **Settings** → group **Contact form** → **Contact form recipients**.
- **Command palette**: ⌘K / CTRL+K → "Contact form recipients" (also found by *contact*,
  *form*, *recipients*, *kontakt* or *formularz*).
- **Permissions**: reading the Settings screen needs **View settings** (`settings:read`);
  changing a value needs **Edit settings** (`settings:write`).
- **Per sales channel**: set one list for all channels, or override it for a single channel.
  The form sends to the list of the channel the visitor is shopping on.
- **Rules**: at most 10 addresses, each a valid e-mail address. Anything else is refused
  when you save.

While a channel has no recipients, the form on that channel answers that it is unavailable,
and the visitor sees the block's "Unavailable" message.

## Building a contact page

A typical contact page is made of blocks that already exist:

1. A **Section** with a **Row** of two **Columns**.
2. In the first column, a **Heading** and a short **Rich content** lead, then the **Contact
   form**.
3. In the second column, the contact details (addresses, phone numbers, opening hours) as
   **Rich content**, or a **Map**.
4. Optionally a **Tabs** block with two tabs — "Contact form" holding the **Contact form**
   and "Newsletter" holding the **Newsletter sign-up** block (when the newsletter module is
   installed).

Give the Section an anchor if you link to the form from elsewhere on the page; after a
visitor sends the form without JavaScript, the browser returns to that anchor.

## Fields

The field set is fixed — the server knows every field, so it can check what arrives:

| Field | Shown | Required |
| --- | --- | --- |
| Name | by default | optional |
| E-mail | always | always |
| Phone | on request | optional |
| Company | on request | optional |
| Subject | on request | optional |
| Select (a list you define, e.g. regions or departments) | on request | optional |
| Message | always | always |
| Privacy consent | always | always |
| Marketing consent | on request | never |

For every field you can change the **label** and the **placeholder**; for the optional ones
also **Show** and **Required**. The select needs at least one option — without one it is
not shown. Its chosen option is sent with the select's label, so the e-mail reads, for
example, "Region: North".

Labels you leave empty show the storefront's own wording in the page's language.

**Privacy consent**: write its label and link it to your privacy policy — the editor shows a
warning until you do. Until then the visitor reads a short default sentence without a link.

**Marketing consent**: switch it on to ask whether the visitor wants news and offers. See
[Newsletter sign-up from the form](#newsletter-sign-up-from-the-form).

## Layout and look

The block follows the colour scheme of the section it is in. The options are presets, so a
page looks right without measurements:

- **Columns** — one, or two from tablet width up (one on phones). With two columns, each
  field's **Width** is half or full; the message is full width unless you change it.
- **Labels** — above the field, or hidden. Hidden labels are still read by screen readers,
  and the label is shown as the placeholder when you wrote none.
- **Field look** — **Boxed** (a frame), **Underline** (a line under the field) or **Pill**
  (fully rounded; the message box keeps softer corners).
- **Button** — the same look options as every other Page Builder button (style, fill, size,
  icon) and its own label. **Button alignment** places it at the start, centre or end, or
  makes it full width.
- **Messages** — the texts shown after sending: **Sent**, **Not accepted** (the server
  refused what was sent) and **Unavailable** (no recipients, too many attempts, or a
  temporary failure).
- **Form name** — the name screen readers announce for the form.
- Outer and inner spacing, border, and hiding the block per screen size work as on every
  block.

## What happens when a visitor sends the form

1. With JavaScript, the form checks the required fields and the e-mail address first, marks
   each field to correct and moves the focus to the first one. What the visitor typed is
   kept until the message is sent.
2. The storefront passes the message to the shop's server, which checks it again —
   whatever the block's settings, the server always requires an e-mail address, a message
   (up to 5 000 characters) and the privacy consent.
3. The server sends **one e-mail per recipient** of the visitor's sales channel, through the
   platform's mail transport. The e-mail is written in the channel's default language and
   lists the fields that were filled in, the page the form was sent from and both consents.
   Its **Reply-To** is the visitor's address, so answering it reaches the visitor.
4. The visitor sees the **Sent** message. Without JavaScript, the browser comes back to the
   same page, in the same language, scrolled to the form.

**What is kept**: the platform's e-mail delivery record notes that a message of kind
`cms.contact_form` went to a recipient, with a fixed subject (the channel's name, never the
visitor's text) and the outcome. Nothing the visitor typed is stored anywhere.

## Newsletter sign-up from the form

When the marketing consent is ticked and the message is sent, the storefront also signs the
address up to the newsletter of the visitor's sales channel — if the newsletter module is
installed and switched on. The channel's own opt-in rules apply, so with double opt-in the
visitor receives a confirmation e-mail first. The subscription is recorded with the source
`cms-contact-form`. If the sign-up fails, the message has still been sent.

Without the newsletter module, the consent is only stated in the e-mail you receive.

## Protection against abuse

- **Rate limit** — at most 10 submissions per visitor address in 10 minutes; the eleventh
  is refused and the visitor sees the "Unavailable" message.
- **Hidden trap field** — a field people never see. A bot that fills it is told the message
  was sent, and nothing is sent.
- **Behind a proxy** — the reference storefront calls the server on the visitor's behalf
  and forwards the visitor's address in `X-Forwarded-For`. The server only counts that
  address when it trusts the storefront as a proxy: set `TRUSTED_PROXY_HOPS` or
  `TRUSTED_PROXY_ADDRESSES` for your deployment. Without it, every visitor shares the
  storefront's address and the limit applies to all of them together.

## For developers: the endpoint

The storefront handler is `POST /forms/contact` (a plain form post answered with `303` back
to the page, or JSON when the request accepts it). It calls the public endpoint:

`POST /api/v1/storefront/cms/contact-form` — body checked against
`contactFormSubmissionSchema` in `@endora-commerce/contracts`; unknown keys are refused.

| Outcome | Status |
| --- | --- |
| Sent (also when the trap field is filled) | `200` `{ "data": { "status": "sent" } }` |
| The body does not match the contract | `400` `VALIDATION_FAILED` |
| No recipients for the request's sales channel | `409` `CMS_CONTACT_FORM_UNAVAILABLE` |
| Too many submissions from one address | `429` |
| Every send failed | `500` `INTERNAL` |
| The CMS module is switched off | `503` `MODULE_DISABLED` |

The answer never contains the recipients or the submitted values. With the CMS module
switched off the block disappears from every page and the storefront handler answers `404`.
