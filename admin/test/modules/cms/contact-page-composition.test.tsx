import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Field } from '@puckeditor/core';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import { buildPageBuilderEditorConfig } from '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor';
import { editorDescriptor } from './page-builder-editor-harness';

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

/**
 * Feature 169 (T116, US6 acceptance 10) — a corporate contact page is built from blocks that
 * exist: a Row of Columns holding a heading, a lead and the contact form beside a column of
 * contact details, and a Tabs block whose panels hold "Contact form" and "Newsletter". The
 * editor's own config is read, so a slot that refused either form would fail here.
 */

const descriptor = editorDescriptor() as unknown as CmsPageBuilderDescriptor;
const config: Config = buildPageBuilderEditorConfig({
  descriptor,
  context: 'cms',
  t: (key) => key,
  translateInScope: (scope, key) => `${scope}.${key}`,
});

type SlotField = Field & { type: 'slot'; allow?: string[]; disallow?: string[] };

function admits(slot: SlotField | undefined, block: string): boolean {
  if (!slot || slot.type !== 'slot') return false;
  if (slot.allow && !slot.allow.includes(block)) return false;
  return !(slot.disallow ?? []).includes(block);
}

describe('a corporate contact page from existing blocks (T116)', () => {
  it('offers both forms in the CMS palette', () => {
    expect(config.components['cms.ContactForm']).toBeDefined();
    expect(config.components['newsletter.Signup']).toBeDefined();
  });

  it('a Tabs panel accepts the contact form and the newsletter sign-up', () => {
    const tabs = config.components['cms.Tabs'] as ComponentConfig;
    const items = tabs.fields?.['items'] as { arrayFields?: Record<string, SlotField> } | undefined;
    const panel = items?.arrayFields?.['panel'];
    expect(admits(panel, 'cms.ContactForm')).toBe(true);
    expect(admits(panel, 'newsletter.Signup')).toBe(true);
  });

  it('a Column in a Row holds the form beside a heading and rich content', () => {
    const row = config.components['cms.Row'] as ComponentConfig;
    const column = config.components['cms.Column'] as ComponentConfig;
    expect(admits(row.fields?.['content'] as SlotField, 'cms.Column')).toBe(true);
    for (const block of ['cms.ContactForm', 'cms.Heading', 'cms.RichContent']) {
      expect(admits(column.fields?.['content'] as SlotField, block), block).toBe(true);
    }
  });

  it('renders the composition: two columns, then the two forms in tabs', () => {
    const defaults = (name: string) => (config.components[name]?.defaultProps ?? {}) as Record<string, unknown>;
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Row',
          props: {
            ...defaults('cms.Row'),
            id: 'row',
            content: [
              {
                type: 'cms.Column',
                props: {
                  ...defaults('cms.Column'),
                  id: 'column-form',
                  content: [
                    { type: 'cms.Heading', props: { ...defaults('cms.Heading'), id: 'heading', text: 'Write to us' } },
                    { type: 'cms.ContactForm', props: { ...defaults('cms.ContactForm'), id: 'contact-a' } },
                  ],
                },
              },
              {
                type: 'cms.Column',
                props: {
                  ...defaults('cms.Column'),
                  id: 'column-details',
                  content: [{ type: 'cms.RichContent', props: { ...defaults('cms.RichContent'), id: 'details' } }],
                },
              },
            ],
          },
        },
        {
          type: 'cms.Tabs',
          props: {
            ...defaults('cms.Tabs'),
            id: 'tabs',
            items: [
              { label: 'Contact form', panel: [{ type: 'cms.ContactForm', props: { ...defaults('cms.ContactForm'), id: 'contact-b' } }] },
              { label: 'Newsletter', panel: [{ type: 'newsletter.Signup', props: { ...defaults('newsletter.Signup'), id: 'signup' } }] },
            ],
          },
        },
      ],
    } as unknown as Data;
    const html = renderToString(<Render config={config} data={data} />);
    expect(html.match(/action="\/forms\/contact"/g)).toHaveLength(2);
    expect(html).toContain('action="/newsletter/subscribe"');
    expect(html).toContain('Write to us');
  });
});
