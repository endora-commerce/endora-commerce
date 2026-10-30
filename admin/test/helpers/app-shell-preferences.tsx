import { StrictMode, type ComponentType, type ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ADMIN_PREFERENCES_DEFAULTS,
  type AdminModulePresenceResponse,
  type AdminPreferences,
} from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from './render-with-session';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 164 — mounting `AppShell` for the preference tests: the **real**
 * `core` bundle and every module's own bundle in the requested language (so
 * "Pin Orders" is the name a person hears, and the Polish rendering is the
 * shipped Polish), the real session and presence providers seeded through
 * their `initial` props, and `<StrictMode>` around all of it, so the store's
 * queue and the carry-over are exercised under double mount.
 */

const repoRoot = resolve(process.cwd(), '..');

function readBundle(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const bundleCache = new Map<string, Bundle>();

/** `core` from `_i18n`, and each module's bundle under its module id. */
export function realBundle(language: 'en' | 'pl'): Bundle {
  const cached = bundleCache.get(language);
  if (cached) return cached;
  const bundle: Bundle = {
    core: readBundle(join(repoRoot, 'packages/modules/_i18n/i18n', `${language}.json`)),
  };
  const modulesDir = join(repoRoot, 'packages/modules');
  for (const dir of readdirSync(modulesDir)) {
    if (dir === '_i18n') continue;
    const file = join(modulesDir, dir, 'i18n', `${language}.json`);
    if (existsSync(file)) bundle[dir] = readBundle(file);
  }
  bundleCache.set(language, bundle);
  return bundle;
}

export function withPreferences(
  session: AdminMe,
  preferences: Partial<AdminPreferences> | undefined,
): AdminMe {
  return preferences === undefined
    ? session
    : { ...session, preferences: { ...ADMIN_PREFERENCES_DEFAULTS, ...preferences } };
}

/** The routed content: where the shell has navigated to. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

export interface RenderShellOptions {
  readonly preferences?: Partial<AdminPreferences>;
  readonly session?: AdminMe;
  readonly permissions?: readonly string[];
  readonly presence?: AdminModulePresenceResponse;
  readonly language?: 'en' | 'pl';
  readonly path?: string;
  readonly extraBundle?: Bundle;
  readonly registry?: readonly { readonly moduleId: string; readonly contributions: AdminContributions }[];
}

/** The element `renderShell` renders, for a `rerender` with other options. */
export function shellElement(AppShell: ComponentType, options: RenderShellOptions = {}): ReactElement {
  const language = options.language ?? 'en';
  const session = withPreferences(
    options.session ?? adminSession({ permissions: options.permissions ?? ['*'] }),
    options.preferences,
  );
  const base = realBundle(language);
  const bundle: Bundle = { ...base };
  for (const [scope, entries] of Object.entries(options.extraBundle ?? {})) {
    bundle[scope] = { ...(base[scope] ?? {}), ...entries };
  }
  return (
    <StrictMode>
      <TranslationProvider
        language={language}
        initialBundle={bundle}
        initialFallbackBundle={realBundle('en')}
      >
        {withSession(
          <MemoryRouter initialEntries={[options.path ?? '/']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="*" element={<LocationProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
          {
            session,
            presence: options.presence ?? modulePresence({ present: everyDeclaredModule() }),
            registry: options.registry ?? MODULE_ADMIN_CONTRIBUTIONS,
          },
        )}
      </TranslationProvider>
    </StrictMode>
  );
}

export function renderShell(AppShell: ComponentType, options: RenderShellOptions = {}): RenderResult {
  return render(shellElement(AppShell, options));
}

/** The sidebar landmark. */
export function sidebar(): HTMLElement {
  const aside = document.querySelector('aside.b2b-sidebar');
  if (!(aside instanceof HTMLElement)) throw new Error('no sidebar rendered');
  return aside;
}

/** The Pinned section, or `null` when it is not rendered. */
export function pinnedSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="sidebar-pinned"]');
}
