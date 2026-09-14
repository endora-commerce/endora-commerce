---
'@endora-commerce/mod-catalog': patch
---

The attribute page's "See also" refers to `promotions` by name instead of
linking `../promotions.md`. `promotions` is not in the module set
`endora new instance` writes, so the relative link named a page that is not in
an instance's documentation tree and `onBrokenLinks: 'throw'` refused the whole
site. The sentence now says the same thing whether or not the reader installed
the sibling.
