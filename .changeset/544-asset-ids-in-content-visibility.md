---
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-document-templates': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-sales-channels': minor
---

**Breaking change:** a write that newly stores an asset id is now refused unless the administrator can see that file in the asset library. This covers a file that does not exist as well (issue #544). Before, these writes stored the id without checking it. A file hidden from the administrator, for example one attached only to a Task they cannot read, then appeared in the library for every reader or in public output.

The check applies to:

- CMS page, block and template content, and a page's sharing image (`shareImageAssetId` on page create and update).
- A category's page content and a product's Page Builder content attributes.
- A blog post's content and a blog category's description.
- Document template content and the template preview. The preview renders the image bytes into the PDF, so it checks every image it names.
- These settings: `shop.logo_asset_id`, `pwa.icon_asset_id` and `cms.default_share_image_asset_id`.
- A sales channel's `logoAssetId`, on create and update.

A refused write answers `404` and stores nothing. A hidden file and a missing one get the same answer. The cms, document template, settings, pwa and sales channel paths answer `ASSET_NOT_FOUND` with `details.assetId`. The catalog and blog paths answer `NOT_FOUND` with `Asset <id> not found.`, as their main-image refusal already does.

Ids the record already stores are not checked, so existing content saves as before, including a body that still embeds a file that has since been purged. Only an id the write adds is checked.

**What to do:** an integration or import that writes content bodies, logos or these settings must use asset ids that exist. When it runs as an administrator, that administrator must be able to see the files in the library. `sales_channels` now declares `assets_library` as a dependency. `settings` already did, so module order does not change.
