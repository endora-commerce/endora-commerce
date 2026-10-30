---
title: newsletter
description: Own-infrastructure newsletter — subscriber list, tags, segments, one-off campaigns and multi-step automations with per-channel opt-in
---

# `newsletter`

Own-infrastructure newsletter sending. Lets operators grow a subscriber list,
segment it with **tags** and **custom fields**, and reach it through one-off
**campaigns** and multi-step **automations** (linear send/wait sequences).
Storefront visitors and signed-in customers subscribe with a per-Sales-Channel
**opt-in** model; every email carries a working unsubscribe link. Content reuses
the email-safe renderer and `{{var}}/{{if}}/{{for}}` directive engine from the
`transactional_emails` stack (`@endora-commerce/email-components`). Bulk delivery goes
through the module's own configurable **sending provider** (an SMTP adapter that
reaches Amazon SES SMTP, Mailgun, or any relay), independent of the
transactional-email transport. The whole module can be **enabled/disabled** so
it never collides with an external ESP (MailerLite, GetResponse, …).

## Concepts

- **Subscriber** — keyed by email (global identity). Status is `pending` →
  `active` → `unsubscribed` / `deactivated`. Re-submitting an email merges tags
  and custom fields rather than duplicating. A separate **suppression** list
  (unsubscribe / bounce / complaint), keyed by email, survives deletion and
  overrides all targeting.
- **Opt-in** — per Sales Channel via Settings `newsletter.opt_in_mode`
  (`single` | `double`). Double opt-in issues a signed, TTL-bounded confirmation
  link; unconfirmed `pending` subscribers expire after
  `newsletter.confirm_ttl_hours`.
- **Tags & custom fields** — operator-defined; tags drive campaign targeting and
  automation triggers, custom fields enrich subscribers (set via API, Admin UI,
  or signup) and feed automation criteria. A custom-field value is stored only
  when its key is a defined field **and** the value matches the field's type
  (yes/no → `true`/`false`, number → a finite number, date → an existing
  `YYYY-MM-DD` date, text → at most 500 characters; `null` clears the value);
  anything else is dropped without refusing the request.
- **Campaign** — a one-off send to `all` / a manual `group` / a `tag` / a
  `tag_list`. Authored in the shared email Page Builder (same palette as
  transactional emails) with subject + Puck content tree + variables; previewed
  with sample data; sent now or scheduled.
- **Automation** — a linear `send` / `wait N days` sequence triggered by
  all/tag/tag-list. Send steps use the same email Page Builder. The step model
  is designed to extend to conditional branching later without rework.
- **Email blocks** — reusable email-safe fragments edited with the same Puck
  editor and embeddable via `EmailInsertBlock` where configured.
- **Variables** — newsletter catalogue includes `subscriber.email`,
  `customFields.*`, `unsubscribeUrl`, `webviewUrl`, `channel.id`, plus branding
  keys; the admin **Insert variable** picker works on subject and content.
- **Branding** — the logo and accent colour come from the campaign's or
  automation's sales channel. One created without a sales channel is previewed
  and sent with the **default** sales channel's branding.
- **Provider** — selected + configured in the Admin UI; the SMTP password is
  stored as a Settings `secret` (AES-256-GCM, write-only at the boundary).

## Delivery

Dispatch is queue-backed on Redis/BullMQ:

- `newsletter.campaign.plan` — resolves the audience and **atomically claims** a
  `newsletter_send_records` row per recipient (`INSERT … ON CONFLICT DO
  NOTHING`), then enqueues a send job for each freshly-claimed recipient.
- `newsletter.send` — renders + dispatches one recipient, idempotent on the
  send-record id (used as the provider `messageId`), throttled by the
  send-worker rate limiter (`newsletter.rate_limit_per_second`).
- `newsletter.automation.step` — executes a step; `wait` steps schedule the next
  step as a BullMQ **delayed job**. A run self-cancels if its subscriber
  unsubscribes mid-sequence.

