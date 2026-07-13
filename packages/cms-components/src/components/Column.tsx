'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CSSProperties, Ref } from 'react';
import {
  buildResponsiveSpanVars,
  hideOnDataAttrs,
  PB_RESPONSIVE_METADATA,
  RESPONSIVE_HIDE_ON_CLASS,
  resolveColumnSpan,
} from '@b2b/page-builder-core';
import { createHideOnField } from '@b2b/page-builder-core/editor';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ColumnProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  COLUMN_SPAN_OPTIONS,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { COLUMN_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';

const HIDE_ON_FIELD = createHideOnField();

function columnSpanStyle(span: ColumnProps['span'], tier: ReturnType<typeof usePreviewBreakpointTier>, editing: boolean): CSSProperties {
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
      disallow: ['Row', 'Column'],
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
    ...DEFAULT_BOX_PROPS,
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
      ...DEFAULT_BOX_PROPS,
    },
  };
}
