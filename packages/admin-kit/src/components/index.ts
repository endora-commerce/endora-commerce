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
export { AssetFieldPicker } from './asset-picker/AssetFieldPicker.js';
export type { AssetFieldPickerProps } from './asset-picker/AssetFieldPicker.js';
export { AssetPicker } from './asset-picker/AssetPicker.js';
export type { AssetPickerProps } from './asset-picker/AssetPicker.js';
export { AssetUploader } from './asset-picker/AssetUploader.js';
export type { AssetUploaderProps } from './asset-picker/AssetUploader.js';
export { fetchAssetDetail, listAssets, uploadAsset } from './asset-picker/assets-api.js';
export type { AssetListQuery, AssetUploadFields } from './asset-picker/assets-api.js';
export { CategorySelect } from './category-picker/CategorySelect.js';
export type { CategorySelectProps } from './category-picker/CategorySelect.js';
export { CategoryTreePicker } from './category-tree-picker/CategoryTreePicker.js';
export type { CategoryTreePickerProps } from './category-tree-picker/CategoryTreePicker.js';
export { adminLanguageToLocale, ancestorIdsForSelected, buildCategoryTree, computeParentIndeterminateIds, expandedIdsForFilteredTree, filterCategoryTree, flattenCategoryTree, pickCategoryDisplayName, subtreeHasSelection, visibleFlattenedTree } from './category-tree-picker/category-tree-utils.js';
export type { CategoryTreeNode, CategoryTreePickerCategory } from './category-tree-picker/category-tree-utils.js';
export { EChart } from './charts/echart.js';
export { ContentLanguageTabs } from './content-language-tabs/ContentLanguageTabs.js';
export type { ContentLanguageTabsProps } from './content-language-tabs/ContentLanguageTabs.js';
export { CmsBlockPicker } from './cms-picker/CmsBlockPicker.js';
export type { CmsBlockPickerProps } from './cms-picker/CmsBlockPicker.js';
export { CmsPagePicker } from './cms-picker/CmsPagePicker.js';
export type { CmsPagePickerProps } from './cms-picker/CmsPagePicker.js';
export type { EChartEventHandler, EChartProps } from './charts/echart.js';
export { CountrySelect } from './country-select/CountrySelect.js';
export type { CountrySelectProps } from './country-select/CountrySelect.js';
export { CountryPicker } from './dictionary-picker/CountryPicker.js';
export type { CountryPickerProps } from './dictionary-picker/CountryPicker.js';
export { CurrencyPicker } from './dictionary-picker/CurrencyPicker.js';
export type { CurrencyPickerProps } from './dictionary-picker/CurrencyPicker.js';
export { listDictionaryCountries, listDictionaryCurrencies } from './dictionary-picker/dictionary-api.js';
export { useCountriesQuery } from './country-select/useCountriesQuery.js';
export type { UseCountriesQueryResult } from './country-select/useCountriesQuery.js';
export { CustomFieldListFilters } from './custom-field-filters/CustomFieldListFilters.js';
export type { CustomFieldListFiltersProps } from './custom-field-filters/CustomFieldListFilters.js';
export {
  customFieldDisplayName,
  customFieldFilterChips,
  resolveCustomFieldLabel,
} from './custom-field-filters/custom-field-filter-chips.js';
export type { CustomFieldFilterChip, CustomFieldFilterTranslator } from './custom-field-filters/custom-field-filter-chips.js';
export {
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  sanitizeCustomFieldFilters,
  toCustomFieldFiltersParam,
  withCustomFieldFilter,
  withoutCustomFieldFilter,
  writeCustomFieldFilterParams,
} from './custom-field-filters/custom-field-filter-params.js';
export { useCustomFieldListFilterFields } from './custom-field-filters/useCustomFieldListFilterFields.js';
export type {
  CustomFieldListFilterFieldsState,
  CustomFieldListFilterFieldsStatus,
} from './custom-field-filters/useCustomFieldListFilterFields.js';
export { CustomFieldValuesPanel } from './custom-field-values/CustomFieldValuesPanel.js';
export type { CustomFieldValuesPanelProps } from './custom-field-values/CustomFieldValuesPanel.js';
export { CustomerGroupPicker } from './customer-group-picker/CustomerGroupPicker.js';
export type { CustomerGroupPickerProps } from './customer-group-picker/CustomerGroupPicker.js';
export { CustomerPicker } from './customer-picker/CustomerPicker.js';
export type { CustomerPickerProps } from './customer-picker/CustomerPicker.js';
export { FulfilmentStrategyPicker } from './fulfilment-strategy-picker/FulfilmentStrategyPicker.js';
export type { FulfilmentStrategyPickerProps, FulfilmentStrategyValue, FulfilmentWarehouseOption } from './fulfilment-strategy-picker/FulfilmentStrategyPicker.js';
export { OrganizationPicker } from './organization-picker/OrganizationPicker.js';
export type { OrganizationPickerProps } from './organization-picker/OrganizationPicker.js';
export { OrganizationPickerMulti } from './organization-picker/OrganizationPickerMulti.js';
export type { OrganizationPickerMultiProps } from './organization-picker/OrganizationPickerMulti.js';
export { OrganizationStatusBadge } from './organization-picker/OrganizationStatusBadge.js';
export type { OrganizationStatusBadgeProps } from './organization-picker/OrganizationStatusBadge.js';
export { useOrganizationsQuery } from './organization-picker/useOrganizationsQuery.js';
export type { UseOrganizationsQueryOptions, UseOrganizationsQueryResult } from './organization-picker/useOrganizationsQuery.js';
export { useFocusTrap } from './hooks/useFocusTrap.js';
export type { FocusTrapOptions } from './hooks/useFocusTrap.js';
export { ModalDialog } from './modal-dialog/ModalDialog.js';
export type { ModalDialogProps } from './modal-dialog/ModalDialog.js';
export { useViewportTier } from './hooks/useViewportTier.js';
export type { ViewportTier } from './hooks/useViewportTier.js';
export { MethodAvailabilityCaption, MethodAvailabilityCell, MethodNotOfferedNotice } from './payment-method-availability/MethodAvailabilityCell.js';
// Feature 161 — the editable grid (`specs/161-price-book-editor/research.md` R4).
export { EditableGrid } from './editable-grid/index.js';
export type { EditableGridCellChange, EditableGridChangeReason, EditableGridColumn, EditableGridHandle, EditableGridProps, EditableGridRenderContext, EditableGridRow, EditableGridSelection } from './editable-grid/index.js';
export { KanbanBoard } from './kanban/index.js';
export type { KanbanBoardLabels, KanbanBoardProps, KanbanCardRenderState, KanbanColumnRenderState, KanbanColumnState, KanbanDropState } from './kanban/index.js';
export { ReorderAnnouncer } from './reorder/ReorderAnnouncer.js';
export type { ReorderAnnouncerProps } from './reorder/ReorderAnnouncer.js';
export { moveItem, useReorderList } from './reorder/useReorderList.js';
// Feature 159 — named, ordered line groups: the editor and its section reorder hook.
export { LineGroupsEditor, SplitLineDialog, canSplitLine, splitLineInto } from './line-groups/index.js';
export type { LineGroupsEditorGroup, LineGroupsEditorLabels, LineGroupsEditorLine, LineGroupsEditorLineSlots, LineGroupsEditorProps, LineGroupsEditorSection, SplitLineDialogLabels, SplitLineDialogProps, SplitLineDialogTarget } from './line-groups/index.js';
export { useGroupedReorder } from './reorder/useGroupedReorder.js';
export type { GroupedHandleProps, GroupedItemContext, GroupedItemProps, GroupedReorderKeyboardEvent, GroupedReorderLabels, GroupedReorderModel, GroupedReorderSection, GroupedSectionContext, GroupedSectionHandleProps, GroupedSectionProps, UseGroupedReorderOptions, UseGroupedReorderResult } from './reorder/useGroupedReorder.js';
export type { ReorderHandleProps, ReorderItemProps, ReorderKeyboardEvent, ReorderLabelContext, ReorderLabels, ReorderListOptions, UseReorderListOptions, UseReorderListResult } from './reorder/useReorderList.js';
export { RuleBuilder } from './rule-builder/RuleBuilder.js';
export { ProductBrowserDialog } from './product-browser/ProductBrowserDialog.js';
export type { ProductBrowserDialogProps } from './product-browser/ProductBrowserDialog.js';
export { ProductBrowserTrigger } from './product-browser/ProductBrowserTrigger.js';
export type { ProductBrowserTriggerProps } from './product-browser/ProductBrowserTrigger.js';
export { parsePositiveInt, productDisplayName } from './product-browser/product-line.js';
export { productSelectability, productSelectabilityReasonKey } from './product-browser/selectability.js';
export type { ProductBrowserRules, ProductSelectability, ProductSelectabilityContext, ProductSelectabilityReason } from './product-browser/selectability.js';
export type { ProductBrowserItem, ProductBrowserStatus, ProductBrowserType } from './product-browser/types.js';
export { ProductPicker } from './product-picker/ProductPicker.js';
export type { ProductPickerProps } from './product-picker/ProductPicker.js';
export { ScopePicker } from './scope-picker/ScopePicker.js';
export type { ScopePickerProps, ScopePickerValue } from './scope-picker/ScopePicker.js';
export { fetchScopeSalesChannel, listScopeSalesChannels } from './scope-picker/sales-channels-api.js';
export { SalesChannelPicker } from './sales-channel-picker/SalesChannelPicker.js';
export type { SalesChannelPickerProps } from './sales-channel-picker/SalesChannelPicker.js';
export {
  MethodSalesChannelsCell,
  MethodSalesChannelsField,
  salesChannelIdsToSubmit,
  useSalesChannelOptions,
} from './method-sales-channels/MethodSalesChannels.js';
export type {
  MethodSalesChannelOption,
  MethodSalesChannelOptions,
  MethodSalesChannelsFieldProps,
} from './method-sales-channels/MethodSalesChannels.js';
export { StatusTransitionGraph } from './status-transition-graph/StatusTransitionGraph.js';
export type { StatusTransitionGraphProps, StatusTransitionGraphStatus, StatusTransitionGraphTransition } from './status-transition-graph/StatusTransitionGraph.js';
export { ScopeNotice } from './scope-notice/ScopeNotice.js';
export type { ScopeNoticeProps } from './scope-notice/ScopeNotice.js';
export { SavedViewsControl } from './saved-views/SavedViewsControl.js';
export type { SavedViewState, SavedViewsControlProps } from './saved-views/SavedViewsControl.js';
export type { RuleAttributeField, RuleBuilderBuiltinField, RuleBuilderLabels, RuleBuilderProps, RuleFieldOptions, StructuralRule, StructuralRuleCondition, StructuralRuleField, StructuralRuleValue } from './rule-builder/RuleBuilder.js';
