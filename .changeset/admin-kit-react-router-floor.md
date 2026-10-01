---
"@endora-commerce/admin-kit": minor
---

The `react-router-dom` peer floor rises from `^7.14.2` to `^7.18.2`, the first version clear of
the open react-router security advisories (GHSA-qwww-vcr4-c8h2, GHSA-chx6-hx7r-mcp5,
GHSA-8x6r-g9mw-2r78 among them). No `admin-kit` export changes; an admin project still on an
older 7.x must upgrade `react-router-dom` alongside it, which is why this is a `minor` in the
0.x series rather than a patch.
