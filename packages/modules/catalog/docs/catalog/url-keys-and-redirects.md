---
title: URL Keys and Redirects
---

# URL Keys and Redirects

A product's storefront address is `/p/<key>`. The key follows the product scopes — Global, Channel
and Channel × language:

- **Global key** — the product's `slug`; it is the key wherever the product has no key of its own;
- **Channel key** — one per sales channel, in every language that channel offers;
- **Channel × language key** — one per channel and language, overriding the Channel key there.

There is no language-only key. The **effective key** at a sales channel and language is the
Channel × language key, else the Channel key, else the Global key. Every product URL the platform
emits — the storefront's canonical and alternate-language links, the sitemap, a redirect target,
the preview address in the admin — uses the effective key, under the language's path prefix.

A key text belongs to **at most one product per sales channel**, across all the channel's
languages; the same product may use it in several languages. A Global key equals no other
product's Global key, Channel key, Channel × language key or redirect anywhere. Changing a key
keeps the previous one as a permanent redirect at that channel and language, straight to the
product; redirects are kept until an operator deletes them. Redirects are served while the `seo`
module is switched on; with `seo` off an old key answers "not found", and the redirects come back
when `seo` is switched on. A product's other **current** keys are not redirects: with `seo` off too,
a request for its Channel or Global key where a narrower key overrides it still leads to its URL in
that channel.

## Managing keys

In the product editor the URL key is one field at the editor's scope, like the name: at Global it
is the Global key, at a channel or a channel and language it either shows "Use value from *parent
scope*" or holds the key of its own. It is saved with the rest of the scope by
`PUT …/products/:id/scoped-values` (`urlKey`). While the `seo` module is on the editor also lists
the redirects the old keys keep — at the editor's channel and language, at every language of the
channel, or all of them at Global.

For API clients, `GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`) answers every
key, the effective key and URL at each channel and language, and the redirects; `PUT` on the same
path (`catalog:write`) writes keys:

```json
{
  "globalKey": "cordless-drill",
  "channelKeys": [
    { "channelId": "<retail-uuid>", "key": "wiertarka" },
    { "channelId": "<retail-uuid>", "languageCode": "en-US", "key": { "inherit": true } }
  ]
}
```

An entry without `languageCode` (or with `null`) is the Channel key; one with a language is the
Channel × language key. A list or key left out is unchanged; `{ "inherit": true }` removes the key at
that scope, so the inherited key applies there again. `null` is refused: the URL key is required.
A key is lower-case kebab case, at most 160 characters. A key for a sales channel the product is not
in, or a language the channel does not offer, is refused with `422 SCOPE_INVALID`; a key left behind
by a channel the product has left is shown as **No longer applies** and can be removed.

- **A key another product holds** in that channel, in any of its languages, is refused with
  `409 URL_KEY_TAKEN`, naming the product (`details.conflicts`). A deleted product's Global key
  stays taken; its Channel and Channel × language keys are released.
- **A key that is another product's redirect** answers `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED`,
  naming the product that would lose the redirect (`details.takeovers`). Sending the same request
  again with the key in `confirmTakeover` takes it over. Only an operator can do this; an
  integration never takes over a redirect.
- **A changed key stays as a redirect** at each channel and language where it was effective,
  pointing at the product, not at a key, so redirects never chain. At most 50 are kept per product and
  channel; the oldest is dropped and named in the audit entry. A redirect is kept until an operator deletes it:
  `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`). Deleting
  a product removes its redirects. While `seo` is off the answer leaves `redirects` out, but the
  rows stay and keep reserving their keys.

A `PUT` is one audited Command, `product.url_keys.update`, whose before-state sent back through the
same route restores the keys; a redirect delete is `product.url_redirect.delete`. Both announce
`product.updated.v1` with `changedFields: ["urlKeys"]`. A `PUT` that changes nothing writes no audit
entry and leaves the product's version. A new or duplicated product's Global key is chosen free of
every live product's keys and redirects.

## On the storefront

`GET /api/v1/catalog/products/resolve/:key` resolves a key at the request's sales channel and
language:

- the product's effective key there answers `{ kind: "product", productId, key }`;
- another current key of the product at that channel and language (its Channel or Global key where
  a narrower key overrides it), and — while `seo` is on — its redirects there, answer
  `{ kind: "redirect", key, languageCode, path, permanent: true }`, `path` being the product's URL to
  redirect to;
- a current key of the product in another language of the channel answers the same with
  `permanent: false`: a key held in another language today may be another product's tomorrow;
- a key of no product there, and a product that is not available to the caller there, answer the
  same `404 PRODUCT_NOT_FOUND`; an archived product answers `410 PRODUCT_ARCHIVED`.

`GET /api/v1/catalog/products/:idOrSlug` accepts an id, a current key at the request's channel and
language, or a product's Global key — never a redirect. The product detail carries
`paths: { canonical, alternates }`: the page's URL at the request's channel and language, and one
per channel language where the product is available to anonymous visitors. `slug` on the listing,
the product detail, grouped and bundle children and product-link tiles is the effective key at the
request's channel and language.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `URL_KEY_TAKEN` | 409 | The key is another product's key in that channel (any language), or, for a Global key, anywhere |
| `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | 409 | The key is another product's redirect and the write did not confirm the takeover |
| `URL_REDIRECT_NOT_FOUND` | 404 | `:redirectId` is not a redirect of the product |
| `SCOPE_INVALID` | 422 | A key for a channel the product is not in, or a language the channel does not offer |
| `PRODUCT_NOT_FOUND` | 404 | The storefront resolve found no product available to the caller |
| `PRODUCT_ARCHIVED` | 410 | The storefront resolve found an archived product |

## Integrations

What a connector, a PIM synchronisation or a spreadsheet writes, and at which scope. An integration
writes only the scopes it names: writing a Global value never removes an operator's override at a
sales channel or a channel and language (FR-091).

Connectors write through `catalogProductScopeWritePort.applyScopes` (version 2): a list of cells,
each a scope (`{}`, `{ channelId }` or `{ channelId, languageCode }`), a field path and a value in
the write encoding — absent for no change, `null` for deliberately empty, `{ "inherit": true }` to
remove the own value. A connector may write the name, the description, attribute values, gallery
alt text, attachment names and descriptions, packaging-unit names, the status, the publication
window and the URL key. Every other field — the audience, Global-only product fields, SEO, gallery
roles, hidden flags, the minimum order quantity and returnable — is refused per cell with
`not_supported`; the rest of the call still applies. How a PIM's locales become scopes is the
import profile's mapping, described on the `import_export` and `pim_connector` pages.

**URL keys from an integration are never forced.** A key that is another product's key in that
channel, or another product's redirect, is not written: the product keeps its previous key at that
scope and the call reports, per key, `{ written: false, issue: { languageCode, channelId, key,
heldByProductId, kind } }` — `kind` is `current` or `redirect`. An integration never takes over
another product's redirect and is never asked to confirm one; only an operator can, in the product
editor (FR-093). An integration reserves at most 1 000 new keys per run; the rest are reported as
`limit_reached`.

**No completeness check runs** on an integration's write; the operator's warnings about missing
names and keys in a scope are an editor feature.

**The products CSV** writes the same scopes through column headers `<field>`, `<field>@<channel
code>` and `<field>@<channel code>/<language>`, with the cell tokens `NULL` and `INHERIT`; the
`import_export` page describes the grammar. Every write is audited and announced with
`product.updated.v1`, whose `changedFields` name what changed.
