import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ReactElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * `specs/172-product-editor-scope-switcher/` T060 (FR-031, `contracts/readers.md` §1) — the page
 * builder's product picker reads the admin product list, which has no channel and therefore
 * answers the product's **Global name as one string**. The picker shows it as it is; it never
 * picks a language out of a map (there is none) and never shows a character of the string.
 */

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (path: string) => get(path), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const { createProductSlugField } = await import('@endora-commerce/page-builder-admin');

afterEach(() => {
  cleanup();
  get.mockReset();
});

function wrap(node: ReactElement): ReactElement {
  return (
    <StrictMode>
      <TranslationProvider language="en" initialBundle={{ core: {} } as Bundle}>
        {node}
      </TranslationProvider>
    </StrictMode>
  );
}

describe('page builder product picker — the Global name string (T060)', () => {
  it('labels the selected product with its Global name and SKU', async () => {
    get.mockResolvedValue({
      data: [{ id: '00000000-0000-4000-8000-000000000001', slug: 'demo-drills-x', name: 'Drill X', sku: 'DEMO-DRILL-X' }],
    });
    const field = createProductSlugField();
    if (field.type !== 'custom') throw new Error('expected a custom field');
    const Render = field.render as (props: Record<string, unknown>) => ReactElement;
    render(
      wrap(
        <Render
          value="demo-drills-x"
          onChange={(): void => undefined}
          field={{ type: 'custom', label: 'Product' }}
          name="product"
          id="product"
        />,
      ),
    );
    await waitFor(() => expect(screen.getByDisplayValue('Drill X (DEMO-DRILL-X)')).toBeTruthy());
  });

  it('falls back to the slug when the Global name is empty', async () => {
    get.mockResolvedValue({
      data: [{ id: '00000000-0000-4000-8000-000000000001', slug: 'demo-drills-x', name: '', sku: 'DEMO-DRILL-X' }],
    });
    const field = createProductSlugField();
    if (field.type !== 'custom') throw new Error('expected a custom field');
    const Render = field.render as (props: Record<string, unknown>) => ReactElement;
    render(
      wrap(
        <Render
          value="demo-drills-x"
          onChange={(): void => undefined}
          field={{ type: 'custom', label: 'Product' }}
          name="product"
          id="product"
        />,
      ),
    );
    await waitFor(() => expect(screen.getByDisplayValue('demo-drills-x (DEMO-DRILL-X)')).toBeTruthy());
  });
});
