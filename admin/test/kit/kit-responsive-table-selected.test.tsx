import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { adminSession, withSession } from '../helpers/render-with-session';
import { setMobileViewport } from '../setup';

/**
 * Issue #1749 — `ResponsiveTable`'s `isRowSelected`: a list with row selection
 * (the products list's bulk edit) marks the selected rows `data-state="selected"`,
 * the attribute the kit `TableRow` already draws in the selected tint, on the
 * desktop table and on the mobile cards alike. The checked checkbox stays what
 * says so; the tint only groups the selection at a glance.
 */

const en = shippedCoreBundle('en');
const session = adminSession({ permissions: ['*'] });
const wrap = (ui: ReactNode): ReactElement => withSession(<>{ui}</>, { session });
const rows = [
  { id: 'a', name: 'Oak chair' },
  { id: 'b', name: 'Pine desk' },
];
const columns = [{ id: 'name', header: 'Name', primary: true, render: (row: { name: string }) => row.name }];

afterEach(() => setMobileViewport(false));

describe('ResponsiveTable — selected rows (isRowSelected)', () => {
  it('marks the selected table rows and leaves the rest unmarked', () => {
    renderWithI18n(
      wrap(
        <ResponsiveTable data={rows} columns={columns} keyExtractor={(row) => row.id} isRowSelected={(row) => row.id === 'b'} />,
      ),
      en,
    );
    expect(screen.getByText('Pine desk').closest('tr')).toHaveAttribute('data-state', 'selected');
    expect(screen.getByText('Oak chair').closest('tr')).not.toHaveAttribute('data-state');
  });

  it('marks nothing when the list has no selection', () => {
    renderWithI18n(wrap(<ResponsiveTable data={rows} columns={columns} keyExtractor={(row) => row.id} />), en);
    expect(screen.getByText('Pine desk').closest('tr')).not.toHaveAttribute('data-state');
  });

  it('marks the selected card on a phone', () => {
    setMobileViewport(true);
    renderWithI18n(
      wrap(
        <ResponsiveTable data={rows} columns={columns} keyExtractor={(row) => row.id} isRowSelected={(row) => row.id === 'a'} />,
      ),
      en,
    );
    expect(screen.getByText('Oak chair').closest('.b2b-responsive-card')).toHaveAttribute('data-state', 'selected');
    expect(screen.getByText('Pine desk').closest('.b2b-responsive-card')).not.toHaveAttribute('data-state');
  });
});
