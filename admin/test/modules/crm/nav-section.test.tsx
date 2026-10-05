import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import type { AdminContributions } from '@endora-commerce/contracts';
import { AdminNavSectionNameSchema } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  everyDeclaredPermission,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * The host's "CRM" sidebar section (`specs/143-crm-sales-opportunities/`,
 * research R-19 — owner ruling of 2026-10-05).
 *
 * The section is the **shell's**: a module may not invent one (D-23), so the
 * enum member, the `NAV` row and the heading's translation are host changes and
 * this file is their proof. It is driven with a contribution declared here
 * rather than with the `crm` package's own, deliberately — the subject is the
 * section, and it has to hold before the module ships its first screen.
 *
 * The heading is asserted against the **shipped** bundles, read from
 * `packages/modules/_i18n/i18n/`, so "labelled CRM" is a statement about what
 * an operator reads and not about a key echoing itself.
 */

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../../packages/admin-shell/src/components/AppShell');

function shippedCoreBundle(language: 'en' | 'pl'): Record<string, string> {
  const path = resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const CRM_ROUTE = '/crm/opportunities';

/** One sidebar entry in the `crm` section, as the module will declare it. */
const crmContribution = {
  moduleId: 'crm',
  contributions: {
    routes: [],
    nav: [
      {
        to: CRM_ROUTE,
        labelKey: 'nav.opportunities.label',
        icon: 'CircleDollarSign',
        section: 'crm',
        weight: 100,
        requiredPermission: 'crm:read',
      },
    ],
  } as unknown as AdminContributions,
};

function renderShell(options: { crmPresent: boolean; permissions: readonly string[] }): RenderResult {
  setMobileViewport(false);
  const present = [...everyDeclaredModule(), ...(options.crmPresent ? ['crm'] : [])];
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present }),
        registry: [...MODULE_ADMIN_CONTRIBUTIONS, crmContribution],
      },
    ),
    { core: shippedCoreBundle('en'), crm: { 'nav.opportunities.label': 'Opportunities' } },
  );
}

function sectionHeadings(): string[] {
  return [...document.querySelectorAll('.b2b-sidebar__group-label')].map(
    (heading) => heading.textContent?.trim() ?? '',
  );
}

function hrefsUnder(heading: string): (string | null)[] {
  const label = [...document.querySelectorAll('.b2b-sidebar__group-label')].find(
    (candidate) => candidate.textContent?.trim() === heading,
  );
  expect(label).toBeDefined();
  const group = (label as Element).closest('.b2b-sidebar__group');
  expect(group).not.toBeNull();
  return [...(group as Element).querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

const everyPermission = [...everyDeclaredPermission(), 'orders:read', 'crm:read'];

describe('the host declares a "CRM" sidebar section', () => {
  it('is a section a module may join', () => {
    expect(AdminNavSectionNameSchema.options).toContain('crm');
  });

  it('is labelled "CRM" in both shipped languages', () => {
    expect(shippedCoreBundle('en')['appShell.section.crm']).toBe('CRM');
    expect(shippedCoreBundle('pl')['appShell.section.crm']).toBe('CRM');
  });

  it('renders a contribution with section "crm" under the CRM heading, placed directly after Sales', () => {
    renderShell({ crmPresent: true, permissions: everyPermission });
    const headings = sectionHeadings();
    // The positive control for the ordering claim: Sales is on screen.
    expect(headings).toContain('Sales');
    expect(headings).toContain('CRM');
    expect(headings.indexOf('CRM')).toBe(headings.indexOf('Sales') + 1);
    expect(hrefsUnder('CRM')).toEqual([CRM_ROUTE]);
  });

  it('renders no heading while the contributing module is switched off', () => {
    renderShell({ crmPresent: false, permissions: everyPermission });
    expect(sectionHeadings()).toContain('Sales');
    expect(sectionHeadings()).not.toContain('CRM');
  });

  it('renders no heading for an operator who may see none of its entries', () => {
    renderShell({
      crmPresent: true,
      permissions: everyPermission.filter((code) => code !== 'crm:read'),
    });
    expect(sectionHeadings()).toContain('Sales');
    expect(sectionHeadings()).not.toContain('CRM');
  });
});
