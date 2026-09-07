/**
 * `@endora-commerce/admin-shell` — the admin application itself (feature 110,
 * FR-016, R7.6).
 *
 * ## What this package is
 *
 * Everything an operator sees that is not a module's own screen: the router and
 * its host routes, the sidebar, the command palette, the breadcrumb trail, the
 * sign-in screen, and the four surfaces the platform owns rather than a module
 * (the dashboard, the profile, `/platform/modules`, and the not-found
 * treatment). It mounts what the modules contribute; it does not know which
 * modules there are.
 *
 * ## Why it is a package and not a copy
 *
 * D-207 rules that a client's instance depends on this platform rather than
 * forking it, and `spec.md` §6.1 extends that to the admin on a measured
 * difference from the storefront: a storefront names zero module packages and
 * reaches the backend over HTTP, so it is presentation a client owns outright
 * (D-195). An admin is the mounting point of every module's screens — a client
 * who forked this shell would take the merge for every module upgrade with it,
 * which is the cost feature 091 removed by deleting the two files a module
 * author had to hand-edit. Copying them into N client trees would restore it
 * and multiply it by N.
 *
 * ## The barrel is what a `main.tsx` needs and nothing else
 *
 * `admin-kit-surface.md` §1's rule, applied one package up: an explicit barrel,
 * no `export *`, and a member is here because a project that mounts this shell
 * has to name it. There are three, and they are the three lines of the entry
 * point — the tree, the session provider it is mounted inside, and the service
 * worker registration. Everything else in this package is reached by the shell
 * itself.
 *
 * `AuthProvider` is re-exported rather than re-implemented: it is the kit's
 * binding, forwarded, so an instance's `main.tsx` names **one** package and the
 * provider `useAuth` reads is the same one in every process.
 */
export { App } from './App.js';
export type { AppProps } from './App.js';
export { registerAdminServiceWorker } from './registerSw.js';
export { AuthProvider } from './lib/auth.js';
export type { AdminMe, AuthProviderProps } from './lib/auth.js';
export type { AdminRegistryEntry } from './lib/module-registry/index.js';
