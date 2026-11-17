---
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-blog': minor
---

**Breaking change:** in Page Builder content, an asset id now counts as a reference to a library file only when it is stored under a key ending in `assetId`, such as `assetId`, `iconAssetId` or `mainImageAssetId`. The key match ignores case (issue #1359). This covers CMS pages, blocks and templates, a category's page content, a product's content attributes, a blog post's content and a blog category's description. Before, any string equal to an asset id counted, whatever its key. A file hidden from an administrator could then be stored under another key, which the save check does not read, and the file appeared in the library for every reader.

An id under any other key was never rendered. It no longer protects the file from deletion and no longer makes a hidden file visible. A page's sharing image column counts as before.

The catalog and blog content saves now refuse an asset id the administrator cannot see with `404 ASSET_NOT_FOUND` and `details.assetId`, like the CMS and the other modules. They answered `404 NOT_FOUND` before. The category, post and blog category main-image refusals are unchanged.

**What to do:** content that places a library file in a custom component must store its id under a key ending in `assetId`. That is also the only key the storefront renders a file from. A client that reads `NOT_FOUND` from a catalog or blog content save should read `ASSET_NOT_FOUND`.
