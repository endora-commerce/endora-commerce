import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, type RenderResult } from '@testing-library/react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import { modulePresence, withSession } from './render-with-session';

/**
 * Mount one of the price-book editor's screens at an address, the way the
 * admin mounts it (feature 161, Phase 4).
 *
 * The screens are the package's own route components, loaded through the
 * route declarations' dynamic-import factories, so a test drives what the
 * registry would; the copy is the **shipped** `core` and `price_lists` bundles,
 * read off disk, so an assertion on a sentence fails when a key is missing in
 * that language. The caller mocks `@endora-commerce/admin-kit/lib`'s
 * `apiClient` before importing this file (the screens' only transport).
 *
 * The current address is rendered into `data-testid="location"`, so a
 * navigation or a filter written to the URL is asserted as the URL.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

function shipped(path: string): Record<string, string> {
  return JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<string, string>;
}

export function bundles(language: 'en' | 'pl'): Bundle {
  return {
    core: shipped(`packages/modules/_i18n/i18n/${language}.json`),
    price_lists: shipped(`packages/modules/price_lists/i18n/${language}.json`),
  };
}

const { contributions } = await import('@endora-commerce/mod-price-lists/admin');

const ROUTES: readonly { path: string; Component: ComponentType }[] = await Promise.all(
  (contributions.routes ?? []).map(async (route) => ({
    path: route.path,
    Component: ((await route.component()) as { default: ComponentType }).default,
  })),
);

function LocationProbe(): ReactNode {
  const location = useLocation();
  return <span data-testid="location" hidden>{`${location.pathname}${location.search}`}</span>;
}

export function mountScreen(options: {
  readonly path: string;
  readonly session: AdminMe;
  readonly language?: 'en' | 'pl';
}): RenderResult {
  const language = options.language ?? 'en';
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundles(language)}>
      {withSession(<>{children}</>, {
        session: options.session,
        presence: modulePresence({ present: ['price_lists'] }),
      })}
    </TranslationProvider>
  );
  return render(
    <MemoryRouter initialEntries={[options.path]}>
      <Routes>
        {ROUTES.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
}

/** The address the screen is at now. */
export function currentLocation(): string {
  return screen.getByTestId('location').textContent ?? '';
}

/** The query parameters of the current address. */
export function currentParams(): URLSearchParams {
  const location = currentLocation();
  return new URLSearchParams(location.includes('?') ? location.slice(location.indexOf('?') + 1) : '');
}

/**
 * The view's filled primary actions (Von Restorff: one per view). A primary
 * action is the kit button's default variant, whichever element carries it.
 */
export function primaryActions(container: HTMLElement): HTMLElement[] {
  // What a hidden tab panel holds is not in the view.
  return [...container.querySelectorAll<HTMLElement>('button, a')].filter((element) =>
    element.closest('[hidden]') === null &&
    /(^|\s)bg-primary(\s|$)/.test(element.className) && element.className.includes('text-primary-foreground'),
  );
}

/** An API error envelope as the kit's client raises it. */
export async function apiError(status: number, code: string, message: string, details?: unknown): Promise<Error> {
  const { ApiError } = await import('@endora-commerce/admin-kit/lib');
  return new ApiError(status, { error: { code, message, ...(details === undefined ? {} : { details }) } } as never);
}

const BASE_PANEL = (contributions.zones ?? []).find((zone) => zone.zone === 'product.editor.pricing.after')!;
const BasePanel = ((await BASE_PANEL.component()) as { default: ComponentType<{ productId: string }> }).default;

/**
 * The product editor's Pricing tab as the base-price panel meets it: the
 * host's tab strip (a *Details* tab, the *Pricing* tab selected) and the
 * panel mounted in the tab body, as `ProductEditor.tsx` mounts the zone.
 */
export function mountBasePricePanel(options: {
  readonly productId: string;
  readonly session: AdminMe;
  readonly language?: 'en' | 'pl';
  readonly onHostTab?: () => void;
}): RenderResult {
  const language = options.language ?? 'en';
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundles(language)}>
      {withSession(<>{children}</>, { session: options.session, presence: modulePresence({ present: ['price_lists'] }) })}
    </TranslationProvider>
  );
  return render(
    <MemoryRouter initialEntries={[`/catalog/products/${options.productId}`]}>
      <div role="tablist" aria-label="Product">
        <button type="button" role="tab" aria-selected="false" onClick={options.onHostTab}>
          Details
        </button>
        <button type="button" role="tab" aria-selected="true">
          Pricing
        </button>
      </div>
      <div role="tabpanel" aria-label="Pricing">
        <BasePanel productId={options.productId} />
      </div>
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
}
