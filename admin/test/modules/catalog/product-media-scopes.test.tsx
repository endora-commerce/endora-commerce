import { StrictMode, createRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T140 (US9, FR-076, FR-077, FR-078) — the product editor's gallery and
 * attachments per scope:
 *
 * - the gallery lists every item from the admin read (an item hidden in the channel the
 *   public read resolves to stays listed); per member channel the operator picks a role
 *   holder or "use inherited", and hides an image in that channel; alt text is edited per
 *   language. The edits are staged and written by the page Save (`flushGallery`): one
 *   `PUT …/gallery/channel-roles` per changed channel with the changed roles only, one
 *   `PATCH …/gallery/:itemId` per changed item with the alt-text patch and the full
 *   hidden-channel set (channels the product has left are carried over, never dropped);
 * - an attachment's names and descriptions per language and its hidden channels are
 *   edited in a dialog and written as one `PATCH …/attachments/:id`.
 *
 * Rendered inside `<StrictMode>` with the catalogue's real `en` and `pl` bundles, so a key
 * missing in either file fails here.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { GallerySection } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductGallerySection'
);
const { AttachmentsSection } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductAttachmentsSection'
);
type GallerySectionHandle = import(
  '../../../../packages/modules/catalog/src/admin/components/ProductGallerySection'
).GallerySectionHandle;

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const LEFT = '00000000-0000-4000-8000-00000000c009';
const I1 = '00000000-0000-4000-8000-0000000000e1';
const I2 = '00000000-0000-4000-8000-0000000000e2';
const I3 = '00000000-0000-4000-8000-0000000000e3';
const A1 = '00000000-0000-4000-8000-0000000000f1';
const A2 = '00000000-0000-4000-8000-0000000000f2';
const TYPE = '00000000-0000-4000-8000-0000000000f9';
const ADMIN = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;
const PUBLIC = `/api/v1/catalog/products/${PRODUCT_ID}`;

const scopeContext = {
  productId: PRODUCT_ID,
  channels: [
    { id: B2B, code: 'b2b', name: 'B2B shop', languages: ['de', 'en'], isDefault: true },
    { id: B2C, code: 'b2c', name: 'B2C shop', languages: ['pl'], isDefault: false },
  ],
  languagesUnion: ['de', 'en', 'pl'],
  primaryAdminLanguage: 'en',
  preference: null,
};

