import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 170 (T111; US9 #1–#3, FR-085) — scopable user attributes on the Attributes tab, one
 * `ScopedField` per value type: unticking "Use value from <parent>" at a channel and entering a
 * value stages it for that channel; a text attribute takes a Channel × language value and can
 * go back to inheriting; a non-scopable attribute is read-only with "Global only".
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const AT_C = `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}&tab=attributes`;
const AT_CL = `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=pl-PL&tab=attributes`;

const C_LEVELS = ['G', 'C'] as Array<'G' | 'C' | 'CL'>;

function attr(key: string, valueType: string, value: unknown, over: Record<string, unknown> = {}) {
  return {
    key,
    label: { 'en-US': key[0]!.toUpperCase() + key.slice(1) },
    valueType,
    isRequired: false,
    view: scopedField<unknown>(value, { source: 'inherited_global', levels: valueType === 'string' ? ['G', 'C', 'CL'] : C_LEVELS, ...over }),
  };
}

function read(scope: ScopeRef) {
  const cl = scope.level === 'channel_language';
  return scopedValuesResponse({
    scope,
    version: '2',
    validScopes: VALID_SCOPES,
    attributes: [
      attr('material', 'string', cl ? 'Stal' : 'Steel', cl ? { source: 'set', ownValue: 'Stal' } : {}),
      attr('weight', 'number', 2.5),
      attr('released', 'date', '2026-01-15'),
      attr('cordless', 'boolean', true),
      attr('voltage', 'select', '18v', cl ? { supportedHere: false } : {}),
      attr('warranty', 'string', '2 years', { levels: ['G'], supportedHere: scope.level === 'global' }),
    ],
  });
}

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string) =>
    path.endsWith('/scoped-values') ? { ...read({ level: 'channel', channelId: CH_RETAIL }), warnings: [] } : { data: null },
  );
});
afterEach(() => cleanup());

function puts(): Array<{ changes: Record<string, unknown> }> {
  return api.put.mock.calls.filter(([path]) => path === `${BASE}/scoped-values`).map(([, body]) => body as { changes: Record<string, unknown> });
}

describe('scopable attributes per scope (feature 170, US9)', () => {
  it('#1 at a channel: untick, enter a number, Save stages it for the channel', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    const weight = await screen.findByLabelText('Weight');
    expect(weight).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('checkbox', { name: /for Weight$/ }));
    await waitFor(() => expect(weight).not.toHaveAttribute('readonly'));
    fireEvent.change(weight, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change\b/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.changes).toEqual({ attributes: { weight: 3 } });
  });

  it('#1 every value type renders at the channel: date, boolean, select', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    expect(await screen.findByLabelText('Released')).toHaveValue('2026-01-15');
    // An inherited select or boolean is a read-only text input with the option label (§11).
    expect(screen.getByLabelText('Cordless')).toHaveValue('Yes');
    expect(screen.getByLabelText('Cordless')).toHaveAttribute('readonly');
  });

  it('#2 at Channel × language a text attribute is set, and "Use value from" removes it', async () => {
    renderEditor(ProductEditor, { url: AT_CL });
    const material = await screen.findByLabelText('Material');
    expect(material).toHaveValue('Stal');
    fireEvent.click(screen.getByRole('checkbox', { name: /for Material$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save 1 change\b/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.changes).toEqual({ attributes: { material: { inherit: true } } });
  });

  it('#2 a non-text attribute at Channel × language is read-only, set per channel', async () => {
    renderEditor(ProductEditor, { url: AT_CL });
    expect(await screen.findByLabelText('Voltage')).toHaveAttribute('readonly');
    expect(screen.getAllByText('Set per channel').length).toBeGreaterThan(0);
  });

  it('#3 a non-scopable attribute outside Global is read-only with "Global only"', async () => {
    renderEditor(ProductEditor, { url: AT_C });
    expect(await screen.findByLabelText('Warranty')).toHaveAttribute('readonly');
    expect(screen.queryByRole('checkbox', { name: /for Warranty$/ })).toBeNull();
  });
});
