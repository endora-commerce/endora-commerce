---
'@endora-commerce/platform': patch
---

A module's install or uninstall hook that logs no longer breaks `module:install --json` (issue #825). The orchestrator's default lifecycle logger — the one every hook is handed on the `module:*` path — wrote with `console.log`, so a hook's `log.info(...)` landed on stdout in front of the JSON document.

That logger now writes through the platform's attached log destination when one is attached, and falls back to the console only when none is. Under a `module:*` command that destination is `attachOperatorDiagnostics(err)` (issue #819), so a hook's line arrives on the command's error channel as one JSON line, beside the platform's own; in a built server it is the server's logger.