const stamp = { createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' };

function galleryItems(options: { thirdLabels?: string[] } = {}): unknown[] {
  return [
    { id: I1, productId: PRODUCT_ID, assetId: `${I1.slice(0, -2)}a1`, position: 0, labels: ['base_image'], altText: { pl: 'Wiertarka' }, hiddenInChannels: [], ...stamp },
    { id: I2, productId: PRODUCT_ID, assetId: `${I2.slice(0, -2)}a2`, position: 1, labels: [], altText: {}, hiddenInChannels: [LEFT], ...stamp },
    { id: I3, productId: PRODUCT_ID, assetId: `${I3.slice(0, -2)}a3`, position: 2, labels: options.thirdLabels ?? [], altText: {}, hiddenInChannels: [B2B], ...stamp },
  ];
}

/** The public read resolves one channel: the image hidden there (I3) is not in it. */
const publicDetail = {
  gallery: [
    { id: I1, position: 0, labels: ['base_image'], asset: { id: `${I1.slice(0, -2)}a1`, kind: 'image', url: '/media/one.jpg' } },
    { id: I2, position: 1, labels: [], asset: { id: `${I2.slice(0, -2)}a2`, kind: 'image', url: '/media/two.jpg' } },
  ],
  assets: [],
  attachments: [
    {
      id: A1,
      position: 0,
      name: 'Datasheet',
      description: null,
      type: { id: TYPE, code: 'datasheet', name: { 'en-US': 'Technical sheet' } },
      asset: { id: `${A1.slice(0, -2)}b1`, kind: 'pdf', url: '/media/sheet.pdf', filename: 'sheet.pdf', sizeBytes: 10, mimeType: 'application/pdf' },
    },
  ],
};

function attachments(): unknown[] {
  return [
    {
      id: A1,
      productId: PRODUCT_ID,
      assetId: `${A1.slice(0, -2)}b1`,
      attachmentTypeId: TYPE,
      name: 'Datasheet',
      description: null,
      position: 0,
      nameTranslations: { pl: 'Karta katalogowa' },
      descriptionTranslations: {},
      hiddenInChannels: [LEFT],
      ...stamp,
    },
    {
      id: A2,
      productId: PRODUCT_ID,
      assetId: `${A2.slice(0, -2)}b2`,
      attachmentTypeId: TYPE,
      name: 'Manual',
      description: 'How to use it',
      position: 1,
      nameTranslations: {},
      descriptionTranslations: {},
      hiddenInChannels: [B2C],
      ...stamp,
    },
  ];
}

function serve(
  options: { channelRoles?: unknown[]; thirdLabels?: string[] } = {},
): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `${ADMIN}/gallery`) return Promise.resolve({ data: galleryItems(options) });
    if (path === `${ADMIN}/gallery/channel-roles`) {
      return Promise.resolve({
        data: options.channelRoles ?? [
          { channelId: B2B, roles: { baseImage: I2, smallImage: null, thumbnail: null } },
        ],
      });
    }
    if (path === `${ADMIN}/scope-context`) return Promise.resolve({ data: scopeContext });
    if (path === `${ADMIN}/attachments`) return Promise.resolve({ data: attachments() });
    if (path === '/api/v1/admin/catalog/attachment-types') {
      return Promise.resolve({
        data: [{ id: TYPE, code: 'datasheet', name: { 'en-US': 'Technical sheet', 'pl-PL': 'Karta' }, position: 0 }],
      });
    }
    if (path === PUBLIC) return Promise.resolve({ data: publicDetail });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(
  ui: ReactElement,
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog }}>
          {withSession(ui, {
            session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
          })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function renderGallery(
  options: { permissions?: readonly string[]; language?: 'en' | 'pl'; onDirtyChange?: (dirty: boolean) => void } = {},
): Promise<React.RefObject<GallerySectionHandle | null>> {
  const ref = createRef<GallerySectionHandle>();
  render(
    wrap(
      <GallerySection
        ref={ref}
        productId={PRODUCT_ID}
        {...(options.onDirtyChange ? { onDirtyChange: options.onDirtyChange } : {})}
      />,
      options,
    ),
  );
  await screen.findByRole('combobox', { name: options.language === 'pl' ? /^kanał$/i : /^channel$/i });
  return ref;
}

async function flush(ref: React.RefObject<GallerySectionHandle | null>): Promise<void> {
  await act(async () => {
    await ref.current!.flushGallery();
  });
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset().mockImplementation((_path: string, body: { channelId: string }) =>
    Promise.resolve({ data: { channelId: body.channelId, roles: { baseImage: null, smallImage: null, thumbnail: null } } }),
  );
  patchSpy.mockReset().mockResolvedValue({ data: {} });
  deleteSpy.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Gallery per channel and alt text per language (US9, FR-076, FR-077)', () => {
  it('lists every gallery item from the admin read, also one the public read leaves out', async () => {
    serve();
    await renderGallery();
    expect(await screen.findByText('Image 3')).toBeInTheDocument();
    expect(screen.getByText('Image 1')).toBeInTheDocument();
    expect(screen.getByText('Image 2')).toBeInTheDocument();
  });

  it('the channel view shows the channel’s own role holder, offers “use inherited” and no image hidden there', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);

    const base = screen.getByRole('combobox', { name: 'Base image in B2B shop' });
    expect(base).toHaveValue(I2);
    const options = within(base).getAllByRole('option').map((o) => o.textContent);
    // D13 — a role option names the image by its place and its file, since the place
    // shifts while the gallery is reordered.
    expect(options).toEqual(['Use inherited (Image 1 · one.jpg)', 'Image 1 · one.jpg', 'Image 2 · two.jpg']);
    expect(screen.getByRole('combobox', { name: 'Small image in B2B shop' })).toHaveValue('');
  });

  it('page Save writes the changed roles of a channel only: null for use inherited, absent when untouched', async () => {
    serve();
    const ref = await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Base image in B2B shop' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Small image in B2B shop' }), I1);

    await flush(ref);

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(`${ADMIN}/gallery/channel-roles`, {
      channelId: B2B,
      roles: { baseImage: null, smallImage: I1 },
    });
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('hiding an image in a channel sends the whole set, keeping a channel the product has left', async () => {
    serve();
    const ref = await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2C);
    await user.click(screen.getByRole('checkbox', { name: 'Hide Image 2 in B2C shop' }));

    await flush(ref);

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(`${ADMIN}/gallery/${I2}`, {
      hiddenInChannels: [B2C, LEFT].sort(),
    });
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('showing an image again in a channel removes that channel only', async () => {
    serve();
    const ref = await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    const hide = screen.getByRole('checkbox', { name: 'Hide Image 3 in B2B shop' });
    expect(hide).toBeChecked();
    await user.click(hide);

    await flush(ref);

    expect(patchSpy).toHaveBeenCalledWith(`${ADMIN}/gallery/${I3}`, { hiddenInChannels: [] });
  });

  it('alt text per language: a changed language is sent, a cleared one as "", the others not at all', async () => {
    serve();
    const ref = await renderGallery();
    const user = userEvent.setup();
    const language = screen.getByRole('combobox', { name: 'Alt text language' });
    expect(within(language).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['de', 'en', 'pl']);

    await user.selectOptions(language, 'pl');
    const altPl = screen.getByRole('textbox', { name: 'Alt text of Image 1 (PL)' });
    expect(altPl).toHaveValue('Wiertarka');
    await user.clear(altPl);
    await user.selectOptions(language, 'en');
    await user.type(screen.getByRole('textbox', { name: 'Alt text of Image 1 (EN)' }), 'Cordless drill');

    await flush(ref);

    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(`${ADMIN}/gallery/${I1}`, {
      altText: { pl: '', en: 'Cordless drill' },
    });
  });

  it('an empty alt text says the image’s own alt text applies', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Alt text language' }), 'de');
    expect(screen.getByRole('textbox', { name: 'Alt text of Image 2 (DE)' })).toHaveAttribute(
      'placeholder',
      'The image’s own alt text',
    );
  });

  it('page Save with nothing changed sends nothing', async () => {
    serve();
    const ref = await renderGallery();
    await flush(ref);
    expect(putSpy).not.toHaveBeenCalled();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('is read-only for catalog:read — role, hide and alt controls are disabled', async () => {
    serve();
    await renderGallery({ permissions: ['catalog:read'] });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    expect(screen.getByRole('combobox', { name: 'Base image in B2B shop' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Hide Image 1 in B2B shop' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Alt text of Image 1 (DE)' })).toBeDisabled();
  });

  it('renders in Polish from the pl bundle', async () => {
    serve();
    await renderGallery({ language: 'pl' });
    expect(screen.getByRole('combobox', { name: /^kanał$/i })).toBeInTheDocument();
  });
});

