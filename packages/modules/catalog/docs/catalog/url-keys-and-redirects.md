---
title: URL keys and redirects
---

# URL Keys and Redirects

A product's storefront address is `/p/<key>`. The key can differ per language, and per sales
channel and language:

- **global key** — the product's `slug`; it is the key in every language where the product has no
  key of its own;
- **language key** — one per language, for every sales channel;
- **sales channel × language key** — one per channel and language, overriding the language key there.

The **effective key** at a sales channel and language is the channel × language key, else the
language key, else the global key. Every product URL the platform emits — the storefront's
canonical and alternate-language links, the sitemap, a redirect target, the preview address in the
admin — uses the effective key, with `?lang=<language>` when the language is not the channel's
default.

A key is valid only in its own language, and is unique per language across all sales channels:
no two products share a key in one language. Changing a key keeps the previous one as a permanent
redirect in its language, straight to the current key; redirects are kept until an operator deletes
them. Redirects are served while the `seo` module is switched on; with `seo` off an old key answers
"not found", and the redirects come back when `seo` is switched on. A product's other **current** keys
are not redirects: with `seo` off too, a request for its language or global key where a channel ×
language key overrides it, or for another channel's key, still leads to its URL in that channel.

## Managing keys

In the product editor, the **URL keys** panel on the SEO tab shows the global key, a key per
language and a key per sales channel and language — an empty field uses the inherited key — and the
storefront URL each channel and language ends up with. While the `seo` module is on it also lists
the redirects the old keys keep.

`GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`) answers the same, and `PUT` on
the same path (`catalog:write`) writes it:

```json
{
  "globalKey": "cordless-drill",
  "languageKeys": [{ "languageCode": "de-DE", "key": "akku-bohrschrauber" }],
  "channelKeys": [{ "channelId": "<retail-uuid>", "languageCode": "pl-PL", "key": null }]
}
```

A list or key left out is unchanged; `key: null` removes the key at that scope, so the inherited
key applies there again. A key is lower-case kebab case, at most 160 characters. A key for a sales
channel the product is not in, or a language the channel does not offer, is refused with
`422 SCOPE_INVALID`; a key left behind by a channel the product has left is shown as **No longer applies**
and can be removed.

- **A key another product holds** in that language is refused with `409 URL_KEY_TAKEN`, naming the
  product (`details.conflicts`). A deleted product's global key stays taken; its language and
  channel keys are released.
- **A key that is another product's redirect** answers `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED`,
  naming the product that would lose the redirect (`details.takeovers`). Sending the same request
  again with the key in `confirmTakeover` takes it over. Only an operator can do this; an
  integration never takes over a redirect.
- **A changed key stays as a redirect** in its language, pointing at the product, not at a key, so
  redirects never chain. A redirect is kept until an operator deletes it:
  `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`). Deleting
  a product removes its redirects. While `seo` is off the answer leaves `redirects` out, but the
  rows stay and keep reserving their keys.

A `PUT` is one audited Command, `product.url_keys.update`, whose before-state sent back through the
same route restores the keys; a redirect delete is `product.url_redirect.delete`. Both announce
`product.updated.v1` with `changedFields: ["urlKeys"]`. A new or duplicated product's global key is
chosen free of every live product's language, channel and redirect keys.

## On the storefront

`GET /api/v1/catalog/products/resolve/:key` resolves a key at the request's sales channel and
language:

- the product's effective key there answers `{ kind: "product", productId, key }`;
- any other current key of the product in that language, and its redirects there (a former global
  key counts in every language), answer `{ kind: "redirect", key, languageCode, path }`, `path`
  being the product's URL to redirect to permanently;
- a key of no product, a key of another language, and a product that is not available to the caller
  there all answer the same `404 PRODUCT_NOT_FOUND`; an archived product answers
  `410 PRODUCT_ARCHIVED`.

`GET /api/v1/catalog/products/:idOrSlug` accepts an id, a current key in the request's language, or
a product's global key — never a redirect. The product detail carries
`paths: { canonical, alternates }`: the page's URL at the request's channel and language, and one
per channel language where the product is available to anonymous visitors. `slug` on the listing,
the product detail, grouped and bundle children and product-link tiles is the effective key at the
request's channel and language.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `URL_KEY_TAKEN` | 409 | The key is another product's key in that language |
| `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | 409 | The key is another product's redirect and the write did not confirm the takeover |
| `URL_REDIRECT_NOT_FOUND` | 404 | `:redirectId` is not a redirect of the product |
| `SCOPE_INVALID` | 422 | A key for a channel the product is not in, or a language the channel does not offer |
| `PRODUCT_NOT_FOUND` | 404 | The storefront resolve found no product available to the caller |
| `PRODUCT_ARCHIVED` | 410 | The storefront resolve found an archived product |

## Integrations

What a connector, a PIM synchronisation or a spreadsheet writes, and at which scope. An integration
writes only the scopes it names: writing a global value never removes an operator's override at a
sales channel or language (FR-091).

| Field | Scope it is written at | Through |
| --- | --- | --- |
| Status | sales channel, or sales channel × language | `catalogProductScopeWritePort.applyScopes` `status`; the products CSV columns `status@<channel code>` and `status@<channel code>/<language>` |
| Global status, visibility, name, description | global (name and description per language) | `catalogProductWritePort`; the products CSV's `status`, `visibility`, `name_en`, `description_en` |
| Publication window | global, or sales channel | `applyScopes` `window` (`channelId: null` is the global window) |
| Audience (visibility and organisations) | sales channel | `applyScopes` `audience` |
| Minimum order quantity, returnable | sales channel | `applyScopes` `orderRules` |
| URL key | language, or sales channel × language | `applyScopes` `urlKeys` (`channelId: null` is the language key) |
| Channel- or language-scoped attribute values | sales channel, language, or both | `catalogProductValueOverrideWritePort` |
| SEO title and description | language | `seoMetaWritePort` — sales channel SEO overrides are the operator's |

`null` as a value means "use inherited": the override at that scope is removed. A field the input
does not name is left as it is.

**URL keys from an integration are never forced.** A key that is another product's key in that
language, or another product's redirect, is not written: the product keeps its previous key at that
scope and the call reports, per key, `{ written: false, issue: { languageCode, channelId, key,
heldByProductId, kind } }` — `kind` is `current` or `redirect`. An integration never takes over
another product's redirect and is never asked to confirm one; only an operator can, in the product
editor (FR-093). A key for a sales channel the product is not in, or a language the channel does not
offer, refuses the whole call.

**No completeness check runs** on an integration's write; the operator's warnings about missing
names and keys in a scope are an editor feature.

**The products CSV round-trips.** The export carries one `status@<channel code>` column per sales
channel and one `status@<channel code>/<language>` column per channel language — the override at
that scope, empty where the scope inherits. Importing the exported file unchanged changes nothing;
an edited cell writes that scope, and an emptied one removes the override. A file without these
columns leaves every scope as it is. One invalid cell — an unknown channel code, a value for a
channel the product is not in or a language the channel does not offer, a value that is not a
status — rejects the whole file, as any other invalid row does.

Every write is audited and announced with `product.updated.v1`, whose `changedFields` name what
changed (`scopedStatus`, `publicationWindow`, `audience`, `orderRules`, `urlKeys`).
