import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1441 (UX audit DS-07, slice S1) — every saved rule in the promotion-rule library
 * carried a filled red Delete beside its Edit, so a list of ten rules was ten red buttons
 * competing with the builder's one Save (Von Restorff, Signal-to-Noise), and a click deleted
 * the rule with no question asked. The row's removal is now a quiet ghost icon in the
 * destructive tone, named after its row, and it asks before deleting (WCAG 3.3.4).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => api.get(...a),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...a: unknown[]) => api.delete(...a),
    },
  };
});

const { PromotionRulesPage } = await import(
  '../../../../packages/modules/promotions/src/admin/pages/PromotionRulesPage'
);

const EN = shippedCoreBundle('en').core!;
const PL = shippedCoreBundle('pl').core!;

const fill = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);

const RULE = {
  id: '00000000-0000-4000-8000-0000000000r1',
  name: 'Big carts',
  description: null,
  definition: { kind: 'all' },
};

let rules: (typeof RULE)[] = [];

function render(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <PromotionRulesPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    { core: EN },
  );
}

async function deleteButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: fill(EN['promotionRules.action.deleteNamed']!, { name: RULE.name }) });
}

beforeEach(() => {
  rules = [RULE];
  api.get.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (path: string) =>
    path === '/api/v1/admin/promotion-rules' ? { data: rules } : { data: [] },
  );
  api.delete.mockImplementation(async () => {
    rules = [];
  });
});
afterEach(() => cleanup());

describe('PromotionRulesPage row actions (DS-07, #1441)', () => {
  it('draws no filled button on a rule row: the removal is a ghost icon named after its row', async () => {
    render();
    const remove = await deleteButton();
    expect(remove).not.toHaveClass('bg-destructive');
    expect(remove).not.toHaveClass('bg-primary');
    expect(remove).toHaveClass('text-destructive');
    expect(remove.textContent).toBe('');
    const row = remove.closest('li')!;
    for (const button of within(row).getAllByRole('button')) {
      expect(button).not.toHaveClass('bg-destructive');
      expect(button).not.toHaveClass('bg-primary');
    }
  });

  it('asks before deleting, and keeps the rule on Cancel', async () => {
    render();
    await userEvent.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(fill(EN['promotionRules.deleteConfirm']!, { name: RULE.name }));
    await userEvent.click(within(dialog).getByRole('button', { name: EN['common.action.cancel']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText(RULE.name)).toBeInTheDocument();
  });

  it('deletes the rule once confirmed and drops it from the list', async () => {
    render();
    await userEvent.click(await deleteButton());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: EN['common.action.delete']! }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/api/v1/admin/promotion-rules/${RULE.id}`));
    await waitFor(() => expect(screen.queryByText(RULE.name)).toBeNull());
  });

  it('ships the new keys in both bundles', () => {
    for (const key of ['promotionRules.action.deleteNamed', 'promotionRules.deleteConfirm']) {
      expect(EN[key], `en ${key}`).toContain('{name}');
      expect(PL[key], `pl ${key}`).toContain('{name}');
    }
  });
});
