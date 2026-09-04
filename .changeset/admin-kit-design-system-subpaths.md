---
'@endora-commerce/admin-kit': minor
---

Publish the four design-system subpaths: `./ui`, `./components`, `./lib` and
`./i18n`.

```ts
import { Button, Card, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable, EChart } from '@endora-commerce/admin-kit/components';
import { apiClient, cn, formatMoney } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
```

Additive: nothing published before this release changed, and `./contributions`
is untouched.

**The implementations moved into this package.** 57 files that were
`admin/src/components/ui`, `admin/src/components`, `admin/src/lib` and
`admin/src/i18n` now live here, and the admin application keeps a one-line
re-export shim at each of the 53 old paths it still names. That is a move rather
than a façade because a façade cannot be built: a `tsc` re-export escaping the
package is TS6059, and dropping `rootDir` to make it compile emits a second copy
of every component into `dist` — a duplicated module-scope value in a tree full
of React context, which is a `null` context at runtime with no type error.

Every export is therefore the **only** copy in the process, and that is asserted
by reference equality rather than by structure
(`admin/test/kit/admin-kit-identity.test.ts`): a second `createContext()`, a
second `ApiError` class and a second copy of `PAGE_SIZE_OPTIONS` all pass a
field-by-field comparison and none of them passes `toBe`.

**Every dependency the kit renders with is a `peerDependency`** — `react`,
`react-router-dom`, `lucide-react`, the four Radix packages,
`class-variance-authority`, `clsx`, `tailwind-merge`, `echarts` and
`@endora-commerce/contracts`. An application must resolve one copy of each: two copies of `react-router-dom` is two router
contexts and a `useNavigate()` that throws.

**Two groups are deliberately not published**, both recorded in
`backend/scripts/ledgers/admin-surface.ts` with the event that retires them:

- the six pickers over another module's data (`organization-picker`,
  `sales-channel-picker`, `asset-picker`, `cms-picker`) — publishing them would
  put module knowledge in a platform package; they belong to the owning module's
  own admin layer;
- the admin application's session and module-presence state (`useAuth`,
  `useModulePresence`, `useSurfaceVisibility`, `usePageSizePreference`). Its
  `PAGE_SIZE_OPTIONS` constant **is** published here, because the list of page
  sizes is design-system and the per-admin preference is application state.

A consumer that needs either today has no supported spelling for it; that is
stated rather than worked around.
