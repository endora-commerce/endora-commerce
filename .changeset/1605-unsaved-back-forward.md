---
'@endora-commerce/admin-shell': minor
'@endora-commerce/admin-kit': minor
---

The browser's Back and Forward buttons now ask before they leave a screen with unsaved changes (issue #1605). `AdminRoot` mounts a data router (`createBrowserRouter` with `RouterProvider`, transitions still off) instead of a component `<BrowserRouter>`; the whole app is one splat route, so the shell's `<Routes>`, links and relative paths behave as before. `useUnsavedChangesGuard` asks Save / Discard / Stay and `useUnsavedChangesPrompt` asks with the browser's confirm, both through React Router's blocker. Only a history step to another path is asked about; a step that changes only the query is left to the screen. A project that composes its own tree under a component router keeps the previous behaviour: Back and Forward are not intercepted there.
