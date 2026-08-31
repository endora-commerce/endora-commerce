import { useState, type ReactNode } from 'react';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { Button, Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { CategoryMappingRowDto } from '../taxonomy-api.js';

/**
 * One category row on the mapping surface — ux-design §2.8.
 *
 * The row grammar is identical whether the screen is rendering the tree or the
 * paged flat list, which is what lets the flat-list fallback above the tree
 * ceiling cost the operator nothing to re-learn: name, effective value, where
 * that value came from, a picker, and — after a save — an Undo.
 *
 * `Set here` / `inherited from X` / `Not covered` are **words**, not colours.
 * A stale row additionally carries an icon and a sentence, because "your
 * mapping stopped resolving" is not something an operator should have to infer
 * from a tint.
 */

export interface CategoryMappingRowProps {
  row: CategoryMappingRowDto;
  /** Indentation depth; 0 in the flat-list presentation. */
  indent: number;
  canWrite: boolean;
  options: ComboboxOption<string>[];
  onSearch: (query: string) => void;
  onChange: (nodeExternalId: string | null) => Promise<void>;
  /** Restores the value this row had before the last save. */
  onUndo: (previous: string | null) => Promise<void>;
}

/** How long the Undo affordance stays available after a save. */
const UNDO_WINDOW_MS = 8_000;

export function CategoryMappingRow(props: CategoryMappingRowProps): ReactNode {
  const { row, indent, canWrite, options, onSearch, onChange, onUndo } = props;
  const t = useTranslation('product_feeds');
  const [undoTarget, setUndoTarget] = useState<{ previous: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const save = async (next: string | null): Promise<void> => {
    const previous = row.origin === 'explicit' ? row.nodeExternalId : null;
    setBusy(true);
    try {
      await onChange(next);
      // Optimistic saves need a way back that does not require the operator to
      // remember what the value was — especially on a screen where one wrong
      // click silently changes what a whole subtree advertises.
      setUndoTarget({ previous });
      window.setTimeout(() => setUndoTarget(null), UNDO_WINDOW_MS);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="flex flex-col gap-2 border-b py-2 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
      style={{ paddingLeft: `${indent * 16}px` }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.categoryName}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {row.origin === 'explicit' && !row.stale && <span>{t('mapping.origin.explicit')}</span>}
          {row.origin === 'inherited' && (
            <span>
              {t('mapping.origin.inherited')} {row.inheritedFromCategoryName ?? ''}
            </span>
          )}
          {row.origin === 'none' && <span>{t('mapping.origin.none')}</span>}
          {row.stale && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle size={12} aria-hidden="true" />
              {t('mapping.stale')}
            </span>
          )}
        </div>
      </div>

      <div className="w-full sm:w-96">
        <Combobox
          value={row.nodeExternalId}
          options={options}
          onChange={(next) => void save(next)}
          onSearchChange={onSearch}
          manualFilter
          disabled={!canWrite || busy}
          placeholder={t('mapping.picker.placeholder')}
          ariaLabel={`${t('mapping.picker.placeholder')} — ${row.categoryName}`}
          clearable
          {...(row.nodeFullPath ? { selectedLabel: row.nodeFullPath } : {})}
        />
      </div>

      {undoTarget && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setUndoTarget(null);
            void onUndo(undoTarget.previous);
          }}
        >
          <Undo2 size={14} aria-hidden="true" />
          {t('mapping.undo')}
        </Button>
      )}
      {!undoTarget && <span className="hidden w-16 sm:block" aria-hidden="true" />}
      <span className="sr-only" title={writeTitle} />
    </li>
  );
}
