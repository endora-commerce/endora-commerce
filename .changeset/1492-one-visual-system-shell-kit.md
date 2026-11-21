---
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
---

The Home dashboard, the command palette's prompt mode and the admin kit's shared components now use one visual system: the kit's `ui/*` primitives and Tailwind utilities instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

- Home (issue #1556): the quick actions are a short list of links instead of four full-width buttons. The stock-alert thumbnails use the sunken-surface colour token instead of a fixed grey gradient, so they follow the dark theme. The KPI tiles, the recent-activity feed and the stock alerts are kit `Card`s with `h2` titles, and the activity feed's loading state is announced.
- Prompt mode: the clarification text box is the kit `Input` and now has a name.
- Admin kit: `PaginationFooter`, the product browser and its trigger, `SaveSessionActions` and `RecordTabs` draw kit `Button`, `Select` and `Card` parts. The product browser's search box is the list toolbar's search. Its side-drawer frame stays until the kit has a drawer.
- The theme still defines the classes these screens stopped using: `b2b-btn--default`, `b2b-field--addon`, `b2b-input-wrap`, `b2b-card--clickable`, `b2b-card__head`, `b2b-card__sub`, `b2b-card__title`, `b2b-card__foot`, `b2b-card__body--flush`, `b2b-filterbar`, `b2b-filterbar__search`, `b2b-kpi-grid`, `b2b-home-dashboard-grid` and `b2b-thumb`. A theme override that targets one of them no longer reaches these screens.
