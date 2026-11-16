---
'@endora-commerce/contracts': minor
---

New helpers for writes that store asset ids (issue #544):

- `contentAssetIds(tree)` collects the asset ids a Page Builder or document tree carries. These are the non-empty strings under any key ending in `assetId`.
- `unlinkableAssetIds(assets, proposed, current)` returns the ids a write newly adds that `AssetReadPort.visibleToCaller` does not return. Ids in `current` are not asked about.
- `assetIdSettingValidator({ contributorModuleId, codes, assets, refuse })` builds a `SettingWriteValidator` for a setting whose value is one asset id.

`SettingWriteValidationInput` gains an optional `currentValues`: every value the setting holds before the write. `settings` always sends it.
