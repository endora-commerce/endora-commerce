# Contract: URL keys and redirects in the three-level model (FR-016; replaces 163 data-model §5)

Owner: `catalog` (`url-key.service.ts`, `url-key-resolution.service.ts`). Decision: research R12. Storage:
`data-model.md` §5.

## 1. Definitions

- **Effective key of P at (C, L)** — P's C×L row → P's C row → `P.slug`.
- **P's keys in channel C** — every `product_url_keys` row of P with `sales_channel_id = C` (any language,
  orphans included), plus `P.slug` when P is a member of C and some language of C has no row of P.
- **Taken in C by Q ≠ P** — `k` is one of Q's keys in C, or Q holds a redirect `(C, any L, k)`.

## 2. Invariants (FR-016, spec round 7)

1. A key text belongs to **at most one product per channel, across all the channel's languages**, orphans
   included; the same product may hold it at several languages. Row-vs-row: the exclusion constraint
   `exclude using gist (sales_channel_id with =, key with =, product_id with <>)` (`data-model.md` §5).
   Slug-vs-row and redirects: code, under the lock of §3.
2. A product's Global key (`slug`) equals no other product's slug, row key (any channel, orphans included) or
   redirect — one indexed query.
3. A redirect `(C, L, k)` never points at a product whose effective key at (C, L) is `k`, never chains, and at most
   50 exist per (product, channel) (oldest dropped, listed in the audit).

## 3. Write rules — one helper for every writer

Every key writer — product create, slug `PATCH`, the save, `PUT …/url-keys`, bulk edit, CSV import, the connector
port, overview reset — calls `UrlKeyService.lockAndCheck(em, writes)`, which takes
`pg_advisory_xact_lock(hashtextextended('catalog.url-key:' || key, 0))` for the sorted set of: each new key, each
outgoing key `k0`, the key that becomes effective after an `inherit`, and the slug fallback; with a 5 s
`lock_timeout`. A G write and a C×L write of the same key therefore serialise. Ownership test: no other code
writes `product_url_keys` or `products.slug` (T149).

| Writing key `k` for P at scope S | Outcome |
| --- | --- |
| S = C or C×L, and `k` is taken in C (§1) — any row with channel C and key `k` of another product, whatever its language, or another product's slug that is its key in C | `409 URL_KEY_TAKEN` naming the holder |
| S = G, and `k` is any other product's slug, row key or redirect anywhere | `409 URL_KEY_TAKEN` / takeover required, naming the holders |
| `k` is Q's redirect in C | `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` naming Q, unless `confirmTakeover` contains `k` (interactive `catalog:write` routes only) → Q's redirects for `k` in C deleted and listed in the audit before-state |
| `k` is P's own redirect in C | that redirect deleted (no self-redirect) |
| P's effective key at a pair changes from `k0` (any write at S, including `inherit`) | redirect `(C, L, k0) → P` at each such pair, unless `k0` is still one of P's keys in C |
| `inherit` at C or C×L | the row deleted; the key that becomes effective is checked as a write at the covered pairs (taken → refused, naming the holder) |
| `empty` | refused — the URL key is required (FR-062) |
| writing at an orphaned scope / removing an orphaned row | removing always allowed (163 FR-015); writing `422 SCOPE_INVALID` |
| a residual exclusion-constraint violation | `409 URL_KEY_TAKEN`, never a 500 |

**Grammar (R12).** `productSlugSchema` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 160) after NFC normalisation and
lower-casing, for every writer. Imports and connectors take the same checks, **never** take over, and reserve at
most 1 000 new keys per run (the rest reported `limit_reached`).

## 4. Resolution of key `k` at (C, L) (storefront)

1. A product whose effective key at (C, L) is `k`, member of C, L offered → that product.
2. Else a redirect `(C, L, k)` → 301 to the product's effective path at (C, L) — served only when `seo` is present
   (163 FR-111, unchanged).
3. Else not found.

`productPath()` (163 D7) is unchanged in signature; it is fed the effective key at (C, L). A redirect target is
built only by `productPath()`: a relative path whose segments pass through `encodeURIComponent` (negative tests:
`//host`, `/\\host`, `..`, `%2f`, `:`, whitespace).

## 5. Admin

The editor shows one URL-key field at the editor scope (`ScopedFieldView<string>`), saved by the save Command
(`scoped-values-api.md` §3). The redirect list (163 Q-C: hidden with `seo` off) shows the redirects at the editor's
(C, L) at C×L, at every L of C at C, and all at G, each deletable (Command `product.url_redirect.delete`,
unchanged).
