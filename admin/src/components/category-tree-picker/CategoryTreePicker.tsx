import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n/useTranslation';
import { useTranslationContext } from '@/i18n/TranslationProvider';
import { CategoryTreeNodeRow } from './CategoryTreeNodeRow';
import {
  adminLanguageToLocale,
  ancestorIdsForSelected,
  buildCategoryTree,
  computeParentIndeterminateIds,
  expandedIdsForFilteredTree,
  filterCategoryTree,
  visibleFlattenedTree,
  type CategoryTreePickerCategory,
} from './category-tree-utils';

export interface CategoryTreePickerProps {
  categories: CategoryTreePickerCategory[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  className?: string;
}

export function CategoryTreePicker(props: CategoryTreePickerProps): ReactNode {
  const t = useTranslation('catalog');
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [filterQuery, setFilterQuery] = useState('');

  const tree = useMemo(() => buildCategoryTree(props.categories), [props.categories]);
  const filterActive = filterQuery.trim().length > 0;
  const filteredTree = useMemo(
    () => (filterActive ? filterCategoryTree(tree, filterQuery, locale) : tree),
    [tree, filterQuery, filterActive, locale],
  );

  const effectiveExpanded = useMemo(() => {
    if (filterActive) return expandedIdsForFilteredTree(filteredTree);
    return expandedIds;
  }, [filterActive, filteredTree, expandedIds]);

  const visibleRows = useMemo(
    () => visibleFlattenedTree(filteredTree, effectiveExpanded, filterActive),
    [filteredTree, effectiveExpanded, filterActive],
  );

  const selectedSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);

  const indeterminateIds = useMemo(
    () => computeParentIndeterminateIds(tree, selectedSet),
    [tree, selectedSet],
  );

  // Keep branches expanded up to each selected category so deep picks are visible.
  useEffect(() => {
    const ancestors = ancestorIdsForSelected(props.categories, selectedSet);
    if (ancestors.size === 0) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [props.categories, selectedSet]);

  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback(
    (id: string): void => {
      if (props.disabled) return;
      if (selectedSet.has(id)) {
        props.onChange(props.selectedIds.filter((x) => x !== id));
      } else {
        props.onChange([...props.selectedIds, id]);
      }
    },
    [props, selectedSet],
  );

  const wrapperClass = props.className ? `space-y-2 ${props.className}` : 'space-y-2';

  if (props.loading) {
    return <p className="text-sm text-muted-foreground">{t('categoryTreePicker.loading')}</p>;
  }

  if (props.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{props.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={wrapperClass}>
      <Input
        type="search"
        value={filterQuery}
        disabled={props.disabled}
        placeholder={t('categoryTreePicker.filter.placeholder')}
        aria-label={t('categoryTreePicker.filter.placeholder')}
        onChange={(e): void => setFilterQuery(e.target.value)}
      />
      <div
        id="category-tree-picker-list"
        role="tree"
        aria-label={t('categoryTreePicker.aria.treeLabel')}
        className="max-h-64 overflow-y-auto rounded-md border border-input p-1"
      >
        {props.categories.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {t('categoryTreePicker.empty.noCategories')}
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {t('categoryTreePicker.empty.noMatches')}
          </p>
        ) : (
          visibleRows.map(({ node, expanded, hasChildren }) => (
            <CategoryTreeNodeRow
              key={node.category.id}
              node={node}
              locale={locale}
              checked={selectedSet.has(node.category.id)}
              indeterminate={indeterminateIds.has(node.category.id)}
              disabled={props.disabled}
              hasChildren={hasChildren}
              expanded={expanded}
              expandLabel={t('categoryTreePicker.expand')}
              collapseLabel={t('categoryTreePicker.collapse')}
              onToggleExpand={(): void => toggleExpand(node.category.id)}
              onToggleSelect={(): void => toggleSelect(node.category.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
