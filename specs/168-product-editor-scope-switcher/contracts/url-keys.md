# Contract: URL keys and redirects in the three-level model (FR-016; replaces 163 data-model §5)

Owner: `catalog` (`url-key.service.ts`, `url-key-resolution.service.ts`). Decision: research R12. Storage:
`data-model.md` §5.

## 1. Definitions

- **Keys of P at (C, L)** — the **effective** key: P's C×L row → P's C row → `P.slug`.
- **Addressable pairs of P** — every (C, L) with C a member channel of P and L ∈ C.languages, **plus** every
  (C, L) or (C, ·) named by an **orphaned** row of P (round 3: orphans keep reserving).
- **Taken at (C, L)** — a key `k` is taken at (C, L) by Q ≠ P when `k` is Q's effective key at an addressable pair
  (C, L) of Q, or Q's own row at exactly that scope (orphan included), or a redirect `(C, L, k) → Q`.

## 2. Invariants

1. No two products share an effective key at any (C, L) (FR-016).
2. A product's Global key (`slug`) equals no other product's key — slug, C row or C×L row, orphan included — at
   any scope, and no other product's redirect at any (C, L) unless taken over (163 FR-072 takeover, operator only).
3. A redirect `(C, L, k)` never points at a product whose effective key at (C, L) is `k` (no self-redirect) and
   never chains (it stores the product, not a URL).

## 3. Write rules (inside the save Command or the URL-key route; `pg_advisory_xact_lock` per touched key, sorted)

| Writing key `k` for P at scope S | Outcome |
| --- | --- |
| `k` taken at some pair S covers (S = C×L → that pair; S = C → every L of C; S = G → every pair of every channel and every key of every product) | `409 URL_KEY_TAKEN` naming the holder(s) per pair |
| `k` is Q's redirect at a pair S covers | `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` naming Q, unless `confirmTakeover` contains `k` → Q's redirect rows for `k` at those pairs deleted |
| `k` is P's own redirect at a pair S covers | that redirect deleted (no self-redirect) |
| P's effective key at a pair changes from `k0` to something else (by any write at S, including `inherit`) | redirect `(C, L, k0) → P` inserted at each such pair, unless `k0` is P's new effective key there |
| `inherit` at C or C×L | the row deleted; P's key at the covered pairs becomes the inherited one, which is then checked as a write of that key at those pairs (taken → refused naming the holder; the operator sets another key instead) |
| `empty` | refused — the URL key is required (FR-062) |
| Writing at an orphaned scope / removing an orphaned row | removing is always allowed (163 FR-015); writing is `422 SCOPE_INVALID` |

Imports and connectors take the same checks and **never** take over: a refused key is reported and the previous
key kept (163 FR-093).

## 4. Resolution of key `k` at (C, L) (storefront)

1. A product whose effective key at (C, L) is `k`, member of C, L offered → that product.
2. Else a redirect `(C, L, k)` → 301 to the product's effective path at (C, L) — served only when `seo` is present
   (163 FR-111, unchanged).
3. Else not found.

`productPath()` (163 D7) is unchanged in signature; it is fed the effective key at (C, L).

## 5. Admin

The editor shows one URL-key field at the editor scope (`ScopedFieldView<string>`), saved by the save Command
(`scoped-values-api.md` §3). The redirect list (163 Q-C: hidden with `seo` off) shows the redirects at the editor's
(C, L) at C×L, at every L of C at C, and all at G, each deletable (Command `product.url_redirect.delete`,
unchanged).
