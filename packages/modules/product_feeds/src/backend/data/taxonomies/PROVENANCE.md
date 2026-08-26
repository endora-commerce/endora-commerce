# Bundled provider taxonomies — provenance and data drop

Feature 067 (Product Feed), FR-077 / FR-078 / FR-098. Contract:
`specs/067-product-feed/contracts/admin-taxonomy-mappings.md` §2. Rationale:
`specs/067-product-feed/research.md` §R10 and §R25.

**This file describes what shipped in the image, and nothing else.** A revision
can also arrive from the optional, off-by-default taxonomy check
(`services/taxonomy-refresh.service.ts`), and a fetched revision is **never
written here** (FR-098): it is parsed in memory and inserted straight into
`product_feed_taxonomies` + `product_feed_taxonomy_nodes`, with its source URLs,
fetch time and content hash recorded on the row. This directory stays a
read-only vendored artefact of the image — writing downloads into it would make
the image's own source tree mutable, would be lost on every redeploy, would
differ between replicas, and would corrupt the one file whose job is to state
where the bundled bytes came from.

---

## Status: **the vendor files ARE bundled** (product decision, 2026-08-02)

The four files listed under "The drop" are vendored in this directory. The decision was taken
knowingly, with the licensing question below still open — see "Licensing".

If a drop is ever removed (see "Licensing"), everything still degrades cleanly:

- `TaxonomyReconcilerService.reconcile()` finds no revision directories and installs nothing;
- the module boots normally, `GET /api/v1/admin/feed-taxonomies` returns an empty collection, and
  the category-mapping screen says no taxonomy is installed;
- `g:google_product_category` resolves to "unmapped", which omits the field and still emits the
  item (FR-083) — exactly the behaviour an unmapped category already has.

Dropping files into the layout below is the whole installation step. No code change is needed,
which is what makes this decision reversible.

## Layout

```
data/taxonomies/<providerCode>/<revision>/<language>.txt
```

`<providerCode>` is the value from `taxonomyProviderCodeSchema` — `google_merchant` or `meta` —
so the directory name *is* the provider code and no mapping table is needed. `<revision>` is the
provider's own published revision label. `<language>` is `en` or `pl`; `en` is authoritative for the
tree's structure and the other languages contribute labels only, which is what makes a stored
mapping language-independent (FR-085).

Files are vendored **verbatim**, exactly as downloaded. Do not reformat, sort, transcode or strip
them: `taxonomy-file-parser.ts` accepts both vendor shapes as published, and a hand-massaged file
would destroy the ability to re-derive the drop from its source.

## The drop

| Provider | `providerCode` | Revision label | Language | Source URL |
| --- | --- | --- | --- | --- |
| Google Merchant Center | `google_merchant` | `2021-09-21` (from the file's own `# Google_Product_Taxonomy_Version:` header) | `en` | `https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt` |
| Google Merchant Center | `google_merchant` | `2021-09-21` | `pl` | `https://www.google.com/basepages/producttype/taxonomy-with-ids.pl-PL.txt` |
| Meta (Facebook/Instagram) | `meta` | `2026-08-02` — retrieval date, because Meta publishes no revision label | `en` | `https://www.facebook.com/products/categories/en_US.txt` |
| Meta (Facebook/Instagram) | `meta` | `2026-08-02` — same date as its `en` sibling | `pl` | `https://www.facebook.com/products/categories/pl_PL.txt` |

Retrieved **2026-08-02**, HTTP 200 on all four URLs. Bytes as downloaded: Google `en` 482 896,
Google `pl` 564 546, Meta `en` 230 286, Meta `pl` 281 076 (1.6 MB on disk including this file).
Meta's files carry a UTF-8 BOM and a `category_id,category` header row, as published.

Record the retrieval date in this table when a drop is made, and add a row rather than editing one:
an installed revision is immutable, and the history is what lets someone explain a mapping that went
stale two upgrades ago.

### Measured sizes (retrieved 2026-08-02)

| File | Size | Nodes |
| --- | --- | --- |
| `google_merchant/2021-09-21/en.txt` | 472 KB | 5 595 |
| `google_merchant/2021-09-21/pl.txt` | 551 KB | 5 595 |
| `meta/2026-08-02/en.txt` | 225 KB | 2 967 |
| `meta/2026-08-02/pl.txt` | 274 KB | 2 967 |
| **Total on disk** | **~1.49 MB** | 8 562 nodes |

Node counts are what `parseTaxonomyFile` actually returns for the vendored files, verified after the
drop; the Meta figure replaces an earlier pre-drop estimate of ~4 400. Every file's external ids are
unique. Maximum depth is 7 for Google and 6 for Meta.

One property worth knowing before debugging a mapping: Google's `pl` file is ordered by its
*localized* label, so it does **not** line up row-for-row with `en` (its first row is id `141`, not
`1`). Nothing depends on file order — the external id is the join key, and `en` is authoritative for
structure — but a diff of the two files is not meaningful.

That matches the ~1.5 MB the plan assumed (research §R10), so the packaging cost is as budgeted:
the files ship in the image because `backend/Dockerfile` does `COPY backend/ backend/` and runs the
app from `src/` through `tsx`, the same mechanism that makes `src/modules/*/i18n/*.json` resolvable
at runtime.

Note that Meta's `pl_PL` file is **not** a translation of `en_US` line-for-line — it is the same tree
with localized labels, and the parser treats `en` as authoritative for structure precisely so a
partial translation cannot invent or drop nodes.

## Licensing — OPEN, and vendored anyway

Neither file carries a licence header, and neither is served from a documentation site under an
explicit open licence:

- **Google**: `https://www.google.com/basepages/producttype/…` responds `content-type: text/plain`
  with no licence notice. The taxonomy is published for merchants to categorise their own products
  in Merchant Center feeds. Google's developer documentation is generally CC BY 4.0, but this file
  is not part of `developers.google.com` and carries no such grant, so **redistribution rights are
  not explicitly granted**.
- **Meta**: `https://www.facebook.com/products/categories/…` responds `content-type: text/csv` with
  no licence notice, governed by Meta's general Terms of Service and Platform Terms, which do not
  obviously permit redistributing the dataset inside another product.

Both are therefore **unclear rather than permissive**.

**The decision taken (2026-08-02): bundle them anyway.** The rationale is that this matches the
established practice of comparable commercial products — Mirasvit's Magento 2 feed extension ships
its taxonomy files inside the package (`vendor/mirasvit/module-feed/src/Feed/Setup/data/mapping`)
and offers autocomplete over them, and Mageplaza advertises category mapping to the Google, Amazon
and eBay taxonomies working out of the box. Not every vendor does: Magmodules ships none and sends
the merchant to Google's file to look the category up by hand.

Recorded plainly so nobody later mistakes this for a cleared question: **prevailing industry
practice is not a licence grant.** Neither provider has granted redistribution rights in writing,
and this remains open pending legal sign-off.

If sign-off is refused for a provider, delete that provider's revision directory. Two supported
alternatives remain, and neither needs a code change:

- a **deployment-time** drop — the operator fetches the file into a mounted directory during
  installation and `TaxonomyReconcilerService` is pointed at it via `dataRoot` (the option exists
  and the tests use it);
- the **taxonomy check** (FR-086), which the operator turns on themselves: it downloads the
  provider's own published file into the database, never onto disk, and installs it inactive until
  somebody promotes it.

Both keep the property FR-077 was written to buy — *feed output never depends on a third party
being reachable* — because generation reads the revision in force from Postgres and contacts
nobody.
