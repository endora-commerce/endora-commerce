import type { ReactNode } from 'react';
import { FormField, type FormFieldProps } from './form-field.js';

export type SettingRowProps = Omit<FormFieldProps, 'layout'>;

/**
 * One setting in a settings list — issue #1442 (UX audit 2026-11-17, DS-09).
 *
 * The label and a short description on the left, the control on the right:
 * the layout an operator knows from every operating system's and SaaS
 * product's settings screen (Jakob's Law), and the one a `Switch` reads best
 * in, because the label states what is on or off and the switch answers it.
 *
 * It is `FormField` with `layout="row"` — the same generated ids, the same
 * `<label for>`, the same described-by order (error, hint, description), the
 * same always-mounted error region — so nothing about labelling or
 * announcement is decided twice.
 *
 * ```tsx
 * <SettingRow label={t('settings.listPrice.label')} description={t('settings.listPrice.help')}>
 *   <Switch checked={value} onCheckedChange={setValue} />
 * </SettingRow>
 * ```
 */
export function SettingRow(props: SettingRowProps): ReactNode {
  return <FormField {...props} layout="row" />;
}
