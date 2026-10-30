import { StrictMode, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import seoPl from '../../../../packages/modules/seo/i18n/pl.json';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 — owner decision "SEO stub = A" (2026-10-26): the product editor's SEO tab
 * no longer carries the "Page title (preview)" input that saved nothing. Below the URL
 * keys it links to the SEO screen, where the meta tags are edited per channel and
 * language — only while `seo` is present and the admin holds the code that screen's
 * routes enforce (`catalog:write`, the `open-seo` action's own gate). The link opens the
 * SEO screen with this product selected (owner decision UX-4 = A).
 *
 * The link is `seo`'s contribution to `product.editor.seo.after`, so `catalog` never
 * names `seo` (`check:admin-zones`' `foreign-module-id`): the zone renderer's presence
 * and permission filters are what hide it.
 */

const seo = await import('../../../../packages/modules/seo/src/admin/index');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111163';
const REGISTRY = [{ moduleId: 'seo', contributions: seo.contributions }];

function wrap(
  options: { permissions?: readonly string[]; seo?: boolean; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const bundle = (language === 'en' ? seoEn : seoPl) as Record<string, string>;
  return (
    <StrictMode>
      <MemoryRouter>
        <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
          <TranslationProvider language={language} initialBundle={{ seo: bundle }}>
            {withSession(<AdminZone name="product.editor.seo.after" props={{ productId: PRODUCT_ID }} />, {
              session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
              presence: options.seo === false ? modulePresence({ absent: ['seo'] }) : modulePresence({ present: ['seo'] }),
              contributions: REGISTRY,
            })}
          </TranslationProvider>
        </AppLanguageContext.Provider>
      </MemoryRouter>
    </StrictMode>
  );
}

afterEach(() => cleanup());

describe('seo contributes the product editor SEO link (owner decision SEO stub = A)', () => {
  it('declares the member with the SEO screen’s code and no match', () => {
    const zone = (seo.contributions.zones ?? []).find((z) => z.zone === 'product.editor.seo.after');
    expect(zone).toBeDefined();
    expect(zone!.match).toBeUndefined();
    expect(zone!.requiredPermission).toBe('catalog:write');
  });

  it('links to the SEO screen with this product selected (UX-4 = A)', async () => {
    render(wrap());
    const link = await screen.findByRole('link', { name: 'Edit SEO meta per channel →' });
    expect(link).toHaveAttribute('href', `/seo?entityType=product&entityId=${PRODUCT_ID}`);
    expect(screen.queryByText(/pick this product/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Page title (preview)')).not.toBeInTheDocument();
  });

  it('renders nothing while seo is off', async () => {
    const { container } = render(wrap({ seo: false }));
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing without the SEO screen’s permission', async () => {
    const { container } = render(wrap({ permissions: ['catalog:read'] }));
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders in Polish from the pl bundle', async () => {
    render(wrap({ language: 'pl' }));
    expect(await screen.findByRole('link', { name: 'Edytuj meta SEO w kanałach →' })).toBeInTheDocument();
  });
});
