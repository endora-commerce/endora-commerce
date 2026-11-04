import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScopeRef } from '@endora-commerce/contracts';
import axe from 'axe-core';
import {
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 170 (T134, SC-013) — axe-core over the product editor at Global, Channel and
 * Channel × language, read-only, with field errors and with the copy dialog open: 0 violations.
 *
 * jsdom computes no colours, so axe's `color-contrast` rule is off in the shared helper. The
 * muted text the editor adds (source lines, notes, read-only and inherited controls) is checked
 * here from the theme's tokens instead, in the light and the dark theme: text on the field
 * background, on the sunken read-only control and on the page.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const URL_G = `/catalog/products/${PRODUCT_ID}?scope=global`;
const URL_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`;
const URL_CL = `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=pl-PL`;

/** Every field state on one screen: own, own empty, inherited from the channel and from Global, absent. */
function read(scope: ScopeRef) {
  if (scope.level === 'global') return scopedValuesResponse({ scope, version: '3', validScopes: VALID_SCOPES });
  return scopedValuesResponse({
    scope,
    version: '3',
    validScopes: VALID_SCOPES,
    fields: {
      name: scopedField('Wiertarka', { source: 'set', ownValue: 'Wiertarka', required: true }),
      description: scopedField<string>(null, { source: 'set_empty', ownValue: null }),
      status: scopedField<'active' | 'inactive'>('active', { source: scope.level === 'channel' ? 'inherited_global' : 'inherited_channel' }),
      urlKey: scopedField('wiertarka', { source: 'inherited_global', required: true }),
      window: scopedField(
        { from: null, until: null },
        { levels: ['G', 'C'], source: 'absent', supportedHere: scope.level !== 'channel_language' },
      ),
    },
  });
}

/**
 * One category, so the Global Categories picker renders a row rather than its empty note.
 */
const CATEGORIES = {
  data: [{ id: '00000000-0000-4000-8000-0000000ca7e1', parentCategoryId: null, name: { 'en-US': 'Tools' }, slug: 'tools', sortOrder: 0 }],
};

beforeEach(() => {
  setUpEditorApi({ read, extra: (path) => (path === '/api/v1/admin/catalog/categories' ? CATEGORIES : undefined) });
  api.post.mockResolvedValue({ data: { overwrites: [], applied: 0, version: '3' } });
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

/**
 * The shared helper's rules (`test/helpers/axe.ts`: WCAG 2.0–2.2 A/AA, `color-contrast` off),
 * over the whole document so portalled menus and dialogs are included.
 * No exclusion: the kit's `CategoryTreePicker` list is a labelled `group` of checkbox rows
 * (it was a `tree` without `treeitem`s, excluded here until the final fix round).
 */
async function expectNoAxeViolations(): Promise<void> {
  const result = await axe.run(
    document.body,
    {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    },
  );
  const lines = result.violations.map(
    (violation) => `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} — ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
  expect(lines).toEqual([]);
}

async function settled(): Promise<void> {
  await screen.findByLabelText(en['productEditor.field.name']!);
  await waitFor(() => expect(screen.getByRole('tabpanel')).not.toHaveAttribute('aria-busy', 'true'));
}

describe('the product editor has no axe violations (feature 170, T134, SC-013)', () => {
  it.each([
    ['Global', URL_G],
    ['Channel', URL_C],
    ['Channel × language', URL_CL],
  ])('at %s', async (_label, url) => {
    renderEditor(ProductEditor, { url });
    await settled();
    await expectNoAxeViolations();
  }, 30_000);

  it.each([
    ['Global', URL_G],
    ['Channel × language', URL_CL],
  ])('read-only (catalog:read only) at %s', async (_label, url) => {
    renderEditor(ProductEditor, { url, permissions: ['catalog:read'] });
    await settled();
    await expectNoAxeViolations();
  }, 30_000);

  it('with a field error after a refused Save at Global', async () => {
    renderEditor(ProductEditor, { url: URL_G });
    await settled();
    const name = screen.getByLabelText(en['productEditor.field.name']!);
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    await expectNoAxeViolations();
  }, 30_000);

  it('with a staged change and the copy dialog open at Channel × language', async () => {
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: URL_CL });
    await settled();
    await user.click(screen.getByRole('button', { name: en['productEditor.copy.menu']!.replace('{field}', en['productEditor.field.name']!) }));
    await user.click(await screen.findByRole('menuitem'));
    await screen.findByText(en['productEditor.copy.noOverwrites']!);
    await expectNoAxeViolations();
  }, 30_000);

  it('in the dark theme at Channel × language', async () => {
    document.documentElement.classList.add('dark');
    renderEditor(ProductEditor, { url: URL_CL });
    await settled();
    await expectNoAxeViolations();
  }, 30_000);
});

// --- Muted-text contrast from the theme tokens (jsdom cannot measure it) ----------------------

const THEME = readFileSync(resolve(process.cwd(), '../packages/admin-kit/theme.css'), 'utf8');

/** The `--name: H S% L%` channels of one theme block (`:root` or `.dark`). */
function tokens(selector: ':root' | '.dark'): Record<string, [number, number, number]> {
  const start = THEME.search(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{`, 'm'));
  expect(start, `${selector} block in theme.css`).toBeGreaterThanOrEqual(0);
  const body = THEME.slice(start, THEME.indexOf('}', start));
  const out: Record<string, [number, number, number]> = {};
  for (const match of body.matchAll(/--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }
  return out;
}

function luminance([h, s, l]: [number, number, number]): number {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(channel(0)) + 0.7152 * linear(channel(8)) + 0.0722 * linear(channel(4));
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('muted text in the editor meets 4.5:1 in both themes (SC-013, WCAG 1.4.3)', () => {
  it.each([':root', '.dark'] as const)('%s: muted text on the field, the read-only control and the page', (selector) => {
    const theme = tokens(selector);
    for (const surface of ['card', 'secondary', 'background'] as const) {
      expect(theme['muted-foreground'], 'muted-foreground').toBeDefined();
      expect(theme[surface], surface).toBeDefined();
      const ratio = contrast(theme['muted-foreground']!, theme[surface]!);
      expect(ratio, `muted-foreground on ${surface} (${selector}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
