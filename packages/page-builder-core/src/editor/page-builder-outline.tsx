import { useMemo, type ReactElement, type ReactNode } from 'react';
import { formatOutlineLabel } from './format-outline-label.js';
import { collectChildItems, extractRootContent, type PuckItem } from './outline-data.js';
import { usePageBuilderPuck } from './use-page-builder-puck.js';

function OutlineItem({ item, depth }: { item: PuckItem; depth: number }): ReactElement | null {
  const config = usePageBuilderPuck((s) => s.config);
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);
  const selectedId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);

  const itemId = item.props.id;
  if (typeof itemId !== 'string') return null;

  const componentConfig = config.components[item.type];
  const label = formatOutlineLabel(
    item.type,
    item.props,
    typeof componentConfig?.label === 'string' ? componentConfig.label : undefined,
  );
  const isSelected = selectedId === itemId;
  const nested = collectChildItems(item.props);

  return (
    <li style={{ listStyle: 'none' }}>
      <button
        type="button"
        onClick={(): void => {
          if (isSelected) {
            dispatch({ type: 'setUi', ui: { itemSelector: null } });
            return;
          }
          const selector = getSelectorForId(itemId);
          if (selector) {
            dispatch({ type: 'setUi', ui: { itemSelector: selector } });
          }
        }}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: '6px 8px',
          paddingLeft: `${8 + depth * 12}px`,
          border: 'none',
          borderRadius: '4px',
          background: isSelected ? 'var(--puck-color-grey-09, #e8eef3)' : 'transparent',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        {label}
      </button>
      {nested.length > 0 ? (
        <ul style={{ margin: 0, padding: 0 }}>
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
    <ul style={{ margin: 0, padding: 0 }}>
      {list.length === 0 ? (
        <li style={{ listStyle: 'none', padding: '4px 8px', fontSize: '12px', opacity: 0.6 }}>No items</li>
      ) : null}
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
export function PageBuilderOutline({ children }: { children?: ReactNode }): ReactElement {
  const data = usePageBuilderPuck((s) => s.appState.data);
  const items = useMemo(() => extractRootContent(data), [data]);

  if (items.length === 0 && children) {
    return <>{children}</>;
  }

  return <CustomOutlineTree items={items} />;
}
