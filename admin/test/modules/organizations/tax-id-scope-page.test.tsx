import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/177-tax-id-scope/` T042 (FR-025; `contracts/admin-surfaces.md` §4.1) —
 * the Tax-ID scope screen.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { TaxIdScopePage } = await import('../../../../packages/modules/organizations/src/admin/pages/TaxIdScopePage');

const bundle = (language: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/organizations/i18n/${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
const EN = bundle('en');
const CORE = JSON.parse(readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8')) as Record<string, string>;

type Status = {
  scope: 'global' | 'per-tree-root';
  updatedAt: string;
  updatedByAdminUserId: string | null;
  sharedTaxIdCount: number;
  enforcement: 'consistent' | 'mismatch';
};

const STATUS: Status = {
  scope: 'global',
  updatedAt: '2026-11-10T12:00:00.000Z',
  updatedByAdminUserId: null,
  sharedTaxIdCount: 0,
  enforcement: 'consistent',
};

function answer(status: Status): void {
  getSpy.mockImplementation(() => Promise.resolve({ data: status }));
}

function render(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/organizations/tax-id-scope']}>
        <TaxIdScopePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['organizations'] }),
        contributions: [],
      },
    ),
    { core: CORE, organizations: EN },
  );
}

const radio = (key: string): HTMLInputElement => screen.getByRole('radio', { name: new RegExp(EN[key]!) }) as HTMLInputElement;
const apply = (): HTMLButtonElement => screen.getByRole('button', { name: EN['taxIdScope.apply'] }) as HTMLButtonElement;

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
});

describe('Tax-ID scope page', () => {
  it('shows a loading state, then the current scope marked as current', async () => {
    let resolveGet: (value: unknown) => void = () => undefined;
    getSpy.mockImplementation(() => new Promise((r) => (resolveGet = r)));
    render();
    expect(screen.getByText(EN['taxIdScope.loading']!).closest('[aria-busy="true"]')).not.toBeNull();
    await act(async () => resolveGet({ data: STATUS }));
    const global = radio('taxIdScope.scope.global.label');
    expect(global.checked).toBe(true);
    expect(within(global.closest('label')!).getByText(EN['taxIdScope.current']!)).toBeInTheDocument();
  });

  it('keeps Apply disabled on the current scope, with a hint saying why', async () => {
    answer(STATUS);
    render();
    await screen.findByRole('radio', { name: new RegExp(EN['taxIdScope.scope.global.label']!) });
    expect(apply()).toBeDisabled();
    expect(screen.getByText(EN['taxIdScope.applyHint']!)).toBeInTheDocument();
    expect(apply().getAttribute('aria-describedby')).toBeTruthy();
  });

  it('confirms before applying, then reports success in a status region mounted beforehand', async () => {
    answer(STATUS);
    render();
    await screen.findByRole('radio', { name: new RegExp(EN['taxIdScope.scope.perTreeRoot.label']!) });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    fireEvent.click(radio('taxIdScope.scope.perTreeRoot.label'));
    expect(apply()).toBeEnabled();
    fireEvent.click(apply());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(EN['taxIdScope.confirm.body']!)).toBeInTheDocument();
    putSpy.mockResolvedValue({ data: { ...STATUS, scope: 'per-tree-root' } });
    fireEvent.click(within(dialog).getByRole('button', { name: EN['taxIdScope.confirm.submit'] }));
    await waitFor(() => expect(status).toHaveTextContent(EN['taxIdScope.success']!));
    expect(putSpy).toHaveBeenCalledWith('/api/v1/admin/organizations/tax-id-scope', { scope: 'per-tree-root' });
  });

  it('lists the shared tax IDs, linked to their organizations, when global is refused', async () => {
    answer({ ...STATUS, scope: 'per-tree-root', sharedTaxIdCount: 2 });
    render();
    await screen.findByRole('radio', { name: new RegExp(EN['taxIdScope.scope.global.label']!) });
    expect(screen.getByTestId('shared-warning')).toHaveTextContent('2');
    const examples = Array.from({ length: 2 }, (_, i) => ({
      taxId: `PL00000000${i}`,
      organizationIds: [`00000000-0000-4000-8000-00000000000${i}`],
    }));
    putSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'ORGANIZATION_TAX_ID_SCOPE_DUPLICATES',
          message: '2 tax IDs are shared.',
          details: { code: 'shared_tax_ids', sharedTaxIdCount: 2, examples },
        },
      } as never),
    );
    fireEvent.click(radio('taxIdScope.scope.global.label'));
    fireEvent.click(apply());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: EN['taxIdScope.confirm.submit'] }));
    const alert = await screen.findByTestId('duplicates-alert');
    expect(alert).toHaveTextContent('2 tax IDs are shared.');
    const links = within(alert).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(examples.map((e) => `/organizations/${e.organizationIds[0]}`));
  });

  it('says when the database does not enforce the scope, and offers to apply it again', async () => {
    answer({ ...STATUS, enforcement: 'mismatch' });
    render();
    expect(await screen.findByText(EN['taxIdScope.mismatch']!)).toBeInTheDocument();
    const again = screen.getByRole('button', { name: EN['taxIdScope.applyAgain'] });
    expect(again).toBeEnabled();
  });

  it('shows the no-permission state on 403', async () => {
    getSpy.mockRejectedValue(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'no' } } as never));
    render();
    expect(await screen.findByText(EN['taxIdScope.forbidden']!)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    answer({ ...STATUS, scope: 'per-tree-root', sharedTaxIdCount: 1 });
    const { container } = render();
    await screen.findByRole('radio', { name: new RegExp(EN['taxIdScope.scope.global.label']!) });
    await expectNoAxeViolations(container);
  });

  it('has every key it uses in both bundles', () => {
    const pl = bundle('pl');
    for (const key of Object.keys(EN).filter((k) => k.startsWith('taxIdScope.'))) {
      expect(pl[key], key).toEqual(expect.any(String));
    }
    expect(Object.keys(EN).filter((k) => k.startsWith('taxIdScope.')).length).toBeGreaterThan(10);
  });
});
