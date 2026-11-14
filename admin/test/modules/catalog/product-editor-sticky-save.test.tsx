import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { CH_RETAIL, PRODUCT_ID, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Issue #717 — the product editor's one Save lives in the sticky scope bar, so at ≥ 1024 px it
 * stays in view on a long product (the page head scrolls away; the scope bar is `lg:sticky`),
 * and below 1024 px the same node is the fixed bottom bar (`StickyFormActions`). One node at
 * every width means there is never a second Save, whatever the viewport.
 *
 * jsdom has no layout, so "reachable without scrolling" is held structurally: Save is a
 * descendant of the sticky scope bar and of the single `.b2b-sticky-form-actions` container,
 * and nothing of it remains in the scrolling page head.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;
const SAVE = /^Save\b/;

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

/** Keyboard order: what Tab visits, in document order (jsdom has no layout, so DOM order is the order). */
function tabbables(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href], [tabindex]'),
  ).filter((el) => {
    if (el.getAttribute('tabindex') === '-1') return false;
    if ((el as HTMLButtonElement).disabled) return false;
    return el.closest('[hidden], [inert]') === null;
  });
}

describe('Save in the sticky scope bar (issue #717)', () => {
  it('Save sits inside the sticky scope bar, not in the scrolling page head', async () => {
    renderEditor(ProductEditor);
    const save = await screen.findByRole('button', { name: SAVE });
    const bar = screen.getByTestId('product-scope-bar');
    expect(bar.className).toMatch(/(^|\s)lg:sticky(\s|$)/);
    expect(bar).toContainElement(save);
    expect(bar).toContainElement(save.closest<HTMLElement>('.b2b-sticky-form-actions'));
    const head = document.querySelector<HTMLElement>('.b2b-page-head')!;
    expect(within(head).queryByRole('button', { name: SAVE })).toBeNull();
    // The staged-changes count rides on the one Save.
    fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka' } });
    expect(within(bar).getByRole('button', { name: /^Save 1 change\b/ })).toBeInTheDocument();
  });

  it('there is exactly one Save and one sticky actions container, before and after staging, at every scope', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    await screen.findByRole('button', { name: SAVE });
    expect(screen.getAllByRole('button', { name: SAVE })).toHaveLength(1);
    expect(document.querySelectorAll('.b2b-sticky-form-actions')).toHaveLength(1);
    fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka' } });
    expect(screen.getAllByRole('button', { name: SAVE })).toHaveLength(1);
    expect(document.querySelectorAll('.b2b-sticky-form-actions')).toHaveLength(1);
  });

  it('keyboard order: Product menu, channel, language, scope map, Save, then the tabs', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    const save = await screen.findByRole('button', { name: SAVE });
    const order = tabbables();
    const at = (el: HTMLElement): number => {
      const i = order.indexOf(el);
      expect(i, el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(0);
      return i;
    };
    const menu = at(screen.getByRole('button', { name: en['productEditor.wholeProduct.menu']! }));
    const channel = at(screen.getByLabelText(en['productEditor.scope.channelSelect']!));
    const language = at(screen.getByLabelText(en['productEditor.scope.languageSelect']!));
    const scopeMap = at(screen.getByRole('button', { name: en['productEditor.scope.scopeMap']! }));
    const saveAt = at(save);
    const firstTab = Math.min(...screen.getAllByRole('tab').map((tab) => order.indexOf(tab)).filter((i) => i >= 0));
    expect(menu).toBeLessThan(channel);
    expect(channel).toBeLessThan(language);
    expect(language).toBeLessThan(scopeMap);
    expect(scopeMap).toBeLessThan(saveAt);
    expect(saveAt).toBeLessThan(firstTab);
  });

  it('the non-Global banner stays in the bar, after Save, and Save names its scope', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    const save = await screen.findByRole('button', { name: SAVE });
    const bar = screen.getByTestId('product-scope-bar');
    const banner = screen.getByTestId('scope-banner-live');
    expect(bar).toContainElement(banner);
    expect(save.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save).toHaveAccessibleName(/Retail PL/);
  });

  it('read-only: no Save and no empty sticky actions container (no bottom bar reserved for nothing)', async () => {
    renderEditor(ProductEditor, { permissions: ['catalog:read'] });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(document.querySelector('.b2b-sticky-form-actions')).toBeNull();
  });
});
