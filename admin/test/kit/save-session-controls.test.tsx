import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { SaveSessionProvider, type SaveOutcome } from '@endora-commerce/admin-kit/lib';
import { SaveSessionActions, SaveSessionSummary } from '@endora-commerce/admin-kit/components';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Feature 180, WP-5 — the two generic controls every adopting editor without a Save of its own
 * uses (`specs/180-one-save-zone-editors/contracts/save-participation.md` §5; FR-007, FR-016,
 * FR-081; research R16). The copy is read off the shipped `core` bundles, so a key that never
 * travelled fails here rather than rendering its own name at an operator.
 */

function bundleOf(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const core = bundleOf(language);
  return (
    <TranslationProvider
      language={language}
      initialBundle={{ core }}
      {...(language === 'en' ? {} : { initialFallbackBundle: { core } })}
    >
      {withSession(<SaveSessionProvider resetKey="r">{ui}</SaveSessionProvider>, {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: [] }),
      })}
    </TranslationProvider>
  );
}

describe('SaveSessionActions', () => {
  it('reads "Save" with a note while nothing is staged, and is inert', () => {
    const onSave = vi.fn();
    render(wrap(<SaveSessionActions hostCount={0} canSave saving={false} onSave={onSave} />));
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No unsaved changes')).toBeTruthy();
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('counts the host’s changes and saves on press', () => {
    const onSave = vi.fn();
    render(wrap(<SaveSessionActions hostCount={2} canSave saving={false} onSave={onSave} />));
    const button = screen.getByRole('button', { name: 'Save 2 changes' });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByText('No unsaved changes')).toBeNull();
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('uses the Polish plural forms', () => {
    const view = render(wrap(<SaveSessionActions hostCount={1} canSave saving={false} onSave={vi.fn()} />, 'pl'));
    expect(screen.getByRole('button', { name: 'Zapisz 1 zmianę' })).toBeTruthy();
    view.rerender(wrap(<SaveSessionActions hostCount={3} canSave saving={false} onSave={vi.fn()} />, 'pl'));
    expect(screen.getByRole('button', { name: 'Zapisz 3 zmiany' })).toBeTruthy();
    view.rerender(wrap(<SaveSessionActions hostCount={5} canSave saving={false} onSave={vi.fn()} />, 'pl'));
    expect(screen.getByRole('button', { name: 'Zapisz 5 zmian' })).toBeTruthy();
  });

  it('is inert while saving and says so', () => {
    const onSave = vi.fn();
    render(wrap(<SaveSessionActions hostCount={2} canSave saving onSave={onSave} />));
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders nothing for an operator who may write no part (FR-035)', () => {
    const { container } = render(
      wrap(<SaveSessionActions hostCount={0} canSave={false} saving={false} onSave={vi.fn()} />),
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('is axe-clean', async () => {
    const { container } = render(wrap(<SaveSessionActions hostCount={1} canSave saving={false} onSave={vi.fn()} />));
    await expectNoAxeViolations(container);
  });
});

const REFUSED: SaveOutcome = {
  result: 'refused',
  parts: [
    { id: 'host', label: 'Organization', result: 'not-attempted', count: 1 },
    {
      id: 'price_lists:display-mode',
      label: 'Price display',
      result: 'refused',
      count: 1,
      issues: { fields: { mode: 'Pick a mode', scope: 'Unknown scope' } },
    },
    {
      id: 'quick_order:ordering-defaults',
      label: 'Ordering defaults',
      result: 'refused',
      count: 1,
      message: 'Invalid',
      issues: { fields: {}, message: 'Invalid' },
    },
  ],
};

const PARTIAL: SaveOutcome = {
  result: 'partial',
  parts: [
    { id: 'host', label: 'Organization', result: 'saved', count: 2 },
    { id: 'price_lists:display-mode', label: 'Price display', result: 'saved', count: 1 },
    {
      id: 'quick_order:ordering-defaults',
      label: 'Ordering defaults',
      result: 'failed',
      count: 1,
      message: 'Server unavailable',
      issues: { fields: {}, message: 'Server unavailable' },
    },
  ],
};

const FAILED: SaveOutcome = {
  result: 'failed',
  parts: [
    { id: 'host', label: 'Organization', result: 'failed', count: 1, message: 'Changed elsewhere' },
    { id: 'price_lists:display-mode', label: 'Price display', result: 'not-attempted', count: 1 },
  ],
};

const SAVED: SaveOutcome = {
  result: 'saved',
  parts: [
    { id: 'host', label: 'Organization', result: 'saved', count: 2 },
    { id: 'price_lists:display-mode', label: 'Price display', result: 'saved', count: 1 },
  ],
};

describe('SaveSessionSummary', () => {
  it('renders nothing with no outcome and no notice', () => {
    const { container } = render(wrap(<SaveSessionSummary outcome={null} notices={[]} onShow={vi.fn()} />));
    expect(container.textContent).toBe('');
  });

  it('a refusal lists every part with problems, with a "Show" that names the part', () => {
    const onShow = vi.fn();
    render(wrap(<SaveSessionSummary outcome={REFUSED} notices={[]} onShow={onShow} />));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nothing was saved. Fix the problems below.');
    expect(alert.textContent).toContain('Price display — 2 problems');
    expect(alert.textContent).toContain('Ordering defaults — 1 problem');
    expect(alert.textContent).not.toContain('Organization');

    fireEvent.click(screen.getByRole('button', { name: /Show.*Price display/ }));
    expect(onShow).toHaveBeenCalledWith('price_lists:display-mode');
  });

  it('a partial save names what was saved and what was not, with its reason', () => {
    const onShow = vi.fn();
    render(wrap(<SaveSessionSummary outcome={PARTIAL} notices={[]} onShow={onShow} />));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Some changes were saved.');
    expect(alert.textContent).toContain('Saved: Organization, Price display.');
    expect(alert.textContent).toContain('Not saved: Ordering defaults — Server unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Show.*Ordering defaults/ }));
    expect(onShow).toHaveBeenCalledWith('quick_order:ordering-defaults');
  });

  it('a failed save says nothing was saved and why', () => {
    render(wrap(<SaveSessionSummary outcome={FAILED} notices={[]} onShow={vi.fn()} />));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nothing was saved.');
    expect(alert.textContent).toContain('Not saved: Organization — Changed elsewhere');
  });

  it('a full save is only announced, in a polite live region', () => {
    render(wrap(<SaveSessionSummary outcome={SAVED} notices={[]} onShow={vi.fn()} />));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Saved: Organization, Price display.');
  });

  it('shows the discarded-change notices, announced politely (issue #1484)', () => {
    render(wrap(<SaveSessionSummary outcome={null} notices={['Base prices: discarded.']} onShow={vi.fn()} />));
    expect(screen.queryByRole('alert')).toBeNull();
    const notice = screen.getAllByRole('status').find((el) => el.textContent?.includes('Base prices: discarded.'));
    expect(notice).toBeDefined();
  });

  it('keeps the polite region mounted before a full save, so the save is announced (issue #1443)', () => {
    const view = render(wrap(<SaveSessionSummary outcome={null} notices={[]} onShow={vi.fn()} />));
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    view.rerender(wrap(<SaveSessionSummary outcome={SAVED} notices={[]} onShow={vi.fn()} />));
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Saved: Organization, Price display.');
  });

  it('moves focus to its heading when an outcome arrives', () => {
    const view = render(wrap(<SaveSessionSummary outcome={null} notices={[]} onShow={vi.fn()} />));
    view.rerender(wrap(<SaveSessionSummary outcome={REFUSED} notices={[]} onShow={vi.fn()} />));
    expect(document.activeElement?.textContent).toBe('Nothing was saved. Fix the problems below.');
  });

  it('is axe-clean for a refusal and a partial save', async () => {
    const refused = render(wrap(<SaveSessionSummary outcome={REFUSED} notices={['A notice']} onShow={vi.fn()} />));
    await expectNoAxeViolations(refused.container);
    refused.unmount();
    const partial = render(wrap(<SaveSessionSummary outcome={PARTIAL} notices={[]} onShow={vi.fn()} />));
    await expectNoAxeViolations(partial.container);
  });

  it('reads in Polish', () => {
    render(wrap(<SaveSessionSummary outcome={REFUSED} notices={[]} onShow={vi.fn()} />, 'pl'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nic nie zapisano.');
    expect(alert.textContent).toContain('Price display — 2 problemy');
    expect(alert.textContent).toContain('Ordering defaults — 1 problem');
  });
});
