'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CSSProperties, Ref } from 'react';
import {
  buildResponsiveSpanVars,
  hideOnDataAttrs,
  PB_RESPONSIVE_METADATA,
  RESPONSIVE_HIDE_ON_CLASS,
  resolveColumnSpan,
} from '@endora-commerce/page-builder-core';
import { createHideOnField } from '@endora-commerce/page-builder-core/fields/hide-on-field';
import { getZoneParentComponentType } from '@endora-commerce/page-builder-core/editor/puck-guards';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ColumnProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  COLUMN_SPAN_OPTIONS,
  CORNER_RADIUS_FIELD,
  DEFAULT_LAYOUT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { COLUMN_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';

const HIDE_ON_FIELD = createHideOnField();

/**
 * Published: CSS vars + @media (storefront).
 * Editing: inline `grid-column` from the selected Puck viewport tier. Relying on
 * iframe @media alone is brittle — a tablet frame of exactly 768px often fails
 * `min-width: 768px` once a scrollbar eats a few pixels, so columns stay span 12.
 */
function columnSpanStyle(
  span: ColumnProps['span'],
  tier: ReturnType<typeof usePreviewBreakpointTier>,
  editing: boolean,
): CSSProperties {
  if (editing) {
    return { gridColumn: `span ${resolveColumnSpan(span, tier, 12)}` };
  }
  return buildResponsiveSpanVars(span, 12);
}

function ColumnShell({
  span,
  hideOn,
  editing,
  tier,
  dragRef,
  children,
}: {
  span: ColumnProps['span'];
  hideOn: ColumnProps['hideOn'];
  editing: boolean;
  tier: ReturnType<typeof usePreviewBreakpointTier>;
  dragRef?: Ref<HTMLDivElement> | null | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      ref={dragRef ?? undefined}
      className={`cmsc-pb-row-col cmsc:min-w-0 cmsc:self-stretch ${RESPONSIVE_HIDE_ON_CLASS}`}
      style={columnSpanStyle(span, tier, editing)}
      {...hideOnDataAttrs(hideOn)}
      data-pb-editing={editing ? '1' : '0'}
    >
      {children}
    </div>
  );
}

const ColumnEditingRender: PuckComponent<ColumnProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { content: Content, span, hideOn, puck, ...box } = props;

  return (
    <ColumnShell span={span} hideOn={hideOn} editing tier={tier} dragRef={puck?.dragRef}>
      <BoxStyled previewTier={tier} className="cmsc-pb-column-inner cmsc:h-full cmsc:w-full" {...box}>
        <Content {...COLUMN_SLOT_EDIT_PROPS} />
      </BoxStyled>
    </ColumnShell>
  );
};

const ColumnPublishedRender: PuckComponent<ColumnProps> = (props) => {
  const { content: Content, span, hideOn, ...box } = props;

  return (
    <ColumnShell span={span} hideOn={hideOn} editing={false} tier="mobile">
      <BoxStyled className="cmsc:h-full cmsc:w-full" {...box}>
        <Content />
      </BoxStyled>
    </ColumnShell>
  );
};

const columnConfig: ComponentConfig<{ props: ColumnProps }> = {
  label: 'Column',
  /** Grid cell is .cmsc-pb-row-col — Puck must not wrap it in an extra block. */
  inline: true,
  resolvePermissions: (data, { appState, permissions }) => {
    const itemId = data.props.id;
    if (typeof itemId !== 'string') return permissions;

    let parentType: string | null = null;
    const zones = appState.data.zones ?? {};

    for (const [zone, items] of Object.entries(zones)) {
      if (!Array.isArray(items)) continue;
      const containsColumn = items.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return (entry as { props?: { id?: string } }).props?.id === itemId;
      });
      if (containsColumn) {
        parentType = getZoneParentComponentType(zone, appState.data);
        break;
      }
    }

    if (parentType === null) {
      const visit = (items: unknown[], parent: string | null): boolean => {
        for (const entry of items) {
          if (!entry || typeof entry !== 'object') continue;
          const record = entry as { type?: string; props?: { id?: string } };
          if (record.props?.id === itemId) {
            parentType = parent;
            return true;
          }
          if (record.props && typeof record.props === 'object') {
            for (const value of Object.values(record.props)) {
              if (Array.isArray(value) && visit(value, record.type ?? null)) return true;
            }
          }
        }
        return false;
      };
      visit(appState.data.content ?? [], 'root');
    }

    const inRow = parentType === 'Row';
    return {
      ...permissions,
      insert: inRow,
      drag: inRow,
      duplicate: inRow,
    };
  },
  fields: {
    hideOn: HIDE_ON_FIELD,
    span: {
      type: 'select',
      label: 'Width',
      metadata: PB_RESPONSIVE_METADATA,
      options: COLUMN_SPAN_OPTIONS,
    },
    content: {
      type: 'slot',
      disallow: ['Column'],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
    background: BACKGROUND_FIELD,
    cornerRadius: CORNER_RADIUS_FIELD,
    shadow: SHADOW_FIELD,
  },
  defaultProps: {
    span: 12,
    content: [],
    ...DEFAULT_LAYOUT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ColumnEditingRender {...props} /> : <ColumnPublishedRender {...props} />,
};

/** Column must not use withHideOn — the outer grid cell is .cmsc-pb-row-col itself. */
export const Column = columnConfig;

export function createDefaultColumnItem(id: string): { type: 'Column'; props: ColumnProps & { id: string } } {
  return {
    type: 'Column',
    props: {
      id,
      span: 12,
      content: [],
      ...DEFAULT_LAYOUT_BOX_PROPS,
    },
  };
}
