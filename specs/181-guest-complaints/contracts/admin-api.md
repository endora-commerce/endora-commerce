# Contract: admin API changes (`returns`)

**Feature**: `specs/181-guest-complaints/`. The source of truth is `packages/contracts/src/returns.ts`.

Existing gates are unchanged: reads use `requireAdmin('returns:read')` and writes
`requireAdmin('returns:write')`. One **new permission code**: `returns:erase_personal_data`
(§A5). Every route keeps passing through the tenant filter, so for an admin who is not unrestricted
a guest case is absent: lists and counts omit it, and a direct id answers `404 NOT_FOUND`, identical
to a missing case (research R-1).

## A1. List: origin filter, guest marking, search

```ts
adminReturnsListQuerySchema.origin = z.enum(['platform', 'off_platform', 'off_platform_customer', 'guest']).optional();
// absent = all; 'off_platform' keeps 180's meaning (both kinds of bought-elsewhere), so 180's saved views are unchanged
returnCaseSummarySchema += { guest: z.boolean() };
returnCaseSummarySchema.customerAccountId → uuidSchema.nullable();
```

| `origin` | Predicate |
| --- | --- |
| `platform` | `order_id is not null` |
| `off_platform` | `order_id is null` |
| `off_platform_customer` | `order_id is null and customer_account_id is not null` |
| `guest` | `customer_account_id is null` |

- **Search.** The free-text `q` additionally matches `lower(contact->>'email') = lower(q)` when `q`
  is an e-mail address. It is an exact match, never a substring (research R-10).
- **Customer column.** For a guest row it shows *Guest* plus the contact name (or *Guest – data
  erased*). The organization column is empty.
- **Saved views** store the widened `origin` unchanged.
- **Export** gains one column, `guest` (`true`/`false`), appended after 180's columns. The export
  has no customer or contact-name column, so a guest's name is never exported (batch 3 finding,
  ruled 2026-11-16: the `guest` column alone).

## A2. Detail

```ts
returnCaseDetailSchema += {
  guest: z.boolean(),
  contactVerifiedAt: isoDateTime.nullable(),       // FR-063
  trackingLinkValidUntil: isoDateTime.nullable(),  // null = open case, or erased
  guestDataErasureDueAt: isoDateTime.nullable(),   // null while open or once erased
};
returnCaseDetailSchema.customerAccountId → uuidSchema.nullable();
commentSchema.authorKind → z.enum(['admin', 'customer', 'guest']);
returnAttachmentSchema += { uploadedByGuest: z.boolean() };
```

On a guest case, the settlement prefill offers only 180's off-platform resolutions (FR-064). The
error is unchanged: `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.

## A3. `POST /api/v1/admin/returns/:id/guest/tracking-link`: send a new tracking link

`returns:write`. Body `{}`.

- **Success:** `200 { data: { trackingVersion } }`. Command `return_case.tracking_link.reissue`
  increments `tracking_version` and enqueues `return_guest_link_reissued` to the verified address.
- **Not a guest case:** `422 VALIDATION_FAILED`, detail `not_guest_case`.
- **Data erased:** `409 RETURN_GUEST_DATA_ERASED`.

## A4. Bell entries

There is no route change. For a guest case the bell's audience is narrowed to `returns:read`
holders whose `adminTenantScopePort.resolveForAdmin` answers `allowAll`. It fails closed when the
port does not answer (research R-10).

## A5. `POST /api/v1/admin/returns/:id/guest/erase`: erase personal data

`requireAdmin('returns:erase_personal_data')`. Body `{ confirm: z.literal(true) }`.

- **Success:** `200 { data: { personalDataErasedAt } }`. Command `return_case.guest_data.erase`
  (trigger `request`) runs in any status.
- **Not a guest case:** `422 VALIDATION_FAILED`, detail `not_guest_case`. A customer's data is erased
  by anonymising the account (180).
- **Already erased:** `200` with the existing stamp. The call is idempotent.

Manifest:

```ts
{ code: 'returns:erase_personal_data', label: 'Erase personal data of guest returns and complaints', requires: ['returns:read'] }
```

Labels go in `i18n/{en,pl}.json` under `adminRoles.permission.returns:erase_personal_data`, per
`specs/conventions/module-admin-surfaces.md`. The admin detail renders the action only when
`hasPermission('returns:erase_personal_data')`.

## A6. Admin UI (no new screen)

- **`ReturnsList.tsx`:** the origin `Select` options (research R-10), a *Guest* `Badge` on the row,
  and the customer column's guest label.
- **`ReturnDetail.tsx`:**
  - a *Guest* badge in the header;
  - on the *Purchase and contact* card, *Verified e-mail · {date}*, *Tracking link valid until
    {date}* or *while the case is open*, and *Personal data will be erased on {date}*;
  - two `RowActionMenu` items, *Send a new tracking link* (with `ConfirmDialog`) and *Erase personal
    data* (with `ConfirmDialog` and irreversible copy);
  - comments by a guest labelled *Guest*.
- **Command palette:** no new action, because there is no new destination (Principle XVI is met by
  the existing `returns-list` action).
