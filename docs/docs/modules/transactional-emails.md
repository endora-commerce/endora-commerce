---
title: transactional_emails
---

# `transactional_emails`

Admin-editable transactional emails. Lets operators change the **subject**,
**content**, and **look** of every transactional email the platform sends —
globally and per **Sales Channel** — from the Admin UI, using an
email-client-safe WYSIWYG editor consistent with the CMS Page Builder. Each
email is described by a **definition** registered by the module that owns it
(orders, returns, organizations, inventory, …), which supplies a default
subject + default content and the set of variables the business logic
substitutes at send time.

## Concepts

- **Definition** — a registered email identified by a unique `code` (e.g.
  `order_confirmation`). Carries the owning module, declared variables (with
  sample values for preview), supported languages, and the module-provided
  default subject + content. Reconciled into `transactional_emails` at boot;
  orphaned definitions (owning module uninstalled) are pruned.
- **Content** — the admin's per-scope, per-language customization, stored in
  `transactional_email_contents`. Resolution at send time is
  **per-channel → global → module default**, with a fallback to the channel's
  default language. Absence of a row means "fall back"; **Reset** deletes it.
- **Blocks & Templates** — reusable email-safe fragments. Blocks are embedded by
  `code` via `EmailInsertBlock`. Email templates remain a separate admin list
  (apply/save outside the canvas); `EmailInsertTemplate` is withdrawn from the
  palette (legacy trees still render). The seeded system blocks
  `default_email_header` (renders branding via `EmailLogo` / `{{var branding.logoUrl}}`) and `default_email_footer`
  are auto-included in the default content.
- **Branding** — header logo, accent color, and the default header/footer block
  codes, resolved per scope through the Settings module
  (`transactional_emails.*`). The resolved logo is exposed to every email as
  `{{var branding.logoUrl}}`.
- **Variables** — Magento-2-style directives over the content + subject:
  `{{var path}}`, `{{if path}}…{{/if}}`, `{{for alias in list}}…{{/for}}`. Values
  are HTML-escaped in the HTML body and raw in the plain-text alternative. A
  missing value resolves to empty — an email is never sent with an unresolved
  `{{…}}` and a missing variable never fails a send. The admin editor exposes an
  **Insert variable** picker (subject, plain text fields, and rich text toolbar)
  fed by the email's declared variables plus branding keys.

## Email editor

The transactional (and newsletter) editors share `EmailEditorPane`:

- Email-safe Puck palette from `@b2b/email-components` (no CMS breakpoints /
  responsive stacking). **Row** opens a column-layout picker (1–6 columns) like
  CMS; columns use a fixed table at send time and the CMS 12-col grid on the
  canvas. **Column** is not listed in the palette (only inside Row). **Table** is
  the data grid (headers + rows, like CMS SimpleTable).
- The canvas is fixed at mail width (**600px**), with an Outline panel like CMS.
  Use **Preview email** for a modal HTML render with sample variable data and
  **Desktop mail (600px)** / **Narrow (320px)** options (fluid `max-width:600px`
  shell so narrow preview does not overflow).
  **Save as template** / **Apply template** reuse the CMS header actions against
  transactional email templates (`email_templates`).
- `EmailLogo` shows the branding logo (no URL field). `EmailImage` supports URL or
  asset library, same as CMS. Color fields use the shared CMS color palette.
  Branding logo in Settings (`*_asset_id`) uses the Assets Library picker.
- `EmailRichText` reuses the CMS Rich Content TipTap editor (plus Variable).
- `EmailProductCard` picks a catalog product; `EmailOrderSummary` is column/totals
  toggles and appears in the palette only when the email declares `order.items`
  (today: **Order confirmation** only). Order confirmation also exposes labeled
  detail blocks: Order ID, Billing/Shipping address, Summary, Applied discounts,
  Delivery method, Payment method (each gated on its template variable).
- Content blocks include layout (`EmailSection`, `EmailRow`/`EmailColumn`, table,
  spacer, divider),
  copy (`EmailText`, `EmailRichText`, headings, callout, footer/legal), media
  (`EmailImage`, `EmailLogo`), commerce (`EmailProductCard`, `EmailOrderSummary`
  and the order detail blocks above), `EmailSocial` (icons + labels + per-link
  enable), and `EmailInsertBlock`.

