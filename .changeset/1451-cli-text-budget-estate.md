---
'@endora-commerce/cli': minor
---

The estate manifest gains `check:text-budget` (issue #1451): a length budget on the English copy of five i18n key families — `*.page.description`, `*.subtitle` and `*.hint` at most 80 characters, `*.help` at most 280, `settingLabels.*.description` at most 120. `endora check` lists it as a `package`-scope rule whose package host is pending the relocation of the analysis into `./rules`.
