// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/180-off-platform-complaints/` T087/T093, reversal of storefront simplification 6.1
 * (design review Part 2, *Product field*): one field per line that searches the catalogue
 * and also takes a typed model name. The search-suggestion API and `SearchAutocomplete`'s
 * keyboard model (WCAG 2.2 AA combobox): a listbox, `aria-activedescendant`, the arrows,
 * Enter and Escape, an announced result count. Choosing sets a hidden `productId` and
 * keeps the name in the field; editing the text clears it. Without JavaScript it is a
 * plain text field posting a model name.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const suggestions = vi.fn();
vi.mock('../../lib/api/search', () => ({
  getSuggestions: (...args: unknown[]) => suggestions(...args),
  SearchSuggestError: class extends Error {},
}));

const ITEMS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Drill X200', sku: 'DR-X200', slug: 'drill-x200', primaryAssetUrl: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Drill X300', sku: 'DR-X300', slug: 'drill-x300', primaryAssetUrl: null },
];

const { ProductField } = await import('../../components/returns/ProductField');

const props = {
  id: 'line-0-model',
  namePrefix: 'lines.0',
  locale: 'en-US',
  label: 'Product',
  hint: 'Search our catalogue, or type the model name.',
  apiBaseUrl: 'http://api.test',
  salesChannelCode: 'default',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  suggestions.mockReset();
  suggestions.mockResolvedValue({ data: ITEMS, meta: { limit: 8, minimumQueryLength: 3, queryEcho: 'dri' } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const input = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[name="lines.0.modelName"]')!;
const hidden = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>('input[type="hidden"][name="lines.0.productId"]');
const options = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="option"]')];

async function type(value: string): Promise<void> {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Past the debounce, then the resolved suggestions.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

function key(name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  act(() => {
    input().dispatchEvent(event);
  });
  return event;
}

describe('without JavaScript', () => {
  it('is a plain labelled text field posting a model name, with no combobox semantics and no productId', () => {
    const out = renderToString(<ProductField {...props} />);
    expect(out).toMatch(/<label[^>]*for="line-0-model"/);
    expect(out).toMatch(/<input[^>]*name="lines\.0\.modelName"/);
    expect(out).not.toContain('role="combobox"');
    expect(out).not.toContain('lines.0.productId');
    expect(out).toContain('Search our catalogue, or type the model name.');
  });

  it('keeps a product chosen on a refused attempt as a hidden productId beside its name', () => {
    const out = renderToString(<ProductField {...props} defaultValue="Drill X200" defaultProductId={ITEMS[0]!.id} />);
    expect(out).toMatch(new RegExp(`<input type="hidden" name="lines\\.0\\.productId" value="${ITEMS[0]!.id}"`));
    expect(out).toMatch(/value="Drill X200"/);
  });
});

describe('with JavaScript — the combobox', () => {
  it('does not reopen the list when results arrive after the customer left the field or pressed Escape', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const leave of ['blur', 'escape'] as const) {
      const field = input();
      field.focus();
      await act(async () => {
        setter.call(field, leave === 'blur' ? 'dri' : 'drill');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      if (leave === 'blur') act(() => field.blur());
      else key('Escape');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 260));
      });
      expect(input().getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('becomes a combobox over a listbox, searching the channel’s catalogue and announcing the count', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    const field = input();
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-autocomplete')).toBe('list');
    expect(field.getAttribute('aria-expanded')).toBe('false');
    await type('dri');
    expect(suggestions).toHaveBeenCalledWith(expect.objectContaining({ apiBaseUrl: 'http://api.test', q: 'dri', salesChannelCode: 'default' }));
    const listbox = host.querySelector('[role="listbox"]')!;
    expect(field.getAttribute('aria-controls')).toBe(listbox.id);
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('DR-X200'), expect.stringContaining('DR-X300')]);
    // No price in a complaint (design review: Signal-to-Noise).
    expect(listbox.textContent).not.toMatch(/zł|PLN|\d+[.,]\d{2}/);
    expect(host.querySelector('[role="status"]')!.textContent).toBe('2 products found');
  });

  it('moves the active option with the arrows through aria-activedescendant, and closes on Escape', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    await type('dri');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    key('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    key('Escape');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    expect(hidden()).toBeNull();
  });

  it('sets the hidden productId and keeps the name editable on Enter, without submitting the form', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    await type('dri');
    key('ArrowDown');
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(hidden()!.value).toBe(ITEMS[0]!.id);
    expect(input().value).toBe('Drill X200');
    expect(input().readOnly).toBe(false);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('DR-X200');
  });

  it('chooses with a click on an option', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    await type('dri');
    act(() => {
      options()[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      options()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(hidden()!.value).toBe(ITEMS[1]!.id);
    expect(input().value).toBe('Drill X300');
  });

  it('clears the productId once the text is edited after choosing, leaving a typed model', async () => {
    await act(async () => root.render(<ProductField {...props} />));
    await type('dri');
    key('ArrowDown');
    key('Enter');
    expect(hidden()).not.toBeNull();
    await type('Drill X200 Pro');
    expect(hidden()).toBeNull();
    expect(input().value).toBe('Drill X200 Pro');
  });

  it('submits a typed model with no productId when nothing is chosen, and says when nothing matches', async () => {
    suggestions.mockResolvedValue({ data: [], meta: { limit: 8, minimumQueryLength: 3, queryEcho: 'zzz' } });
    await act(async () => root.render(<ProductField {...props} />));
    await type('zzz');
    expect(hidden()).toBeNull();
    expect(options()).toHaveLength(0);
    expect(host.querySelector('[role="status"]')!.textContent).toBe('No catalogue match — your text is sent as the model name');
    expect(key('Enter').defaultPrevented).toBe(false);
  });

  it('speaks Polish', async () => {
    await act(async () => root.render(<ProductField {...props} locale="pl-PL" />));
    await type('dri');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Znalezione produkty: 2');
  });
});
