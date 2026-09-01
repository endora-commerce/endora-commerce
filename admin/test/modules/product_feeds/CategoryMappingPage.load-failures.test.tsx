import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * A failed installed-taxonomy read must not read as "no taxonomy is installed".
 *
 * The screen's mount read was `void client.listInstalled().then(…)` with no
 * `.catch`, so a failed request was an unhandled rejection **and** left
 * `installed` empty — and the empty branch of this screen is a specific,
 * confident claim about the platform: *"No provider taxonomy is installed on
 * this platform yet, so there is nothing to map against."* An operator who has
 * installed one is told they have not.
 *
 * Both halves are asserted, because only the pair is the repair: a `.catch`
 * alone sets a message the early return never renders, and the early return
 * alone still swallows the rejection.
 */

const listInstalled = vi.fn();
const listMappings = vi.fn();
const coverage = vi.fn();
const searchNodes = vi.fn();

vi.mock('../../../../packages/modules/product_feeds/src/admin/taxonomy-api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/taxonomy-api')
  >('../../../../packages/modules/product_feeds/src/admin/taxonomy-api');
  return {
    ...actual,
    feedTaxonomiesClient: {
      ...actual.feedTaxonomiesClient,
      listInstalled: () => listInstalled(),
      listMappings: (input: unknown) => listMappings(input),
      coverage: (code: unknown) => coverage(code),
      searchNodes: (input: unknown) => searchNodes(input),
    },
  };
});

const EN = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../packages/modules/product_feeds/i18n/en.json'),
    'utf8',
  ),
) as Record<string, string>;

const bundle = { product_feeds: EN };

/**
 * A key read out of the shipped bundle, and a sentinel for one that is not
 * there. A bare `EN[key]` is `string | undefined`, and `undefined` handed to a
 * matcher is the same failure this whole file is about — an absence standing in
 * for a value nobody looked at.
 */
const MISSING: string[] = [];
const copy = (key: string): string => {
  const value = EN[key];
  if (value === undefined) {
    MISSING.push(key);
    return `«product_feeds is missing ${key}»`;
  }
  return value;
};

const MAPPING_LOAD_FAILED = copy('mapping.loadFailed');
const NO_TAXONOMY = copy('mapping.noTaxonomy');

const { CategoryMappingPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/CategoryMappingPage'
);

function renderPage(): void {
  renderWithI18n(
    withSession(
      // `useAppLanguage` throws rather than defaulting — a screen with no
      // provider renders nothing, which is the failure mode this whole file is
      // about, so it is seeded rather than mocked.
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={['/product-feeds/category-mapping']}>
          <CategoryMappingPage />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['product_feeds'] }),
      },
    ),
    bundle,
  );
}

beforeEach(() => {
  listInstalled.mockReset();
  listMappings.mockReset();
  coverage.mockReset();
  searchNodes.mockReset();
  listMappings.mockResolvedValue({ data: [] });
  coverage.mockResolvedValue({
    data: {
      totalCategories: 0,
      explicitlyMapped: 0,
      coveredByInheritance: 0,
      uncovered: 0,
      staleMappings: 0,
    },
  });
  searchNodes.mockResolvedValue({ data: [] });
});

describe('CategoryMappingPage — the sentences it now renders are in the shipped bundle', () => {
  it('finds every key this file asserts on', () => {
    expect(MISSING).toEqual([]);
  });
});

describe('CategoryMappingPage — a failed taxonomy read is not an uninstalled taxonomy', () => {
  it('shows the load failure instead of the "nothing is installed" sentence', async () => {
    listInstalled.mockRejectedValue(new Error('network'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(MAPPING_LOAD_FAILED);
    // The claim the screen has no evidence for.
    expect(screen.queryByText(NO_TAXONOMY)).toBeNull();
  });

  it('still says "nothing is installed" when the read succeeds and answers empty', async () => {
    // The control. Without it the case above would pass over a screen that had
    // simply stopped distinguishing anything.
    listInstalled.mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(screen.getByText(NO_TAXONOMY)).toBeTruthy());
    expect(screen.queryByText(MAPPING_LOAD_FAILED)).toBeNull();
  });
});
