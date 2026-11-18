// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `specs/180-off-platform-complaints/` FR-B12 — the product lines of a complaint without an
 * order: added and removed with JavaScript (a removed line posts nothing), nested `<details>`
 * without it. A slot keeps its field names whatever its position.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { LineSlots } = await import('../../components/returns/LineSlots');

const slot = (i: number) => <input key={i} name={`lines.${i}.modelName`} defaultValue="" aria-label={`model ${i}`} />;
const props = (initialCount = 1) => ({
  slots: [0, 1, 2].map(slot),
  initialCount,
  addLabel: 'Add another product',
  removeLabel: 'Remove',
  headings: ['Product 1', 'Product 2', 'Product 3'],
  removeNames: ['Remove product 1', 'Remove product 2', 'Remove product 3'],
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const names = (): string[] => [...host.querySelectorAll('input')].map((i) => i.name);
const button = (name: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes(name))!;

describe('LineSlots', () => {
  it('renders every slot without JavaScript, the later ones in nested details with one add control', () => {
    const html = renderToString(<LineSlots {...props()} />);
    for (const i of [0, 1, 2]) expect(html).toContain(`name="lines.${i}.modelName"`);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it('reopens the slots a refused attempt carried', () => {
    const html = renderToString(<LineSlots {...props(2)} />);
    expect(html.match(/<details[^>]*open=""/g)).toHaveLength(1);
  });

  it('adds a line, focusing it, and removes any line so it posts nothing', () => {
    act(() => root.render(<LineSlots {...props()} />));
    expect(names()).toEqual(['lines.0.modelName']);
    // One line: no heading, nothing to remove.
    expect(host.querySelector('h3')).toBeNull();

    act(() => button('Add another product').click());
    expect(names()).toEqual(['lines.0.modelName', 'lines.1.modelName']);
    expect(document.activeElement).toBe(host.querySelector('input[name="lines.1.modelName"]'));
    expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Product 1', 'Product 2']);

    act(() => button('Add another product').click());
    act(() => button('Remove product 2').click());
    // The third slot keeps its names; it is now the second line on screen.
    expect(names()).toEqual(['lines.0.modelName', 'lines.2.modelName']);
    expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Product 1', 'Product 2']);
    expect(document.activeElement).toBe(button('Add another product'));

    act(() => button('Remove product 1').click());
    expect(names()).toEqual(['lines.2.modelName']);
    expect(host.querySelector('[aria-label^="Remove"]')).toBeNull();
  });

  it('offers no add control once every slot is open', () => {
    act(() => root.render(<LineSlots {...props(3)} />));
    expect(names()).toHaveLength(3);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Add another product'))).toBe(false);
  });
});
