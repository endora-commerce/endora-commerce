---
'@endora-commerce/mod-pim-unopim': patch
---

A re-import now updates what changed at the source, and empties category
assignments the source dropped.

**Prices, media and every other product field.** After a first import, a
subsequent run walked the whole product stream again whenever the connection
held a category mapping and no linked product carried a category row — which is
the ordinary state of a UnoPim catalogue whose products are not filed under
categories. Because the run awards the first copy of a source SKU it meets and
counts the rest as duplicates, the walk never reached the source change sitting
past the bookmark. In a shop that had bound a price attribute to a price list,
the amount written by the first import was the amount it kept selling at, for
every run after it; a media file changed in UnoPim was never re-fetched; and a
run over an unchanged source reported every product as considered instead of
nothing. The re-walk still happens for the one case it was written for — a
category mapping that appeared after the products were walked — and now stops
after it, because that walk moves the bookmark it is asked about.

**Category assignments (FR-045).** A source product that no longer names any
category left its Endora assignments in place: the import derived the write
from the categories it had projected, and an empty projection produced no
write at all. Assignments are replaced to match the source, and a source that
places a product nowhere now empties them. A protected assignment on a
non-empty source is still skipped, unchanged.

Nothing to do on upgrade. The first run after it re-reads only what the source
reports as changed; a shop whose prices had frozen sees them follow the source
again on that run.
