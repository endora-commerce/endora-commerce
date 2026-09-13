---
'@endora-commerce/platform': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
---

Eleven container names a module read and nothing defaulted are now defaulted by
the module that reads them, so a composition that contributes nothing can
resolve every one of them.

`@endora-commerce/platform` — `composeApp` registers two more names:
`customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
the resolved `NEWSLETTER_TOKEN_SECRET`.

`@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
consumer composing the module through `registerModule` is unaffected; a consumer
calling `newsletterModule` directly passes `async () => null` where it passed
`null`. The `NewsletterBridge` interface is removed — the module reads its nine
members itself.

`mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
each registers the names it reads. No published shape changes; a composition
that contributes one of them still overrides the default, which is what the
contribution window is for.

`mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
`customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
one of those owners declares `activation.nonDeactivatable`, so no operator loses
an activation control.
