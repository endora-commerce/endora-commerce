---
'@endora-commerce/mod-assets-library': patch
---

The asset detail drawer no longer writes the MIME type or the visibility the moment an option is picked. The MIME type is staged in its select and written by a "Save MIME type" button, like the filename and the label beside it, with a line saying it overrides the type detected from the file. Visibility is shown as a badge with a "Change…" button that opens a dialog naming what the change does before it is confirmed. Without `assets.write` both are read-only, and the visibility control says why. The visibility labels are now capitalised ("Public" / "Private").
