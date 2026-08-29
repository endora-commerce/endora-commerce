/**
 * `@endora-commerce/admin-kit/components` — The composites an admin screen builds a page out of — tables, pagination,
 * pickers, the reorder helpers and the `<EChart>` wrapper.
 *
 * The membership is **derived, never designed**
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` §1): every
 * `from '…'` specifier in the admin's module directories that resolves inside the admin
 * source root and outside the importing file's own module directory, plus the transitive
 * closure of those files, which is what has to live in one place for there to be one copy.
 *
 * The barrel is **explicit and holds no `export *`** (R2): a short published set reports
 * more findings than a complete one, and its obvious repair is to widen the barrel
 * silently. `check:admin-surface` refuses one and exits 2.
 *
 * Every binding here is the **only** copy in the process. `admin/src` keeps a re-export
 * shim at each old path, so a `@/…` specifier and this subpath name one module record —
 * proved by reference equality in `admin/test/kit/admin-kit-shims.test.ts`, not by a
 * structural comparison, which a second React context would pass.
 */
export { FileDropzone } from './FileDropzone.js';
export { PaginationFooter } from './PaginationFooter.js';
export type { PaginationFooterProps } from './PaginationFooter.js';
export { ResponsiveTable } from './ResponsiveTable.js';
export type { ResponsiveColumn, ResponsiveTableProps } from './ResponsiveTable.js';
export { RowActionMenu, RowActionMenuItem, RowActionMenuSeparator } from './RowActionMenu.js';
export type { RowActionMenuItemProps, RowActionMenuProps } from './RowActionMenu.js';
export { StickyFormActions } from './StickyFormActions.js';
export type { StickyFormActionsProps } from './StickyFormActions.js';
export { TouchReorderButtons } from './TouchReorderButtons.js';
export type { TouchReorderButtonsProps } from './TouchReorderButtons.js';
export { AdminUserPicker } from './admin-user-picker/AdminUserPicker.js';
export type { AdminUserPickerProps } from './admin-user-picker/AdminUserPicker.js';
export { CategorySelect } from './category-picker/CategorySelect.js';
export type { CategorySelectProps } from './category-picker/CategorySelect.js';
export { CategoryTreePicker } from './category-tree-picker/CategoryTreePicker.js';
export type { CategoryTreePickerProps } from './category-tree-picker/CategoryTreePicker.js';
export { adminLanguageToLocale, ancestorIdsForSelected, buildCategoryTree, computeParentIndeterminateIds, expandedIdsForFilteredTree, filterCategoryTree, flattenCategoryTree, pickCategoryDisplayName, subtreeHasSelection, visibleFlattenedTree } from './category-tree-picker/category-tree-utils.js';
export type { CategoryTreeNode, CategoryTreePickerCategory } from './category-tree-picker/category-tree-utils.js';
export { EChart } from './charts/echart.js';
export type { EChartEventHandler, EChartProps } from './charts/echart.js';
export { CountrySelect } from './country-select/CountrySelect.js';
export type { CountrySelectProps } from './country-select/CountrySelect.js';
export { useCountriesQuery } from './country-select/useCountriesQuery.js';
export type { UseCountriesQueryResult } from './country-select/useCountriesQuery.js';
export { CustomerGroupPicker } from './customer-group-picker/CustomerGroupPicker.js';
export type { CustomerGroupPickerProps } from './customer-group-picker/CustomerGroupPicker.js';
export { CustomerPicker } from './customer-picker/CustomerPicker.js';
export type { CustomerPickerProps } from './customer-picker/CustomerPicker.js';
export { useFocusTrap } from './hooks/useFocusTrap.js';
export { useViewportTier } from './hooks/useViewportTier.js';
export type { ViewportTier } from './hooks/useViewportTier.js';
export { MethodAvailabilityCaption, MethodAvailabilityCell, MethodNotOfferedNotice } from './payment-method-availability/MethodAvailabilityCell.js';
export { ReorderAnnouncer } from './reorder/ReorderAnnouncer.js';
export type { ReorderAnnouncerProps } from './reorder/ReorderAnnouncer.js';
export { moveItem, useReorderList } from './reorder/useReorderList.js';
export type { ReorderHandleProps, ReorderItemProps, ReorderKeyboardEvent, ReorderLabelContext, ReorderLabels, ReorderListOptions, UseReorderListOptions, UseReorderListResult } from './reorder/useReorderList.js';
export { RuleBuilder } from './rule-builder/RuleBuilder.js';
export { ScopeNotice } from './scope-notice/ScopeNotice.js';
export type { ScopeNoticeProps } from './scope-notice/ScopeNotice.js';
export type { RuleAttributeField, RuleBuilderBuiltinField, RuleBuilderLabels, RuleBuilderProps, RuleFieldOptions, StructuralRule, StructuralRuleCondition, StructuralRuleField, StructuralRuleValue } from './rule-builder/RuleBuilder.js';