## Rendering

Rendering is performed **server-side** by the first-party `@b2b/email-components`
package (React-free): the Puck content tree is walked and emitted as
table-based, inline-styled, email-client-safe HTML plus a plain-text
alternative. The admin editor reuses the same email-safe component palette.
`EmailRichText` HTML is whitelist-sanitized (`p/strong/em/u/a/ul/ol/li/br`)
before send; directive markers in text are preserved.

## Registering an email from a module

```ts
// manifest.ts
transactionalEmails: [
  { code: 'order_confirmation', name: 'Order confirmation', group: 'orders',
    variables: [{ key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' }] },
],

// plugin.ts (default subject + content)
emailDefaultsRegistry.register('order_confirmation', { defaultSubject, defaultContent });
```

The owning module sends through the `TransactionalEmailSender` port (injected by
composition), preserving its existing idempotency `messageId`:

```ts
await sender.send({
  code: 'order_confirmation',
  salesChannelId, language, to,
  messageId: `order_confirmation:${order.id}`,
  variables: { order: { businessId, items: [...] }, customer: { firstName } },
});
```

When the sender is not wired, modules fall back to their legacy in-code builders,
so behavior is unchanged in environments without the module.

## Preview

`POST /api/v1/admin/transactional-emails/{code}/preview` renders an email with
each variable's declared sample value (and any unsaved draft content), returning
`{ subject, html, text }`. The admin opens the HTML in a new tab.

## Switching an email off

The module itself is **non-deactivatable**: every deployment sends account
verification, invitations and order mail through it, so `/platform/modules`
renders it locked with that reason rather than as a toggle. The granularity that
*is* offered is the individual email — the list at `/transactional-emails`
carries a per-row switch, backed by
`POST /api/v1/admin/transactional-emails/{code}/activation` with `{ active }`.
The flip runs through the Command Bus, so it is audited as
`transactional_email.activation.set` and reversible; it drops no content, no
override and no per-channel customization. A deactivated email answers
`{ status: 'deactivated' }` at send time and **no fallback mail goes out**.

Emails required to create an account or to get back into one may not be switched
off at all: today `email_verification` and `organization_invitation`. The
declaration lives on the owning module's registry entry
(`EmailDefaults.nonDeactivatable`), not in a list held by this module or by the
Admin UI, and a refused flip answers `409 TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`
carrying that module's own reason — the same shape the module-level refusal uses.

## Delivery record

Every send leaves one row in `email_deliveries`, a table owned by the `email`
module — the transport is where a message's fate is decided, so it is where the
record of that fate lives. The row carries the recipient, the email code, the
sales channel, the message id, the business document the message delivered (an
invoice, typically), the outcome and the moment it was attempted.

The outcome is one of three, and the split is the point of the table:

| Status | Means | Typical reason |
| --- | --- | --- |
| `sent` | the transport accepted the message | — |
| `suppressed` | the platform deliberately did not send | `deactivated` (an operator switched this email off), `duplicate_message_id` |
| `failed` | the message was meant to go out and did not | `transport_error`, `no_transport`, `no_definition` |

An operator asking "did the customer get the invoice" therefore gets an answer
that outlives a log rotation, and one that does not confuse a configuration they
chose with an outage. This is **best-effort delivery with a durable record**, not
guaranteed delivery: there is no retry queue and no outbox, a resend stays an
operator action, and a message lost between the business write and the transport
call is lost. There is no admin screen over the table yet — it is read from the
database.

## Permissions

- `transactional_emails:read` — view emails, blocks, templates, branding, preview.
- `transactional_emails:write` — edit content, branding, and manage blocks/templates.

## Registered emails

All pre-existing transactional emails route through this mechanism: orders
(confirmation, comment, reorder, admin-created), returns (authorized, rejected),
organizations (verification, invitation, new-registration), and inventory
(low-stock, back-in-stock). Two net-new emails are also registered and dispatched
via event subscribers: payments (`payment_status_changed`, on payment
received/failed) and shipments (`shipment_created`, on shipment created).
