import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import {
  FulfilmentStrategyPicker,
  type FulfilmentStrategyValue,
} from '@endora-commerce/admin-kit/components';

/**
 * Feature 091, P9 — `FulfilmentStrategyPicker` is the kit's.
 *
 * **It is a published component and never was a zone**
 * (`contracts/admin-component-contribution.md` §10.2). Its props are
 * `(value, onChange, warehouses, allowInherit?, disabled?, idPrefix?)` — a value
 * in and a value back — and both of its consumers own the save. That is Z1
 * question 1, so what has to be asserted here is the *controlled* contract and
 * not a screen: every edit leaves through `onChange`, and the component keeps no
 * state of its own to disagree with the parent's.
 *
 * **The copy is `core`'s** (R-1, `admin-kit-surface.md` R6). Unlike P8's two
 * members this one already read `useTranslation('core')` and every key it reads
 * was already in `_i18n`'s shipped bundle, so the publication moves no key. That
 * is a claim worth an assertion rather than a sentence: the bundle here is the
 * **shipped** one read off disk, in both languages, because a passthrough bundle
 * resolves a key to itself and would pass whether or not the copy is there.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(
    join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`),
    'utf8',
  );
  return { core: JSON.parse(raw) as Record<string, string> };
}

const EN = coreBundle('en');
const PL = coreBundle('pl');

function renderInCore(ui: ReactElement, language: 'en' | 'pl'): ReturnType<typeof render> {
  const bundle = language === 'en' ? EN : PL;
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper });
}

/** Every unresolved key renders as `core.<key>`; nothing else in the admin does. */
function expectNoRawKeys(container: HTMLElement): void {
  expect(container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
}

const WAREHOUSES = [
  { id: 'w1', code: 'MAIN', name: 'Main warehouse' },
  { id: 'w2', code: 'OVF', name: 'Overflow' },
];

describe('FulfilmentStrategyPicker — the kit renders it from the shipped `core` bundle', () => {
  it('labels the strategy select and its hint in English and in Polish', () => {
    const value: FulfilmentStrategyValue = { strategy: 'any', warehouseOrder: [] };

    const en = renderInCore(
      <FulfilmentStrategyPicker
        value={value}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
      />,
      'en',
    );
    expect(screen.getByLabelText('Warehouse-picking strategy')).toBeTruthy();
    expect(
      screen.getByText(
        'How warehouses are picked to fulfil order lines. Precedence: product → ' +
          'organization → sales channel → platform default.',
      ),
    ).toBeTruthy();
    expectNoRawKeys(en.container);
    en.unmount();

    const pl = renderInCore(
      <FulfilmentStrategyPicker
        value={value}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
      />,
      'pl',
    );
    expect(screen.getByLabelText('Strategia pobierania z magazynów')).toBeTruthy();
    expectNoRawKeys(pl.container);
    pl.unmount();
  });

  it('offers the inherit option only when the caller asks for it', () => {
    const value: FulfilmentStrategyValue = { strategy: 'any', warehouseOrder: [] };

    const without = renderInCore(
      <FulfilmentStrategyPicker
        value={value}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
      />,
      'en',
    );
    expect(screen.queryByText('Inherit (channel / default)')).toBeNull();
    without.unmount();

    const with_ = renderInCore(
      <FulfilmentStrategyPicker
        value={value}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
        allowInherit
      />,
      'en',
    );
    expect(screen.getByText('Inherit (channel / default)')).toBeTruthy();
    expectNoRawKeys(with_.container);
    with_.unmount();
  });

  it('hands every edit back through `onChange` and stores nothing itself', () => {
    // The whole of Z1 question 1: the parent owns the value. A component that
    // kept its own copy would still render correctly here and would silently
    // stop agreeing with the parent that saves.
    const onChange = vi.fn();
    const value: FulfilmentStrategyValue = { strategy: 'any', warehouseOrder: [] };
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={value}
        onChange={onChange}
        warehouses={WAREHOUSES}
        allowInherit
      />,
      'en',
    );

    fireEvent.change(screen.getByLabelText('Warehouse-picking strategy'), {
      target: { value: 'defined_order' },
    });
    expect(onChange).toHaveBeenCalledWith({ strategy: 'defined_order', warehouseOrder: [] });

    // Nothing moved on screen, because the value it renders is still the prop.
    expect(
      (screen.getByLabelText('Warehouse-picking strategy') as HTMLSelectElement).value,
    ).toBe('any');
    view.unmount();
  });

  it('maps the inherit option to a null strategy', () => {
    const onChange = vi.fn();
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={{ strategy: 'any', warehouseOrder: [] }}
        onChange={onChange}
        warehouses={WAREHOUSES}
        allowInherit
      />,
      'en',
    );

    fireEvent.change(screen.getByLabelText('Warehouse-picking strategy'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenCalledWith({ strategy: null, warehouseOrder: [] });
    view.unmount();
  });

  it('orders warehouses for `defined_order` and reports each move through `onChange`', () => {
    const onChange = vi.fn();
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={{ strategy: 'defined_order', warehouseOrder: ['w1', 'w2'] }}
        onChange={onChange}
        warehouses={WAREHOUSES}
      />,
      'en',
    );

    expect(view.container.textContent).toContain('Main warehouse');
    expect(screen.getByText('(MAIN)')).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText('Move down')[0]!);
    expect(onChange).toHaveBeenLastCalledWith({
      strategy: 'defined_order',
      warehouseOrder: ['w2', 'w1'],
    });

    fireEvent.click(screen.getAllByLabelText('Remove')[0]!);
    expect(onChange).toHaveBeenLastCalledWith({
      strategy: 'defined_order',
      warehouseOrder: ['w2'],
    });

    expectNoRawKeys(view.container);
    view.unmount();
  });

  it('offers only the warehouses the order does not already hold', () => {
    const onChange = vi.fn();
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={{ strategy: 'defined_order', warehouseOrder: ['w1'] }}
        onChange={onChange}
        warehouses={WAREHOUSES}
      />,
      'en',
    );

    const add = screen.getByLabelText('Add a warehouse…') as HTMLSelectElement;
    const offered = Array.from(add.options)
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(offered).toEqual(['w2']);

    fireEvent.change(add, { target: { value: 'w2' } });
    expect(onChange).toHaveBeenLastCalledWith({
      strategy: 'defined_order',
      warehouseOrder: ['w1', 'w2'],
    });
    view.unmount();
  });

  it('shows the warehouse order only for `defined_order`', () => {
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={{ strategy: 'lowest_stock_first', warehouseOrder: ['w1'] }}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
      />,
      'en',
    );
    expect(screen.queryByText('Warehouse order')).toBeNull();
    expectNoRawKeys(view.container);
    view.unmount();
  });

  it('disables every control when the caller is saving', () => {
    const view = renderInCore(
      <FulfilmentStrategyPicker
        value={{ strategy: 'defined_order', warehouseOrder: ['w1', 'w2'] }}
        onChange={(): void => {}}
        warehouses={WAREHOUSES}
        disabled
      />,
      'en',
    );
    expect(
      (screen.getByLabelText('Warehouse-picking strategy') as HTMLSelectElement).disabled,
    ).toBe(true);
    for (const button of screen.getAllByLabelText('Remove')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    view.unmount();
  });

  it('disambiguates element ids with `idPrefix`, so two pickers may share a page', () => {
    const view = renderInCore(
      <>
        <FulfilmentStrategyPicker
          value={{ strategy: 'any', warehouseOrder: [] }}
          onChange={(): void => {}}
          warehouses={WAREHOUSES}
          idPrefix="product-1"
        />
        <FulfilmentStrategyPicker
          value={{ strategy: 'any', warehouseOrder: [] }}
          onChange={(): void => {}}
          warehouses={WAREHOUSES}
          idPrefix="org-fulfilment"
        />
      </>,
      'en',
    );
    expect(view.container.querySelector('#product-1-strategy')).toBeTruthy();
    expect(view.container.querySelector('#org-fulfilment-strategy')).toBeTruthy();
    view.unmount();
  });
});
