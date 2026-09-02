import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { AdminModulePresenceResponse } from '@endora-commerce/contracts';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { LoginPage } from './components/LoginPage.js';
import { IdleLogout } from './components/IdleLogout.js';
import { useAuth } from './lib/auth.js';
import { TranslationProvider } from './i18n/TranslationProvider.js';
import { useTranslation } from './i18n/useTranslation.js';
import { appBootstrapCopy } from './i18n/preauth-login-copy.js';
import { AdminActionsProvider } from './lib/admin-actions/AdminActionsProvider.js';
import { ModulePresenceProvider } from './lib/module-presence';
import { AppLanguageContext } from './i18n/app-language-context.js';
import { AdminContributionsProvider } from '@endora-commerce/admin-kit/zones';
import { registryRoutes } from './lib/module-registry/index.js';
import { MODULE_ADMIN_CONTRIBUTIONS } from './modules.generated.js';
import {
  useSurfaceVisibility,
  type GatedSurface,
  type PermissionRequirement,
} from './lib/surface-visibility.js';
import type { SupportedAdminLanguage } from './i18n/types.js';
import { HomePage } from './modules/home/HomePage.js';
import { ModulesPage as PlatformModulesPage } from './modules/platform/ModulesPage.js';
import { ProfilePage } from './modules/profile/ProfilePage.js';

function NotFoundPage(): ReactNode {
  const t = useTranslation('core');
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {t('app.notFound')}
    </div>
  );
}

/**
 * One module-contributed route, gated and lazily loaded (feature 091, FR-011).
 *
 * **The gate is here and not in the module**, which is the whole reason a
 * contribution is a declaration rather than a component. `useSurfaceVisibility`
 * is the one predicate the sidebar, the palette and the dashboard already share
 * (issue #230 — three surfaces answering the visibility question three ways),
 * and it reads the server's effective enabled-set, so an operator switching a
 * module off withdraws its screens without a rebuild. A module that gated its
 * own screen would be a fourth answer, in a package, where nothing could see it
 * drift.
 *
 * A hidden route renders the admin's own not-found treatment rather than a
 * blank frame: an operator following a stale deep-link into a module their role
 * cannot open, or into one that is switched off, gets the same answer as any
 * other unknown path — which is what the surface is already telling them by not
 * listing it.
 */
function ModuleRoute({
  module,
  requiredPermission,
  load,
}: {
  module: string;
  requiredPermission: PermissionRequirement | undefined;
  load: () => Promise<{ readonly default: unknown }>;
}): ReactNode {
  const isVisible = useSurfaceVisibility();
  // `lazy` is memoised per mounted route: calling it on every render would
  // build a new component type each time and remount the screen underneath the
  // operator, losing their form state.
  const Screen = useMemo(
    () => lazy(async () => ({ default: (await load()).default as ComponentType })),
    [load],
  );
  // `exactOptionalPropertyTypes` is on, so an absent requirement is an absent
  // property rather than an explicit `undefined` — the distinction the flag
  // exists for, and the reason this is a spread and not a field.
  const surface: GatedSurface = {
    module,
    ...(requiredPermission === undefined ? {} : { requiredPermission }),
  };
  if (!isVisible(surface)) return <NotFoundPage />;
  return (
    <Suspense fallback={<ModuleScreenFallback />}>
      <Screen />
    </Suspense>
  );
}

/** The frame shown while a module's chunk is in flight. */
function ModuleScreenFallback(): ReactNode {
  const t = useTranslation('core');
  return <p className="text-sm text-muted-foreground">{t('app.moduleScreenLoading')}</p>;
}

export interface AppProps {
  /**
   * The effective enabled-set, when the caller already has it.
   *
   * Forwarded verbatim to `ModulePresenceProvider`'s own `initial`, which has
   * carried the same prop since feature 073. It exists here because this
   * provider is mounted **inside** the auth gate below and deliberately so —
   * an anonymous visitor on the login page must not fetch
   * `/api/v1/admin/module-presence` — which leaves a caller rendering `<App/>`
   * with no way to reach it.
   *
   * The caller that needs it is a test asserting a route gate: feature 091's
   * P3 put `useSurfaceVisibility` and `useModulePresence` in one package, so
   * replacing either module leaves the predicate reading a provider nobody
   * mounted. Seeding the real provider is the repair, and it is the better
   * test — the gate under assertion is then the real one rather than a stub of
   * it.
   */
  readonly modulePresence?: AdminModulePresenceResponse;
}

