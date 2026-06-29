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
- **Blocks & Templates** — reusable email-safe fragments embedded by `code`
  (`EmailInsertBlock` / `EmailInsertTemplate`). The seeded system blocks
  `default_email_header` (renders the branding logo) and `default_email_footer`
  are auto-included in the default content.
- **Branding** — header logo, accent color, and the default header/footer block
  codes, resolved per scope through the Settings module
  (`transactional_emails.*`). The resolved logo is exposed to every email as
  `{{var branding.logoUrl}}`.
- **Variables** — Magento-2-style directives over the content + subject:
  `{{var path}}`, `{{if path}}…{{/if}}`, `{{for alias in list}}…{{/for}}`. Values
  are HTML-escaped in the HTML body and raw in the plain-text alternative. A
  missing value resolves to empty — an email is never sent with an unresolved
  `{{…}}` and a missing variable never fails a send.

## Rendering

Rendering is performed **server-side** by the first-party `@b2b/email-components`
package (React-free): the Puck content tree is walked and emitted as
table-based, inline-styled, email-client-safe HTML plus a plain-text
alternative. The admin editor reuses the same email-safe component palette.

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

## Permissions

- `transactional_emails:read` — view emails, blocks, templates, branding, preview.
- `transactional_emails:write` — edit content, branding, and manage blocks/templates.

## Migrated emails

All pre-existing transactional emails route through this mechanism: orders
(confirmation, comment, reorder, admin-created), returns (authorized, rejected),
organizations (verification, invitation, new-registration), and inventory
(low-stock, back-in-stock).
