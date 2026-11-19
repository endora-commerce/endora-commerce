---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-tasks': patch
---

Editor panels render as sections of the card they sit in, not as cards inside it (issue #1437, UX audit DS-03).

New in `@endora-commerce/admin-kit/ui`: `EditorSection`, a heading (`h2` by default, `as` like `CardTitle`), an optional one-line `description`, an `action`, and a rule between consecutive sections. It has a `chrome` prop: `'section'` (the default) or `'card'` for a section that stands alone on a page. Also new: `EditorSectionChromeProvider`, `useEditorSectionChrome`, and the types `EditorSectionChrome`, `EditorSectionHeading`, `EditorSectionProps` and `EditorSectionChromeProviderProps`. `Section` now renders through `EditorSection` without the divider; it looks and reads as before.

**Breaking visual change for modules (0.x, so released as a minor):**

- `CustomFieldValuesPanel` no longer draws its own `Card`. It renders as a section of the host's card. A panel mounted on its own, between cards, must pass `chrome="card"` to keep its card: `<CustomFieldValuesPanel chrome="card" … />`. It also takes `titleAs` (`'h3'` inside a titled card).
- `RecordHistory` and `CommentThread` list their entries as rows divided by a rule instead of a bordered box per entry. Both take `chrome="card"` to draw a titled card around themselves.
- `<AdminZone>` takes `chrome`. A contribution built on `EditorSection` renders as a section by default, and as a card of its own under `<AdminZone … chrome="card" />`. Use that prop for a zone mounted at page level. A contribution that draws its own `Card` is unchanged.

The CRM, Projects, Tasks, quote-request and quick-order panels contributed to the order, quote-request, opportunity, task, organization and customer screens are now built on `EditorSection`. Those screens mount their zones with `chrome="card"`, so the panels look as they did. The custom-field panels on the customer, organization, order-create, quote-request-create, opportunity-create, project-create and task screens keep their card. Project stages, template stages and project-create members are listed as divided rows.
