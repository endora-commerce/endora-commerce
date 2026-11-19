import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; SALES-23) — the promotion editor's Save used to sit
 * mid-page, between the Limits card and the Coupons card, which saves on its own. It is now the
 * last control of the form, in the kit's sticky bar (Cancel before it, Save last), and a refused
 * save is said in that bar instead of at the top of the page.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => putSpy(...args),
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

async function renderEditor(): Promise<void> {
  getSpy.mockImplementation((path: string) =>
    Promise.resolve(path === `/api/v1/admin/promotions/${ID}` ? { data: PROMOTION } : { data: [] }),
  );
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
    { core: CORE_EN },
  );
  await screen.findByDisplayValue('Summer sale');
}

function saveBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (bar === null) throw new Error('no save bar');
  return bar;
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
});

describe('PromotionEditPage — the one Save in the sticky bar (DS-19)', () => {
  it('draws Cancel then Save in a sticky bar that ends the form', async () => {
    await renderEditor();
    const bar = saveBar();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    const names = within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(names).toEqual([CORE_EN['promotions.edit.cancel'], CORE_EN['promotions.edit.save']]);
    const form = bar.closest('form');
    expect(form).not.toBeNull();
    expect(form!.lastElementChild).toBe(bar);
  });

  it('says a refused save in the bar', async () => {
    await renderEditor();
    putSpy.mockRejectedValue(new ApiError(409, { error: { code: 'CONFLICT', message: 'The code is taken.' } }));
    fireEvent.click(within(saveBar()).getByRole('button', { name: CORE_EN['promotions.edit.save']! }));
    await waitFor(() => expect(within(saveBar()).getByRole('alert')).toHaveTextContent('The code is taken.'));
  });
});
