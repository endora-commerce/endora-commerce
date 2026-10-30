---
'@endora-commerce/admin-kit': patch
---

Data-fetching picker fixes; no prop changes.

- `AdminUserPicker`, `CustomerPicker`, `CategorySelect` and `CustomerGroupPicker`: a failed request now shows its error in the listbox even when the caller passes `emptyMessage`. Previously the caller's empty-state text replaced the error, so a failure read as "nothing found".
- `CategorySelect`: category names are looked up by the admin language's locale (`pl` → `pl-PL`), so a Polish admin sees Polish names; before, every label fell back to `en-US`.
- `CategorySelect`, `CustomerGroupPicker`, `CustomerPicker` and `useCountriesQuery` import `apiClient` through the kit's `lib` barrel, so a test that mocks `@endora-commerce/admin-kit/lib` reaches them.
