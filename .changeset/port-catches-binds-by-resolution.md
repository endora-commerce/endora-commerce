---
'@endora-commerce/cli': patch
---

The `port-catches` rule no longer reads one module's catches through another module's sources. A call's arguments bind a callee's parameters only when the call site's file declares the callee or imports it through a relative specifier (followed through relative re-exports), instead of whichever declaration of that name the walk read last; and the gates an alias carries are those of the alias scopes visible where the site reads it, instead of every alias of the same spelling. A module's classification therefore no longer changes when another module's sources are added to or removed from the population. Sites that existed only through a same-named declaration in another module disappear from `findPortCatches`.
