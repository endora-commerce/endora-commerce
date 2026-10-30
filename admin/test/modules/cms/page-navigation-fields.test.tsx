import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentConfig, Data } from '@puckeditor/core';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  fieldsPanel,
  mountPageBuilderEditor,
  outlineButtons,
  selectOutlineItem,
  stubEditorApi,
} from './page-builder-editor-harness';

/**
 * `specs/169-page-builder-contact-form/` T057, US5, FR-014 — in the admin, each
 * link of `cms.PageNavigation` picks its anchor from the sections of the page
 * as it is now (`collectAnchors`), or takes free text normalised to the anchor
 * grammar when it loses focus: the link field's anchor control, exported as a
 * field of its own (`createAnchorField`). The swapped field is one object for
 * the life of the editor, so its input keeps the focus.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

const { defaultPageBuilderConfig } = await import('@endora-commerce/cms-components');
const { withAdminPageNavigationFields, PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS } = await import(
  '../../../../packages/modules/cms/src/admin/components/PageNavigationFields'
);

const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;

type Field = { type: string; label?: string; arrayFields?: Record<string, Field> };

function page(): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: 'cms.PageNavigation',
        props: { ...(components['cms.PageNavigation']?.defaultProps ?? {}), id: 'pb169-nav', items: [{ label: 'About us', anchor: '' }] },
      },
      { type: 'cms.Section', props: { id: 'pb169-s1', anchor: 'about', content: [] } },
      { type: 'cms.Section', props: { id: 'pb169-s2', anchor: 'offer', content: [] } },
    ],
  } as unknown as Data;
}

/** The control inside the `<label>` whose own text is `name` (the picker labels each control by wrapping it). */
function control<T extends HTMLElement>(panel: HTMLElement, name: string, tag: 'select' | 'input'): T {
  const label = [...panel.querySelectorAll('label')].find((element) => element.querySelector('span')?.textContent === name);
  const found = label?.querySelector<T>(tag);
  if (!found) throw new Error(`no ${tag} labelled "${name}"`);
  return found;
}

describe('cms.PageNavigation anchor picker in the admin (T057)', () => {
  it('swaps only the items\' anchor field, once, for the page-navigation block', () => {
    expect([...PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS]).toEqual(['cms.PageNavigation']);
    const base = components['cms.PageNavigation']!;
    const first = withAdminPageNavigationFields('cms.PageNavigation', base).fields as Record<string, Field>;
    const second = withAdminPageNavigationFields('cms.PageNavigation', base).fields as Record<string, Field>;
    expect(Object.keys(first)).toEqual(Object.keys(base.fields ?? {}));
    const anchor = first['items']!.arrayFields!['anchor']!;
    expect(anchor.type).toBe('custom');
    expect(anchor).not.toBe((base.fields as Record<string, Field>)['items']!.arrayFields!['anchor']);
    // Stable: the same field object every time the editor config is built (focus is kept).
    expect(second['items']!.arrayFields!['anchor']).toBe(anchor);
    expect(first['items']!.arrayFields!['label']).toBe((base.fields as Record<string, Field>)['items']!.arrayFields!['label']);
    expect(withAdminPageNavigationFields('cms.Text', components['cms.Text']!)).toBe(components['cms.Text']);
  });

  it('in the real editor, lists the page\'s section anchors and normalises typed text', async () => {
    stubEditorApi(vi.mocked(apiClient));
    const editor = await mountPageBuilderEditor(page());
    expect(outlineButtons()[0]!.textContent).toContain('Page navigation');
    await selectOutlineItem(0);
    const panel = fieldsPanel()!;

    // Open the one link of the list.
    const summary = within(panel).getByText('About us');
    await act(async () => {
      fireEvent.click(summary);
    });
    const select = await waitFor(() => control<HTMLSelectElement>(panel, 'Sections on this page', 'select'));
    expect([...(select as HTMLSelectElement).options].map((option) => option.value)).toEqual(['', 'about', 'offer']);

    await act(async () => {
      fireEvent.change(select, { target: { value: 'offer' } });
    });
    await waitFor(() => {
      const items = (editor.latest()?.content[0]?.props as { items?: Array<{ anchor?: string }> } | undefined)?.items;
      expect(items?.[0]?.anchor).toBe('offer');
    });

    const text = control<HTMLInputElement>(panel, 'Anchor', 'input');
    await act(async () => {
      fireEvent.change(text, { target: { value: '  Our Contact ' } });
      fireEvent.blur(text);
    });
    await waitFor(() => {
      const items = (editor.latest()?.content[0]?.props as { items?: Array<{ anchor?: string }> } | undefined)?.items;
      expect(items?.[0]?.anchor).toBe('our-contact');
    });
  });
});
