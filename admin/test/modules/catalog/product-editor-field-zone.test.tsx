import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ProductEditorFieldZoneProps } from '@endora-commerce/contracts';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { CH_RETAIL, PRODUCT_ID, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Feature 170 (T133, FR-106) — the `product.editor.field.after` zone at the editor scope. The
 * host passes `scope` and `languageCodes: null` (protection is whole-field, FR-046); a
 * contributor written before 170, which reads neither, still renders under every field.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

/** A pre-170 contributor: reads `productId` and `fieldPath` only. */
function LegacyProbe({ productId, fieldPath }: { productId: string; fieldPath: string }): ReactNode {
  return <span data-testid={`legacy-${fieldPath}`}>{`legacy ${productId.slice(0, 4)} ${fieldPath}`}</span>;
}

/** A 170 contributor: reports the scope and the locale set it was handed. */
function ScopeProbe(props: ProductEditorFieldZoneProps): ReactNode {
  const scope = props.scope;
  const where = !scope ? 'none' : scope.level === 'channel_language' ? `cl:${scope.channelId}:${scope.languageCode}` : scope.level;
  return <span data-testid={`scope-${props.fieldPath}`}>{`${where} locales=${props.languageCodes === null ? 'null' : 'set'}`}</span>;
}

const CONTRIBUTIONS: AdminContributions = {
  zones: [
    zoneComponent('product.editor.field.after', () => Promise.resolve({ default: LegacyProbe as never }), { weight: 10 }),
    zoneComponent('product.editor.field.after', () => Promise.resolve({ default: ScopeProbe as never }), { weight: 20 }),
  ],
};
const REGISTRY = [{ moduleId: 'catalog', contributions: CONTRIBUTIONS }];

beforeEach(() => setUpEditorApi());
afterEach(() => cleanup());

describe('the field zone at the editor scope (feature 170, T133, FR-106)', () => {
  it('at Global: a contributor ignoring scope renders under Name and Description; the host passes scope and languageCodes null', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global`, contributions: REGISTRY });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(await screen.findByTestId('legacy-name')).toHaveTextContent('legacy 1111 name');
    expect(await screen.findByTestId('legacy-description')).toBeInTheDocument();
    expect(await screen.findByTestId('scope-name')).toHaveTextContent('global locales=null');
  });

  it('at Channel × language: the same contributor still renders, and the scope reaches the 170 one', async () => {
    renderEditor(ProductEditor, {
      url: `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=pl-PL`,
      contributions: REGISTRY,
    });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(await screen.findByTestId('legacy-name')).toBeInTheDocument();
    expect(await screen.findByTestId('scope-name')).toHaveTextContent(`cl:${CH_RETAIL}:pl-PL locales=null`);
    expect(await screen.findByTestId('scope-description')).toHaveTextContent(`cl:${CH_RETAIL}:pl-PL locales=null`);
  });

  it('at Channel: the zone sits below the control, in the field notes (editor-ui.md §11)', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}`, contributions: REGISTRY });
    const name = await screen.findByLabelText(en['productEditor.field.name']!);
    const probe = await screen.findByTestId('scope-name');
    expect(probe).toHaveTextContent('channel locales=null');
    // The notes row is part of the control's description, so the zone's text is read with it.
    expect(name).toHaveAccessibleDescription(expect.stringContaining('channel locales=null'));
    expect(within(probe.closest('[id$="-note"]') as HTMLElement).getByTestId('legacy-name')).toBeInTheDocument();
  });
});
