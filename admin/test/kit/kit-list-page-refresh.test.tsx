import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { createRef, type ReactElement, type ReactNode } from 'react';
import { ListPage, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * Issue #1749 — what the work lists (Tasks, Projects, Opportunities) needed
 * from `ListPage` to move onto it without losing a state they already had:
 *
 * - `busy` — a refresh over rows already on screen. The rows stay, the results
 *   region is `aria-busy`, and the count's live region says *Loading…*; the
 *   skeleton is for the first load only (ux-laws §6.1).
 * - `resultsRef` — the results region, focusable from script, for a screen that
 *   sends focus to the results (after removing a refused filter, WCAG 2.4.3).
 * - an error's `action` — a way out other than *Retry*, for a failure that
 *   asking again cannot fix (a filter the server refuses).
 */

const en = shippedCoreBundle('en');
const core = en.core!;
const session = adminSession({ permissions: ['*'] });
const wrap = (ui: ReactNode): ReactElement => withSession(<>{ui}</>, { session });

describe('ListPage — a refresh over rows on screen (busy)', () => {
  it('keeps the rows, marks the results busy and says loading in the count region, with no skeleton', () => {
    const { rerender } = renderWithI18n(
      wrap(
        <ListPage title="Tasks" count="Tasks: 3" load={{ kind: 'ready' }}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Tasks: 3');
    expect(screen.getByText('rows').closest('[aria-busy]')).toBeNull();

    rerender(
      wrap(
        <ListPage title="Tasks" count="Tasks: 3" load={{ kind: 'ready' }} busy>
          <p>rows</p>
        </ListPage>,
      ),
    );
    expect(screen.getByText('rows').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('list-page-skeleton')).toBeNull();
    // The same region, so the change is announced.
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(core['common.state.loading']!);
  });
});

describe('ListPage — the results region (resultsRef)', () => {
  it('hands the results region to the screen, focusable from script and out of the tab order', () => {
    const ref = createRef<HTMLDivElement>();
    renderWithI18n(
      wrap(
        <ListPage title="Projects" load={{ kind: 'ready' }} resultsRef={ref}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    expect(ref.current).not.toBeNull();
    expect(ref.current).toContainElement(screen.getByText('rows'));
    expect(ref.current).toHaveAttribute('tabindex', '-1');
    ref.current!.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it('leaves the region out of focus handling when no screen asks for it', () => {
    renderWithI18n(
      wrap(
        <ListPage title="Projects" load={{ kind: 'ready' }}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    expect(screen.getByText('rows').closest('[tabindex]')).toBeNull();
  });
});

describe('ListPage — an error with its own way out (action)', () => {
  const refused: ListPageLoad = {
    kind: 'error',
    message: 'The filter "Region" is no longer available.',
    action: <button type="button">Remove filter</button>,
  };

  it('offers the action in place of Retry', () => {
    renderWithI18n(
      wrap(
        <ListPage title="Opportunities" load={refused} onRetry={() => undefined}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The filter "Region" is no longer available.');
    expect(within(alert).getByRole('button', { name: 'Remove filter' })).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: core['common.action.retry']! })).toBeNull();
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('has no axe violations with the action on screen', async () => {
    const { container } = renderWithI18n(
      wrap(
        <ListPage title="Opportunities" load={refused}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    await expectNoAxeViolations(container);
  });
});
