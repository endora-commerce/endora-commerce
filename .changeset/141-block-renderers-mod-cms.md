---
"@endora-commerce/mod-cms": minor
---

The CMS editor renders a module's block with the renderer that module contributes through its `./admin` layer, and a declared block nothing renders is now insertable and editable from its declared fields behind a neutral preview — it used to be a placeholder with no editable field. The documentation page *Extending the Page Builder* describes how a module package ships its renderers. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).
