---
'@endora-commerce/mod-megamenu': patch
---

The megamenu item panel names its target pickers in plain words (issue #1467). "Category id", "CMS page id", "Asset id" and "CMS block id" are now "Category", "Page", "Image" (or "Video", when the item shows a video) and "Content block", in English and Polish, and each label is linked to its picker through the kit `FormField`. The bundle keys `fields.categoryId`, `fields.cmsPageId`, `fields.assetId` and `fields.cmsBlockId` are replaced by `fields.category`, `fields.cmsPage`, `fields.assetImage`, `fields.assetVideo` and `fields.cmsBlock`.

In the item tree, "Move up" and "Move down" are 32 px icon buttons with an accessible name, and the first and last item of a level cannot be moved past the end. "Add child item" and "Delete item" moved into a row menu named "Actions for <item>", with delete last.
