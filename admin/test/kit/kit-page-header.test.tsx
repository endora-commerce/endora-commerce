import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Button, PageHeader } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1436 (UX audit 2026-11-17, DS-02) — `PageHeader` is the one place a
 * page's `h1` is drawn. The description is opt-in and one line; anything longer
 * goes behind a ⓘ (`help`), so a screen opens on its content rather than on a
 * paragraph about it (Signal-to-Noise, Hick's Law).
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

function inRouter(ui: ReactElement, path = '/here'): ReactElement {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/here" element={ui} />
        <Route path="/list" element={<p>List page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PageHeader — heading', () => {
  it('draws the title as the one h1, with no description paragraph unless one is given', () => {
    const { container } = renderWithI18n(inRouter(<PageHeader title="Orders" />), EN);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe('Orders');
    expect(container.querySelector('header p')).toBeNull();
  });

  it('clamps the description to one line', () => {
    renderWithI18n(inRouter(<PageHeader title="Orders" description="Placed in the last 30 days" />), EN);
    const description = screen.getByText('Placed in the last 30 days');
    expect(description.tagName).toBe('P');
    expect(description.className).toContain('line-clamp-1');
  });

  it('keeps title actions (an Edit, a status badge) beside the heading, out of its name', () => {
    renderWithI18n(
      inRouter(<PageHeader title="Spring sale" titleActions={<Button variant="ghost">Rename</Button>} />),
      EN,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Spring sale');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  });
});

describe('PageHeader — help', () => {
  it('puts the longer explanation behind a ⓘ named after the page, closed until asked', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      inRouter(<PageHeader title="Price books" help="The most specific price book wins at checkout." />),
      EN,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    // The heading's name stays its words — the ⓘ is beside it, not inside it.
    expect(heading.textContent).toBe('Price books');
    const button = screen.getByRole('button', { name: 'More information Price books' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('The most specific price book wins at checkout.')).toBeNull();

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)!.textContent).toBe(
      'The most specific price book wins at checkout.',
    );
  });

  it('renders no ⓘ when there is no help', () => {
    renderWithI18n(inRouter(<PageHeader title="Orders" description="Today" />), EN);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the ⓘ in Polish when the admin is in Polish', () => {
    renderWithI18n(inRouter(<PageHeader title="Cenniki" help="Wygrywa najbardziej szczegółowy cennik." />), PL, {
      language: 'pl',
    });
    expect(screen.getByRole('button', { name: 'Więcej informacji Cenniki' })).toBeTruthy();
  });
});

describe('PageHeader — back', () => {
  it('is a link to the parent screen', async () => {
    const user = userEvent.setup();
    renderWithI18n(inRouter(<PageHeader title="Order 1001" back={{ label: 'Orders', to: '/list' }} />), EN);
    const link = screen.getByRole('link', { name: 'Orders' });
    // No guard of its own: the app-wide unsaved-changes prompt still covers it.
    expect(link.hasAttribute('data-own-unsaved-guard')).toBe(false);
    await user.click(link);
    expect(screen.getByText('List page')).toBeTruthy();
  });

  it('lets an editor with unsaved changes hold the navigation by preventing the click', async () => {
    const user = userEvent.setup();
    let asked = 0;
    renderWithI18n(
      inRouter(
        <PageHeader
          title="Product"
          back={{
            label: 'Products',
            to: '/list',
            onClick: (event): void => {
              asked += 1;
              event.preventDefault();
            },
          }}
        />,
      ),
      EN,
    );
    const link = screen.getByRole('link', { name: 'Products' });
    // The editor's own guard: the app-wide unsaved-changes prompt stands aside for it.
    expect(link.hasAttribute('data-own-unsaved-guard')).toBe(true);
    await user.click(link);
    expect(asked).toBe(1);
    expect(screen.queryByText('List page')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Product');
  });
});

describe('PageHeader — axe', () => {
  it('a header in every state has no WCAG 2.2 AA violation axe can see', async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      inRouter(
        <main>
          <PageHeader
            title="Price books"
            description="Net prices"
            help="The most specific price book wins at checkout."
            back={{ label: 'Pricing', to: '/list' }}
            titleActions={<Button variant="ghost">Rename</Button>}
            actions={<Button>New price book</Button>}
          />
        </main>,
      ),
      EN,
    );
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'More information Price books' }));
    await expectNoAxeViolations(container);
  });
});