export function App({ modulePresence }: AppProps = {}): ReactNode {
  const { status, me } = useAuth();
  // Feature 019 — admin-side language state. Seeded from the session
  // payload's `preferredLanguage`; falls back to English (FR-003).
  // Lives at App scope so changes to it (driven by ProfilePage's
  // language selector) re-render the whole authenticated tree.
  const initialLanguage = (me?.adminUser.preferredLanguage ?? 'en') as SupportedAdminLanguage;
  const [language, setLanguage] = useState<SupportedAdminLanguage>(initialLanguage);

  // `useState` reads `initialLanguage` only on first mount, when `me` is
  // still null (auth is loading) — so without this sync the language is
  // locked to 'en' even when the session payload that arrives next carries
  // `preferredLanguage: 'pl'`. Re-sync whenever `me.preferredLanguage`
  // flips, but only when the user hasn't already chosen a different one
  // via ProfilePage in this same session.
  const sessionLanguage = me?.adminUser.preferredLanguage ?? null;
  useEffect(() => {
    if (sessionLanguage && sessionLanguage !== language) {
      setLanguage(sessionLanguage as SupportedAdminLanguage);
    }
    // We intentionally depend only on sessionLanguage — re-running on every
    // `language` change would clobber the user's in-session override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLanguage]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40">
        <p className="text-sm text-muted-foreground">{appBootstrapCopy.loading}</p>
      </div>
    );
  }
  if (status === 'unauthenticated') return <LoginPage />;
  return (
    <TranslationProvider language={language}>
      <AppLanguageContext.Provider value={{ language, setLanguage }}>
        <ModulePresenceProvider {...(modulePresence === undefined ? {} : { initial: modulePresence })}>
        {/* The zone renderer is the kit's (Z6) — a host screen becomes a
            package and `admin/src/lib/` is then unreachable to it — while the
            registry stays the application's, because it is module knowledge and
            `admin-kit-surface.md` R6 refuses that in the kit. This provider is
            the seam that carries the one into the other, and it is mounted
            **inside** the presence provider: `useAdminZone` filters on the
            effective enabled-set at enumeration, so the two are ordered. */}
        <AdminContributionsProvider entries={MODULE_ADMIN_CONTRIBUTIONS}>
        <AdminActionsProvider language={language}>
        {/* Auto sign-out after the configured inactivity window (default 60 min). */}
        <IdleLogout />
        <Routes>
          <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        {/* The eight `/catalog*` routes were declared here until feature 091's
            Phase 4 batch 15. `catalog` is a zone **host** six members over —
            `ProductEditor` mounts five of them, `ProductAttributesTab` a sixth
            `product.editor.field.after` and `CategoriesTree`
            `category.editor.after` — and a host moves on the same terms a
            contributor does, because a zone is neither a route nor a nav entry.
            Their declarations are in
            `packages/modules/catalog/src/admin/index.ts`. The create form is
            `/catalog/products/:id` with the id `new` and always was, so this
            batch declares no static `/catalog/products/new` beside it. */}
        {/* The three `/customers*` and two `/organizations*` routes were
            declared here until feature 091's Phase 4 batch 14. Both modules are
            zone **hosts** — `CustomerDetail` renders `customer.detail.after`
            and `OrganizationDetail` renders `organization.detail.after`, the
            two members P7b published — and a host moves on the same terms a
            contributor does, because a zone is neither a route nor a nav entry.
            Their declarations are in
            `packages/modules/{customers,organizations}/src/admin/index.ts`. */}
        {/* The four `/orders*` routes were declared here until feature 091's
            Phase 4 batch 15, and `orders` hosts four zone members across three
            of them. Their declarations are in
            `packages/modules/orders/src/admin/index.ts`. One tightening
            travelled with the move and is recorded there: `/orders/new` was
            ungated here while the sidebar row advertising it carried
            `orders:write`, so a read-only operator followed a row to a form
            whose save would refuse. */}
        {/* `/transactional-emails*` and `/newsletter/*` were declared here —
            six and eleven routes — until feature 091's Phase 4 batch 11. Both
            modules own their screens now and their route declarations are in
            `packages/modules/{transactional_emails,newsletter}/src/admin/index.ts`.
            The two `kind` props the fragment-editor routes carried live in
            `EmailBlockEditorPage` and `EmailTemplateEditorPage`, because a
            contribution declaration has nowhere to put an argument. */}
        {/* `/invoices*` — four routes — and `/ksef` were declared here until
            feature 091's Phase 4 batch 12. Both modules own their screens now
            and the declarations are in
            `packages/modules/{invoices,ksef}/src/admin/index.ts`. The invoice
            detail publishes the `invoice.detail.after` zone that replaced its
            import of `ksef`'s panel, which is what retires the one key in
            `backend/scripts/ledgers/cross-module-imports/invoices.ts`. */}
        {/*
          A redirect for the deep links that predate the screen's move to
          `/delivery-methods/dhl-parcel`, and the admin application's own:
          `dhl_parcel` declares the destination route in its own package since
          feature 091's Phase 4 batch five, and a `<Navigate>` is not that
          module's screen. It stays ungated deliberately — the destination is
          what `ModuleRoute` gates, so an operator who cannot reach the screen
          meets the admin's not-found treatment there rather than here.
        */}
        <Route path="/settings/dhl-parcel" element={<Navigate to="/delivery-methods/dhl-parcel" replace />} />
        {/* `/quote-requests*` — three routes — were declared here until feature
            091's Phase 4 batch 12; `quote_requests` owns them now, in
            `packages/modules/quote_requests/src/admin/index.ts`. */}
        {/* Sixteen more routes stood here until feature 091's Phase 4 batch 13
            — `/orders/quick-order`, the five `/pim-ergonode*`, the three
            `/price-lists*`, the four `/inventory*` and the three
            `/warehouses*`. Their four modules own them now, in
            `packages/modules/{quick_order,pim_ergonode,price_lists,inventory}/src/admin/index.ts`.
            The warehouse screens go to `inventory` because that is the module
            the sidebar attributes `/warehouses` to; a directory name is not a
            module id, and `inventory` had two surface directories. Ordering
            notes the declarations kept: `/price-lists/display-modes` before
            `/price-lists/:id`, `/warehouses/new` before `/warehouses/:id`, and
            Ergonode's literal segments before its parametric run route. */}
        {/*
          `/comparisons`, `/comparisons/:id`, `/api-keys` and `/webhooks` are
          declared by the modules that own them since feature 091's Phase 4 (the
          plan's batch 6), and arrive through `MODULE_ADMIN_CONTRIBUTIONS` in
          `modules.generated.ts`. Leaving a `<Route>` standing here beside the
          declaration would declare each screen twice, with `react-router`
          silently taking the first match. Their declarations are in
          `packages/modules/{comparisons,api_keys,webhooks}/src/admin/index.ts`.

          `/credentials`, `/credentials/new`, `/dictionary` and the two audit
          spellings left the same way in batch 10, into
          `packages/modules/{credentials,dictionaries}/src/admin/index.ts`.
        */}
        {/* The eleven `/cms…` and seven `/blog/…` routes were declared here
            until feature 091's Phase 4 batch 16 — the batch that takes the last
            module-owned registration out of this file. Both modules own their
            screens now and their declarations are in
            `packages/modules/{cms,blog}/src/admin/index.ts`. `/cms` stays a
            second declaration of the page list rather than becoming a
            `<Navigate>`: a redirect's element comes from `react-router-dom`
            rather than from a surface directory, which is how
            `/settings/dhl-parcel` below came to be the admin application's own,
            and moving a `cms` deep link into the host's registry is the
            direction this feature exists to reverse.

            `blog`'s two editors render `cms`' `PageBuilderEditor` through
            `@endora-commerce/mod-cms/admin-ui` — D-191's published-component
            subpath, decided from the component's own signature (Z1: `data` in,
            `onChange` back, so the consumer decides that it appears). */}
        <Route path="/platform/modules" element={<PlatformModulesPage />} />
        {/*
          `/settings`, `/settings/groups`, `/settings/cache` and `/settings/pwa`
          are declared by the modules that own them since feature 091's Phase 4
          batch 10, and arrive through `MODULE_ADMIN_CONTRIBUTIONS` in
          `modules.generated.ts`. The first three are `settings`'; the fourth is
          **`pwa`**'s, which is batch six's split closing — the screen lived
          under `modules/settings/pages/` and moved with that directory, so the
          route is declared beside the sidebar entry that advertises it and is
          gated on `pwa`'s presence rather than on `settings`'. Their
          declarations are in
          `packages/modules/{settings,pwa}/src/admin/index.ts`.
        */}
        {/* The three `/sales-channels*` routes were declared here until feature
            091's Phase 4 batch 14. `SalesChannelEditPage` renders
            `sales_channel.editor.after`, the member P7c published, so this
            module is a zone host as well as the contributor P7a and P7b made
            it. Its declaration is in
            `packages/modules/sales_channels/src/admin/index.ts`. */}
        <Route path="/profile" element={<ProfilePage />} />
        {/* Every module-owned screen, from the generated registry. `App.tsx`
            declares the host's own routes and nothing else; a module adds one
            by shipping `src/admin/` and regenerating (feature 091, FR-010). */}
        {registryRoutes().map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <ModuleRoute
                module={route.module}
                requiredPermission={route.requiredPermission}
                load={route.component}
              />
            }
          />
        ))}
        <Route
          path="*"
          element={<NotFoundPage />}
        />
          </Route>
        </Routes>
        </AdminActionsProvider>
        </AdminContributionsProvider>
        </ModulePresenceProvider>
      </AppLanguageContext.Provider>
    </TranslationProvider>
  );
}
