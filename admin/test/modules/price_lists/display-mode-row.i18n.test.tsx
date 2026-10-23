import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The display-mode override row speaks the admin language (feature 161,
 * Checkpoint 11 ruling 3): its help line — what the chosen mode does for
 * customers — was an English literal in the component; it is the module's
 * bundle's now, in English and Polish, read here from the shipped files.
 */

const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const { bundles } = await import('../../helpers/price-book-screen');
const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';

function mount(language: 'en' | 'pl', mode: string): void {
  getSpy.mockImplementation(async () => ({ data: { mode } }));
  render(
    <TranslationProvider language={language} initialBundle={bundles(language)}>
      {withSession(
        <MemoryRouter>
          <AdminZone name="category.editor.after" props={{ categoryId: CATEGORY_ID }} />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['price_lists:read', 'price_lists:write'] }),
          presence: modulePresence({ present: ['price_lists'] }),
          contributions: [{ moduleId: 'price_lists', contributions: priceLists.contributions }],
        },
      )}
    </TranslationProvider>,
  );
}

beforeEach(() => getSpy.mockReset());

describe('display-mode override row — the help line in the admin language', () => {
  it('explains each mode in English', async () => {
    mount('en', 'inherit');
    expect(await screen.findByText('Inherits the parent in the resolution chain (Settings → Organization → Category → Product).')).toBeInTheDocument();
  });

  it('explains each mode in Polish', async () => {
    mount('pl', 'none');
    expect(await screen.findByText('Klienci nie zobaczą ceny; zamiast „Dodaj do koszyka” zobaczą „Dodaj do zapytania ofertowego”.')).toBeInTheDocument();
  });

  it('names the chosen format in Polish', async () => {
    mount('pl', 'net_only');
    expect(await screen.findByText('Klienci widzą ceny w formacie „Tylko netto” w tym zakresie.')).toBeInTheDocument();
  });
});
