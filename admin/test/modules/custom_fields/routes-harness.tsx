import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { createMemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';

/**
 * Issue #1804 — `/custom-fields` is three routes: the list, `/new` and `/:id`,
 * the definition editor on its own page. The suites mount all three in a
 * **data** router, as `AdminRoot` does, so the editor's unsaved-changes guard
 * sees Back / Forward too, and every flow walks the screens the way an
 * operator does: *New field* or a row's *Edit* to the editor, a save back to
 * the list.
 *
 * The page components are passed in rather than imported here, so each suite
 * imports them after its own `vi.mock` of the API client.
 */

export interface CustomFieldsScreens {
  CustomFieldsPage: ComponentType;
  CustomFieldEditorPage: ComponentType;
}

export interface RenderRoutesOptions {
  /** The history the router starts with; the last entry is the current one. Default: the list. */
  initialEntries?: string[];
  permissions?: string[];
  bundle?: Bundle;
  language?: SupportedAdminLanguage;
}

/** Where the router is — the list page names no record, so a test reads the address here. */
function Where(): ReactNode {
  const location = useLocation();
  return (
    <p hidden data-testid="where">
      {location.pathname + location.search}
    </p>
  );
}

export function renderCustomFieldsRoutes(
  screens: CustomFieldsScreens,
  {
    initialEntries = ['/custom-fields'],
    permissions = ['custom_fields:read', 'custom_fields:write'],
    bundle = {},
    language = 'en',
  }: RenderRoutesOptions = {},
): ReturnType<typeof createMemoryRouter> {
  const { CustomFieldsPage, CustomFieldEditorPage } = screens;
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <Where />
            <Routes>
              <Route path="/custom-fields" element={<CustomFieldsPage />} />
              <Route path="/custom-fields/new" element={<CustomFieldEditorPage />} />
              <Route path="/custom-fields/:id" element={<CustomFieldEditorPage />} />
              <Route path="*" element={<p>elsewhere</p>} />
            </Routes>
          </>
        ),
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  renderWithI18n(
    <StrictMode>
      <AuthProvider initial={adminSession({ permissions })}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
    bundle,
    { language },
  );
  return router;
}

/** The router's current address, path and query. */
export function currentAddress(): string {
  return screen.getByTestId('where').textContent ?? '';
}

/** The editor page's form, named by its title ("New field", "Edit region"). */
export function findEditor(title: string): Promise<HTMLElement> {
  return screen.findByRole('form', { name: title });
}
