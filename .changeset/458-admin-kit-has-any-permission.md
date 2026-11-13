---
'@endora-commerce/admin-kit': minor
---

`useAuth()` now returns `hasAnyPermission(codes: readonly string[]): boolean` (issue #458). It
answers `true` when the signed-in admin holds any one of `codes` (a `'*'` role holds every code),
and `false` for an empty list. Use it instead of `codes.some((code) => hasPermission(code))`, and
write the codes as a literal array at the call: the permission inventory in
`@endora-commerce/mod-admin-roles` reads that literal, so each code is checked. A test that mocks
`useAuth()` for a component that calls `hasAnyPermission` must add it to the mock.
