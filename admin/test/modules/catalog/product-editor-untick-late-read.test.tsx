import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 174 (US6 #1, US9 #1, FR-061) — an operator who unticks "Use value from <parent>" while
 * the editor is still reading keeps the untick when the late reads land.
 *
 * The untick is `ScopedField`'s own state until something is typed, and a new read of the field
 * (`view`) starts it over. The editor reads more than the scoped values: the category and
 * attribute-set lists, the product's attribute set and its options. Each case below holds those
 * reads back, unticks while they are in flight, then lets them land and asserts that the field is
 * still unticked, still editable, and the same DOM node — a remount would hand back a fresh,
 * ticked field.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const atChannel = (tab?: string): string =>
  `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}${tab ? `&tab=${tab}` : ''}`;

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '5',
    validScopes: VALID_SCOPES,
    fields: {
      name: scopedField('Drill', { source: 'inherited_global', required: true }),
      description: scopedField('Global text', { source: 'inherited_global' }),
    },
    attributes: [
      {
        key: 'weight',
        label: { 'en-US': 'Weight' },
        valueType: 'number',
        isRequired: false,
        view: scopedField<unknown>(2.5, { source: 'inherited_global', levels: ['G', 'C'] }),
      },
      {
        key: 'voltage',
        label: { 'en-US': 'Voltage' },
        valueType: 'select',
        isRequired: false,
        view: scopedField<unknown>('18v', { source: 'inherited_global', levels: ['G', 'C'] }),
      },
    ],
  });
}

interface Held {
  readonly path: string;
  release(): void;
}

/** Holds every GET whose path `hold` names until it is released; the rest answer at once. */
function holdReads(hold: (path: string) => unknown | undefined): Held[] {
  const held: Held[] = [];
  setUpEditorApi({
    read,
    extra: (path) => {
      const answer = hold(path);
      if (answer === undefined) return undefined;
      return new Promise((resolve) => held.push({ path, release: () => resolve(answer) }));
    },
  });
  return held;
}

async function releaseAll(held: Held[]): Promise<void> {
  // Release what is held, then whatever the released answers asked for in turn.
  for (let round = 0; round < 5; round += 1) {
    const pending = held.splice(0);
    if (pending.length === 0) return;
    await act(async () => {
      for (const h of pending) h.release();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

afterEach(() => cleanup());

describe('an untick during the editor’s late reads survives them (feature 174, FR-061)', () => {
  it('Details: the category and attribute-set lists land after the untick of the name', async () => {
    const held = holdReads((path) =>
      path === '/api/v1/admin/catalog/categories' || path === '/api/v1/admin/catalog/attribute-sets'
        ? { data: [] }
        : undefined,
    );
    renderEditor(ProductEditor, { url: atChannel() });
    const label = en['productEditor.field.name']!;
    // The first case pays the lazy editor and zone imports: wait longer than the default second.
    const name = await screen.findByLabelText(label, undefined, { timeout: 10_000 });
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: `Use value from Global for ${label}` });
    expect(box).toBeChecked();
    expect([...new Set(held.map((h) => h.path))].sort()).toEqual(['/api/v1/admin/catalog/attribute-sets', '/api/v1/admin/catalog/categories']);

    fireEvent.click(box);
    await waitFor(() => expect(name).not.toHaveAttribute('readonly'));

    await releaseAll(held);
    expect(screen.getByLabelText(label)).toBe(name);
    expect(screen.getByRole('checkbox', { name: `Use value from Global for ${label}` })).not.toBeChecked();
    expect(name).not.toHaveAttribute('readonly');
  }, 15_000);

  it('Attributes: the attribute set and its options land after the untick of a number attribute', async () => {
    const held = holdReads((path) => {
      if (path.startsWith('/api/v1/admin/catalog/attribute-sets/')) {
        return {
          data: {
            attributes: [
              { id: 'attr-weight', key: 'weight', valueType: 'number' },
              { id: 'attr-voltage', key: 'voltage', valueType: 'select' },
            ],
          },
        };
      }
      if (path.includes('/options')) return { data: { items: [{ value: '18v', label: { 'en-US': '18 V' }, labelDefault: '18 V', sortOrder: 0 }] } };
      return undefined;
    });
    renderEditor(ProductEditor, { url: atChannel('attributes') });
    const weight = await screen.findByLabelText('Weight');
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /for Weight$/ });
    expect(box).toBeChecked();
    expect(held.some((h) => h.path.startsWith('/api/v1/admin/catalog/attribute-sets/'))).toBe(true);

    fireEvent.click(box);
    await waitFor(() => expect(weight).not.toHaveAttribute('readonly'));

    await releaseAll(held);
    expect(screen.getByLabelText('Weight')).toBe(weight);
    expect(screen.getByRole('checkbox', { name: /for Weight$/ })).not.toBeChecked();
    expect(weight).not.toHaveAttribute('readonly');
  }, 15_000);

  it('Attributes: the options of a select land after its untick, and the select stays editable', async () => {
    const held = holdReads((path) => {
      if (path.startsWith('/api/v1/admin/catalog/attribute-sets/')) {
        return { data: { attributes: [{ id: 'attr-voltage', key: 'voltage', valueType: 'select' }] } };
      }
      if (path.includes('/options')) {
        return { data: { items: [{ value: '18v', label: { 'en-US': '18 V' }, labelDefault: '18 V', sortOrder: 0 }] } };
      }
      return undefined;
    });
    renderEditor(ProductEditor, { url: atChannel('attributes') });
    await screen.findByLabelText('Voltage');
    // An inherited select is a read-only text input until the untick (`contracts/editor-ui.md` section 11).
    expect(screen.getByLabelText('Voltage').tagName).toBe('INPUT');
    fireEvent.click(screen.getByRole('checkbox', { name: /for Voltage$/ }));
    await waitFor(() => expect(screen.getByLabelText('Voltage').tagName).toBe('SELECT'));
    const select = screen.getByLabelText('Voltage');

    await releaseAll(held);
    expect(screen.getByLabelText('Voltage')).toBe(select);
    expect(screen.getByRole('checkbox', { name: /for Voltage$/ })).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole('option', { name: '18 V' })).toBeInTheDocument());
  }, 15_000);
});
