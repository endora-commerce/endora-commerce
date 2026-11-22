import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1507 (UX audit CAT-05, architect ruling Q3 of 2026-11-21) — a category is named in
 * every language the sales channels offer together, not in a hard-coded `en-US` + `pl-PL`
 * pair. A stored name in a language no channel offers stays visible, read-only and flagged,
 * and a save sends it back unchanged.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { CategoriesTree } = await import('../../../../packages/modules/catalog/src/admin/pages/CategoriesTree');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/catalog/i18n/en.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const bundle = { catalog: en, core: coreEn };
const nameIn = (language: string): string => en['categories.field.nameIn']!.replace('{language}', language);

const FURNITURE = '33333333-3333-4333-8333-333333333301';

function answer(channels: Record<string, string[]> | 'down'): void {
  getSpy.mockImplementation((url: string) => {
    if (url.startsWith('/api/v1/admin/sales-channels?')) {
      if (channels === 'down') return Promise.reject(new Error('down'));
      return Promise.resolve({ items: Object.keys(channels).map((code) => ({ code, defaultLanguage: 'en-US' })) });
    }
    if (url.startsWith('/api/v1/admin/sales-channels/')) {
      const code = url.split('/').pop() ?? '';
      return Promise.resolve({ code, languages: channels === 'down' ? [] : channels[code] });
    }
    return Promise.resolve({
      data: [
        {
          id: FURNITURE,
          parentCategoryId: null,
          name: { 'pl-PL': 'Meble', 'fr-FR': 'Meubles' },
          slug: 'meble',
          sortOrder: 0,
          isActive: true,
        },
      ],
    });
  });
}

function renderTree(): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/catalog/categories']}>
      <CategoriesTree />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle,
    },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset().mockResolvedValue({ data: { id: '00000000-0000-4000-8000-00000000c001' } });
  patchSpy.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('CategoriesTree — names per content language (#1507)', () => {
  it('offers a name field per language of the channels together, and no hard-coded pair', async () => {
    answer({ b2b: ['pl-PL', 'de-DE'], b2c: ['pl-PL', 'cs-CZ'] });
    renderTree();
    await screen.findByRole('button', { name: 'Meble' });
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.newRoot']! }));
    expect(await screen.findByLabelText(nameIn('Czech (Czechia)'))).toBeTruthy();
    expect(screen.getByLabelText(nameIn('German (Germany)'))).toBeTruthy();
    expect(screen.getByLabelText(nameIn('Polish (Poland)'))).toBeTruthy();
    expect(screen.queryByLabelText(nameIn('English (United States)'))).toBeNull();
  });

  it('derives the slug from the first name given and creates with the names typed', async () => {
    answer({ b2b: ['de-DE', 'pl-PL'] });
    renderTree();
    await screen.findByRole('button', { name: 'Meble' });
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.newRoot']! }));
    fireEvent.change(await screen.findByLabelText(nameIn('Polish (Poland)')), { target: { value: 'Oświetlenie' } });
    expect((screen.getByLabelText(en['categories.field.slug']!) as HTMLInputElement).value).toBe('oswietlenie');
    fireEvent.click(screen.getByRole('button', { name: en['categories.action.create']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({ name: { 'pl-PL': 'Oświetlenie' } });
    expect(Object.keys((postSpy.mock.calls[0]?.[1] as { name: object }).name)).toEqual(['pl-PL']);
  });

  it('shows a stored name in a language no channel offers read-only and flagged, and saves it back unchanged', async () => {
    answer({ b2b: ['pl-PL', 'en-US'] });
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Meble' }));
    const outside = (await screen.findByLabelText(nameIn('French (France)'))) as HTMLInputElement;
    expect(outside.readOnly).toBe(true);
    expect(outside.value).toBe('Meubles');
    const hint = document.getElementById(outside.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(en['contentLanguages.outside.hint']);
    expect(screen.getByText(en['contentLanguages.outside.badge']!)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(nameIn('English (United States)')), { target: { value: 'Furniture' } });
    fireEvent.click(screen.getByRole('button', { name: coreEn['saveSession.action.count.one']!.replace('{count}', '1') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect((patchSpy.mock.calls[0]?.[1] as { name: object }).name).toEqual({
      'pl-PL': 'Meble',
      'fr-FR': 'Meubles',
      'en-US': 'Furniture',
    });
  });

  it('says so and falls back to the stored languages when the channels cannot be read', async () => {
    answer('down');
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Meble' }));
    expect(await screen.findByText(en['contentLanguages.failed']!)).toBeTruthy();
    expect((screen.getByLabelText(nameIn('French (France)')) as HTMLInputElement).readOnly).toBe(false);
    expect(screen.getByLabelText(nameIn('Polish (Poland)'))).toBeTruthy();
  });

  it('has no axe violations with a flagged language in the editor', async () => {
    answer({ b2b: ['pl-PL'] });
    renderTree();
    fireEvent.click(await screen.findByRole('button', { name: 'Meble' }));
    await screen.findByLabelText(nameIn('French (France)'));
    await expectNoAxeViolations(document.body);
  });
});
