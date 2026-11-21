import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — with two-step verification on, the
 * one card holds two titled sections: the recovery codes first and switching it
 * off last, so the destructive form sits away from the routine one (Fitts) and
 * each form is named by its heading (Common Region, WCAG 2.2 SC 1.3.1).
 */

let status: Record<string, unknown> = {};

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: vi.fn(async () => ({ data: status })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { default: AdminSecuritySettings } = await import('../../../../packages/modules/mfa/src/admin/pages/AdminSecuritySettings');

function bundleOf(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const path = resolve(process.cwd(), `../packages/modules/mfa/i18n/${language}.json`);
  return { ...shippedCoreBundle(language), mfa: JSON.parse(readFileSync(path, 'utf8')) as Record<string, string> };
}
const MFA_EN = JSON.parse(readFileSync(resolve(process.cwd(), '../packages/modules/mfa/i18n/en.json'), 'utf8')) as Record<string, string>;

/** The shipped English sentence for a key; a missing key fails the test rather than matching nothing. */
function en(key: string): string {
  const text = MFA_EN[key];
  if (text === undefined) throw new Error(`mfa en.json has no ${key}`);
  return text;
}

const ACTIVE = { totpActive: true, recoveryCodesRemaining: 8, totpEnabledForScope: true, canDisable: true, disableBlockedReason: null };

describe('AdminSecuritySettings — sections inside the one card (DS-03)', () => {
  it('puts the regenerate form and the disable form in two named sections, the disable one last', async () => {
    status = ACTIVE;
    const { container } = renderWithI18n(<AdminSecuritySettings />, bundleOf('en'), { language: 'en' });
    const codes = await screen.findByRole('region', { name: en('security.recoveryCodes.sectionTitle') });
    const off = screen.getByRole('region', { name: en('security.disable.sectionTitle') });
    expect(within(codes).getByRole('button', { name: en('security.regenerate.submit') })).toBeTruthy();
    expect(within(off).getByRole('button', { name: en('security.disable.submit') })).toBeTruthy();
    expect(codes.compareDocumentPosition(off) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const region of [codes, off]) expect(region.getAttribute('data-slot')).toBe('editor-section');
    // One card on the page: the sections are not cards of their own.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  });

  it('keeps the blocked notice in the switch-off section when the factor is required', async () => {
    status = { ...ACTIVE, canDisable: false, disableBlockedReason: 'factor_required' };
    renderWithI18n(<AdminSecuritySettings />, bundleOf('en'), { language: 'en' });
    const off = await screen.findByRole('region', { name: en('security.disable.sectionTitle') });
    expect(within(off).getByTestId('mfa-disable-blocked')).toBeTruthy();
  });

  it('names both sections in Polish', async () => {
    status = ACTIVE;
    renderWithI18n(<AdminSecuritySettings />, bundleOf('pl'), { language: 'pl' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Kody odzyskiwania' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Wyłączenie weryfikacji dwuetapowej' })).toBeTruthy();
  });
});
