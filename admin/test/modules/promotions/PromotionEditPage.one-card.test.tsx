import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1546 (UX audit 2026-11-17, SALES-23) — the promotion editor is one card of four
 * sections committed by the one Save, which says when the form holds unsaved changes. Copying
 * a saved rule over a rule the operator already built asks first (WCAG 3.3.4). Every label of
 * the action is translated and linked to its control. The coupons, which write on their own,
 * say so; before the promotion exists they are a heading and one line, not a card of controls.
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
const CORE_PL = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/pl.json'), 'utf8'),
) as Record<string, string>;
const en = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`missing en key ${key}`);
  return value;
};

const ID = '00000000-0000-4000-8000-00000000p001';
const CONDITION = {
  kind: 'condition',
  field: { kind: 'builtin', key: 'cartTotal' },
  op: 'gte',
  values: [100],
};
const SAVED_RULE = {
  id: 'rule-1',
  name: 'Big carts',
  definition: { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [500] },
};

function promotion(rule: unknown): Record<string, unknown> {
  return {
    id: ID,
    name: 'Summer sale',
    description: null,
    code: null,
    isActive: true,
    priority: 0,
    stopFurther: false,
    action: { type: 'percentage_off_cart', percent: 10 },
    rule,
    ruleId: null,
    usageLimitGlobal: null,
    usageLimitPerOrganization: null,
    usageLimitPerCustomer: null,
  };
}

