---
'@endora-commerce/admin-shell': minor
---

New package: the admin application itself.

`@endora-commerce/admin-shell` is the router, the sidebar and command palette,
the breadcrumb trail, the sign-in screen and the four surfaces the platform owns
rather than a module (the dashboard, the profile, `/platform/modules` and the
not-found treatment). It was `admin/src`; an admin project now holds only
`index.html`, `main.tsx`, its Vite and Tailwind configuration, its brand assets,
its theme tokens and the generated contribution registry.

The barrel is three members and they are the three lines of an entry point:

```tsx
import { App, AuthProvider, registerAdminServiceWorker } from '@endora-commerce/admin-shell';

registerAdminServiceWorker();
createRoot(root).render(
  <StrictMode><BrowserRouter><AuthProvider>
    <App contributions={MODULE_ADMIN_CONTRIBUTIONS} />
  </AuthProvider></BrowserRouter></StrictMode>,
);
```

`contributions` is required rather than defaulted. The generated registry is the
admin project's file and this is a package, so the shell cannot import it — and
an `App` with no registry would render the host's own routes and none of the
modules', which is a blank product that looks like a working one.
