import type { ReactNode } from 'react';
import { KanbanSquare, List } from 'lucide-react';
import type { AdminListViewMode } from '@endora-commerce/contracts';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export interface ViewModeToggleProps {
  /** The view on screen. */
  mode: AdminListViewMode;
  /** Called with the other view; never with the one already on screen. */
  onChange: (mode: AdminListViewMode) => void;
}

/**
 * *List* or *Board* — the one switch every screen that shows its records both
 * ways uses (issue #1558, UX audit WORK-07; first written for Tasks,
 * `specs/165-task-management/` FR-018). Two toggle buttons in a named group,
 * the pressed one saying in words which view is on screen, not by colour alone.
 *
 * The screen keeps the choice — a remembered preference (Tasks) or the address
 * (`?view=board`, CRM); this only shows and changes it.
 */
export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps): ReactNode {
  const t = useTranslation('core');
  const option = (value: AdminListViewMode, icon: ReactNode): ReactNode => (
    <Button
      type="button"
      variant={mode === value ? 'secondary' : 'ghost'}
      size="sm"
      className="min-h-11 sm:min-h-9"
      aria-pressed={mode === value}
      onClick={(): void => {
        if (mode !== value) onChange(value);
      }}
    >
      {icon}
      {t(`common.viewMode.${value}`)}
    </Button>
  );
  return (
    <div role="group" aria-label={t('common.viewMode.label')} className="inline-flex rounded-md border p-0.5">
      {option('list', <List aria-hidden="true" />)}
      {option('board', <KanbanSquare aria-hidden="true" />)}
    </div>
  );
}
