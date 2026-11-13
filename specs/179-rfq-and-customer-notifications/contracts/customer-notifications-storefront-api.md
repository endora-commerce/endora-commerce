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
| `GET` | `/api/v1/storefront/notifications/:id` | — | `200 CustomerNotificationResponse` (`{ data: CustomerNotification }`); `404 NOT_FOUND` for an id the list would not show (another account's, another channel's, an absent producer's, unknown). Read-only: marks nothing, so it answers normally under impersonation. Added 2026-11-13 (architect ruling) so the open route of §3 can learn the entry's `linkPath` |
| `POST` | `/api/v1/storefront/notifications/:id/read` | — | `204`; `404 NOT_FOUND` for an id that is not the caller's |
| `POST` | `/api/v1/storefront/notifications/read-all` | — | `200 { data: { updated } }` |

Scoping applied to every route, in the query and not after it:

- `customer_account_id = actor.customerAccountId` (and the `@CustomerScoped` filter beneath it);
- `sales_channel_id = <request's resolved channel> or sales_channel_id is null` (FR-044);
- `source_module` ∈ the effectively present modules (FR-044).

`read-all` marks exactly the entries the list would show (same three predicates), so an entry
hidden on this channel stays unread for the channel it belongs to.

Impersonation (`actor.impersonatorAdminUserId` not null): `GET`s answer normally (all three); both `POST`s answer as if they
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

export const customerNotificationResponseSchema = z.object({
  data: customerNotificationSchema,      // GET /api/v1/storefront/notifications/:id
});

export const customerNotificationUnreadCountResponseSchema = z.object({
  data: z.object({ unreadCount: z.number().int().nonnegative() }),
});
```

Language: the request's response language (`specs/083-buyer-language-resolution/`), passed to
`adminI18nService.translate(scope, key, language, params)`. The response carries `kind` so a
consumer may branch without parsing the sentence (`specs/conventions/module-i18n.md`, case 1).

## 3. Storefront

Amended after the designer review of 2026-11-12; rulings on its four open decisions are research
R-24.

| Piece | File | Notes |
| --- | --- | --- |
| API client (server-only) | `storefront/lib/api/customer-notifications.ts` | list, count, read, read-all; session cookie forwarded like `lib/api/account` |
| Page | `storefront/app/(account)/account/notifications/page.tsx` | Server Component; page size 20; paging with `components/Pagination.tsx` (cursor mode, label prop "Show older" / "Pokaż starsze"); while the module is off it calls `notFound()` (the shop's 404, FR-048). No `loading.tsx`: page loads use `NavigationFeedback` |
| Open route | `storefront/app/(account)/account/notifications/[id]/open/route.ts` | `GET`: `POST …/:id/read` (skipped under impersonation — the API no-ops it anyway), then `303` to the localised `linkPath`; a failed mark still redirects; an entry with no link, or an unknown id, redirects to the page. The row links with `prefetch={false}`; `/account*` is already excluded from speculation rules (`components/SpeculationRules.tsx`), so nothing pre-marks an entry |
| Mark one / mark all | `storefront/app/(account)/account/notifications/actions.ts` | server actions `markRead(id)` (for entries without a link) and `markAllRead()`; both `revalidatePath('/', 'layout')` so the account entry's count re-renders in the same response (FR-051a); a failure redirects with `?markError=1` (the `pushSaved` / `pushError` pattern of `account/page.tsx`) |
| Submit buttons | same page | the `useFormStatus` pattern of `CartSubmitButton`: disabled, `aria-busy`, spinner while in flight. Under impersonation *Mark all as read* is disabled with "Read state is not changed while impersonating" / "Podczas impersonacji stan przeczytania się nie zmienia" |
| Unread count | `storefront/app/layout.tsx` | fetched next to `cartItemCount`, only for a signed-in buyer and when `customer_notifications` is in the `ModulePresenceSet`; a failed fetch renders as 0 and logs. Re-rendered by `revalidatePath('/', 'layout')` (FR-051a); no polling |
| Indicator — pill | `storefront/components/Header.tsx` `UserPill` | reuses `.icon-btn__count` (no new badge class; accent colour, not `bad`), pinned to the top-right corner of the 32 px avatar, offset outward, never over the name; `9+` cap; static (no pulse, ping or entry animation). Initials `aria-hidden`; a visually hidden `chrome.header.accountUnread` ("Unread notifications: {count}" / "Nieprzeczytane powiadomienia: {count}") after the visible name — never an `aria-label` replacing it (WCAG 2.5.3). No live region. Not rendered in the minimal checkout header |
| Indicator — tab bar | `storefront/components/mobile/MobileTabBar.tsx` account tab | reuses `.m-tabbar__badge` (`aria-hidden`, `9+`) plus the same visually hidden text inside the tab link |
| Indicator — drawer | `storefront/components/Megamenu/MegamenuMobileDrawer.tsx` | when signed in and the module is present, the footer gains a *Notifications* row linking to `/account/notifications`, count in text ("Notifications (2)" / "Powiadomienia (2)"). The burger trigger carries no dot |
| Breakpoint alignment | `storefront/app/globals.css` (`.m-tabbar` wrapper, `--m-tabbar-h`), `MobileTabBar.tsx`, `MegamenuMobileDrawer.tsx` | the tab bar and drawer switch at the header's 877 px instead of `md` (768 px), so 768–876 px has an account entry (FR-051). Verified at 767, 768, 876 and 877 px |
| Account navigation | `storefront/app/(account)/layout.tsx` sidebar | *Notifications* second, after Profile (Serial Position), "Notifications ({count})" / "Powiadomienia ({count})" when unread > 0 using the `account.nav.cartsToApproveCount` pattern; only while the module is present |
| Account overview | `storefront/app/(account)/account/page.tsx` | when unread > 0, a one-line summary "You have {count} unread notifications" / "Masz nieprzeczytane powiadomienia: {count}" linking to the page (SC-006) |
| Copy | `storefront/lib/i18n/messages/account.ts` (`account.notifications.*`, `account.nav.notifications*`), `chrome.ts` (`chrome.header.accountUnread`) | en-US and pl-PL through `defineMessages`; plural-free patterns like `chrome.header.cartItems` |

Page anatomy (ux-laws §6 states):

- **Heading**, and beside it an always-rendered `role="status"` container. After *Mark all as read*
  succeeds it reads "All notifications are marked as read" / "Wszystkie powiadomienia oznaczono jako
  przeczytane" and focus moves to the heading (the button unmounts). A failure shows a specific error
  with a retry.
- ***Mark all as read*** — the single secondary action (outline), shown only when something is
  unread; full width under 400 px, wraps, never truncates ("Oznacz wszystkie jako przeczytane").
- **Rows**: an entry with a link is one full-width link surface (Fitts) to its open route; an entry
  without a link is not a link and shows a small *Mark as read* / *Oznacz jako przeczytane* button
  while unread. Unread: text label "New" / "Nowe" before the sentence, semibold, `bg-accent-soft`.
  Read: regular weight. Every row ≥ 44 px tall. Date: `<time dateTime>`, relative ("2 h ago" /
  "2 godz. temu", `Intl.RelativeTimeFormat` in the request locale) under 7 days, otherwise absolute
  (`toLocaleDateString(locale)`, as the quote-request list), date in `text-muted`.
- **Empty state**: an icon, "When something changes on your quote requests, you'll see it here." /
  "Gdy coś zmieni się w Twoich zapytaniach ofertowych, zobaczysz to tutaj.", and *Go to quote
  requests* only when `quote_requests` is present and the buyer has an Organization (the sidebar's
  rule).
- **Footer**: a secondary link "Manage push notifications" / "Zarządzaj powiadomieniami push" to the
  profile's push section, which disambiguates the existing "Powiadomienia push" heading.
- **Error state**: a specific message and a retry link.
