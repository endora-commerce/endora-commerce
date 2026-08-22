'use client';

import { type ComponentConfig, type Field, type PuckComponent, FieldLabel } from '@measured/puck';
import { withHideOn } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type {
  SimpleTableCell,
  SimpleTableHeader,
  SimpleTableProps,
  SimpleTableRow,
} from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

const inputClassName = '_Input-input_bsxfo_26';

function parsePipeHeaders(raw: string): SimpleTableHeader[] {
  return raw
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function parsePipeRows(raw: string): SimpleTableRow[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      cells: line.split('|').map((cell) => ({ value: cell.trim() })),
    }));
}

function resolveColumns(props: SimpleTableProps): SimpleTableHeader[] {
  if (Array.isArray(props.columns) && props.columns.length > 0) return props.columns;
  if (Array.isArray(props.headers)) return props.headers;
  if (typeof props.headers === 'string' && props.headers.trim()) return parsePipeHeaders(props.headers);
  return [];
}

function resolveRows(props: SimpleTableProps): SimpleTableRow[] {
  if (Array.isArray(props.tableRows) && props.tableRows.length > 0) return props.tableRows;
  if (Array.isArray(props.rows)) return props.rows;
  if (typeof props.rows === 'string' && props.rows.trim()) return parsePipeRows(props.rows);
  return [];
}

function padRowCells(row: SimpleTableRow, colCount: number): SimpleTableRow {
  const cells = [...(row.cells ?? [])];
  while (cells.length < colCount) cells.push({ value: '' });
  return { cells: cells.slice(0, Math.max(colCount, 1)) };
}

function emptyCells(colCount: number): SimpleTableCell[] {
  return Array.from({ length: Math.max(colCount, 1) }, () => ({ value: '' }));
}

/** Fixed cell editors — one input per column, no nested array +/- (avoids Puck stale-length races). */
function createTableCellsField(columns: SimpleTableHeader[]): Field<SimpleTableCell[]> {
  const colCount = Math.max(1, columns.length);
  const headers =
    columns.length > 0 ? columns : Array.from({ length: colCount }, (_, i) => ({ label: `Column ${i + 1}` }));

  return {
    type: 'custom',
    label: 'Cells',
    render: ({ value, onChange, readOnly }) => {
      const cells = padRowCells({ cells: Array.isArray(value) ? value : [] }, colCount).cells ?? emptyCells(colCount);

      return (
        <FieldLabel label="Cells" {...(readOnly === true ? { readOnly: true } : {})}>
          <div className="cmsc-pb-table-cells-field">
            {headers.map((col, index) => (
              <label key={index} className="cmsc-pb-table-cells-field__row">
                <span className="cmsc-pb-table-cells-field__label">
                  {col.label?.trim() || `Column ${index + 1}`}
                </span>
                <input
                  type="text"
                  className={inputClassName}
                  value={cells[index]?.value ?? ''}
                  readOnly={readOnly === true}
                  onChange={(e): void => {
                    const next = emptyCells(colCount).map((fallback, i) =>
                      i === index ? { value: e.target.value } : { value: cells[i]?.value ?? fallback.value },
                    );
                    onChange(next);
                  }}
                />
              </label>
            ))}
          </div>
        </FieldLabel>
      );
    },
  };
}

function SimpleTableBody({
  props,
  editing,
  tier,
}: {
  props: SimpleTableProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const { striped = true, ...box } = props;
  const columns = resolveColumns(props);
  const rows = resolveRows(props).map((row) => padRowCells(row, columns.length || 1));

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <div className="cmsc-pb-table-wrap">
        <table className={`cmsc-pb-table${striped ? ' cmsc-pb-table--striped' : ''}`}>
          {columns.length > 0 ? (
            <thead>
              <tr>
                {columns.map((col, i) => (
                  <th key={`${col.label}-${i}`}>{col.label}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {(row.cells ?? []).map((cell, ci) => (
                  <td key={`${ri}-${ci}`}>{cell.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && columns.length === 0 ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b] cmsc:mt-2">Add columns in the Columns tab.</p>
      ) : null}
    </BoxStyled>
  );
}

const SimpleTableEditingRender: PuckComponent<SimpleTableProps> = (props) => (
  <SimpleTableBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const SimpleTablePublishedRender: PuckComponent<SimpleTableProps> = (props) => (
  <SimpleTableBody props={props} editing={false} tier={null} />
);

function migrateTableProps(props: SimpleTableProps): SimpleTableProps {
  const columns = resolveColumns(props);
  const colCount = Math.max(1, columns.length);
  const tableRows = resolveRows(props).map((row) => padRowCells(row, colCount));
  return {
    ...props,
    columns: columns.length > 0 ? columns : [{ label: 'Column 1' }],
    tableRows,
  };
}

const BASE_TABLE_FIELDS = {
  columns: {
    type: 'array' as const,
    label: 'Columns',
    getItemSummary: (item: SimpleTableHeader, index?: number) =>
      item.label?.trim() || `Column ${(index ?? 0) + 1}`,
    arrayFields: {
      label: { type: 'text' as const, label: 'Header' },
    },
    defaultItemProps: { label: 'Column' },
  },
  striped: {
    type: 'radio' as const,
    label: 'Striped rows',
    options: [
      { label: 'Yes', value: true },
      { label: 'No', value: false },
    ],
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

function tableRowsField(columns: SimpleTableHeader[]) {
  const colCount = Math.max(1, columns.length);
  return {
    type: 'array' as const,
    label: 'Rows',
    getItemSummary: (item: SimpleTableRow, index?: number) => {
      const preview = (item.cells ?? [])
        .map((c) => c.value?.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' · ');
      return preview || `Row ${(index ?? 0) + 1}`;
    },
    arrayFields: {
      cells: createTableCellsField(columns),
    },
    defaultItemProps: { cells: emptyCells(colCount) },
  };
}

const simpleTableConfig: ComponentConfig<SimpleTableProps> = {
  label: 'Table',
  fields: {
    ...BASE_TABLE_FIELDS,
    tableRows: tableRowsField([{ label: 'Plan' }, { label: 'Users' }, { label: 'Price' }]),
  },
  defaultProps: {
    columns: [{ label: 'Plan' }, { label: 'Users' }, { label: 'Price' }],
    tableRows: [
      { cells: [{ value: 'Starter' }, { value: '5' }, { value: '€49' }] },
      { cells: [{ value: 'Growth' }, { value: '25' }, { value: '€149' }] },
      { cells: [{ value: 'Enterprise' }, { value: 'Unlimited' }, { value: 'Custom' }] },
    ],
    striped: true,
    ...DEFAULT_BOX_PROPS,
  },
  resolveFields: (data) => {
    const columns = resolveColumns(data.props);
    const resolvedColumns = columns.length > 0 ? columns : [{ label: 'Column 1' }];
    return {
      ...BASE_TABLE_FIELDS,
      tableRows: tableRowsField(resolvedColumns),
    };
  },
  resolveData: async ({ props }) => ({ props: migrateTableProps(props) }),
  render: (props) =>
    props.puck?.isEditing ? (
      <SimpleTableEditingRender {...props} />
    ) : (
      <SimpleTablePublishedRender {...props} />
    ),
};

export const SimpleTable = withHideOn(simpleTableConfig);