Workers run under the separable `worker.ts` entrypoint and pause when the module
is disabled. Producers only enqueue — never inline-execute — so N≥2 workers
never double-send.

## Engagement

Campaign e-mails can carry open and click tracking, added when each
recipient's message is sent. Both kinds are **off** until an operator switches
them on (see the settings below); an untouched instance sends campaigns without
either.

- **Opens** — an invisible 1×1 image,
  `GET /api/v1/newsletter/open.gif?token=…`, is added before the end of the
  message body. Loading it records an open against the recipient's send record.
- **Clicks** — every absolute `http(s)` link is rewritten to
  `GET /api/v1/newsletter/click?token=…&u=<destination>`. The token is signed,
  bound to the send record, to a link id numbered in document order
  (`link-1`, `link-2`, …) and to the destination, so the redirect only ever
  leads to the link the e-mail was sent with. A token that does not verify
  answers `410`; a destination that does not match the token leads to the
  storefront home page. `mailto:` and `tel:` links, in-page anchors, relative
  links and the module's own links (unsubscribe, confirmation) are left as
  they are. The plain-text part of the message is sent unchanged.

Both URLs are built on the public API base URL the unsubscribe link uses, and
both tokens stay valid for one year. Following a tracked link also counts as an
open, so a reader whose mail client blocks images is counted once they click.

