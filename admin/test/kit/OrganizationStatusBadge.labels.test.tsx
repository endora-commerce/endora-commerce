import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrganizationStatus } from '@endora-commerce/contracts';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Issue #1368 — the organization status pill (the organizations list, the
 * moderation panel and every organization picker) carried hard-coded English
 * labels, so a Polish operator read "Pending" and "Blocked".
 *
 * The pill is the kit's, so its copy is `core`'s (`admin-kit-surface.md` R6:
 * the kit never resolves a module's namespace). Rendered against the shipped
 * `core` catalogue in `en` and `pl`; the Polish run uses Polish as its own
 * fallback, so a key missing from `pl.json` shows up as a raw key.
 */
const { OrganizationStatusBadge } = await import('@endora-commerce/admin-kit/components');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CORE = {
  en: read('../packages/modules/_i18n/i18n/en.json'),
  pl: read('../packages/modules/_i18n/i18n/pl.json'),
};

const STATUSES: OrganizationStatus[] = ['pending_verification', 'active', 'blocked', 'rejected'];

afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('OrganizationStatusBadge labels (%s) — issue #1368', (language) => {
  it.each(STATUSES)('labels %s from the core catalogue', (status) => {
    const label = CORE[language][`organizationStatusBadge.${status}`];
    expect(label, `core.organizationStatusBadge.${status} in ${language}.json`).toBeTruthy();

    renderWithI18n(<OrganizationStatusBadge status={status} />, { core: CORE[language] }, { language });

    expect(screen.getByText(label!)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('core.');
    expect(text).not.toContain(status);
  });

  it('gives the four statuses four different labels', () => {
    const labels = STATUSES.map((s) => CORE[language][`organizationStatusBadge.${s}`]);
    expect(new Set(labels).size).toBe(STATUSES.length);
  });
});
