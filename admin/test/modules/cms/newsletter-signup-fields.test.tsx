import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import type { ComponentConfig, Data } from '@puckeditor/core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import {
  NEWSLETTER_SIGNUP_FIELDS_BLOCK,
  withAdminNewsletterSignupFields,
} from '../../../../packages/modules/cms/src/admin/components/NewsletterSignupFields';
import { editorDescriptor, fieldsPanel, mountPageBuilderEditor, selectOutlineItem } from './page-builder-editor-harness';

/**
 * `specs/169-page-builder-contact-form/` US7, FR-024, FR-025 (T182) — in the
 * admin's editor, `newsletter.Signup`'s topic tag and attribute custom field
 * are the newsletter pickers: the tag by name (the code stored), the custom
 * field writing its key, type and label together. The swap is
 * `withAdminNewsletterSignupFields`; `PageBuilderEditor` applies it.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

type Composite = { type: string; arrayFields?: Record<string, { type: string }> };

const signup = defaultPageBuilderConfig.components['newsletter.Signup'] as ComponentConfig;

function adminFields(): Record<string, Composite> {
  return withAdminNewsletterSignupFields(signup).fields as unknown as Record<string, Composite>;
}

describe('newsletter.Signup in the admin (T182)', () => {
  it('swaps the topic tag and the attribute custom field for the pickers', () => {
    const fields = adminFields();
    expect(NEWSLETTER_SIGNUP_FIELDS_BLOCK).toBe('newsletter.Signup');
    expect(fields['topics']!.arrayFields!['tagCode']!.type).toBe('custom');
    expect(Object.keys(fields['topics']!.arrayFields!)).toEqual(['label', 'tagCode']);
    // The picker writes the type: the type select is the package default's, not the admin's.
    expect(Object.keys(fields['attributes']!.arrayFields!)).toEqual(['key', 'label', 'placeholder', 'required']);
    expect(fields['attributes']!.arrayFields!['key']!.type).toBe('custom');
  });

  it('is stable: the same picker objects on every build', () => {
    const first = adminFields();
    const second = adminFields();
    expect(second['topics']!.arrayFields!['tagCode']).toBe(first['topics']!.arrayFields!['tagCode']);
    expect(second['attributes']!.arrayFields!['key']).toBe(first['attributes']!.arrayFields!['key']);
    // Every other field is the block's own.
    expect(second['attributes']!.arrayFields!['placeholder']).toBe(
      (signup.fields as unknown as Record<string, Composite>)['attributes']!.arrayFields!['placeholder'],
    );
  });

  it('PageBuilderEditor applies the swap', () => {
    const editor = readFileSync(resolve(__dirname, '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor.tsx'), 'utf8');
    expect(editor).toMatch(/withAdminNewsletterSignupFields\(/);
  });
});

describe('newsletter.Signup pickers in the mounted editor (T182)', () => {
  function stub(): void {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/admin/cms/page-builder/config')) return { data: editorDescriptor() };
      if (url === '/api/v1/admin/newsletter/tags') {
        return { data: { items: [{ id: 't1', code: 'offers', name: 'Special offers', description: null }, { id: 't2', code: 'events', name: 'Events', description: null }] } };
      }
      if (url === '/api/v1/admin/newsletter/custom-fields') {
        return { data: { items: [{ id: 'f1', key: 'vip', label: 'Trade customer', type: 'boolean' }] } };
      }
      return { data: [] };
    });
  }

  function page(): Data {
    return {
      root: { props: {} },
      content: [
        {
          type: 'newsletter.Signup',
          props: {
            ...(signup.defaultProps ?? {}),
            id: 'pb169-signup',
            topics: [{ label: 'Offers', tagCode: 'offers' }],
            attributes: [{ key: 'company', type: 'text', label: 'Company' }],
          },
        },
      ],
    } as unknown as Data;
  }

  async function openItem(summary: string): Promise<HTMLElement> {
    const panel = fieldsPanel()!;
    const item = within(panel).getByText(summary);
    await act(async () => {
      fireEvent.click(item);
    });
    return panel;
  }

  it('picks a topic’s tag by name and stores its code', async () => {
    stub();
    const editor = await mountPageBuilderEditor(page());
    await selectOutlineItem(0);
    const panel = await openItem('Offers');
    const option = await within(panel).findByText('Events', { selector: 'option' });
    const select = option.closest('select')!;
    expect(select.value).toBe('offers');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'events' } });
    });
    await waitFor(() => {
      const props = editor.latest()?.content[0]?.props as { topics?: Array<{ tagCode?: string }> } | undefined;
      expect(props?.topics?.[0]?.tagCode).toBe('events');
    });
  });

  it('picks an attribute’s custom field, writing the key, the type and the label together', async () => {
    stub();
    const editor = await mountPageBuilderEditor(page());
    await selectOutlineItem(0);
    const panel = await openItem('Company');
    const option = await within(panel).findByText('Trade customer', { selector: 'option' });
    await act(async () => {
      fireEvent.change(option.closest('select')!, { target: { value: 'vip' } });
    });
    await waitFor(() => {
      const props = editor.latest()?.content[0]?.props as { attributes?: unknown[] } | undefined;
      expect(props?.attributes?.[0]).toEqual({ key: 'vip', type: 'boolean', fieldLabel: 'Trade customer', label: 'Company' });
    });
    // The picker shows the picked field.
    await waitFor(() => expect((within(panel).getByText('Trade customer', { selector: 'option' }).closest('select') as HTMLSelectElement).value).toBe('vip'));
  });
});
