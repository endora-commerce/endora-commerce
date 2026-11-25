---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-projects': minor
---

Two admin zones are new on the Project detail screen (issue #1905): `project.detail.after`, the stack of cards the screen ends with, and `project.detail.sidebar`, a sidebar card beside the tabs whose every contribution is a section. Both carry `ProjectDetailZoneProps` — `{ projectId }` and nothing else — exported by `@endora-commerce/contracts`. A module adds a panel with `zoneComponent('project.detail.after', …)` or `zoneComponent('project.detail.sidebar', …)`; the sidebar is drawn only while something fills it, and with the contributor switched off, or for a reader without its permission, the screen is exactly the one without the zones. There is no `project.detail.tabs`: the Project's tab strip takes no contributed tab.
