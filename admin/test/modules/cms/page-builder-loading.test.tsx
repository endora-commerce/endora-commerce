import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { PageBuilderEditor } from '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { editorDescriptor, shippedBundles } from './page-builder-editor-harness';

/**
 * Issue #1540 (UX audit 2026-11-17, CONTENT-23) — while the CMS page builder
 * reads its block descriptor it shows a skeleton of the three-pane builder, in
 * a polite, `aria-busy` status region, where it used to show a grey sentence
 * above an empty 640 px bordered box. Puck mounts only once the config is
 * known, so a block never flashes as its fallback first.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

const EMPTY = { root: { props: {} }, content: [] };

function mount(language: 'en' | 'pl' = 'en'): HTMLElement {
  return render(
    <StrictMode>
      <TranslationProvider language={language} initialBundle={shippedBundles(language)}>
        {withSession(<PageBuilderEditor data={EMPTY} contentKey="pbl1540" onChange={(): void => undefined} />, {
          session: adminSession({ permissions: ['*'], preferredLanguage: language }),
          presence: modulePresence({ present: ['cms', 'catalog', 'blog', 'newsletter'] }),
        })}
      </TranslationProvider>
    </StrictMode>,
  ).container;
}

describe('PageBuilderEditor loading (#1540)', () => {
  it('shows the builder skeleton, not a sentence, while the config loads', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const config = new Promise((settle) => {
      answer = settle;
    });
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/admin/cms/page-builder/config')) return config;
      return { data: [] };
    });
    const container = mount();

    const region = screen.getByText('Loading the page builder…').closest('[role="status"]')!;
    expect(region.getAttribute('data-slot')).toBe('page-builder-skeleton');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.cms-page-builder__canvas')).toBeNull();
    expect(container.textContent).not.toContain('Loading Page Builder config');

    answer({ data: editorDescriptor() });
    await waitFor(() => expect(container.querySelector('.cms-page-builder__canvas')).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(container.querySelector('[data-slot="page-builder-skeleton"]')).toBeNull();
  });

  it('says it in Polish', () => {
    vi.mocked(apiClient.get).mockImplementation(() => new Promise(() => undefined));
    mount('pl');
    expect(screen.getByText('Wczytywanie kreatora stron…').closest('[data-slot="page-builder-skeleton"]')).not.toBeNull();
  });

  it('keeps the degraded canvas, not the skeleton, when the config fails', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/admin/cms/page-builder/config')) throw new Error('config down');
      return { data: [] };
    });
    const container = mount();
    await screen.findByText('config down');
    expect(container.querySelector('[data-slot="page-builder-skeleton"]')).toBeNull();
    expect(container.querySelector('.cms-page-builder__canvas')).not.toBeNull();
  });
});
