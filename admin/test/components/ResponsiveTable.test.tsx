import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponsiveTable, type ResponsiveColumn } from '../../src/components/ResponsiveTable';
import { setMobileViewport } from '../setup';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: ResponsiveColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    primary: true,
    render: (row) => row.name,
  },
  {
    id: 'status',
    header: 'Status',
    render: (row) => row.status,
  },
];

const rows: Row[] = [
  { id: '1', name: 'Alpha', status: 'new' },
  { id: '2', name: 'Beta', status: 'done' },
];

describe('ResponsiveTable', () => {
  it('renders table headers on desktop', () => {
    setMobileViewport(false);
    render(<ResponsiveTable columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });

  it('renders card layout on mobile', () => {
    setMobileViewport(true);
    render(<ResponsiveTable columns={columns} data={rows} keyExtractor={(r) => r.id} />);
    expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
