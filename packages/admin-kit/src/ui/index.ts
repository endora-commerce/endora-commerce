/**
 * `@endora-commerce/admin-kit/ui` — The shadcn/Radix primitives — the seventeen `admin/src/components/ui` members
 * admin module code imports, measured.
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
export { Alert, AlertDescription, AlertTitle } from './alert.js';
export type { AlertProps } from './alert.js';
export { Badge } from './badge.js';
export type { BadgeProps } from './badge.js';
export { Button, buttonVariants } from './button.js';
export type { ButtonProps } from './button.js';
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card.js';
export { Checkbox } from './checkbox.js';
export { ColorPicker, DEFAULT_COLOR_PRESETS } from './color-picker.js';
export { Combobox } from './combobox.js';
export type { ComboboxOption, ComboboxProps } from './combobox.js';
export { Input } from './input.js';
export { Label } from './label.js';
export { MultiSelect } from './multi-select.js';
export type { MultiSelectOption, MultiSelectProps } from './multi-select.js';
export { PageHeader } from './page-header.js';
export type { PageHeaderProps } from './page-header.js';
export { RouteTabs, RouteTabLink, activeTabPath } from './route-tabs.js';
export type { RouteTab, RouteTabsProps, RouteTabLinkProps } from './route-tabs.js';
export { SaveButtonGroup } from './save-button-group.js';
export type { SaveButtonGroupProps } from './save-button-group.js';
export { Section } from './section.js';
export type { SectionProps } from './section.js';
export { Select } from './select.js';
export { Separator } from './separator.js';
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './table.js';
export { Textarea } from './textarea.js';
