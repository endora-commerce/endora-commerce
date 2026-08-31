import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

/**
 * The asset cluster builds its **own** requests (feature 091, P4c).
 *
 * `AssetPicker`, `AssetUploader` and `AssetFieldPicker` stayed in `admin/src`
 * through Phase 1b and through P2, on the reading that `AssetFieldPicker`'s
 * module knowledge was a *component* — `assets_library`' own `AssetPicker` —
 * and so had no request to rebuild. `admin-component-contribution.md` Z1.1
 * measured that one level deeper and found the same P2 shape: `AssetPicker`
 * calls one `GET`, `AssetUploader` posts multipart over `apiBaseUrl`, and every
 * type all three name (`AssetSummary`, `AssetDetail`, `ListAssetsResponse`) is
 * already `@endora-commerce/contracts`'.
 *
 * So the tests here assert the **request**, exactly as `kit-pickers.test.tsx`
 * does for the three P2 pickers: there is no admin client left to spy on, and
 * the URL is the whole of what these components know about the module whose
 * data they show.
 *
 * The mock is keyed on `@endora-commerce/admin-kit/lib` — the barrel the moved
 * components import `apiClient` and `apiBaseUrl` from — because `vi.mock` keys
 * on a resolved module id and a component importing `../../lib/api-client.js`
 * from inside the package resolves to a module this mock does not name.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { AssetFieldPicker, AssetPicker, AssetUploader } = await import(
  '@endora-commerce/admin-kit/components'
);

const bundle = passthroughBundle('assets_library', [
  'picker.searchPlaceholder',
  'picker.empty',
  'picker.uploadNew',
  'common.search',
  'common.close',
  'common.loading',
  'uploader.dropAria',
  'uploader.dropCopy',
  'uploader.trigger',
  'uploader.uploading',
  'uploader.error.wrongType',
]);

const IMAGE = {
  id: 'a-1',
  folderId: null,
  filename: 'logo.png',
  label: 'Logo',
  mimeType: 'image/png',
  sizeBytes: 10,
  visibility: 'public',
  storageBackend: 'local',
  url: '/assets/file/a-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  pendingCleanup: false,
};

beforeEach(() => {
  getSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AssetPicker', () => {
  it('asks the assets list endpoint itself, with the picker page size', async () => {
    getSpy.mockResolvedValue({ data: [IMAGE], nextCursor: null });

    renderWithI18n(<AssetPicker onSelect={(): void => {}} />, bundle);

    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(getSpy.mock.calls[0]?.[0]).toBe('/api/v1/admin/assets?limit=24');
  });

  it('carries the MIME filter and the search term into the query string', async () => {
    getSpy.mockResolvedValue({ data: [], nextCursor: null });

    renderWithI18n(
      <AssetPicker acceptMimePrefix="image/" onSelect={(): void => {}} />,
      bundle,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(getSpy.mock.calls[0]?.[0]).toBe('/api/v1/admin/assets?mime=image%2F&limit=24');

    await userEvent.type(
      screen.getByPlaceholderText('picker.searchPlaceholder'),
      'logo',
    );
    await userEvent.click(screen.getByRole('button', { name: 'common.search' }));

    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(1));
    expect(getSpy.mock.calls.at(-1)?.[0]).toBe(
      '/api/v1/admin/assets?q=logo&mime=image%2F&limit=24',
    );
  });

  it('hands the chosen asset back to the caller', async () => {
    getSpy.mockResolvedValue({ data: [IMAGE], nextCursor: null });
    const onSelect = vi.fn();

    renderWithI18n(<AssetPicker onSelect={onSelect} />, bundle);

    await waitFor(() => expect(screen.getByTitle('logo.png')).toBeTruthy());
    await userEvent.click(screen.getByTitle('logo.png'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }));
  });
});

describe('AssetFieldPicker', () => {
  it('resolves an existing id through the single-asset endpoint it builds', async () => {
    getSpy.mockResolvedValue({ data: IMAGE });

    renderWithI18n(
      <AssetFieldPicker value="a-1" onChange={(): void => {}} />,
      bundle,
    );

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/assets/a-1'));
    await waitFor(() =>
      expect(screen.getByLabelText('Selected asset').getAttribute('value')).toBe('Logo'),
    );
  });

  it('asks for nothing when there is no value yet', () => {
    renderWithI18n(<AssetFieldPicker value="" onChange={(): void => {}} />, bundle);
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('AssetUploader', () => {
  it('posts multipart to the assets endpoint on the published API origin', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: IMAGE }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onUploaded = vi.fn();

    const { container } = renderWithI18n(
      <AssetUploader acceptPrefix="image/" onUploaded={onUploaded} />,
      bundle,
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    await userEvent.upload(
      input as HTMLInputElement,
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/api/v1/admin/assets')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());

    vi.unstubAllGlobals();
  });
});
