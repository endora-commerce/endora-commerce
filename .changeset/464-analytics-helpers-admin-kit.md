---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
---

The analytics screen helpers that CRM and Projects each kept a copy of now live in the admin kit
(issue #464): `FigureCard`, `useFigure`, `useChartColors` and `prefersReducedMotion` from
`@endora-commerce/admin-kit/components`, and the range presets (`RANGE_PRESETS`, `presetRange`,
`isDayRange`, `DayRange`, `RangePreset`) from `@endora-commerce/admin-kit/lib`. `FigureCard`
takes the module's error sentence as `errorFallback`, and an optional `footer` drawn under every
answer. Both analytics screens use the kit copies and behave as before; Projects keeps its own
wrapper for the period and counts line under each figure.
