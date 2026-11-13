---
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-crm': patch
---

The attachment lists of Tasks, Projects and CRM Opportunities resolve every file's download link in one batched `assetReadPort.resolveUrls` read instead of one `assetsLibraryPort.getAsset` call per file (issue #545). The full asset detail asked every registered asset-reference descriptor about each attached file, so a list of N files issued about 12 × N reference statements. The links are unchanged: the same signed, expiring URL for a private file, with `download=1`. A host that composes these services itself must provide `resolveUrls` on the `assets` dependency (it is part of the published `AssetReadPort`).
