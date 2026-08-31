import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../helpers/render-with-i18n';

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
 *
 * ## Why the bundle is the shipped one and the assertions are on **text**
 *
 * R-1 (`admin-kit-surface.md` R6, 2026-08-31) rules that a translation namespace
 * is module knowledge: these components read `core` now, not
 * `useTranslation('assets_library')`. Nothing about that failure is loud — a key
 * the bundle does not carry does not throw and does not 404, it renders
 * `core.<key>` into the operator's screen — so a `passthroughBundle` that
 * resolves every key to itself would pass whether the move happened or not, and
 * would pass equally over a typo.
 *
 * So the bundle is read off `_i18n`'s **shipped** `en.json` and every assertion
 * names the English sentence an operator would see. A key that did not travel,
 * or travelled under a different spelling, fails on the rendered string.
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

/**
 * `_i18n`'s bundle, which the admin serves under the synthetic `core` scope.
 *
 * `process.cwd()` is the `admin` workspace under vitest — the spelling
 * `admin/test/components/ScopeNotice.test.tsx` already uses to read the same
 * file, and for the same reason: `import.meta.url` is not a `file:` URL through
 * vitest's transform.
 */
const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const bundle = { core: CORE_EN };

/**
 * Every key `core` did not carry, and a sentinel in its place.
 *
 * Reading the bundle is what makes these assertions worth anything, and a
 * missing key must not take the file down at import — then nothing reports
 * *which* key. So a miss is recorded and stands in as a string no rendered
 * output can match, which reds the coverage case by name and every render case
 * that needed it.
 */
const MISSING: string[] = [];
const copy = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) {
    MISSING.push(key);
    return `«core is missing ${key}»`;
  }
  return value;
};

/** The eleven keys the two components read, as an operator sees them. */
const COPY = {
  searchPlaceholder: copy('assetPicker.searchPlaceholder'),
  empty: copy('assetPicker.empty'),
  uploadNew: copy('assetPicker.uploadNew'),
  search: copy('common.action.search'),
  close: copy('common.action.close'),
  loading: copy('common.state.loading'),
  dropAria: copy('assetPicker.upload.dropAria'),
  dropCopy: copy('assetPicker.upload.dropCopy'),
  trigger: copy('assetPicker.upload.trigger'),
  uploading: copy('assetPicker.upload.uploading'),
  wrongType: copy('assetPicker.upload.error.wrongType'),
};

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

describe('the eleven keys travelled to `core`', () => {
  it('carries every one of them in the shipped bundle', () => {
    // The move's own assertion, and the reason it names the keys: a bundle that
    // lost one renders `core.assetPicker.empty` at the operator — no throw, no
    // 404 — which a `passthroughBundle` test would sail straight past.
    expect(MISSING).toEqual([]);
    expect(Object.keys(COPY)).toHaveLength(11);
  });

  it('reads the three generic ones from `core`\'s own families, not from copies', () => {
    // R-1's remedy is a move, not a duplication: `Close`, `Loading…` and
    // `Search` are concepts `core` already names, so the picker uses those and
    // adds nothing beside them.
    expect(COPY.close).toBe(CORE_EN['common.action.close']);
    expect(COPY.loading).toBe(CORE_EN['common.state.loading']);
    expect(COPY.search).toBe(CORE_EN['common.action.search']);
  });
});

describe('AssetPicker', () => {
  it('renders its own copy out of the `core` bundle', async () => {
    getSpy.mockResolvedValue({ data: [], nextCursor: null });

    renderWithI18n(<AssetPicker onSelect={(): void => {}} onClose={(): void => {}} />, bundle);

    expect(screen.getByPlaceholderText(COPY.searchPlaceholder)).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.search })).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.close })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(COPY.empty)).toBeTruthy());
  });

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

    await userEvent.type(screen.getByPlaceholderText(COPY.searchPlaceholder), 'logo');
    await userEvent.click(screen.getByRole('button', { name: COPY.search }));

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
  it('renders its own copy out of the `core` bundle', () => {
    const { container } = renderWithI18n(
      <AssetUploader onUploaded={(): void => {}} />,
      bundle,
    );
    expect(container.querySelector(`[aria-label="${COPY.dropAria}"]`)).toBeTruthy();
    expect(screen.getByText(COPY.dropCopy)).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.trigger })).toBeTruthy();
  });

  it('names the offending type in the wrong-type message, interpolated', async () => {
    // The one key of the eleven that takes parameters. A raw-key render would
    // show `core.assetPicker.upload.error.wrongType` with no substitution, so
    // this asserts the interpolation as well as the lookup.
    const { container } = renderWithI18n(
      <AssetUploader acceptPrefix="image/" onUploaded={(): void => {}} />,
      bundle,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // `applyAccept: false` because the component's own guard is the subject:
    // user-event honours the `accept` attribute and would drop the file before
    // the handler that produces this message ever ran. A real drag-and-drop
    // reaches the same guard, `accept` being an input-picker filter and not a
    // validation.
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), {
      applyAccept: false,
    });

    const expected = COPY.wrongType
      .replace('{expected}', 'image')
      .replace('{actual}', 'text/plain');
    await waitFor(() => expect(within(container).getByText(expected)).toBeTruthy());
  });

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
