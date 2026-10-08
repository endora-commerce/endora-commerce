---
'@endora-commerce/mod-cms': patch
---

The CMS page, block and template editors no longer squeeze the Page Builder on
mid-width screens.

The settings panel becomes a column beside the builder from 1800px instead of
1536px: between the two, the canvas was under 300px wide and the builder's
toolbar clipped its own title. Below 1800px the panel still sits above the
canvas, and it now starts collapsed there when editing existing content, so the
builder is on the first screen; "Show settings" opens it. A choice the operator
has already made is kept, a new page, block or template still opens the panel,
and a refused save still reveals it.
