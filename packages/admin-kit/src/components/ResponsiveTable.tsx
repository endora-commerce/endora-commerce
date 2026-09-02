import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table.js';
import { useViewportTier } from './hooks/useViewportTier.js';

export interface ResponsiveColumn<T> {
  id: string;
  header: ReactNode;
  /** Shown in the card headline on mobile. At least one column must be primary. */
  primary?: boolean;
  /** Omitted from the card headline; still shown in the desktop table. */
  hideOnMobile?: boolean;
  render: (row: T) => ReactNode;
  /** Optional second line under the headline on mobile. */
  meta?: (row: T) => ReactNode;
  className?: string;
}

export interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyState?: ReactNode;
  /** Optional row actions rendered in the last table column and on each card. */
  renderActions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Force horizontal scroll wrapper instead of cards on mobile. */
  mode?: 'auto' | 'table-scroll';
}

export function ResponsiveTable<T>(props: ResponsiveTableProps<T>): ReactNode {
  const {
    columns,
    data,
    keyExtractor,
    emptyState = null,
    renderActions,
    onRowClick,
    mode = 'auto',
  } = props;
  const tier = useViewportTier();
  const primaryColumns = columns.filter((c) => c.primary);
  const displayColumns: ResponsiveColumn<T>[] =
    primaryColumns.length > 0
      ? primaryColumns
      : columns[0] != null
        ? [columns[0]]
        : [];

  if (data.length === 0) {
    return emptyState;
  }

  if (tier === 'desktop' || mode === 'table-scroll') {
    const table = (
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.id} className={col.className}>
                {col.header}
              </TableHead>
            ))}
            {renderActions ? <TableHead className="w-[1%]" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={keyExtractor(row)}
              className={onRowClick ? 'cursor-pointer' : undefined}
              onClick={onRowClick ? (): void => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <TableCell key={col.id} className={col.className}>
                  {col.render(row)}
                </TableCell>
              ))}
              {renderActions ? <TableCell>{renderActions(row)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

    if (mode === 'table-scroll') {
      return <div className="b2b-table-scroll">{table}</div>;
    }
    return table;
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((row) => (
        <div
          key={keyExtractor(row)}
          className="b2b-responsive-card"
          role={onRowClick ? 'button' : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? (): void => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (e): void => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          }
        >
          <div className="b2b-responsive-card__headline">
            {displayColumns.map((col) => (
              <span key={col.id}>{col.render(row)}</span>
            ))}
          </div>
          {displayColumns.some((col) => col.meta) ? (
            <div className="b2b-responsive-card__meta">
              {displayColumns.map((col) =>
                col.meta ? <span key={col.id}>{col.meta(row)}</span> : null,
              )}
            </div>
          ) : null}
          {columns
            .filter((c) => !c.primary && !c.hideOnMobile)
            .map((col) => (
              <div key={col.id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{col.header}: </span>
                {col.render(row)}
              </div>
            ))}
          {renderActions ? (
            <div className="b2b-responsive-card__actions">{renderActions(row)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
