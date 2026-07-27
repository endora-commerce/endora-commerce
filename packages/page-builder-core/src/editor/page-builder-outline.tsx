import { useMemo, useState, type DragEvent, type ReactElement } from 'react';
import { formatOutlineLabel } from './format-outline-label.js';
import { collectChildItems, extractRootContent, type PuckItem } from './outline-data.js';
import {
  canOutlineDrop,
  outlineDropBeforeTarget,
  outlineSiblingCount,
  outlineStepReorder,
  type OutlineDropPayload,
} from './outline-dnd.js';
import { usePageBuilderPuck } from './use-page-builder-puck.js';

const DRAG_MIME = 'application/x-pb-outline-item';

let activeOutlineDrag: OutlineDropPayload | null = null;

function outlineTypeIcon(type: string): string {
  if (type === 'Row') return '▦';
  if (type === 'Column' || type === 'EmailColumn') return '▥';
  return '▪';
}

function OutlineItem({ item, depth }: { item: PuckItem; depth: number }): ReactElement | null {
  const config = usePageBuilderPuck((s) => s.config);
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);
  const data = usePageBuilderPuck((s) => s.appState.data);
  const selectedId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const [isDragging, setIsDragging] = useState(false);
  const [dropBefore, setDropBefore] = useState(false);

  const itemId = item.props.id;
  if (typeof itemId !== 'string') return null;

  const selector = getSelectorForId(itemId);
  const componentConfig = config.components[item.type];
  const label = formatOutlineLabel(
    item.type,
    item.props,
    typeof componentConfig?.label === 'string' ? componentConfig.label : undefined,
  );
  const isSelected = selectedId === itemId;
  const nested = collectChildItems(item.props);
  const columnSpan =
    item.type === 'Column' || item.type === 'EmailColumn'
      ? typeof item.props.span === 'number'
        ? ` · ${item.props.span}/12`
        : ''
      : '';

  const selectItem = (): void => {
    if (isSelected) {
      dispatch({ type: 'setUi', ui: { itemSelector: null } });
      return;
    }
    const nextSelector = getSelectorForId(itemId);
    if (nextSelector) {
      dispatch({ type: 'setUi', ui: { itemSelector: nextSelector } });
    }
  };

  const payload = (): OutlineDropPayload | null => {
    if (!selector) return null;
    return { itemId, sourceZone: selector.zone, sourceIndex: selector.index };
  };

  const moveWithinZone = (direction: -1 | 1): void => {
    const drag = payload();
    if (!drag || !selector) return;
    const action = outlineStepReorder(
      drag,
      selector.zone,
      direction,
      outlineSiblingCount(data, selector.zone),
    );
    if (action) dispatch(action);
  };

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    const drag = payload();
    if (!drag) return;
    activeOutlineDrag = drag;
    setIsDragging(true);
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(drag));
    event.dataTransfer.effectAllowed = 'move';
    if (event.currentTarget) {
      event.dataTransfer.setDragImage(event.currentTarget, 16, 16);
    }
  };

  const onDragEnd = (): void => {
    activeOutlineDrag = null;
    setIsDragging(false);
    setDropBefore(false);
  };

  const onDragOver = (event: DragEvent<HTMLLIElement>): void => {
    if (!selector || !activeOutlineDrag) return;
    if (!canOutlineDrop(activeOutlineDrag, itemId, selector.zone, selector.index, data)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropBefore(event.clientY < bounds.top + bounds.height / 2);
  };

  const onDragLeave = (): void => {
    setDropBefore(false);
  };

  const onDrop = (event: DragEvent<HTMLLIElement>): void => {
    event.preventDefault();
    if (!selector || !activeOutlineDrag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const insertBefore = event.clientY < bounds.top + bounds.height / 2;
    const targetIndex = insertBefore ? selector.index : selector.index + 1;
    if (!canOutlineDrop(activeOutlineDrag, itemId, selector.zone, targetIndex, data)) return;
    dispatch(outlineDropBeforeTarget(activeOutlineDrag, selector.zone, targetIndex));
    activeOutlineDrag = null;
    setIsDragging(false);
    setDropBefore(false);
  };

  return (
    <li
      className={`pb-outline-item ${item.type === 'Column' || item.type === 'EmailColumn' ? 'pb-outline-item--column' : ''} ${isSelected ? 'pb-outline-item--selected' : ''} ${isDragging ? 'pb-outline-item--dragging' : ''} ${dropBefore ? 'pb-outline-item--drop-before' : ''}`}
      style={{ '--pb-outline-depth': depth } as React.CSSProperties}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="pb-outline-item__row"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span className="pb-outline-item__drag" aria-hidden>
          ⋮⋮
        </span>
        <button type="button" className="pb-outline-item__label" onClick={selectItem}>
          <span className="pb-outline-item__icon" aria-hidden>
            {outlineTypeIcon(item.type)}
          </span>
          <span className="pb-outline-item__text">
            {label}
            {columnSpan}
          </span>
        </button>
        <div className="pb-outline-item__actions">
          <button
            type="button"
            className="pb-outline-item__action"
            aria-label="Move up"
            onClick={(): void => moveWithinZone(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="pb-outline-item__action"
            aria-label="Move down"
            onClick={(): void => moveWithinZone(1)}
          >
            ↓
          </button>
        </div>
      </div>
      {nested.length > 0 ? (
        <ul className="pb-outline-list">
          {nested.map((child) => {
            const childId = child.props.id;
            if (typeof childId !== 'string') return null;
            return <OutlineItem key={childId} item={child} depth={depth + 1} />;
          })}
        </ul>
      ) : null}
    </li>
  );
}

function CustomOutlineTree({ items }: { items: PuckItem[] }): ReactElement {
  const list = Array.isArray(items) ? items : [];

  return (
    <ul className="pb-outline-list pb-outline-list--root">
      {list.length === 0 ? <li className="pb-outline-empty">No items</li> : null}
      {list.map((item) => {
        const itemId = item.props.id;
        if (typeof itemId !== 'string') return null;
        return <OutlineItem key={itemId} item={item} depth={0} />;
      })}
    </ul>
  );
}

/**
 * Custom Puck outline — labels include the editor-only `editorName` prop.
 * Puck uses this as an outline wrapper and passes default LayerTree nodes as
 * `children`; we render our own tree from `appState.data` when possible.
 */
export function PageBuilderOutline({ children }: { children?: React.ReactNode }): ReactElement {
  const data = usePageBuilderPuck((s) => s.appState.data);
  const items = useMemo(() => extractRootContent(data), [data]);

  if (items.length === 0 && children) {
    return <>{children}</>;
  }

  return <CustomOutlineTree items={items} />;
}
