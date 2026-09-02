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
import { Columns2, LayoutGrid, Plus } from 'lucide-react';
import {
  ROW_LAYOUT_PRESETS,
  addColumnFitRow,
  addColumnFullWidth,
  applyRowLayoutPreset,
  type RowLayoutPresetId,
} from '@endora-commerce/cms-components/editor/row-layout-presets';
import type { RowProps } from '@endora-commerce/cms-components/schema/component-types';
import { usePageBuilderPuck, resolveContentSliderIdForItem } from '@endora-commerce/page-builder-core/editor';
import { useActionBarTarget, QuickTooltip, wrapQuickTooltip } from '@endora-commerce/page-builder-admin';
import { ContentSliderActionBarExtras } from './ContentSliderActionBarExtras.js';
import { SliderPreviewActionBarExtras } from './SliderPreviewActionBarExtras.js';
import { isPuckItemType, safeGetPuckItem } from './puck-safe.js';

function RowLayoutFlyout({
  anchorRef,
  onClose,
  onSelect,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (presetId: RowLayoutPresetId) => void;
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
      {ROW_LAYOUT_PRESETS.map((preset) => (
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

function RowActionBarExtras({ rowId }: { rowId: string }): ReactElement {
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  const getItemById = usePageBuilderPuck((s) => s.getItemById);
  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutAnchorRef = useRef<HTMLSpanElement>(null);

  const applyRow = (mutate: (props: RowProps) => RowProps): void => {
    const item = getItemById(rowId);
    const selector = getSelectorForId(rowId);
    if (!item || item.type !== 'Row' || !selector) return;
    const nextProps = mutate(item.props as RowProps);
    dispatch({
      type: 'replace',
      destinationZone: selector.zone,
      destinationIndex: selector.index,
      data: { type: 'Row', props: { ...nextProps, id: rowId } },
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
        <RowLayoutFlyout
          anchorRef={layoutAnchorRef}
          onClose={(): void => setLayoutOpen(false)}
          onSelect={(presetId): void => applyRow((props) => applyRowLayoutPreset(props, presetId))}
        />
      ) : null}
      <QuickTooltip text="Add column and fit row">
        <ActionBar.Action label="Add column and fit row" onClick={(): void => applyRow(addColumnFitRow)}>
          <Plus size={16} />
        </ActionBar.Action>
      </QuickTooltip>
      <QuickTooltip text="Add full-width column">
        <ActionBar.Action
          label="Add full-width column"
          onClick={(): void => applyRow(addColumnFullWidth)}
        >
          <Columns2 size={16} />
        </ActionBar.Action>
      </QuickTooltip>
    </>
  );
}

/** Puck action bar — default duplicate/delete plus Row layout controls when a Row is active. */
export function PageBuilderActionBar({
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
    selectedItem?.type === 'Row' && typeof selectedItem.props.id === 'string'
      ? selectedItem.props.id
      : null;
  const rowId =
    label === 'Row' ? (target?.type === 'Row' ? target.id : selectedRowId) : null;
  const showRowExtras = Boolean(rowId);

  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);
  const getItemById = usePageBuilderPuck((s) => s.getItemById);

  const resolveCarouselId = (type: string, id: string | null | undefined): string | null => {
    const item = safeGetPuckItem(getItemById, id);
    return isPuckItemType(item, type) ? id! : null;
  };

  const contentSliderId = ((): string | null => {
    if (target?.type === 'ContentSlider') return resolveCarouselId('ContentSlider', target.id);
    if (selectedItem?.type === 'ContentSlider' && typeof selectedItem.props.id === 'string') {
      return resolveCarouselId('ContentSlider', selectedItem.props.id);
    }
    const selectedId = selectedItem?.props.id;
    if (typeof selectedId !== 'string') return null;
    const nestedSliderId = resolveContentSliderIdForItem(selectedId, getSelectorForId, getItemById);
    return nestedSliderId ? resolveCarouselId('ContentSlider', nestedSliderId) : null;
  })();

  const imageSliderId =
    target?.type === 'ImageSlider'
      ? resolveCarouselId('ImageSlider', target.id)
      : selectedItem?.type === 'ImageSlider' && typeof selectedItem.props.id === 'string'
        ? resolveCarouselId('ImageSlider', selectedItem.props.id)
        : null;

  const productSliderId =
    target?.type === 'ProductSlider'
      ? resolveCarouselId('ProductSlider', target.id)
      : selectedItem?.type === 'ProductSlider' && typeof selectedItem.props.id === 'string'
        ? resolveCarouselId('ProductSlider', selectedItem.props.id)
        : null;

  return (
    <ActionBar>
      <ActionBar.Group>
        {wrapQuickTooltip(parentAction, 'parent')}
        {label ? <ActionBar.Label label={label} /> : null}
        {showRowExtras ? <RowActionBarExtras rowId={rowId!} /> : null}
      </ActionBar.Group>
      {contentSliderId || imageSliderId || productSliderId ? (
        <ActionBar.Group>
          {contentSliderId ? <ContentSliderActionBarExtras sliderId={contentSliderId} /> : null}
          {imageSliderId ? (
            <SliderPreviewActionBarExtras carouselId={imageSliderId} type="ImageSlider" />
          ) : null}
          {productSliderId ? (
            <SliderPreviewActionBarExtras carouselId={productSliderId} type="ProductSlider" />
          ) : null}
        </ActionBar.Group>
      ) : null}
      <ActionBar.Group>
        {Children.map(children, (child, index) => wrapQuickTooltip(child, `action-${index}`))}
      </ActionBar.Group>
    </ActionBar>
  );
}

export type { RowLayoutPresetId };
