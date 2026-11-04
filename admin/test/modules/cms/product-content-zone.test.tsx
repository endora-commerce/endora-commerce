import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-022, FR-025,
 * contracts/admin-surfaces.md §2) — `cms` contributes its Page Builder to the
 * product content screen, as it does to the category content screen and for
 * the same reason: `catalog` is `nonDeactivatable` and owns the document and
 * the save; `cms` is switchable and owns the canvas.
 *
 * The **declaration** is asserted through the package's own `contributions`
 * mounted in the real `<AdminZone>`; the **wrapper** is driven from source
 * with the canvas stubbed.
 */

const editorProps: Array<Record<string, unknown>> = [];
const apiCalls: unknown[] = [];

vi.mock('../../../../packages/modules/cms/src/admin/components/PageBuilderEditor', () => ({
  PageBuilderEditor: (props: {
    data: unknown;
    contentKey?: string;
    onChange: (data: unknown) => void;
  }) => {
    editorProps.push(props);
    return (
      <div data-testid="page-builder">
        <span data-testid="page-builder-data">{JSON.stringify(props.data)}</span>
        <button
          type="button"
          onClick={(): void =>
            props.onChange({ root: { props: {} }, content: [{ type: 'cms.Text', props: { id: 't' } }] })
          }
        >
          canvas-edit
        </button>
      </div>
    );
  },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  const record = (...args: unknown[]): Promise<never> => {
    apiCalls.push(args);
    return Promise.reject(new Error('the contribution must not call an API'));
  };
  return {
    ...actual,
    apiClient: { get: record, post: record, put: record, patch: record, delete: record },
  };
});

const cms = await import('@endora-commerce/mod-cms/admin');
const { ProductContentEditor } = await import(
  '../../../../packages/modules/cms/src/admin/zones/ProductContentEditor'
);

const PRODUCT_ID = '44444444-4444-4444-8444-444444444404';
const REGISTRY = [{ moduleId: 'cms', contributions: cms.contributions }];

function mountZone(options: { readonly permissions?: readonly string[]; readonly present?: boolean }): HTMLElement {
  const { container } = render(
    withSession(
      <MemoryRouter initialEntries={['/x']}>
        <div data-testid="host">
          <AdminZone
            name="product.content.editor"
            props={{
              productId: PRODUCT_ID,
              attributeKey: 'buying_guide',
              language: 'en-US',
              data: null,
              onChange: () => {},
            }}
          />
        </div>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['cms.read'])] }),
        presence:
          options.present === false ? modulePresence({ absent: ['cms'] }) : modulePresence({ present: ['cms'] }),
        contributions: REGISTRY,
      },
    ),
  );
  return container;
}

describe('cms contributes the product content editor (feature 172)', () => {
  beforeEach(() => {
    editorProps.length = 0;
    apiCalls.length = 0;
  });

  it('declares one contribution to the zone, gated on the CMS read code', () => {
    const zones = (cms.contributions.zones ?? []).filter((zone) => zone.zone === 'product.content.editor');
    expect(zones).toHaveLength(1);
    expect(zones[0]?.requiredPermission).toBe('cms.read');
    expect(zones[0]?.match).toBeUndefined();
    expect(typeof zones[0]?.component).toBe('function');
  });

  it('contributes nothing while the module is switched off, or without the read code', async () => {
    for (const container of [mountZone({ present: false }), mountZone({ permissions: ['catalog:write'] })]) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(container.querySelector('[data-testid="host"]')?.innerHTML).toBe('');
    }
  });

  it('seeds the canvas, keys it per product, attribute and language, offers Translate and the full palette', async () => {
    const stored = { root: { props: {} }, content: [{ type: 'cms.RichContent', props: { id: 'a' } }] };
    const onChange = vi.fn();
    render(
      <ProductContentEditor
        productId={PRODUCT_ID}
        attributeKey="buying_guide"
        language="pl-PL"
        data={stored}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('page-builder-data').textContent).toBe(JSON.stringify(stored));
    expect(editorProps[0]?.['contentKey']).toBe(`product:${PRODUCT_ID}:buying_guide:pl-PL`);
    expect(editorProps[0]?.['activeLanguage']).toBe('pl-PL');
    expect(editorProps[0]?.['resource']).toEqual({ type: 'catalog_product_content', id: PRODUCT_ID });
    // OR-3 — no restricted block context: the full CMS palette.
    expect(editorProps[0]?.['context']).toBeUndefined();

    fireEvent.click(screen.getByText('canvas-edit'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ content: [{ type: 'cms.Text' }] });
    expect(screen.getByTestId('page-builder-data').textContent).toContain('cms.Text');
    // The host saves; the contribution never does.
    expect(apiCalls).toEqual([]);
  });

  it('opens an empty document when the product has none in that language', () => {
    render(
      <ProductContentEditor productId={PRODUCT_ID} attributeKey="buying_guide" language="en-US" data={null} onChange={() => {}} />,
    );
    expect(screen.getByTestId('page-builder-data').textContent).toBe(
      JSON.stringify({ root: { props: {} }, content: [] }),
    );
  });
});
