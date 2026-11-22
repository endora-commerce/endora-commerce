---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-tasks': patch
---

Record-tab zones: a module can add a whole tab — a label, an optional count and a panel — to another module's record tab strip. `@endora-commerce/contracts` adds the zone `opportunity.detail.tabs` (props `OpportunityDetailZoneProps`), `RECORD_TAB_ZONE_NAMES` with `RecordTabZoneName` and `isRecordTabZoneName`, `RecordTabDeclarationSchema`, an optional `tab` on a zone contribution (required on a record-tab zone, refused on every other one) and the TypeScript-only `count` factory (`AdminCountFactory`). `@endora-commerce/admin-kit` adds `recordTabComponent()` on `./contributions`, which takes only a record-tab zone and type-checks the panel and the count loader (`RecordTabCounter`) against the zone's props, and `useRecordTabZone()` on `./zones`, which returns the visible contributed tabs with their labels and counts and renders the selected panel; `zoneComponent()` now refuses a record-tab zone at compile time. The CRM opportunity screen renders `opportunity.detail.tabs` after its *Events* tab and selects a contributed tab from `?tab=<id>`. The Tasks module's panel on an opportunity left `opportunity.detail.sidebar` and is now a *Tasks* tab (`?tab=tasks`) on `opportunity.detail.tabs`, whose count is the open linked Tasks; the order and quote-request sidebars keep their *Tasks* sections. `check:admin-zones` reads `useRecordTabZone('<zone>', …)` as a render site and `recordTabComponent('<zone>', …)` as a contribution.
