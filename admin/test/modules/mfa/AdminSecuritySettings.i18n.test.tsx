import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Issue #1481 (UX audit 2026-11-17, SHELL-05) — the admin's own two-step
 * verification screen.
 *
 * - every string comes from the `mfa` bundle, so a Polish-speaking operator
 *   sets up their second factor in Polish;
 * - the page has a heading (`PageHeader`'s `h1`), as every other screen does;
 * - the *disable* and *regenerate* forms own one code each — typing in one
 *   used to fill the other, because both were bound to one state;
 * - a refused code is reported on the field that sent it, not in a banner
 *   above both forms.
 */

const { ApiError } = await import('@endora-commerce/admin-kit/lib');

let status: Record<string, unknown> = {};
const post = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: status })),
      post: (...args: unknown[]) => post(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { default: AdminSecuritySettings } = await import(
  '../../../../packages/modules/mfa/src/admin/pages/AdminSecuritySettings'
);

function bundleOf(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const path = resolve(process.cwd(), `../packages/modules/mfa/i18n/${language}.json`);
  return {
    ...shippedCoreBundle(language),
    mfa: JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>,
  };
}

const ACTIVE = {
  totpActive: true,
  recoveryCodesRemaining: 8,
  totpEnabledForScope: true,
  canDisable: true,
  disableBlockedReason: null,
};
const INACTIVE = { ...ACTIVE, totpActive: false, recoveryCodesRemaining: 0 };

function refusal(message: string): InstanceType<typeof ApiError> {
  return new ApiError(403, { error: { code: 'MFA_INVALID_CODE', message } });
}

describe('AdminSecuritySettings — copy, heading and per-form state (issue #1481)', () => {
  beforeEach(() => {
    status = {};
    post.mockReset();
  });

  it('titles the panel with an h2 under the Profile\'s h1 (issue #1519) and words it in Polish', async () => {
    status = ACTIVE;
    renderWithI18n(<AdminSecuritySettings />, bundleOf('pl'), { language: 'pl' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Weryfikacja dwuetapowa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyłącz weryfikację dwuetapową' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wygeneruj nowe kody odzyskiwania' })).toBeTruthy();
    expect(screen.getByText(/Niewykorzystane kody odzyskiwania: 8/)).toBeTruthy();
    // Not one English sentence left on the Polish screen.
    expect(document.body.textContent).not.toMatch(/Two-step|recovery codes|Enter a current code/);
  });

  it('words the enable step in Polish', async () => {
    status = INACTIVE;
    post.mockResolvedValueOnce({ data: { secret: 'ABC', otpauthUri: 'otpauth://x', qrSvg: '<svg/>' } });
    renderWithI18n(<AdminSecuritySettings />, bundleOf('pl'), { language: 'pl' });
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz weryfikację dwuetapową' }));
    const field = await screen.findByLabelText(/Wpisz 6-cyfrowy kod/);
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByRole('button', { name: 'Potwierdź i włącz' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Manual key|Add this account|Confirm and enable/);
  });

  it('keeps the disable and the regenerate code apart', async () => {
    status = ACTIVE;
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'));
    const disableCode = (await screen.findByLabelText(/to disable two-step verification/)) as HTMLInputElement;
    const regenerateCode = screen.getByLabelText(/to regenerate recovery codes/) as HTMLInputElement;
    fireEvent.change(disableCode, { target: { value: '111111' } });
    expect(disableCode.value).toBe('111111');
    expect(regenerateCode.value).toBe('');
    fireEvent.change(regenerateCode, { target: { value: '222222' } });
    expect(disableCode.value).toBe('111111');
    expect(regenerateCode.value).toBe('222222');
    for (const field of [disableCode, regenerateCode]) {
      expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    }
  });

  it('sends each form its own code', async () => {
    status = ACTIVE;
    post.mockResolvedValue({ data: { recoveryCodes: ['AAAA'] } });
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'));
    const disableCode = await screen.findByLabelText(/to disable two-step verification/);
    const regenerateCode = screen.getByLabelText(/to regenerate recovery codes/);
    fireEvent.change(disableCode, { target: { value: '111111' } });
    fireEvent.change(regenerateCode, { target: { value: '222222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/api/v1/admin/account/mfa/recovery-codes/regenerate', { code: '222222' });
  });

  it('reports a refused code on the field that sent it', async () => {
    status = ACTIVE;
    post.mockRejectedValueOnce(refusal('That code was not accepted.'));
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'));
    const disableCode = await screen.findByLabelText(/to disable two-step verification/);
    const regenerateCode = screen.getByLabelText(/to regenerate recovery codes/);
    fireEvent.change(regenerateCode, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    await waitFor(() => expect(regenerateCode.getAttribute('aria-invalid')).toBe('true'));
    const describedBy = regenerateCode.getAttribute('aria-describedby') ?? '';
    const description = describedBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(description).toContain('That code was not accepted.');
    expect(disableCode.getAttribute('aria-invalid')).toBeNull();
  });

  it('falls back to a translated sentence when the failure carries none', async () => {
    status = INACTIVE;
    post.mockRejectedValueOnce(new Error('network down'));
    renderWithI18n(<AdminSecuritySettings />, bundleOf('pl'), { language: 'pl' });
    fireEvent.click(await screen.findByRole('button', { name: 'Włącz weryfikację dwuetapową' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Coś poszło nie tak. Spróbuj ponownie.')).toBeTruthy();
  });
});