describe('Gallery — review round D+F (D4, UX-2, C-9, D13, D14)', () => {
  it('reports whether it holds staged edits (D4)', async () => {
    serve();
    const dirty = vi.fn();
    await renderGallery({ onDirtyChange: dirty });
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Alt text language' }), 'en');
    await user.type(screen.getByRole('textbox', { name: 'Alt text of Image 1 (EN)' }), 'x');
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
    await user.clear(screen.getByRole('textbox', { name: 'Alt text of Image 1 (EN)' }));
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });

  it('while edits are staged, Add and Remove wait for Save and say so (UX-2 = A)', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    const removeButtons = (): HTMLElement[] => screen.getAllByRole('button', { name: /^remove$/i });
    expect(removeButtons()[0]).not.toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2C);
    await user.click(screen.getByRole('checkbox', { name: 'Hide Image 2 in B2C shop' }));
    const reason = screen.getByText('Save your changes first.');
    for (const button of removeButtons()) {
      expect(button).toBeDisabled();
      expect(button.getAttribute('aria-describedby')).toContain(reason.id);
    }
    const add = screen.getByRole('button', { name: /add to gallery/i });
    expect(add).toBeDisabled();
    expect(add.getAttribute('aria-describedby')).toContain(reason.id);
  });

  it('removing an image asks in a dialog, not the browser’s confirm (D4)', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /^remove$/i })[0]!);
    const dialog = await screen.findByRole('dialog', { name: /remove image 1/i });
    expect(window.confirm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    expect(deleteSpy).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: /^remove$/i })[0]!);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^remove image$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${ADMIN}/gallery/${I1}`));
  });

  it('the preview is a dialog that Escape closes (D4)', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /open full-size preview/i })[0]!);
    expect(await screen.findByRole('dialog', { name: /preview/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"use inherited" says when the inherited image is hidden in the channel (C-9)', async () => {
    serve({ thirdLabels: ['small_image'] });
    await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    const small = screen.getByRole('combobox', { name: 'Small image in B2B shop' });
    expect(within(small).getAllByRole('option')[0]?.textContent).toBe('Use inherited (Image 3, hidden here)');
  });

  it('warns when the channel’s own role holder is hidden there (D13)', async () => {
    serve({ channelRoles: [{ channelId: B2B, roles: { baseImage: I3, smallImage: null, thumbnail: null } }] });
    await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    expect(screen.getByText(/Image 3 is the base image in B2B shop but is hidden there/i)).toBeInTheDocument();
  });

  it('says alt text is per language, not per channel, while a channel is selected (D13)', async () => {
    serve();
    await renderGallery();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /^channel$/i }), B2B);
    expect(screen.getByText(/alt text is per language and applies in every channel/i)).toBeInTheDocument();
  });

  it('says why its controls are read-only without catalog:write (D14)', async () => {
    serve();
    await renderGallery({ permissions: ['catalog:read'] });
    expect(screen.getByText(/read-only: you can see the gallery but not change it/i)).toBeInTheDocument();
  });
});

describe('Attachments per language and per channel (US9, FR-078)', () => {
  async function renderAttachments(permissions?: readonly string[]): Promise<void> {
    render(wrap(<AttachmentsSection productId={PRODUCT_ID} />, permissions ? { permissions } : {}));
    await screen.findByText('Manual');
  }

  it('lists every attachment from the admin read, also one hidden in the channel the public read resolves', async () => {
    serve();
    await renderAttachments();
    expect(screen.getByText('Datasheet')).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: 'Technical sheet' })).toHaveLength(2);
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('Hidden in: B2C shop')).toBeInTheDocument();
  });

  it('edits names, descriptions and hidden channels in one PATCH of what changed', async () => {
    serve();
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Datasheet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Translations and channels: Datasheet' });

    const namePl = within(dialog).getByRole('textbox', { name: 'Name (PL)' });
    expect(namePl).toHaveValue('Karta katalogowa');
    expect(within(dialog).getByRole('textbox', { name: 'Name (DE)' })).toHaveAttribute('placeholder', 'Datasheet');
    await user.clear(namePl);
    await user.type(namePl, 'Karta produktu');
    await user.type(within(dialog).getByRole('textbox', { name: 'Description (DE)' }), 'Datenblatt');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Hide in B2C shop' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${ADMIN}/attachments/${A1}`, {
      nameTranslations: { pl: 'Karta produktu' },
      descriptionTranslations: { de: 'Datenblatt' },
      hiddenInChannels: [B2C, LEFT].sort(),
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a cleared translation is sent as "" (use the global value)', async () => {
    serve();
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Datasheet' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name (PL)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${ADMIN}/attachments/${A1}`, { nameTranslations: { pl: '' } });
  });

  it('Save with nothing changed closes without a request', async () => {
    serve();
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Manual' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Hide in B2C shop' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('a refusal stays in the dialog, named', async () => {
    serve();
    patchSpy.mockRejectedValue(
      new ApiError(422, { error: { code: 'SCOPE_INVALID', message: 'B2C shop is not a channel of the product.' } }),
    );
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Manual' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (EN)' }), 'User manual');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('B2C shop is not a channel of the product.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the inherited global name and description as visible text (D9)', async () => {
    serve();
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Manual' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: 'Name (EN)' });
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')).toHaveTextContent('Inherited: Manual');
    const description = within(dialog).getByRole('textbox', { name: 'Description (EN)' });
    expect(document.getElementById(description.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Inherited: How to use it',
    );
  });

  it('a failure that is not a refusal says nothing was saved; Escape with changes asks first (D16)', async () => {
    serve();
    patchSpy.mockRejectedValueOnce(new Error('network'));
    await renderAttachments();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Manual' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (EN)' }), 'User manual');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing was saved. Try again.');
    await user.keyboard('{Escape}');
    expect(within(dialog).getByText(/changes that are not saved/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // Final code review C-m2: deleting an attachment asks in the kit dialog, as the gallery
  // does, never in the browser's native confirm().
  it('asks in a dialog before deleting an attachment, and deletes nothing on Cancel', async () => {
    serve();
    const nativeConfirm = vi.spyOn(window, 'confirm');
    await renderAttachments();
    const user = userEvent.setup();
    const row = screen.getByText('Manual').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete attachment "Manual"?' });
    expect(dialog).toHaveTextContent('The attachment Manual is removed from this product now. The file stays in the library.');
    expect(deleteSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('deletes the attachment once the dialog is confirmed, then reloads the list', async () => {
    serve();
    const nativeConfirm = vi.spyOn(window, 'confirm');
    await renderAttachments();
    const user = userEvent.setup();
    const row = screen.getByText('Manual').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete attachment "Manual"?' });
    const listReads = getSpy.mock.calls.filter(([p]) => p === `${ADMIN}/attachments`).length;
    await user.click(within(dialog).getByRole('button', { name: 'Delete attachment' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${ADMIN}/attachments/${A2}`));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([p]) => p === `${ADMIN}/attachments`).length).toBeGreaterThan(listReads),
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('asks in Polish from the Polish bundle', async () => {
    serve();
    render(wrap(<AttachmentsSection productId={PRODUCT_ID} />, { language: 'pl' }));
    await screen.findByText('Manual');
    const user = userEvent.setup();
    const row = screen.getByText('Manual').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Usuń' }));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć załącznik „Manual”?' });
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Usuń załącznik' })).toBeInTheDocument();
  });

  it('is read-only for catalog:read — the dialog’s fields and Save are disabled', async () => {
    serve();
    await renderAttachments(['catalog:read']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Translations and channels: Datasheet' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Name (PL)' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Hide in B2B shop' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
