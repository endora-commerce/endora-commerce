import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';

/**
 * Issues #1439 (DS-05), #1441 (DS-07) and #1448 (DS-15), UX audit 2026-11-17.
 *
 * The tags-and-fields screen drew two create forms open above its lists, each
 * with a filled *Add*. Now each section's header carries an outline *Add …*
 * that opens the kit's dialog (whose submit is the one filled button while it
 * is open), and an empty section is the kit's `EmptyState`, not a grey sentence.
 */

let permissions = new Set(['newsletter:read', 'newsletter:write']);
const listTags = vi.fn();
const listCustomFields = vi.fn();
const createTag = vi.fn();
const createCustomField = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, useAuth: () => ({ hasPermission: (code: string) => permissions.has(code) }) };
});

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: () => listTags(),
    listCustomFields: () => listCustomFields(),
    createTag: (input: unknown) => createTag(input),
    createCustomField: (input: unknown) => createCustomField(input),
  },
}));

const { TagsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/TagsPage');

const bundle = { ...shippedModuleBundle('newsletter', 'en'), ...shippedCoreBundle('en') };
const copy = bundle.newsletter as Record<string, string>;
const core = bundle.core as Record<string, string>;
const label = (key: string): string => {
  const value = copy[key];
  if (!value) throw new Error(`newsletter/i18n/en.json carries no "${key}"`);
  return value;
};
const classes = (el: Element): string[] => el.className.split(/\s+/);

beforeEach(() => {
  permissions = new Set(['newsletter:read', 'newsletter:write']);
  listTags.mockReset().mockResolvedValue({ items: [] });
  listCustomFields.mockReset().mockResolvedValue({ items: [] });
  createTag.mockReset().mockResolvedValue({});
  createCustomField.mockReset().mockResolvedValue({});
});

describe('Newsletter TagsPage — add through a dialog, empty sections as EmptyState', () => {
  it('draws no form on the page and an outline Add in each section header', async () => {
    const { container } = renderWithI18n(<TagsPage />, bundle);
    await waitFor(() => expect(listTags).toHaveBeenCalled());
    expect(container.querySelector('input, select')).toBeNull();
    for (const key of ['tags.add', 'fields.add']) {
      const add = await screen.findByRole('button', { name: label(key) });
      expect(add.closest('[data-slot="card-header"]')).not.toBeNull();
      expect(classes(add)).toContain('border-input');
    }
    // No filled button competes on the page.
    expect([...container.querySelectorAll('button')].filter((b) => classes(b).includes('bg-primary'))).toEqual([]);
  });

  it('shows the kit EmptyState for an empty tag list and an empty field list', async () => {
    const { container } = renderWithI18n(<TagsPage />, bundle);
    expect(await screen.findByText(label('tags.empty'))).toBeInTheDocument();
    expect(screen.getByText(label('fields.empty'))).toBeInTheDocument();
    expect(screen.getByText(label('tags.emptyBody'))).toBeInTheDocument();
    expect(screen.getByText(label('fields.emptyBody'))).toBeInTheDocument();
    expect(container.querySelectorAll('[data-empty-state="no-data"]')).toHaveLength(2);
  });

  it('offers no Add without newsletter:write', async () => {
    permissions = new Set(['newsletter:read']);
    renderWithI18n(<TagsPage />, bundle);
    expect(await screen.findByText(label('tags.empty'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: label('tags.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: label('fields.add') })).toBeNull();
  });

  it('marks a missing tag name on the field and sends nothing', async () => {
    renderWithI18n(<TagsPage />, bundle);
    fireEvent.click(await screen.findByRole('button', { name: label('tags.add') }));
    const dialog = screen.getByRole('dialog', { name: label('tags.dialog.title') });
    fireEvent.click(within(dialog).getByRole('button', { name: label('tags.add') }));
    const name = within(dialog).getByRole('textbox', { name: new RegExp(label('tags.field.name')) });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(dialog).toHaveTextContent(label('tags.nameRequired'));
    expect(createTag).not.toHaveBeenCalled();
  });

  it('creates a tag, closes the dialog and reloads the list', async () => {
    renderWithI18n(<TagsPage />, bundle);
    fireEvent.click(await screen.findByRole('button', { name: label('tags.add') }));
    const dialog = screen.getByRole('dialog', { name: label('tags.dialog.title') });
    fireEvent.change(within(dialog).getByRole('textbox', { name: new RegExp(label('tags.field.name')) }), {
      target: { value: 'VIP' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: label('tags.add') }));
    await waitFor(() => expect(createTag).toHaveBeenCalledWith({ code: 'vip', name: 'VIP' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listTags.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps the field dialog open and says why when the server refuses', async () => {
    createCustomField.mockRejectedValue(new Error('Key "company" is already used.'));
    renderWithI18n(<TagsPage />, bundle);
    fireEvent.click(await screen.findByRole('button', { name: label('fields.add') }));
    const dialog = screen.getByRole('dialog', { name: label('fields.dialog.title') });
    fireEvent.change(within(dialog).getByRole('textbox', { name: new RegExp(label('fields.field.label')) }), {
      target: { value: 'Company' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: label('fields.add') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Key "company" is already used.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Cancel without a request', async () => {
    renderWithI18n(<TagsPage />, bundle);
    fireEvent.click(await screen.findByRole('button', { name: label('fields.add') }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: core['common.action.cancel']! }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createCustomField).not.toHaveBeenCalled();
  });
});
