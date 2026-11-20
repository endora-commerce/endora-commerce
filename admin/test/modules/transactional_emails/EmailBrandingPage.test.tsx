import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { EmailBranding, PutEmailBrandingRequest } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import en from '../../../../packages/modules/transactional_emails/i18n/en.json';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import { contributions } from '../../../../packages/modules/transactional_emails/src/admin/index';
import { manifest } from '../../../../packages/modules/transactional_emails/src/manifest';

/**
 * Issue #1466 (UX audit CONTENT-08) — the e-mail branding screen.
 *
 * The branding service, its API and the `EmailLogo` block that reads it shipped
 * in feature 047; the panel to set them was imported by nothing, so the logo and
 * accent colour could not be reached. What is pinned here: the screen is
 * reachable (route, sidebar, palette — Principle XVI), it has one Save that
 * sends only what changed, and its edge states (read-only, no permission, load
 * failure, an unsaved scope switch) exist.
 */

const CHANNEL = { id: '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34', code: 'b2b-pl', name: { 'pl-PL': 'Hurt PL' } };
let permissions = ['transactional_emails:read', 'transactional_emails:write'];
const brandingFor = new Map<string | null, EmailBranding>();
const branding = vi.fn(async (salesChannelId: string | null): Promise<EmailBranding> => {
  const value = brandingFor.get(salesChannelId);
  if (!value) throw new Error('not found');
  return value;
});
const putBranding = vi.fn(
  async (salesChannelId: string | null, body: PutEmailBrandingRequest): Promise<EmailBranding> => {
    const current = brandingFor.get(salesChannelId)!;
    return {
      ...current,
      logoAssetId: body.logoAssetId ?? current.logoAssetId,
      accentColor: body.accentColor ?? current.accentColor,
    };
  },
);

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    useAuth: () => ({ hasPermission: (code: string) => permissions.includes(code) }),
    apiClient: { ...actual.apiClient, get: async () => ({ items: [CHANNEL] }) },
  };
});

vi.mock('../../../../packages/modules/transactional_emails/src/admin/api/transactional-emails-client', () => ({
  transactionalEmailsClient: {
    branding: (id: string | null) => branding(id),
    putBranding: (id: string | null, body: PutEmailBrandingRequest) => putBranding(id, body),
  },
}));

const { EmailBrandingPage } = await import(
  '../../../../packages/modules/transactional_emails/src/admin/pages/EmailBrandingPage'
);

function resolved(patch: Partial<EmailBranding>): EmailBranding {
  return {
    salesChannelId: null,
    logoAssetId: '',
    logoUrl: '',
    accentColor: '#1f2937',
    headerBlockCode: 'default_email_header',
    footerBlockCode: 'default_email_footer',
    source: 'global',
    ...patch,
  };
}

async function renderPage(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <EmailBrandingPage />
    </MemoryRouter>,
    { transactional_emails: en, core },
  );
}

const saveButton = (): HTMLElement => screen.getByRole('button', { name: core['common.action.save'] });

async function pickAccent(hex: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: en['branding.accent'] }));
  await userEvent.click(screen.getByRole('button', { name: hex }));
}

beforeEach(() => {
  permissions = ['transactional_emails:read', 'transactional_emails:write'];
  brandingFor.clear();
  brandingFor.set(null, resolved({}));
  brandingFor.set(CHANNEL.id, resolved({ salesChannelId: CHANNEL.id, source: 'channel' }));
  branding.mockClear();
  putBranding.mockClear();
});

describe('reachability (Principle XVI)', () => {
  it('declares the route, a sidebar entry and a palette action for /transactional-emails/branding', () => {
    const path = '/transactional-emails/branding';
    const route = contributions.routes?.find((r) => r.path === path);
    expect(route?.requiredPermission).toBe('transactional_emails:read');
    expect(contributions.nav?.some((n) => n.to === path && n.labelKey === 'nav.emailBranding.label')).toBe(true);
    const action = manifest.actions?.find((a) => a.targetRoute === path);
    expect(action?.requiredPermission).toBe('transactional_emails:read');
    expect(en[action!.labelKey as keyof typeof en]).toBe('Email branding');
  });
});

describe('EmailBrandingPage', () => {
  it('shows the logo and accent fields, with Save disabled until something changes', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: en['branding.title'] })).toBeTruthy();
    expect(await screen.findByRole('group', { name: en['branding.logo'] })).toBeTruthy();
    expect(screen.getByRole('group', { name: en['branding.accent'] })).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves only the field that changed, for the scope in view, and confirms it', async () => {
    await renderPage();
    await pickAccent('#ea580c');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(saveButton());
    await waitFor(() => expect(putBranding).toHaveBeenCalledTimes(1));
    expect(putBranding).toHaveBeenCalledWith(null, { accentColor: '#ea580c' });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', en['branding.saved']);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  // Issue #1499 (UX audit SALES-17, DEC-12 a): "Saved" is said beside Save, in
  // one always-mounted region, and not again in a success banner under the header.
  it('says "Saved" beside the Save button, with no success banner', async () => {
    await renderPage();
    await screen.findByRole('group', { name: en['branding.accent'] });
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(region.parentElement?.contains(saveButton())).toBe(true);
    await pickAccent('#ea580c');
    await userEvent.click(saveButton());
    await waitFor(() => expect(region).toHaveTextContent(en['branding.saved']));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('asks before switching scope with unsaved edits; Stay keeps them, Discard switches', async () => {
    await renderPage();
    await pickAccent('#ea580c');
    const scope = await screen.findByRole('combobox', { name: en['editor.scope'] });
    await screen.findByRole('option', { name: 'Hurt PL' });

    await userEvent.selectOptions(scope, CHANNEL.id);
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en['branding.switchScope.stay'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(branding).not.toHaveBeenCalledWith(CHANNEL.id);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

    await userEvent.selectOptions(scope, CHANNEL.id);
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en['branding.switchScope.discard'] }));
    await waitFor(() => expect(branding).toHaveBeenCalledWith(CHANNEL.id));
    expect(putBranding).not.toHaveBeenCalled();
  });

  it('"Save and switch" writes the current scope, then loads the next one', async () => {
    await renderPage();
    await pickAccent('#ea580c');
    const scope = await screen.findByRole('combobox', { name: en['editor.scope'] });
    await screen.findByRole('option', { name: 'Hurt PL' });
    await userEvent.selectOptions(scope, CHANNEL.id);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en['branding.switchScope.save'] }));
    await waitFor(() => expect(branding).toHaveBeenCalledWith(CHANNEL.id));
    expect(putBranding).toHaveBeenCalledWith(null, { accentColor: '#ea580c' });
  });

  it('is read-only without the write permission: no Save, disabled controls, and it says why', async () => {
    permissions = ['transactional_emails:read'];
    await renderPage();
    expect(await screen.findByText(en['branding.readOnly'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: core['common.action.save'] })).toBeNull();
    expect((await screen.findByRole('button', { name: en['branding.accent'] }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('explains a missing read permission instead of rendering the form', async () => {
    permissions = [];
    await renderPage();
    expect(screen.getByText(en['branding.noPermission'])).toBeTruthy();
    expect(branding).not.toHaveBeenCalled();
  });

  it('offers a retry when the branding cannot be loaded', async () => {
    brandingFor.delete(null);
    await renderPage();
    expect(await screen.findByText(en['branding.loadError'], { exact: false })).toBeTruthy();
    brandingFor.set(null, resolved({}));
    await userEvent.click(screen.getByRole('button', { name: core['common.action.retry'] }));
    expect(await screen.findByRole('group', { name: en['branding.logo'] })).toBeTruthy();
  });
});
