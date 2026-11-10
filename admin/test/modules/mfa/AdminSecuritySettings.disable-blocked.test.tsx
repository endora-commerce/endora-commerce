import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #935 — the admin's own security screen renders the disable control
 * from the server's verdict. While the factor is the account's last one and a
 * setting or the admin's role requires it, the control is not offered and the
 * screen says why, instead of letting the click discover the refusal.
 */

let status: Record<string, unknown> = {};

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: status })),
      post: vi.fn(),
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
  return { mfa: JSON.parse(readFileSync(path, 'utf8')) as Record<string, string> };
}

const ACTIVE = { totpActive: true, recoveryCodesRemaining: 8, totpEnabledForScope: true, socialLinks: [] };

describe('AdminSecuritySettings — switching the last factor off (issue #935)', () => {
  beforeEach(() => {
    status = {};
  });

  it('offers the disable control when the server allows it', async () => {
    status = { ...ACTIVE, totpEnforcedForScope: false, canDisable: true, disableBlockedReason: null };
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'));
    expect(await screen.findByRole('button', { name: 'Disable two-step verification' })).toBeTruthy();
    expect(screen.queryByTestId('mfa-disable-blocked')).toBeNull();
  });

  it('hides the control and explains why while a requirement keeps the last factor', async () => {
    status = { ...ACTIVE, totpEnforcedForScope: true, canDisable: false, disableBlockedReason: 'factor_required' };
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'));
    const notice = await screen.findByTestId('mfa-disable-blocked');
    expect(notice.textContent).toContain('Two-step verification is required');
    expect(notice.textContent).toContain('security setting or your role');
    expect(screen.queryByRole('button', { name: 'Disable two-step verification' })).toBeNull();
    // Regenerating recovery codes keeps the factor, so it stays on offer.
    expect(screen.getByRole('button', { name: 'Regenerate recovery codes' })).toBeTruthy();
  });

  it('explains it in Polish too', async () => {
    status = { ...ACTIVE, totpEnforcedForScope: true, canDisable: false, disableBlockedReason: 'factor_required' };
    renderWithI18n(<AdminSecuritySettings />, bundleOf('pl'), { language: 'pl' });
    const notice = await screen.findByTestId('mfa-disable-blocked');
    expect(notice.textContent).toContain('Weryfikacja dwuetapowa jest wymagana');
  });
});
