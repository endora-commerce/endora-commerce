---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

**`@endora-commerce/platform` gains a sixth subpath, `./composition`, and it is not public API** (D-160.14; `specs/080-f4-real-scope/contracts/host-package.md` §2.7).

It carries the 27 composition symbols a composition root needs and no published barrel carries — `buildServer`, `composeModules`, `createRootContainer`, `registerOrm`, `registerValues`, `createRegistrationOwnership`, `registerRequestScopeHook`, `platformLogger`, `registryCache`, `publishStateChanged`, `activationDeclarationsFrom`, `requiredModulesFrom`, `composeSettingsKernel`, `ManifestReconciler`, `composeSalesChannelsKernel`, `DefaultChannelReconciler`, `createRequestLanguageResolver`, `AuditLogService`, `forkScopedEm`, `resolveTenantContext`, `systemTenantContext`, and the types `ModulePlugin`, `ApiInterceptorRegistry`, `KernelContainer`, `DecorationRecord`, `SettingsKernel`, `SalesChannelsKernel`.

**Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged. **No module may name `./composition`** — production source or test alike; a module's server-bound test composes through the test kit's `composeTestServer`, never through `composeModules`. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer.

`@endora-commerce/cli` learns the rule: `resolveHostSpecifier` answers a third way — `host-internal-subpath`, a subpath the host's `exports` map declares and no barrel carries — and `check:platform-surface` reports a module's reach into one as a finding of its own kind. `HostPackage` gains a required `declaredSubpaths` field, read off the host manifest's own `exports` map; a consumer constructing a `HostPackage` by hand must supply it.
