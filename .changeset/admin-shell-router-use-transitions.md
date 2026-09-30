---
"@endora-commerce/admin-shell": minor
---

`AdminRoot` passes `useTransitions={false}` to its `<BrowserRouter>` again, and the
`react-router-dom` peer floor rises from `^7.14.2` to `^7.18.2`.

react-router 7.15.0 renamed `unstable_useTransitions` to `useTransitions` and ignores the old
spelling at runtime. Since `^7.14.2` resolves to 7.18 on a fresh install, every published
`admin-shell` has been mounting the router with transitions on: navigating to a module screen
that is still loading changed the URL and left the previous screen (and `useLocation()`) in
place, so the sidebar appeared to do nothing. Upgrading fixes it with no change on your side.

This is a `minor` because the peer range moves: an instance pinned below `react-router-dom`
7.18.2 has to upgrade it (`pnpm add react-router-dom@^7.18.2` in the admin project). 7.18.2 is
also the first version clear of the open react-router advisories (GHSA-qwww-vcr4-c8h2,
GHSA-chx6-hx7r-mcp5, GHSA-8x6r-g9mw-2r78 and the medium/low ones before them). A project that
mounts `App` inside its own router rather than using `AdminRoot` should pass
`useTransitions={false}` itself; `unstable_useTransitions` no longer does anything.
