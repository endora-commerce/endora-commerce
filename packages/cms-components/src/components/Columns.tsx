'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  buildResponsiveNumberVars,
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ColumnItemProps, ColumnsProps } from '../schema/component-types.js';
import { clampColumnCount, parseWidths } from './styles.js';

const ColumnsEditingRender: PuckComponent<ColumnsProps> = ({ columnItems, columns, widths, gap }) => {
  const tier = usePreviewBreakpointTier();
  const count = clampColumnCount(columns);
  const columnWidths = parseWidths(widths, count);
  const items = columnItems ?? [];
  const resolvedGap = resolveResponsiveNumber(gap, tier, 24);

  return (
    <div
      className="cmsc:grid cmsc:w-full"
      style={{
        gap: `${resolvedGap}px`,
        gridTemplateColumns: columnWidths.join(' '),
      }}
    >
      {Array.from({ length: count }, (_, index) => {
        const slot = items[index]?.content;
        const Content = slot;
        return (
          <div key={index} className="cmsc:min-w-0">
            {Content ? <Content minEmptyHeight={96} /> : null}
          </div>
        );
      })}
    </div>
  );
};

const ColumnsPublishedRender: PuckComponent<ColumnsProps> = ({ columnItems, columns, widths, gap }) => {
  const count = clampColumnCount(columns);
  const columnWidths = parseWidths(widths, count);
  const items = columnItems ?? [];

  return (
    <div
      className="cmsc:grid cmsc:w-full cmsc-pb-gap"
      style={{
        gridTemplateColumns: columnWidths.join(' '),
        ...buildResponsiveNumberVars('gap', gap, 24),
      }}
    >
      {Array.from({ length: count }, (_, index) => {
        const slot = items[index]?.content;
        const Content = slot;
        return (
          <div key={index} className="cmsc:min-w-0">
            {Content ? <Content minEmptyHeight={96} /> : null}
          </div>
        );
      })}
    </div>
  );
};

const columnsConfig: ComponentConfig<{ props: ColumnsProps }> = {
  label: 'Columns',
  fields: {
    columns: { type: 'number', label: 'Columns', min: 1, max: 6, step: 1 },
    widths: { type: 'text', label: 'Widths' },
    gap: { type: 'number', label: 'Gap', min: 0, max: 96, step: 4, metadata: PB_RESPONSIVE_METADATA },
    columnItems: {
      type: 'array',
      label: 'Column content',
      arrayFields: {
        content: { type: 'slot' },
      },
      getItemSummary: (_item, index = 0) => `Column ${index + 1}`,
    },
  },
  defaultProps: {
    columns: 2,
    widths: '50%,50%',
    gap: 24,
    columnItems: [{ content: [] }, { content: [] }],
  },
  resolveData: async ({ props }) => {
    const count = clampColumnCount(props.columns);
    const items: ColumnItemProps[] = [...(props.columnItems ?? [])];
    while (items.length < count) {
      items.push({ content: [] });
    }
    if (items.length > count) {
      items.length = count;
    }
    return { props: { ...props, columnItems: items } };
  },
  render: (props) =>
    props.puck?.isEditing ? <ColumnsEditingRender {...props} /> : <ColumnsPublishedRender {...props} />,
};

export const Columns = withHideOn(columnsConfig);
