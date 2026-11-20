import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import {
  apiReferenceUrl,
  summariseApiDescription,
  type ApiDescriptionDocument,
} from '../../../../packages/admin-shell/src/modules/platform/api-description';

/**
 * `/api-description` — the kernel-served screen an administrator holding
 * `platform.api_description.read` opens from the System section or ⌘K.
 *
 * The fetch is mocked at the module boundary; the summary and the reference URL
 * are the real functions, because they are what the screen renders.
 */

let answer: () => Promise<ApiDescriptionDocument>;

vi.mock('../../../../packages/admin-shell/src/modules/platform/api-description', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../../packages/admin-shell/src/modules/platform/api-description')
    >();
  return { ...actual, getApiDescription: vi.fn(() => answer()) };
});

const { ApiDescriptionPage } = await import(
  '../../../../packages/admin-shell/src/modules/platform/ApiDescriptionPage'
);

const bundle = passthroughBundle('core', [
  'platform.apiDescription.title',
  'platform.apiDescription.reference.title',
  'platform.apiDescription.reference.body',
  'platform.apiDescription.reference.open',
  'platform.apiDescription.document.title',
  'platform.apiDescription.document.loading',
  'platform.apiDescription.document.name',
  'platform.apiDescription.document.version',
  'platform.apiDescription.document.operations',
  'platform.apiDescription.document.download',
  'platform.apiDescription.access.title',
  'platform.apiDescription.access.administrators',
  'platform.apiDescription.access.apiKeys',
]);

const DOCUMENT: ApiDescriptionDocument = {
  openapi: '3.1.0',
  info: { title: 'B2B Platform API', version: '0.100.0' },
  paths: {
    '/api/v1/catalog/products': { get: {}, post: {}, parameters: [] },
    '/api/v1/orders': { get: {} },
  },
};

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter>
      <ApiDescriptionPage />
    </MemoryRouter>,
    bundle,
  );
}

beforeEach(() => {
  answer = async () => DOCUMENT;
});

describe('summariseApiDescription', () => {
  it('counts method-and-path pairs and nothing else', () => {
    expect(summariseApiDescription(DOCUMENT)).toEqual({
      title: 'B2B Platform API',
      version: '0.100.0',
      operations: 3,
    });
  });

  it('answers an empty document with zero operations', () => {
    expect(summariseApiDescription({})).toEqual({ title: '', version: '', operations: 0 });
  });
});

describe('apiReferenceUrl', () => {
  it('points at the reference page on the API origin', () => {
    expect(apiReferenceUrl('https://api.example.com/')).toBe(
      'https://api.example.com/api/v1/_docs',
    );
  });
});

describe('ApiDescriptionPage', () => {
  it('summarises the document and links to the reference in a new tab', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('B2B Platform API')).toBeTruthy());
    expect(screen.getByText('0.100.0')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    const link = screen.getByRole('link', { name: /platform\.apiDescription\.reference\.open/ });
    expect(link.getAttribute('href')).toMatch(/\/api\/v1\/_docs$/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    const download = screen.getByRole('button', {
      name: /platform\.apiDescription\.document\.download/,
    });
    expect((download as HTMLButtonElement).disabled).toBe(false);
  });

  it('names the scope an API key needs', async () => {
    renderPage();
    expect(await screen.findByText('platform.api_description.read')).toBeTruthy();
  });

  it('shows the refusal and keeps the download disabled when the document is refused', async () => {
    answer = async () => {
      throw new ApiError(403, {
        error: { code: 'FORBIDDEN', message: 'Missing permission: platform.api_description.read.' },
      });
    };
    renderPage();

    expect(await screen.findByText(/Missing permission/)).toBeTruthy();
    const download = screen.getByRole('button', {
      name: /platform\.apiDescription\.document\.download/,
    });
    expect((download as HTMLButtonElement).disabled).toBe(true);
  });
});
