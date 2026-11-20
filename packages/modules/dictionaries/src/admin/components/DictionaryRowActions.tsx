import type { ReactNode } from 'react';
import { RowActionMenu, RowActionMenuItem, RowActionMenuSeparator } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export interface DictionaryRowActionsProps {
  /** The row's code — the menu is named after it ("Actions for PL"). */
  code: string;
  isDefault: boolean;
  isActive: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}

/**
 * The row menu of a dictionary tab (issue #1562, UX audit WORK-13): edit, set
 * default and delete, the destructive entry last after a separator — the same
 * shape as the Projects dictionaries' rows, instead of an outline *Edit*, a
 * star and a filled red bin in every row (Fitts: the destructive action gets
 * distance; Von Restorff: no row carries a filled button).
 *
 * The default row cannot be deleted, and only an active, non-default row can
 * become the default; both entries stay visible, disabled, and *Delete* says
 * why, so the rule is shown rather than a missing entry.
 */
export function DictionaryRowActions({
  code,
  isDefault,
  isActive,
  onEdit,
  onSetDefault,
  onDelete,
}: DictionaryRowActionsProps): ReactNode {
  const t = useTranslation('dictionaries');
  return (
    <RowActionMenu label={t('action.rowMenu', { code })}>
      <RowActionMenuItem onSelect={onEdit}>{t('action.edit')}</RowActionMenuItem>
      <RowActionMenuItem disabled={isDefault || !isActive} onSelect={onSetDefault}>
        {t('action.setDefault')}
      </RowActionMenuItem>
      <RowActionMenuSeparator />
      <RowActionMenuItem
        destructive
        disabled={isDefault}
        title={isDefault ? t('action.deleteDefault') : undefined}
        onSelect={onDelete}
      >
        {t('action.delete')}
      </RowActionMenuItem>
    </RowActionMenu>
  );
}
