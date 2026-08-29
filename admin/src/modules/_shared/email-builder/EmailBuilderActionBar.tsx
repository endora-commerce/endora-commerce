'use client';

import { createPortal } from 'react-dom';
import {
  Children,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ActionBar } from '@measured/puck';
import { LayoutGrid, Plus } from 'lucide-react';
import {
  EMAIL_ROW_LAYOUT_PRESETS,
  addEmailColumnFitRow,
  applyEmailRowLayoutPreset,
  replaceEmailRowInData,
  type EmailRowLayoutPresetId,
  type EmailRowProps,
} from '@endora-commerce/email-components';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
import { useActionBarTarget } from '@/modules/cms/components/action-bar-target';
import { QuickTooltip, wrapQuickTooltip } from '@/modules/cms/components/QuickTooltip';

function EmailRowLayoutFlyout({
  anchorRef,
  onClose,
  onSelect,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (presetId: EmailRowLayoutPresetId) => void;
}): ReactElement | null {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const doc = anchor.ownerDocument;
    setPortalRoot(doc.body);
    const rect = anchor.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      zIndex: 9999,
      visibility: 'visible',
    });
  }, [anchorRef]);

  useEffect(() => {
    const anchor = anchorRef.current;
    const doc = anchor?.ownerDocument ?? document;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('keydown', onKeyDown);
    return (): void => {
      doc.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, onClose]);

  if (!portalRoot) return null;

  return createPortal(
    <div ref={menuRef} className="pb-row-action-flyout" style={style} role="menu">
      <p className="pb-row-action-flyout__heading">Layout</p>
      {EMAIL_ROW_LAYOUT_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="pb-row-action-flyout__item"
          onClick={(): void => onSelect(preset.id)}
        >
          {preset.label}
        </button>
      ))}
    </div>,
    portalRoot,
  );
}

function EmailRowActionBarExtras({ rowId }: { rowId: string }): ReactElement {
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getItemById = usePageBuilderPuck((s) => s.getItemById);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutAnchorRef = useRef<HTMLSpanElement>(null);

  /**
   * Slot columns live in both `props.content` and `zones[rowId:content]`.
   * A plain Puck `replace` updates props (Outline) but can leave the canvas
   * DropZone on a stale zone — use setData + replaceEmailRowInData instead.
   */
  const applyRow = (mutate: (props: EmailRowProps) => EmailRowProps): void => {
    const item = getItemById(rowId);
    if (!item || item.type !== 'EmailRow') return;
    const nextProps = mutate(item.props as EmailRowProps);
    dispatch({
      type: 'setData',
      data: (previous) =>
        replaceEmailRowInData(previous, rowId, {
          type: 'EmailRow',
          props: { ...nextProps, id: rowId },
        }),
      recordHistory: true,
    });
    setLayoutOpen(false);
  };

  return (
    <>
      <span ref={layoutAnchorRef} className="pb-row-action-bar__layout-anchor">
        <QuickTooltip text="Column layout">
          <ActionBar.Action
            label="Column layout"
            onClick={(): void => setLayoutOpen((open) => !open)}
          >
            <LayoutGrid size={16} />
          </ActionBar.Action>
        </QuickTooltip>
      </span>
      {layoutOpen ? (
        <EmailRowLayoutFlyout
          anchorRef={layoutAnchorRef}
          onClose={(): void => setLayoutOpen(false)}
          onSelect={(presetId): void =>
            applyRow((props) => applyEmailRowLayoutPreset(props, presetId))
          }
        />
      ) : null}
      <QuickTooltip text="Add column (max 6)">
        <ActionBar.Action
          label="Add column"
          onClick={(): void => applyRow(addEmailColumnFitRow)}
        >
          <Plus size={16} />
        </ActionBar.Action>
      </QuickTooltip>
    </>
  );
}

/** Puck action bar — default actions plus EmailRow layout controls. */
export function EmailBuilderActionBar({
  label,
  children,
  parentAction,
}: {
  label?: string;
  children: ReactNode;
  parentAction: ReactNode;
}): ReactElement {
  const target = useActionBarTarget();
  const selectedItem = usePageBuilderPuck((s) => s.selectedItem);
  const selectedRowId =
    selectedItem?.type === 'EmailRow' && typeof selectedItem.props.id === 'string'
      ? selectedItem.props.id
      : null;
  const rowId =
    label === 'Row' ? (target?.type === 'EmailRow' ? target.id : selectedRowId) : null;

  return (
    <ActionBar>
      <ActionBar.Group>
        {wrapQuickTooltip(parentAction, 'parent')}
        {label ? <ActionBar.Label label={label} /> : null}
        {rowId ? <EmailRowActionBarExtras rowId={rowId} /> : null}
      </ActionBar.Group>
      <ActionBar.Group>
        {Children.map(children, (child, index) => wrapQuickTooltip(child, `action-${index}`))}
      </ActionBar.Group>
    </ActionBar>
  );
}
