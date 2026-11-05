---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': patch
---

The Organization cart surfaces name a cart's owner as the members page names a member (issue #751).

- `orgCartSummarySchema` — and with it `orgCartDetailViewSchema` and `orgCartsListResponseSchema` — gains a required `ownerEmail: string | null`: the owner's e-mail, `null` when the account can no longer be read. A consumer that builds these shapes by hand must now supply it.
- `ownerDisplayName` on `GET /api/v1/organization/carts` and `GET /api/v1/organization/carts/:id` is now the owner's first and last name; it falls back to the e-mail for an owner with no name, then to the account id. It was the e-mail alone — read `ownerEmail` where the e-mail is what you need.
