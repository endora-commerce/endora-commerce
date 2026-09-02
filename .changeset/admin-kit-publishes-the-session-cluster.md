---
'@endora-commerce/admin-kit': minor
---

Published the admin session and module-presence state.

`@endora-commerce/admin-kit/lib` gains `AuthProvider`, `useAuth`, `AdminMe`,
`ModulePresenceProvider`, `useModulePresence`, `getModulePresence`,
`setModuleActivation`, `useSurfaceVisibility`, `isSurfaceVisible`,
`satisfiesPermission`, `usePageSizePreference` and the `GatedSurface` /
`PermissionRequirement` types.

**`useAuth` is how a screen refuses a control the operator may not use**, and until now a
package could not name it. Sixteen packaged modules therefore render every control live to
a read-only operator, who fills the form in and gets a 403 on save. This release is what
lets each of them fix that; the screen-side repairs are the owners'.

`usePageSizePreference` moves for a related reason. Its constant, `PAGE_SIZE_OPTIONS`, was
published on its own because the hook reads the signed-in admin's id to key its
`localStorage` entry — that id comes from `useAuth`, so the split has nothing left to
separate and both halves are one package's now.

**If you render one of these,** nothing changes: every prop is the same, and `admin/src`
keeps a re-export shim at each old path.

**If you test something that reads them, the seam changed and this is the part to read.**
`useSurfaceVisibility` calls `useAuth` and `useModulePresence` **inside** the package, so a
test that replaced either module at its own path no longer reaches the predicate:

```diff
-vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
-vi.mock('@/lib/module-presence', () => ({ useModulePresence: () => ({ isPresent: () => true }) }));
+render(
+  <AuthProvider initial={session}>
+    <ModulePresenceProvider initial={{ modules: [...], degraded: false }}>
+      <Subject />
+    </ModulePresenceProvider>
+  </AuthProvider>,
+);
```

`AuthProvider` takes a new optional `initial: AdminMe`, the prop `ModulePresenceProvider`
has carried since it was written: supply it and the provider starts `authenticated` and
skips its boot fetch. That is the whole substitution seam, and it is data rather than a
mock — a permission gate asserted against a stub of the predicate asserts that the stub was
consulted.

Two properties of the projection are worth knowing before you seed one. `isPresent` answers
`false` for a module id the projection does not list, so name every module your subject asks
about; and an unlisted module is the *hidden* branch of every gate, which renders as
nothing at all.
