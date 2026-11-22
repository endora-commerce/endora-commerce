---
'@endora-commerce/admin-kit': patch
---

**The product browser's status strip is the kit `Tabs`, and its empty list is the kit `EmptyState`** (issues #1445, #1448).

- **Status tabs.** *All / Active / Inactive / Archived* now follow the WAI-ARIA tabs pattern: the strip is named ("Product status"), it is one stop in the tab order, ←/→ and Home/End move and select, every tab names the list as the panel it controls, and the count is part of the tab's accessible name ("Active, items: 25"). As on every other kit strip, a count of zero draws no badge. While *Show selected only* is on, the tabs are disabled and none is selected, because the review lists the selection across every status; *Show all products* leaves it, as before.
- **Empty list.** A search or type filter that matches nothing shows the kit's no-results block with *Clear filters*, which clears the search and the type, keeps the tab and the selection, and puts focus back in the search box. A tab with nothing in it and no filter says so ("No archived products", "The catalogue has no products yet") without offering to clear anything.
- `RouteTabsZone` now draws the same strip markup as `RouteTabs`, through one shared internal frame. No visible change.
