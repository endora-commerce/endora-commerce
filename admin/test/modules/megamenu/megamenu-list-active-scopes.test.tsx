import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MegamenuSummary } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1567 (UX audit follow-up) — the list's "active in N scopes" badge read
 * "{count} zakresów" for every count, so Polish showed "2 zakresów". The key is
 * now a plural family chosen by `Intl.PluralRules`, like the tree's nested-item
 * question: one "zakres", few "zakresy", many "zakresów".
 */

const { listMenus } = vi.hoisted(() => ({ listMenus: vi.fn() }));
vi.mock('../../../../packages/modules/megamenu/src/admin/api/megamenu-client', () => ({
  megamenuClient: { listMenus },
}));

const { MegamenuListPage } = await import('../../../../packages/modules/megamenu/src/admin/pages/MegamenuListPage');

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const read = (path: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(__dirname, path), 'utf8')) as Record<string, string>;
  return {
    megamenu: read(`../../../../packages/modules/megamenu/i18n/${language}.json`),
    core: read(`../../../../packages/modules/_i18n/i18n/${language}.json`),
  };
}

function menu(id: number, activeIn: number): MegamenuSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${id}`,
    name: `Menu ${id}`,
    description: null,
    version: 1,
    bindings: [],
    activeIn,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

async function renderList(language: 'en' | 'pl', counts: number[]): Promise<void> {
  listMenus.mockResolvedValue({ data: counts.map((count, i) => menu(i + 1, count)) });
  renderWithI18n(
    <MemoryRouter>
      <MegamenuListPage />
    </MemoryRouter>,
    bundle(language),
    { language },
  );
  await screen.findByText('Menu 1');
}

describe('MegamenuListPage — the active-scopes badge is plural-aware', () => {
  it('Polish: 1 zakres, 2 zakresy, 5 zakresów, 22 zakresy', async () => {
    await renderList('pl', [1, 2, 5, 22]);
    expect(screen.getByText('1 zakres')).toBeInTheDocument();
    expect(screen.getByText('2 zakresy')).toBeInTheDocument();
    expect(screen.getByText('5 zakresów')).toBeInTheDocument();
    expect(screen.getByText('22 zakresy')).toBeInTheDocument();
  });

  it('English: 1 scope, 3 scopes', async () => {
    await renderList('en', [1, 3]);
    expect(screen.getByText('1 scope')).toBeInTheDocument();
    expect(screen.getByText('3 scopes')).toBeInTheDocument();
  });
});
