---
'@endora-commerce/cli': patch
---

The admin route reader behind `check:action-route-permissions` reads registrations whose path is
not a literal at the call site. A route registered through a `const` (`app.get(base, …)`), through
a local helper's parameter (`patchRoute(url, …)`), as a `+` concatenation, as a member of a table
declared in the file, with `app.route({ method, url, … })`, or with `.all` / `.head` / `.options`
was not read as a registration at all, while the summary's `unreadable-paths` said `0`. Four admin
routes in this repository were in no route record for that reason.

A registration whose path still cannot be resolved is now reported in `RouteScanResult.unreadable`
(file, line and the path as written) instead of being skipped, unless the part that was read
already shows the path is outside `/api/v1/admin`. `unreadablePaths` is that list's length.

`RouteScanInput.pathBindings` lets a caller supply the values of a path identifier no declaration
in the file provides — a registrar mounted under a prefix it is handed.

`requireAdmin('')` is read as `requireAdmin()`: the guard returns before checking anything when
the code is empty, so the route is open to any administrator session and is reported that way.

For `check:action-route-permissions` itself the verdicts are unchanged in this repository: one
action now resolves at the `exact` level instead of `subtree`, to the same code.
