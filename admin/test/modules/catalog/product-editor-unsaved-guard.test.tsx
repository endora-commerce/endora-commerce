import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  CH_RETAIL,
  CH_VIP,
  VALID_SCOPES,
  currentSearch,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Issue #1606 (follow-up of DS-13, #1446) — the product editor asks about unsaved changes through
 * the kit's one guard, `useUnsavedChangesGuard`, instead of a dialog of its own: the same dialog,
 * focus (Stay first) and buttons as every other admin editor, with the editor's own question —
 * "Save your changes at <scope>?" and how many changes there are. Every way out is asked in that
 * dialog: a scope switch, the Back link, any other in-app link (it used to be the browser's
 * two-way `window.confirm`), and the browser's Back / Forward between scopes, where Stay puts the
 * scope the operator stayed at back in the address.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const core = shippedCoreBundle('en').core as Record<string, string>;

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '9',
    validScopes: VALID_SCOPES,
    fields: { name: scopedField('Drill', { source: 'set', ownValue: 'Drill', required: true }) },
  });
}

const AT_C = `/catalog/products/${'11111111-1111-4111-8111-111111111170'}?scope=channel&channel=${CH_RETAIL}`;

/** The editor beside an unrelated in-app link (the sidebar) and a browser Back. */
function EditorWithChrome(): ReactNode {
  const navigate = useNavigate();
  return (
    <>
      <nav>
        <Link to="/catalog/products">Sidebar: Products</Link>
        <button type="button" onClick={() => navigate(-1)}>
          Browser back
        </button>
      </nav>
      <ProductEditor />
    </>
  );
}

beforeEach(() => {
  setUpEditorApi({ read });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function stageName(value = 'Wiertarka'): Promise<void> {
  fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value } });
}

/** The guard title at a channel scope: "Save your changes at <channel> — all languages?". */
function titleAt(channel: string): RegExp {
  const [before] = en['productEditor.guard.title']!.split('{scope}');
  return new RegExp(`^${before}${channel}\\b`);
}

function bodyOne(key: string): string {
  return en[`${key}.one`]!.replace('{count}', '1');
}

describe('the product editor asks through the kit guard (#1606)', () => {
  it('a scope switch asks in the kit dialog with the editor’s question; Stay has the initial focus', async () => {
    renderEditor(EditorWithChrome, { url: AT_C });
    await stageName();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(titleAt('Retail PL'));
    expect(dialog).toHaveAccessibleDescription(bodyOne('productEditor.guard.body'));
    expect(within(dialog).getByTestId('unsaved-changes-stay')).toHaveTextContent(core['form.unsavedChanges.stay']!);
    expect(within(dialog).getByTestId('unsaved-changes-discard')).toHaveTextContent(core['form.unsavedChanges.discard']!);
    expect(within(dialog).getByTestId('unsaved-changes-save')).toHaveTextContent(core['form.unsavedChanges.save']!);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByTestId('unsaved-changes-stay')));
  });

  it('the Back link asks with the leave wording', async () => {
    renderEditor(EditorWithChrome, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('link', { name: en['productEditor.back']! }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(bodyOne('productEditor.guard.bodyLeave'));
    fireEvent.click(within(dialog).getByTestId('unsaved-changes-stay'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('product list')).toBeNull();
    expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
  });

  it('another in-app link asks in the same dialog, never window.confirm, and Discard follows it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderEditor(EditorWithChrome, { url: AT_C });
    await stageName();
    fireEvent.click(screen.getByRole('link', { name: 'Sidebar: Products' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(bodyOne('productEditor.guard.bodyLeave'));
    fireEvent.click(within(dialog).getByTestId('unsaved-changes-discard'));
    expect(await screen.findByText('product list')).toBeInTheDocument();
  });

  it('browser Back to another scope asks; Stay puts the current scope back in the address (§11)', async () => {
    const view = renderEditor(EditorWithChrome, { url: AT_C });
    await screen.findByLabelText(en['productEditor.field.name']!);
    // Move to VIP with nothing staged, so Back has a scope to return to.
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    await stageName();

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(titleAt('B2B VIP'));
    expect(dialog).toHaveAccessibleDescription(bodyOne('productEditor.guard.body'));
    fireEvent.click(within(dialog).getByTestId('unsaved-changes-stay'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Wiertarka');
  });

  it('browser Back to another scope: Discard loads that scope and drops the changes', async () => {
    const view = renderEditor(EditorWithChrome, { url: AT_C });
    await screen.findByLabelText(en['productEditor.field.name']!);
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_VIP } });
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_VIP));
    await stageName();

    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('unsaved-changes-discard'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentSearch(view).get('channel')).toBe(CH_RETAIL);
    await waitFor(() => expect(screen.getByLabelText(en['productEditor.field.name']!)).toHaveValue('Drill'));
  });
});
