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
  or signup) and feed automation criteria.
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
- **Provider** — selected + configured in the Admin UI; the SMTP password is
  stored as a Settings `secret` (AES-256-GCM, write-only at the boundary).

## Delivery (Principle X)

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

Open tracking uses a 1×1 pixel; click tracking rewrites links through a signed
redirect. Per-campaign counts of sent / delivered / failed / opened / clicked
(plus per-link clicks) are aggregated from `newsletter_send_records` and
`newsletter_engagement_events`. Tracking can be disabled per campaign.

## Permissions

- `newsletter:read` — view subscribers, campaigns, automations, stats.
- `newsletter:write` — manage subscribers, campaigns, automations, blocks, and
  the sending provider.

## Storefront

A reusable signup component (server action, tag-attachable), a double-opt-in
confirmation landing, an unsubscribe page (optional reason), and an account
panel showing subscription status + tags with subscribe/unsubscribe actions.

## Schema

Migration `083_newsletter_init.ts` creates `newsletter_subscribers`,
`newsletter_tags`, `newsletter_subscriber_tags`, `newsletter_custom_fields`,
`newsletter_suppressions`, `newsletter_email_blocks`(+ channel bridge),
`newsletter_campaigns`(+ group bridge), `newsletter_send_records`,
`newsletter_engagement_events`, `newsletter_automations`, and
`newsletter_automation_runs`. Provider config + opt-in mode live in the
**Settings** module (no bespoke credential table).
