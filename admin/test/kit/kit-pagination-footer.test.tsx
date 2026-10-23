import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import { PaginationFooter } from '@endora-commerce/admin-kit/components';

/**
 * `PaginationFooter`'s page sizes (feature 161, Checkpoint 5 review): a list
 * whose API pages differently from the admin's usual sizes — the price-book
 * grid's 50/100/200 lines — offers its own through `pageSizes`, and every
 * existing caller keeps the shared `PAGE_SIZE_OPTIONS`.
 */

const core = JSON.parse(readFileSync(join(resolve(process.cwd(), '..'), 'packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<string, string>;

function mount(ui: ReactElement): void {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language="en" initialBundle={{ core }}>
      <>{children}</>
    </TranslationProvider>
  );
  render(ui, { wrapper });
}

const options = (): string[] => [...screen.getByLabelText('Rows per page:').querySelectorAll('option')].map((o) => o.textContent ?? '');

describe('PaginationFooter — page sizes', () => {
  it('offers the shared sizes by default', () => {
    mount(<PaginationFooter page={0} pageSize={20} total={45} onPageSizeChange={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(options()).toEqual(['5', '10', '20', '50', '100', '500']);
  });

  it('offers a caller’s own sizes and hands back the one chosen', async () => {
    const onPageSizeChange = vi.fn();
    mount(
      <PaginationFooter
        page={0}
        pageSize={50}
        pageSizes={[50, 100, 200]}
        total={120}
        onPageSizeChange={onPageSizeChange}
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(options()).toEqual(['50', '100', '200']);
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Rows per page:'), '200');
    expect(onPageSizeChange).toHaveBeenCalledWith(200);
  });
});
