import { DropZone, type ComponentConfig } from '@measured/puck';
import type { ColumnsProps } from '../schema/component-types.js';
import { clampColumnCount, parseWidths } from './styles.js';

export const Columns: ComponentConfig<ColumnsProps> = {
  label: 'Columns',
  fields: {
    columns: { type: 'number', label: 'Columns', min: 1, max: 6, step: 1 },
    widths: { type: 'text', label: 'Widths' },
    gap: { type: 'number', label: 'Gap', min: 0, max: 96, step: 4 },
  },
  defaultProps: {
    columns: 2,
    widths: '50%,50%',
    gap: 24,
  },
  render: ({ id, columns, widths, gap }) => {
    const count = clampColumnCount(columns);
    const columnWidths = parseWidths(widths, count);

    return (
      // `gridTemplateColumns` (computed widths) + `gap` (author-driven) stay inline
      // (FR-006); the rest are `cmsc:` utilities. Feature 041.
      <div
        className="cmsc:grid cmsc:w-full"
        style={{ gridTemplateColumns: columnWidths.join(' '), gap }}
      >
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="cmsc:min-w-0">
            <DropZone zone={`${id}:column-${index}`} minEmptyHeight={96} />
          </div>
        ))}
      </div>
    );
  },
};
