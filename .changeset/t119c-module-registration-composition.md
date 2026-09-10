---
'@endora-commerce/platform': minor
---

`@endora-commerce/platform/composition` exports `ModuleRegistration`, the entity class the
`module_registrations` table is mapped by.

`host-package.md` §1.3 classifies this class **A** — not public API — and that classification is
applied here rather than revised: `./composition` is not public API either, and a consumer that may
name it has already composed the platform. It is deliberately **not** on `./kernel`, which would let
every module package name the row recording whether its siblings are installed.

Why it needed an address at all: an instance's generated entity registry has to hand this class to
MikroORM, and it was the one platform entity class no barrel carried — so the generator named all
six of them by relative path into `packages/platform/dist/`, which resolves in the Endora checkout
and in no client's. With this export the registry names each class by the subpath that publishes it
(`@endora-commerce/platform/kernel` for `AuditLogEntry`, `SalesChannel`, `Setting`, `SettingGroup`
and `SettingValue`; `@endora-commerce/platform/composition` for `ModuleRegistration`).

For a consumer this is additive: nothing moves off a barrel, no published subpath is added, and
`./kernel`'s surface is unchanged.
