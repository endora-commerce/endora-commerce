import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Checkbox } from '../../ui/checkbox.js';
import { cn } from '../../lib/utils.js';
import { pickCategoryDisplayName, type CategoryTreeNode } from './category-tree-utils.js';

interface CategoryTreeNodeRowProps {
  node: CategoryTreeNode;
  locale: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  /** Called with the category's name, so every expand control names its branch. */
  expandLabel: (name: string) => string;
  collapseLabel: (name: string) => string;
}

export function CategoryTreeNodeRow(props: CategoryTreeNodeRowProps): ReactNode {
  const label = pickCategoryDisplayName(
    props.node.category.name,
    props.node.category.slug,
    props.locale,
  );
  const indeterminate = props.indeterminate === true && !props.checked;
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate, props.checked]);

  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-sm py-1 pr-2',
        indeterminate && 'bg-primary/5',
      )}
      style={{ paddingLeft: `${props.node.depth * 16 + 4}px` }}
    >
      {props.hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 max-lg:h-11 max-lg:w-11"
          disabled={props.disabled}
          aria-expanded={props.expanded}
          aria-label={props.expanded ? props.collapseLabel(label) : props.expandLabel(label)}
          onClick={props.onToggleExpand}
        >
          {props.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </Button>
      ) : (
        <span className="inline-block h-7 w-7 shrink-0 max-lg:w-11" aria-hidden />
      )}
      {/* The name is part of the label, so clicking it toggles the checkbox (Fitts). */}
      <label
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1 max-lg:min-h-11',
          props.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <Checkbox
          ref={checkboxRef}
          checked={props.checked}
          disabled={props.disabled}
          aria-checked={indeterminate ? 'mixed' : props.checked}
          onChange={(): void => props.onToggleSelect()}
        />
        <span
          className={cn('truncate text-sm', indeterminate && 'font-medium text-foreground')}
          title={label}
        >
          {label}
        </span>
      </label>
    </div>
  );
}
