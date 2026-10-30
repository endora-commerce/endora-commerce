import { StrictMode, createRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 — final QA review Q-L10, owner decision UX-3 = A: the product editor's scope
 * editor speaks one vocabulary. Returning a value to the inherited one is "Use inherited"
 * / "Użyj dziedziczonego" — on the name and description overrides, in the status selects
 * of the scope controls, and in the outcome line after the page Save — and "Reset" is not
 * used ("Restore" stays the archive's).
 *
 * Rendered inside `<StrictMode>` with the catalogue's real `en` and `pl` bundles.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(() => Promise.resolve({})),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { ProductScopeEditor } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor'
);
type Handle = import('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor').ProductScopeEditorHandle;

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const PRODUCT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;

const NAME_OVERRIDE = { attributeKey: 'name', channelId: B2B, languageCode: 'de', value: { v: 'Bohrer B2B' } };

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `${PRODUCT_PATH}/scope-context`) {
      return Promise.resolve({
        data: {
          productId: PRODUCT_ID,
          channels: [{ id: B2B, code: 'b2b', name: 'B2B', languages: ['de'], isDefault: true }],
          languagesUnion: ['de'],
          primaryAdminLanguage: 'de',
          preference: { lastChannelId: B2B, lastLanguageCode: 'de' },
        },
      });
    }
    if (path === `${PRODUCT_PATH}/value-overrides`) {
      return Promise.resolve({ data: { overrides: [NAME_OVERRIDE] } });
    }
    if (path === `${PRODUCT_PATH}/scopes`) {
      return Promise.resolve({
        data: {
          global: {
            status: 'active',
            publishFrom: null,
            publishUntil: null,
            visibility: 'public',
            allowedOrganizationIds: [],
            minOrderQuantity: null,
            returnable: true,
          },
          channels: [
            {
              channelId: B2B,
              isMember: true,
              languages: ['de'],
              status: null,
              window: null,
              audience: null,
              minOrderQuantity: null,
              returnable: null,
              languageStatuses: [],
              orphaned: false,
            },
          ],
          organizations: [],
        },
      });
    }
    if (path.startsWith(`${PRODUCT_PATH}?`)) {
      return Promise.resolve({
        data: {
          id: PRODUCT_ID,
          name: { de: 'Bohrer' },
          description: {},
          resolved: {
            context: { channelId: B2B, languageCode: 'de' },
            name: 'Bohrer B2B',
            description: null,
            attributeValues: {},
            sources: { name: 'channel+language', description: 'global' },
          },
        },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function renderEditor(language: 'en' | 'pl'): React.RefObject<Handle | null> {
  const ref = createRef<Handle>();
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  const ui: ReactElement = (
    <StrictMode>
      <TranslationProvider language={language} initialBundle={{ catalog }}>
        {withSession(
          <ProductScopeEditor
            ref={ref}
            productId={PRODUCT_ID}
            baselineName={{ de: 'Bohrer' }}
            baselineDescription={{}}
            onBaselineNameChange={(): void => undefined}
            onBaselineDescriptionChange={(): void => undefined}
          />,
          { session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }) },
        )}
      </TranslationProvider>
    </StrictMode>
  );
  render(ui);
  return ref;
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  primeGets();
  patchSpy.mockResolvedValue({ data: { overrides: [], applied: { upserted: 0, deleted: 1 } } });
});
afterEach(() => cleanup());

describe('the scope editor speaks the UX-3 vocabulary (Q-L10)', () => {
  it.each([
    {
      language: 'en' as const,
      useInherited: 'Use inherited',
      statusInherit: /^Use inherited \(/,
      // Text nodes run together in `textContent`, so no trailing word boundary. The status
      // help's "until it is restored" is the archive's restore and stays.
      banned: /\breset/i,
    },
    {
      language: 'pl' as const,
      useInherited: 'Użyj dziedziczonego',
      statusInherit: /^Użyj dziedziczonego \(/,
      banned: /przywróć|resetuj|zresetuj/i,
    },
  ])('$language: "use inherited" on the override, in the status select and in the outcome', async (c) => {
    const ref = renderEditor(c.language);
    const user = userEvent.setup();

    const useInherited = await screen.findByRole('button', { name: c.useInherited });
    const statusSelect = await screen.findByRole('combobox', { name: /B2B$/ });
    expect(within(statusSelect).getByRole('option', { name: c.statusInherit })).toBeInTheDocument();

    await user.click(useInherited);
    await act(async () => {
      await ref.current!.flushOverrides();
    });
    expect(patchSpy).toHaveBeenCalledWith(`${PRODUCT_PATH}/value-overrides`, {
      upserts: [],
      deletes: [{ attributeKey: 'name', channelId: B2B, languageCode: 'de' }],
    });
    // The outcome line is shown, and neither it nor anything else says "reset".
    const bundle = (c.language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
    const outcome = bundle['productEditor.scopeEditor.applied.deleted']!.replace('{count}', '1');
    expect(await screen.findByText(outcome)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(c.banned);
  });
});
