---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-i18n': minor
---

**Breaking:** `PATCH /api/v1/admin/organizations/:id` no longer accepts `status` (issue #1468). A body that carries it is refused with `400 VALIDATION_ERROR` at `status`, and nothing else in that body is written. To change an organization's status, call the moderation endpoints instead: `POST /api/v1/admin/organizations/:id/approve`, `…/reject`, `…/block` or `…/unblock`. They are the only path that checks the allowed transitions, records `approvedAt` / `blockedAt` / `blockedReason`, emits `organization.status_changed.v1` and sends the customer e-mail.

- Old: `PATCH /api/v1/admin/organizations/:id` with `{ "status": "blocked" }`.
- New: `POST /api/v1/admin/organizations/:id/block` with `{ "expectedVersion": <version>, "reason": "…" }`.

In `@endora-commerce/contracts`, `adminPatchOrganizationRequestSchema` refuses `status` with the message in the new `ADMIN_PATCH_ORGANIZATION_STATUS_REFUSAL` export. `vatStatus` is still accepted.

On the organization screen, the status and VAT status selects are gone, and the page's Save no longer counts or sends either field:

- The **Moderation** section is the only place the status is shown and changed. Its actions are offered only to operators who hold `customers:manage`.
- The VAT status is shown in the header. It is changed by the new **Change VAT status…** dialog. The dialog needs `customers:manage`, applies immediately and is audited as `organization.admin_patch`.
- The remaining section is titled **Contact & notifications**.

`ModerationActionsPanel` takes a required `canModerate` prop. In the core catalogue, `organizations.detail.accountStatus` and `organizations.detail.statusCard` are removed and `organizations.detail.notificationsCard` is added. A deployment that overrides the removed keys must drop them.
