---
'@endora-commerce/mod-comparisons': patch
---

The comparison PDF's language weighs `Accept-Language` by `q` (issue #1011). `pickExportLanguage` now goes through `requestScopeLanguage` from `@endora-commerce/contracts`: the tags in descending `q`, each matched against the sales channel's languages (exactly, then by base language), and the first one the channel offers wins, else the channel's default. It used to strip `;q` without sorting by it, so `en;q=0.2, pl;q=0.9` exported an English PDF. The PDF now also always matches the language the comparison view reads product names in.

`pickExportLanguage` takes the resolved channel (`id`, `defaultLanguage`, `languages`) and accepts a repeated header as an array. The `en-US` fallback for a channel without a default language is gone, because every sales channel has one.
