import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement, type ReactNode } from 'react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { CursorPagination, PaginationFooter } from '@endora-commerce/admin-kit/components';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * `PaginationFooter`'s page sizes (feature 161, Checkpoint 5 review): a list
 * whose API pages differently from the admin's usual sizes — the price-book
 * grid's 50/100/200 lines — offers its own through `pageSizes`, and every
 * existing caller keeps the shared `PAGE_SIZE_OPTIONS`.
 */

const core = JSON.parse(readFileSync(join(resolve(process.cwd(), '..'), 'packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<string, string>;

function mount(ui: ReactElement): HTMLElement {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language="en" initialBundle={{ core }}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper }).container;
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

/**
 * Issue #1803 — a keyboard user who presses Next onto the last page (or
 * Previous onto the first) keeps focus on the button they pressed. A `disabled`
 * button cannot hold focus, so the browser dropped it to `<body>` and the user
 * had to tab through the whole page again (WCAG 2.2 SC 2.4.3). The end of the
 * range is announced as `aria-disabled` instead (SC 4.1.2), and pressing the
 * button there does nothing.
 */
const next = (): HTMLElement => screen.getByRole('button', { name: core['common.pagination.next']! });
const previous = (): HTMLElement => screen.getByRole('button', { name: core['common.pagination.previous']! });

function OffsetPager({ total, onNext, onPrev }: { total: number; onNext: () => void; onPrev: () => void }): ReactNode {
  const [page, setPage] = useState(0);
  return (
    <PaginationFooter
      page={page}
      pageSize={20}
      total={total}
      onPageSizeChange={vi.fn()}
      onPrev={(): void => {
        onPrev();
        setPage((p) => p - 1);
      }}
      onNext={(): void => {
        onNext();
        setPage((p) => p + 1);
      }}
    />
  );
}

/** A cursor-paged list of three pages: the third answers no next cursor. */
function CursorPager({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }): ReactNode {
  const [page, setPage] = useState(0);
  return (
    <PaginationFooter
      mode="cursor"
      page={page}
      pageSize={20}
      rowCount={page === 2 ? 5 : 20}
      hasNext={page < 2}
      onPageSizeChange={vi.fn()}
      onPrev={(): void => {
        onPrev();
        setPage((p) => p - 1);
      }}
      onNext={(): void => {
        onNext();
        setPage((p) => p + 1);
      }}
    />
  );
}

describe.each([
  ['offset', (onNext: () => void, onPrev: () => void): ReactElement => <OffsetPager total={45} onNext={onNext} onPrev={onPrev} />],
  ['cursor', (onNext: () => void, onPrev: () => void): ReactElement => <CursorPager onNext={onNext} onPrev={onPrev} />],
] as const)('PaginationFooter (%s) — focus at the ends of the range', (_mode, pager) => {
  it('keeps focus on Next after it reaches the last page, and ignores a further press', async () => {
    const onNext = vi.fn();
    mount(pager(onNext, vi.fn()));
    const user = userEvent.setup();
    next().focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(next()).toHaveFocus();
    expect(next()).toHaveAttribute('aria-disabled', 'true');
    expect(next()).not.toBeDisabled();
    await user.keyboard('{Enter}');
    await user.click(next());
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(next()).toHaveFocus();
  });

  it('keeps focus on Previous after it reaches the first page, and ignores a further press', async () => {
    const onPrev = vi.fn();
    mount(pager(vi.fn(), onPrev));
    const user = userEvent.setup();
    expect(previous()).toHaveAttribute('aria-disabled', 'true');
    await user.click(next());
    previous().focus();
    expect(previous()).not.toHaveAttribute('aria-disabled');
    await user.keyboard('{Enter}');
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(previous()).toHaveFocus();
    expect(previous()).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard(' ');
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('announces the new range when a page changes under the focused button', async () => {
    mount(pager(vi.fn(), vi.fn()));
    const summary = screen.getByText(/^Showing 1–20/);
    expect(summary).toHaveAttribute('aria-live', 'polite');
    await userEvent.setup().click(next());
    expect(summary).toHaveTextContent(/^Showing 21–40/);
  });

  it('has no axe violations at either end of the range', async () => {
    const container = mount(pager(vi.fn(), vi.fn()));
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.click(next());
    await user.click(next());
    await expectNoAxeViolations(container);
  });
});

describe('CursorPagination — focus at the ends of the range', () => {
  function Harness({ onNext }: { onNext: () => void }): ReactNode {
    const [page, setPage] = useState(1);
    return (
      <CursorPagination
        page={page}
        pageSize={20}
        hasPrevious={page > 1}
        hasNext={page < 2}
        onPageSizeChange={vi.fn()}
        onPrevious={(): void => setPage((p) => p - 1)}
        onNext={(): void => {
          onNext();
          setPage((p) => p + 1);
        }}
      />
    );
  }

  it('keeps focus on Next after it reaches the last page, and ignores a further press', async () => {
    const onNext = vi.fn();
    const container = mount(<Harness onNext={onNext} />);
    const user = userEvent.setup();
    next().focus();
    await user.keyboard('{Enter}');
    expect(next()).toHaveFocus();
    expect(next()).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container);
  });

  it('keeps focus while a page is being fetched, and ignores a press until it answers', async () => {
    const onNext = vi.fn();
    mount(
      <CursorPagination
        page={1}
        pageSize={20}
        hasPrevious={false}
        hasNext
        busy
        onPageSizeChange={vi.fn()}
        onPrevious={vi.fn()}
        onNext={onNext}
      />,
    );
    next().focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onNext).not.toHaveBeenCalled();
    expect(next()).toHaveFocus();
    expect(next()).toHaveAttribute('aria-disabled', 'true');
  });
});
