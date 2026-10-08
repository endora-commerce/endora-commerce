import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `cms` contributes its Page Builder to the category content screen.
 *
 * ## Why it is a contribution and not an import
 *
 * `catalog`'s category content screen owns the document and no editor: it
 * mounts the `category.content.editor` zone and saves whatever comes back.
 * `blog` reaches the same canvas by importing `PageBuilderEditor` off this
 * module's `./admin-ui`, and may, because it declares `cms` in its manifest
 * `dependencies`. `catalog` may not — it is `nonDeactivatable` and this module
 * is switchable, so the edge would make `cms.enabled` a dead switch — so the
 * direction is inverted and this module declares the other end.
 *
 * ## What is asserted against what
 *
 * The **declaration** is this package's own `contributions` object off its
 * `./admin` subpath, mounted through the real `<AdminZone>` over the real
 * providers, so a zone name, a weight or a permission that drifts fails here —
 * and so does the off state, which is the reason the seam exists.
 *
 * The **wrapper** is driven from source with the canvas stubbed: what it owes
 * the host is a document in and every edit back, and Puck is not the subject.
 */

const editorProps: Array<Record<string, unknown>> = [];

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

const cms = await import('@endora-commerce/mod-cms/admin');
const { CategoryContentEditor } = await import(
  '../../../../packages/modules/cms/src/admin/zones/CategoryContentEditor'
);

const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';

const REGISTRY = [{ moduleId: 'cms', contributions: cms.contributions }];

function mountZone(options: {
  readonly permissions?: readonly string[];
  readonly present?: boolean;
}): HTMLElement {
  const { container } = render(
    withSession(
      <MemoryRouter initialEntries={['/x']}>
        <div data-testid="host">
          <AdminZone
            name="category.content.editor"
            props={{ categoryId: CATEGORY_ID, language: 'en-US', data: null, onChange: () => {} }}
          />
        </div>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['cms.read'])] }),
        presence:
          options.present === false
            ? modulePresence({ absent: ['cms'] })
            : modulePresence({ present: ['cms'] }),
        contributions: REGISTRY,
      },
    ),
  );
  return container;
}

describe('cms contributes the category content editor', () => {
  beforeEach(() => {
    editorProps.length = 0;
  });

  it('declares one contribution to the zone, gated on the code that opens its own editors', () => {
    const zones = (cms.contributions.zones ?? []).filter(
      (zone) => zone.zone === 'category.content.editor',
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]?.requiredPermission).toBe('cms.read');
    expect(zones[0]?.match).toBeUndefined();
    // FR-013: the Puck chunk sits behind a factory the renderer reaches only
    // after it has decided presence and permission.
    expect(typeof zones[0]?.component).toBe('function');
  });

  it('contributes nothing while the module is switched off', async () => {
    const container = mountZone({ present: false });
    // Give a lazy chunk the chance to arrive, so the absence is not a race.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="host"]')?.innerHTML).toBe('');
  });

  it('contributes nothing to an operator without the CMS read code', async () => {
    const container = mountZone({ permissions: ['catalog:write'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="host"]')?.innerHTML).toBe('');
  });

  it('seeds the canvas with the stored document and reports every edit to the host', async () => {
    const stored = { root: { props: {} }, content: [{ type: 'cms.RichContent', props: { id: 'a' } }] };
    const onChange = vi.fn();
    render(
      <CategoryContentEditor
        categoryId={CATEGORY_ID}
        language="pl-PL"
        data={stored}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('page-builder-data').textContent).toBe(JSON.stringify(stored));
    // Puck seeds from `data` on mount only; the key is what re-seeds it for
    // another category or another language.
    expect(editorProps[0]?.['contentKey']).toBe(`category:${CATEGORY_ID}:pl-PL`);

    fireEvent.click(screen.getByText('canvas-edit'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ content: [{ type: 'cms.Text' }] });
    // The canvas is handed its own edit back, or the next render would reset it.
    expect(screen.getByTestId('page-builder-data').textContent).toContain('cms.Text');
  });

  it('opens an empty document when the category has none in that language', () => {
    render(
      <CategoryContentEditor
        categoryId={CATEGORY_ID}
        language="en-US"
        data={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('page-builder-data').textContent).toBe(
      JSON.stringify({ root: { props: {} }, content: [] }),
    );
  });
});
