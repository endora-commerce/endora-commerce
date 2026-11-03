import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import seoPl from '../../../../packages/modules/seo/i18n/pl.json';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Feature 170 (T124; US10 #1–#3, FR-090…FR-093, `contracts/editor-ui.md` §5) — `seo`'s
 * `ProductSeoSection` in the product editor's `product.editor.seo` zone: the five SEO fields at
 * the editor scope with their source (`GET /api/v1/admin/seo/meta/product/:id`), an empty
 * field showing the derived value it falls back to, every change staged through the host's
 * `onStage` (the host's one Save writes it), read-only without `catalog:write`, and nothing
 * while `seo` is off.
 */

const get = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => get(...a), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const seo = await import('../../../../packages/modules/seo/src/admin/index');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111170';
const CH = '00000000-0000-4000-8000-00000000c0a1';
const AT_CL: ScopeRef = { level: 'channel_language', channelId: CH, languageCode: 'pl-PL' };
const REGISTRY = [{ moduleId: 'seo', contributions: seo.contributions }];

function field(value: string | null, over: Partial<ScopedFieldView<string>> = {}): ScopedFieldView<string> {
  return { value, source: 'inherited_global', levels: ['G', 'C', 'CL'], supportedHere: true, required: false, ...over };
}

const READ = {
  data: {
    scope: AT_CL,
    scoped: {
      title: field('Wiertarka | Sklep', { source: 'set', ownValue: 'Wiertarka | Sklep' }),
      description: field(null, { source: 'absent' }),
      ogTitle: field(null, { source: 'absent' }),
      ogDescription: field(null, { source: 'absent' }),
      ogImageUrl: field(null, { source: 'absent' }),
    },
    resolved: {
      title: 'Wiertarka | Sklep',
      description: 'Derived drill description',
      openGraph: { title: 'Wiertarka | Sklep', description: 'Derived drill description', image: null },
      source: 'override',
      locale: 'pl-PL',
    },
    sources: {},
  },
};

function wrap(
  options: { permissions?: readonly string[]; seo?: boolean; language?: 'en' | 'pl'; readOnly?: boolean; onStage?: (f: string, op: ScopedWriteOp<string> | undefined) => void } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const bundle = (language === 'en' ? seoEn : seoPl) as Record<string, string>;
  return (
    <StrictMode>
      <MemoryRouter>
        <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
          <TranslationProvider language={language} initialBundle={{ seo: bundle, ...shippedCoreBundle(language) }}>
            {withSession(
              <AdminZone
                name="product.editor.seo"
                props={{
                  productId: PRODUCT_ID,
                  scope: AT_CL,
                  scopeLabel: 'Retail PL × Polish',
                  parentScopeLabel: 'Retail PL',
                  view: null,
                  staged: new Map(),
                  onStage: options.onStage ?? ((): void => undefined),
                  readOnly: options.readOnly ?? false,
                  errors: {},
                }}
              />,
              {
                session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
                presence: options.seo === false ? modulePresence({ absent: ['seo'] }) : modulePresence({ present: ['seo'] }),
                contributions: REGISTRY,
              },
            )}
          </TranslationProvider>
        </AppLanguageContext.Provider>
      </MemoryRouter>
    </StrictMode>
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(READ);
});
afterEach(() => cleanup());

describe('ProductSeoSection (feature 170, US10)', () => {
  it('is the product.editor.seo member, readable with catalog:read; the 163 link is gone', () => {
    const zones = (seo.contributions.zones ?? []).filter((z) => z.zone === 'product.editor.seo');
    expect(zones).toHaveLength(1);
    expect(zones[0]!.requiredPermission).toBe('catalog:read');
  });

  it('#1 reads the SEO fields at the editor scope and shows each with its source', async () => {
    render(wrap());
    const title = await screen.findByLabelText(seoEn['productSeo.field.title']);
    expect(get).toHaveBeenCalledWith(`/api/v1/admin/seo/meta/product/${PRODUCT_ID}?channelId=${CH}&languageCode=pl-PL`);
    expect(title).toHaveValue('Wiertarka | Sklep');
    expect(title).toHaveAccessibleDescription(expect.stringContaining('Set at this scope'));
    expect(screen.getByLabelText(seoEn['productSeo.field.description'])).toHaveAccessibleDescription(
      expect.stringContaining('Derived drill description'),
    );
    expect(screen.queryByRole('link')).toBeNull();
    // The first case pays the lazy zone / editor import; under a loaded runner that exceeds 5 s.
  }, 15_000);

  it('#2 a change is staged through the host, never saved by the section', async () => {
    const onStage = vi.fn();
    render(wrap({ onStage }));
    fireEvent.change(await screen.findByLabelText(seoEn['productSeo.field.title']), { target: { value: 'Nowy' } });
    expect(onStage).toHaveBeenCalledWith('title', { op: 'set', value: 'Nowy' });
  });

  it('read-only: no checkbox and read-only controls', async () => {
    render(wrap({ readOnly: true }));
    expect(await screen.findByLabelText(seoEn['productSeo.field.title'])).toHaveAttribute('readonly');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('#3 renders nothing and reads nothing while seo is off', async () => {
    const { container } = render(wrap({ seo: false }));
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(get).not.toHaveBeenCalled();
  });

  it('a failed read shows an error with Retry', async () => {
    get.mockRejectedValue(new Error('offline'));
    render(wrap());
    const retry = await screen.findByRole('button', { name: seoEn['productSeo.retry'] });
    get.mockResolvedValue(READ);
    fireEvent.click(retry);
    expect(await screen.findByLabelText(seoEn['productSeo.field.title'])).toHaveValue('Wiertarka | Sklep');
  });

  it('renders in Polish and has no axe violations', async () => {
    const { container } = render(wrap({ language: 'pl' }));
    await screen.findByLabelText(seoPl['productSeo.field.title']);
    await expectNoAxeViolations(container);
  });
});
