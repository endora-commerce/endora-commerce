import { DropZone, type ComponentConfig } from '@measured/puck';
import type { RowProps } from '../schema/component-types.js';

// `align` is one of four fixed options → utility classes. `gap`, `background`
// and `padding` are author-driven arbitrary values → kept inline (FR-006). Feature 041.
const alignClass: Record<RowProps['align'], string> = {
  stretch: 'cmsc:items-stretch',
  start: 'cmsc:items-start',
  center: 'cmsc:items-center',
  end: 'cmsc:items-end',
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
      className={`cmsc:flex cmsc:flex-col cmsc:w-full ${alignClass[align]}`}
      style={{ gap, background, padding }}
    >
      <DropZone zone={`${id}:content`} minEmptyHeight={80} />
    </section>
  ),
};