function stubApi(rule: unknown): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/promotions/${ID}`) return Promise.resolve({ data: promotion(rule) });
    if (path === '/api/v1/admin/promotion-rules') return Promise.resolve({ data: [SAVED_RULE] });
    return Promise.resolve({ data: [] });
  });
  putSpy.mockResolvedValue({ data: promotion(rule) });
}

function renderAt(path: string): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/promotions/new" element={<PromotionEditPage />} />
          <Route path="/promotions/:id" element={<PromotionEditPage />} />
          <Route path="/promotions" element={<p>list</p>} />
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
}

async function renderEditor(rule: unknown = { kind: 'all' }): Promise<void> {
  stubApi(rule);
  renderAt(`/promotions/${ID}`);
  await screen.findByDisplayValue('Summer sale');
}

function form(): HTMLFormElement {
  const el = document.querySelector('form');
  if (el === null) throw new Error('no form');
  return el;
}

function saveBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (bar === null) throw new Error('no save bar');
  return bar;
}

async function copyFromSavedRule(): Promise<void> {
  const select = screen.getByLabelText(en('promotions.edit.ruleCopyFrom'));
  await waitFor(() => expect(select).not.toBeDisabled());
  fireEvent.change(select, { target: { value: SAVED_RULE.id } });
}

function savedPayload(): Record<string, unknown> {
  const call = putSpy.mock.calls[0];
  if (!call) throw new Error('not saved');
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
});

describe('PromotionEditPage — one card, four sections, one Save (SALES-23)', () => {
  it('draws General, Action, Rule and Limits as sections of one card', async () => {
    await renderEditor();
    const cards = form().querySelectorAll('[data-slot="card"]');
    expect(cards).toHaveLength(1);
    const headings = within(cards[0] as HTMLElement)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      en('promotions.edit.general'),
      en('promotions.edit.action'),
      en('promotions.edit.rule'),
      en('promotions.edit.limits'),
    ]);
    for (const name of headings) {
      expect(screen.getByRole('region', { name: name! })).toBeInTheDocument();
    }
  });

  it('says "Unsaved changes" in the bar only once the form differs from what was saved', async () => {
    await renderEditor();
    expect(saveBar()).not.toHaveTextContent(en('form.unsavedChanges.hint'));
    fireEvent.change(screen.getByLabelText(en('promotions.field.name')), { target: { value: 'Winter sale' } });
    expect(saveBar()).toHaveTextContent(en('form.unsavedChanges.hint'));
    fireEvent.change(screen.getByLabelText(en('promotions.field.name')), { target: { value: 'Summer sale' } });
    expect(saveBar()).not.toHaveTextContent(en('form.unsavedChanges.hint'));
  });

  it('links the action type and every action field to its label, in words', async () => {
    await renderEditor();
    const type = screen.getByLabelText(en('promotions.edit.actionType'));
    expect(type.tagName).toBe('SELECT');
    expect(screen.getByLabelText(en('promotions.actionField.percent'))).toHaveValue(10);
    fireEvent.change(type, { target: { value: 'buy_x_units_amount_off' } });
    for (const key of ['actionField.productId', 'actionField.buyUnits', 'actionField.amount', 'field.currency']) {
      expect(screen.getByLabelText(en(`promotions.${key}`))).toBeInTheDocument();
    }
    fireEvent.change(type, { target: { value: 'buy_x_get_y_free' } });
    const target = screen.getByLabelText(en('promotions.actionField.target'));
    expect(within(target).getAllByRole('option').map((o) => o.textContent)).toEqual([
      en('promotions.actionTarget.cheapest'),
      en('promotions.actionTarget.most_expensive'),
    ]);
  });
});

describe('PromotionEditPage — copying a saved rule (SALES-23, WCAG 3.3.4)', () => {
  it('copies straight over an empty rule', async () => {
    await renderEditor({ kind: 'all' });
    await copyFromSavedRule();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(saveBar()).getByRole('button', { name: en('promotions.edit.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(savedPayload().rule).toEqual(SAVED_RULE.definition);
  });

  it('asks before replacing a rule the operator built, and keeps it on Cancel', async () => {
    await renderEditor(CONDITION);
    await copyFromSavedRule();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Big carts');
    fireEvent.click(within(dialog).getByRole('button', { name: en('common.action.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saveBar()).not.toHaveTextContent(en('form.unsavedChanges.hint'));
    fireEvent.click(within(saveBar()).getByRole('button', { name: en('promotions.edit.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(savedPayload().rule).toEqual(CONDITION);
  });

  it('replaces the rule once the operator confirms', async () => {
    await renderEditor(CONDITION);
    await copyFromSavedRule();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en('promotions.edit.ruleCopyConfirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(saveBar()).toHaveTextContent(en('form.unsavedChanges.hint'));
    fireEvent.click(within(saveBar()).getByRole('button', { name: en('promotions.edit.save') }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(savedPayload().rule).toEqual(SAVED_RULE.definition);
  });
});

describe('PromotionEditPage — coupons (SALES-23)', () => {
  it('marks the coupons of a saved promotion as applying immediately, outside the form', async () => {
    await renderEditor();
    const coupons = screen.getByRole('region', { name: new RegExp(en('promotions.coupons.title')) });
    expect(form().contains(coupons)).toBe(false);
    expect(coupons).toHaveTextContent(en('saveSession.immediateBadge'));
    expect(within(coupons).getByLabelText(en('promotions.coupons.code'))).toBeInTheDocument();
    expect(within(coupons).getByLabelText(en('promotions.generator.format'))).toBeInTheDocument();
    expect(within(coupons).getByLabelText(en('promotions.generator.limitScope'))).toBeInTheDocument();
  });

  // #1441 (DS-07, slice S1): the editor's one filled action is the sticky Save. The coupons'
  // own Add and Generate write immediately, beside it, so they are outline — two more filled
  // buttons in the view would cancel the Save out (Von Restorff).
  it('leaves the sticky Save the only filled button: the coupon Add and Generate are outline', async () => {
    await renderEditor();
    const coupons = screen.getByRole('region', { name: new RegExp(en('promotions.coupons.title')) });
    for (const name of [en('promotions.coupons.add'), en('promotions.generator.generate')]) {
      const button = within(coupons).getByRole('button', { name });
      expect(button, name).toHaveClass('border-input');
      expect(button, name).not.toHaveClass('bg-primary');
    }
    expect(within(coupons).getAllByRole('button').filter((b) => b.classList.contains('bg-primary'))).toEqual([]);
    expect(within(saveBar()).getByRole('button', { name: en('promotions.edit.save') })).toHaveClass('bg-primary');
  });

  it('shows a new promotion only the coupons heading and one line, no controls', async () => {
    stubApi({ kind: 'all' });
    renderAt('/promotions/new');
    const coupons = await screen.findByRole('region', { name: en('promotions.coupons.title') });
    expect(coupons).toHaveTextContent(en('promotions.coupons.saveFirst'));
    expect(coupons.closest('[data-slot="card"]')).toBeNull();
    expect(within(coupons).queryByRole('textbox')).toBeNull();
    expect(within(coupons).queryByRole('button')).toBeNull();
  });
});

describe('PromotionEditPage copy (EN + PL)', () => {
  it('ships every new key in both bundles', () => {
    const keys = [
      'promotions.edit.ruleCopyConfirm',
      'promotions.edit.ruleCopyTitle',
      'promotions.edit.ruleCopyMessage',
      ...['percent', 'amount', 'buyQuantity', 'freeQuantity', 'target', 'spendStep', 'nth',
        'productId', 'buyUnits', 'freeUnits'].map((k) => `promotions.actionField.${k}`),
      'promotions.actionField.productIdPlaceholder',
      'promotions.actionTarget.cheapest',
      'promotions.actionTarget.most_expensive',
      'promotions.generator.formatAlnum',
      'promotions.generator.formatDigits',
      'promotions.generator.formatLetters',
      'promotions.generator.scopePerCoupon',
      'promotions.generator.scopeSharedBatch',
    ];
    for (const key of keys) {
      expect(CORE_EN[key], key).toBeTruthy();
      expect(CORE_PL[key], key).toBeTruthy();
    }
  });
});
