---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

Published the three data-fetching pickers, and the Organization picker's row shape.

`@endora-commerce/admin-kit/components` gains `SalesChannelPicker`, `CmsBlockPicker`,
`CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti`,
`OrganizationStatusBadge` and `useOrganizationsQuery`. Each of them was previously
unreachable from a package: it lived in the admin application and imported another
module's admin API client, so publishing it would have put module code in the kit.

**A kit component gets its data by building the request itself**, from the published
`apiClient` and the owner's schema in `@endora-commerce/contracts`. Five kit components
already did that before this release (`CustomerPicker`, `AdminUserPicker`,
`CustomerGroupPicker`, `CategorySelect`, `useCountriesQuery`); the rule was simply never
written down. An HTTP path plus a schema out of a package the kit already depends on is
not module knowledge — a module's *code* is, and that is what these seven files no longer
name.

**If you render one of these,** nothing changes: every prop is the same, and
`admin/src` keeps a re-export shim at each old path. **If you test one,** the seam moved:
mock `@endora-commerce/admin-kit/lib`'s `apiClient`, not the module client.

```diff
-vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
-  organizationsPickerClient: { list: listSpy },
-}));
+vi.mock('@endora-commerce/admin-kit/lib', async () => ({
+  ...(await vi.importActual('@endora-commerce/admin-kit/lib')),
+  apiClient: { get: getSpy, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
+}));
```

`@endora-commerce/contracts` gains `organizationPickerListItemSchema` /
`OrganizationPickerListItem` and `organizationPickerPageSchema` /
`OrganizationPickerPage` — the picker's projection over
`GET /api/v1/admin/organizations`, which now crosses a package boundary and so belongs
here under Principle II. **There is no `OrganizationStatusPickerFilter`**: its four
members are exactly `organizationStatusSchema`'s, measured, so the picker takes the
published `OrganizationStatus` rather than acquiring a second name for one set.

```diff
-import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
+import type { OrganizationStatus } from '@endora-commerce/contracts';
```

`admin/src/modules/organizations/api/organizations-picker-client.ts` is deleted; it
existed only to serve this picker and nothing else imported it.
