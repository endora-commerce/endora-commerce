import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1496 (UX audit SALES-06, on DS-14 #1447) — the promotion editor reads
 * the stored promotion once into its form. Until it arrives a skeleton stands
 * in for the form; a read that fails shows its error and a retry, never the
 * empty form it used to show, whose Save would overwrite the promotion with
 * blanks.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { PromotionEditPage } = await import(
  '../../../../packages/modules/promotions/src/admin/pages/PromotionEditPage'
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ID = '00000000-0000-4000-8000-00000000p001';

const PROMOTION = {
  id: ID,
  name: 'Summer sale',
  description: null,
  code: null,
  isActive: true,
  priority: 0,
  stopFurther: false,
  action: { type: 'percentage_off_cart', percent: 10 },
  rule: { kind: 'all' },
  ruleId: null,
  usageLimitGlobal: null,
  usageLimitPerOrganization: null,
  usageLimitPerCustomer: null,
};

function renderEditor(readPromotion: () => Promise<unknown>): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/promotions/${ID}`) return readPromotion();
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/promotions/${ID}`]}>
        <Routes>
          <Route path="/promotions/:id" element={<PromotionEditPage />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['promotions'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

const nameField = (): HTMLElement | null => screen.queryByLabelText(CORE_EN['promotions.field.name']!);

beforeEach(() => {
  getSpy.mockReset();
});

describe('PromotionEditPage — first load (SALES-06)', () => {
  it('shows a busy skeleton region until the promotion arrives, then the filled form', async () => {
    let release!: () => void;
    renderEditor(() => new Promise((resolve) => (release = () => resolve({ data: PROMOTION }))));

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent(CORE_EN['promotions.loading']!);
    expect(nameField()).toBeNull();

    release();
    expect(await screen.findByDisplayValue('Summer sale')).toBeInTheDocument();
  });

  it('a read that fails shows the error and a retry, and no form to save over the promotion', async () => {
    let attempt = 0;
    renderEditor(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: PROMOTION });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CORE_EN['promotions.error.load']!);
    expect(nameField()).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: CORE_EN['common.action.retry']! }));
    expect(await screen.findByDisplayValue('Summer sale')).toBeInTheDocument();
  });
});
