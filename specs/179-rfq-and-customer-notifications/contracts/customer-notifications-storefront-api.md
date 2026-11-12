# Contract: customer notification centre — storefront API and pages

**Normative for** FR-042 – FR-052. Zod schemas in `packages/contracts/src/customer-notifications.ts`
(new, beside the port types of `delivery-and-ports.md` §1). Every route is registered by
`customer_notifications` through `ctx.routes` (gated by its presence), guarded by `requireCustomer`,
and answers `Cache-Control: private, no-store`. While the module is off every route answers the
platform's `503 MODULE_DISABLED` (as-if-absent, `specs/conventions/module-activation.md`).

## 1. Routes

| Method | Path | Body / query | Answer |
| --- | --- | --- | --- |
| `GET` | `/api/v1/storefront/notifications` | `?limit=1..50` (default 20), `?cursor=<opaque>` | `200 CustomerNotificationListResponse` |
| `GET` | `/api/v1/storefront/notifications/unread-count` | — | `200 { data: { unreadCount } }` |
| `POST` | `/api/v1/storefront/notifications/:id/read` | — | `204`; `404 NOT_FOUND` for an id that is not the caller's |
| `POST` | `/api/v1/storefront/notifications/read-all` | — | `200 { data: { updated } }` |

Scoping applied to every route, in the query and not after it:

- `customer_account_id = actor.customerAccountId` (and the `@CustomerScoped` filter beneath it);
- `sales_channel_id = <request's resolved channel> or sales_channel_id is null` (FR-044);
- `source_module` ∈ the effectively present modules (FR-044).

`read-all` marks exactly the entries the list would show (same three predicates), so an entry
hidden on this channel stays unread for the channel it belongs to.

Impersonation (`actor.impersonatorAdminUserId` not null): `GET`s answer normally; both `POST`s answer as if they
succeeded (`204` / `{ updated: 0 }`) and write nothing (FR-045).

## 2. Schemas

```ts
export const customerNotificationSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  /** Rendered in the request's language; the stored English sentence when the key does not resolve. */
  title: z.string(),
  body: z.string().nullable(),
  subject: z.object({ type: z.string(), id: uuidSchema }).nullable(),
  /** Storefront-relative, without locale prefix; the storefront localises it. */
  linkPath: z.string().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
}).strict();

export const customerNotificationListResponseSchema = z.object({
  data: z.object({
    items: z.array(customerNotificationSchema),
    nextCursor: z.string().nullable(),   // keyset over (created_at desc, id desc), base64url
    unreadCount: z.number().int().nonnegative(),
  }),
});

export const customerNotificationUnreadCountResponseSchema = z.object({
  data: z.object({ unreadCount: z.number().int().nonnegative() }),
});
```

Language: the request's response language (`specs/083-buyer-language-resolution/`), passed to
`adminI18nService.translate(scope, key, language, params)`. The response carries `kind` so a
consumer may branch without parsing the sentence (`specs/conventions/module-i18n.md`, case 1).

## 3. Storefront

| Piece | File | Notes |
| --- | --- | --- |
| API client (server-only) | `storefront/lib/api/customer-notifications.ts` | list, count, read, read-all; session cookie forwarded like `lib/api/account` |
| Page | `storefront/app/(account)/account/notifications/page.tsx` | Server Component; `?cursor=` paging with a *Show older* link (no client JS needed); empty, error and module-absent states |
| Open action | `storefront/app/(account)/account/notifications/actions.ts` | server action `openNotification(id)`: `POST …/:id/read`, then `redirect(localised linkPath)`; a failed mark still redirects (reading matters more than the flag) |
| Mark all | same file | server action `markAllRead()`: `POST …/read-all`, `revalidatePath` of the page |
| Unread count | `storefront/app/layout.tsx` | fetched next to `cartItemCount`, only for a signed-in buyer and when `customer_notifications` is in the `ModulePresenceSet`; a failed fetch renders as 0 and logs |
| Indicator | `storefront/components/Header.tsx` `UserPill`; `components/mobile/MobileTabBar.tsx` account tab; `components/Megamenu/MegamenuMobileDrawer.tsx` account row | a count badge on the avatar (`9+` above nine); accessible name via `chrome.header.accountUnread` "{name}, {count} unread notifications"; tokens only (`bg-accent`, `text-*`), no raw colour |
| Account entry | `storefront/app/(account)/account/page.tsx` | a *Notifications* link with the count, beside the existing sections |
| Copy | `storefront/lib/i18n/messages/account.ts` (`account.notifications.*`), `chrome.ts` (`chrome.header.accountUnread`) | en-US and pl-PL through `defineMessages` |

Page anatomy (ux-laws §6 states): heading; *Mark all as read* as the single secondary action
(outline), shown only when something is unread; a list where each entry is one full-width link
surface (Fitts) showing the sentence, a relative date with the absolute date in `title`, and an
unread marker that is a text label ("New" / "Nowe") plus weight, not colour alone; empty state with
an icon, one line ("Updates about your quote requests will appear here.") and one action (*Go to
quote requests*, shown only when `quote_requests` is present); error state with a retry link.
Mobile: same list, touch targets ≥ 44 px.
