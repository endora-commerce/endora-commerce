import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardList, Filter } from 'lucide-react';
import { Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15) — the kit's `EmptyState`. An empty
 * list was a grey sentence hand-written on ~25 screens, and most lists said the
 * same thing for "nothing here yet" and "your filters match nothing". The kit
 * draws one block — icon, title, one line, one action (Picture Superiority) —
 * in two variants, so the two situations never look alike.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

function region(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-empty-state]');
  if (!found) throw new Error('no empty state rendered');
  return found;
}

describe('EmptyState — "no data" (the default variant)', () => {
  it('renders the icon (decorative), the title, the one line and the one action', () => {
    renderWithI18n(
      <EmptyState
        icon={<ClipboardList size={20} />}
        title="No forms yet"
        description="Create one to start collecting entries."
        action={<Button>New form</Button>}
      />,
      EN,
    );
    const block = region();
    expect(block.getAttribute('data-empty-state')).toBe('no-data');
    expect(block.classList.contains('b2b-empty')).toBe(true);
    const icon = block.querySelector('.b2b-empty__icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(block.querySelector('.b2b-empty__title')?.textContent).toBe('No forms yet');
    expect(block.querySelector('.b2b-empty__sub')?.textContent).toBe('Create one to start collecting entries.');
    expect(screen.getByRole('button', { name: 'New form' })).toBeTruthy();
  });

  it('omits the line and the action when there are none — a read-only operator gets no dead button', () => {
    renderWithI18n(<EmptyState icon={<ClipboardList />} title="No forms yet" />, EN);
    const block = region();
    expect(block.querySelector('.b2b-empty__sub')).toBeNull();
    expect(block.querySelector('button, a')).toBeNull();
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(
      <EmptyState icon={<ClipboardList />} title="No forms yet" description="Create one." action={<Button>New form</Button>} />,
      EN,
    );
    await expectNoAxeViolations(container);
  });
});

describe('EmptyState — "no results" (filters matched nothing)', () => {
  it('says so in the shipped copy and offers Clear filters, which calls back', async () => {
    const onClear = vi.fn();
    renderWithI18n(<EmptyState variant="no-results" onClearFilters={onClear} />, EN);
    const block = region();
    expect(block.getAttribute('data-empty-state')).toBe('no-results');
    expect(block.querySelector('.b2b-empty__icon svg')).not.toBeNull();
    expect(block.querySelector('.b2b-empty__title')?.textContent).toBe(EN.core!['common.emptyState.noResults.title']);
    expect(block.querySelector('.b2b-empty__sub')?.textContent).toBe(EN.core!['common.emptyState.noResults.body']);
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear.getAttribute('type')).toBe('button');
    // Outline, not filled: the no-results state is not the view's primary (Von Restorff).
    expect(clear.className).toContain('border');
    await userEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ships the copy in Polish', () => {
    renderWithI18n(<EmptyState variant="no-results" onClearFilters={() => undefined} />, PL, { language: 'pl' });
    expect(screen.getByRole('button', { name: 'Wyczyść filtry' })).toBeTruthy();
    expect(region().querySelector('.b2b-empty__title')?.textContent).toBe(PL.core!['common.emptyState.noResults.title']);
    expect(PL.core!['common.emptyState.noResults.title']).not.toBe(EN.core!['common.emptyState.noResults.title']);
    expect(PL.core!['common.emptyState.noResults.body']).not.toBe(EN.core!['common.emptyState.noResults.body']);
  });

  it('lets a screen name what it lists, keeping the kit line and button', () => {
    renderWithI18n(
      <EmptyState variant="no-results" icon={<Filter />} title="No form matches these filters." onClearFilters={() => undefined} />,
      EN,
    );
    const block = region();
    expect(block.querySelector('.b2b-empty__title')?.textContent).toBe('No form matches these filters.');
    expect(block.querySelector('.b2b-empty__sub')?.textContent).toBe(EN.core!['common.emptyState.noResults.body']);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<EmptyState variant="no-results" onClearFilters={() => undefined} />, EN);
    await expectNoAxeViolations(container);
  });
});
