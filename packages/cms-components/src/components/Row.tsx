import { DropZone, type ComponentConfig } from '@measured/puck';
import type { CSSProperties } from 'react';
import type { RowProps } from '../schema/component-types.js';

const alignMap: Record<RowProps['align'], CSSProperties['alignItems']> = {
  stretch: 'stretch',
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

export const Row: ComponentConfig<RowProps> = {
  label: 'Row',
  fields: {
    gap: { type: 'number', label: 'Gap', min: 0, max: 96, step: 4 },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Stretch', value: 'stretch' },
        { label: 'Start', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'End', value: 'end' },
      ],
    },
    background: { type: 'text', label: 'Background' },
    padding: { type: 'number', label: 'Padding', min: 0, max: 120, step: 4 },
  },
  defaultProps: {
    gap: 24,
    align: 'stretch',
    background: 'transparent',
    padding: 0,
  },
  render: ({ id, gap, align, background, padding }) => (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        alignItems: alignMap[align],
        background,
        padding,
        width: '100%',
      }}
    >
      <DropZone zone={`${id}:content`} minEmptyHeight={80} />
    </section>
  ),
};
