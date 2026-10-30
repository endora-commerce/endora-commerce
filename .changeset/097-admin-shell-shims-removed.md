---
'@endora-commerce/admin-shell': patch
'@endora-commerce/admin-kit': patch
---

`@endora-commerce/admin-shell` no longer carries its 67 re-export shims over `@endora-commerce/admin-kit` (`lib/api-client`, `lib/auth`, `components/ui/*`, `i18n/*` and the rest). The shell imports every one of those bindings from `@endora-commerce/admin-kit/lib`, `/ui`, `/components` or `/i18n` directly. None of the shims was reachable through the package's `exports` map, so nothing a consumer can import has changed: `AuthProvider` and the `AdminMe` / `AuthProviderProps` types are still exported from the package root, and are the kit's own bindings as before. A test that replaces one of these bindings with `vi.mock` must name the kit specifier (for example `vi.mock('@endora-commerce/admin-kit/lib', …)`, spreading the original module) — a mock on an old `admin-shell/src/...` path no longer has a file to resolve to.
