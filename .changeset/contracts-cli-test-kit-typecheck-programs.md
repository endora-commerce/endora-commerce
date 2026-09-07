---
---

Build configuration only: the test files of `@endora-commerce/contracts`,
`@endora-commerce/cli` and `@endora-commerce/test-kit` now enter each package's
type-check program, where before they entered none. Nothing any of the three
publishes changes — the emitted `dist` is byte-identical, because the test
exclusion moved from the type-check half of each package's tsconfig pair to the
emit half rather than being dropped.