Two settings in the **Newsletter** group switch the two kinds independently.
Both are **off** by default, so a campaign is tracked only after an operator
switches them on on the Settings screen. Each can be set per sales channel (a
campaign with no sales channel reads the default sales channel's values):

| Setting | While off (the default) |
| --- | --- |
| `newsletter.tracking.opens_enabled` | no image is added and no opens are counted |
| `newsletter.tracking.clicks_enabled` | links lead straight to their destination and no clicks are counted |

A campaign created through the API with `trackingEnabled: false` is sent with
neither. Automation e-mails are not tracked.

Per-campaign counts of sent / delivered / failed / opened / clicked (plus
per-link clicks) are aggregated from `newsletter_send_records` and
`newsletter_engagement_events`. Opens are approximate: a mail client that
blocks images reports none, and one that loads images for the reader reports
an open that may not be one.

## Permissions

- `newsletter:read` — view subscribers, campaigns, automations, stats.
- `newsletter:write` — manage subscribers, campaigns, automations, blocks, and
  the sending provider.

## Storefront

A reusable signup component (server action, tag-attachable), a double-opt-in
confirmation landing, an unsubscribe page (optional reason), and an account
panel showing subscription status + tags with subscribe/unsubscribe actions.

### Sign-up block in the Page Builder

The module declares the Page Builder block `newsletter.Signup` (palette section
*Forms*, label **Newsletter sign-up**), so an editor can put a sign-up form on
any CMS page:

| Option | Meaning |
| --- | --- |
| Heading, text | An optional heading (with its level) and rich text above the form. |
| E-mail label, placeholder, button label | The form's own texts. |
| Topics | Up to 12 checkboxes, each a label and a newsletter **tag**; the ticked ones are added to the subscriber as tags. In the admin the tag is chosen from the list of existing newsletter tags by name, and the block stores its code. A stored code the list does not hold stays selected; without the list (no `newsletter:read` permission, the module off) the code is typed as text. **Topics required** asks for at least one. A topic whose tag code is not a valid code is not offered. |
| Subscriber attributes | Up to 10 of the newsletter's **custom fields**, shown after the e-mail field and before the topics. In the admin each is chosen from the existing custom fields, which also records its type and label. A yes/no field is a checkbox; a text, number or date field is the matching input (a text takes at most 500 characters). Each has an optional **label** (else the field's own label), a **placeholder** (not for a yes/no field) and a **Required** switch: a required checkbox must be ticked, any other required field filled in. |
| Consent label | The text of the consent checkbox, which is always shown and always required. It is inline rich text, so it can link to the privacy policy. |
| Layout | Inline (field and button on one line) or boxed. |
| Button placement, field shape | **Beside the field** (default) or **Inside the field**: the e-mail field and the button share one box, **Rounded** (default) or a **Pill**. |
| Topic columns | The topics as a grid of 1–4 columns; left empty, they flow in one wrapping row. |
| Hide the email label | Hides the e-mail field's label visually; it stays the field's label, so screen readers still read it. Use a placeholder so sighted visitors know what to type. |
| Messages | The texts shown after a sign-up: pending confirmation, subscribed, and the refusals (consent missing, invalid e-mail, no topic chosen, service unavailable, and — with subscriber attributes — a required field missing, which reads the shop's own translated text when left empty). |

Every text is translatable with the Page Builder's **Translate** action. At
the top level of a page the block also carries the section settings (anchor,
colour scheme, background, spacing, width).

**How a sign-up travels.** The block is a plain HTML form that posts to the
storefront's own handler, `POST /newsletter/subscribe`
(`storefront/app/newsletter/subscribe/route.ts`), so it works without
JavaScript. The handler:

- answers `404` while the newsletter module is not present;
- checks the e-mail with the same rule as the backend, requires `consent=on`,
  keeps at most 12 topic codes matching `^[a-z0-9_-]{1,64}$` and drops the
  rest, and accepts only a same-origin path as `returnTo` (anything else
  returns to `/`);
- reads the subscriber attributes the block describes (at most 10), turns each
  value into its type — a ticked box is `true`, an unticked one `false`, a
  number when it is one, a date when it is `YYYY-MM-DD`, a text trimmed to at
  most 500 characters — and refuses the sign-up with `reason=fields` when a
  required one is missing;
- subscribes through the existing `POST /api/v1/newsletter/subscribe` in the
  request's sales channel, with the ticked topics as `tags`, the attributes as
  `customFields` and `source: 'cms-block'`;
- without JavaScript, redirects (`303`) back to the page with
  `?newsletter=pending|active|error&reason=consent|email|topics|fields|unavailable`
  and the section's anchor as the fragment, where the block shows the
  matching message;
- with JavaScript, the block posts with `Accept: application/json` and gets
  `{status: 'pending' | 'active'}` (200) or `{error: …}` (400); the message
  appears in place and the typed address is kept.

Whether the answer is `pending` or `active` follows the channel's opt-in mode.
The subscription is recorded as any other: `consentAt` is set, the
`newsletter_subscribe` audit entry carries `source: 'cms-block'`, so these
sign-ups can be told apart from the others, and a topic code that matches no
existing tag is ignored — no tag is created from the storefront. The module
checks each attribute value again against its own custom-field definitions and
keeps only the values whose type matches (see *Tags & custom fields*).

**A row of topic checkboxes.** To offer topics as a row of checkboxes — for
example in a page footer — create the tags first (**Newsletter → Tags & Fields**), then
in the block add one topic per tag, give it the visitor-facing label and pick
its tag. Leave **Topic columns** empty for one wrapping row, or set 2–4 for a
grid; switch on **Topics required** if a sign-up without a topic should be
refused.

While the module is switched off, the block is not offered in the palette, a
stored one renders nothing, and the handler answers `404`.

`newsletter.Signup` is the platform's own newsletter. The CMS module keeps a
separate **Newsletter signup** form, `cms.NewsletterSignup`, which posts to any
external endpoint for a newsletter service outside the platform.

## Schema

Migration `20260629T200954_newsletter_init.ts` creates `newsletter_subscribers`,
`newsletter_tags`, `newsletter_subscriber_tags`, `newsletter_custom_fields`,
`newsletter_suppressions`, `newsletter_email_blocks`(+ channel bridge),
`newsletter_campaigns`(+ group bridge), `newsletter_send_records`,
`newsletter_engagement_events`, `newsletter_automations`, and
`newsletter_automation_runs`. Provider config + opt-in mode live in the
**Settings** module (no bespoke credential table).
