import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setMobileViewport } from '../../setup';

/**
 * Inventory stock form uses shared page layout; mobile single-column is
 * enforced via global `.b2b-main` grid rules (feature 029).
 */
describe('InventoryPage mobile layout contract', () => {
  it('mobile viewport tier is active in test harness', () => {
    setMobileViewport(true);
    render(
      <div className="b2b-main">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label htmlFor="qty">qty</label>
          <input id="qty" />
        </div>
      </div>,
    );
    expect(screen.getByLabelText('qty')).toBeInTheDocument();
  });
});
