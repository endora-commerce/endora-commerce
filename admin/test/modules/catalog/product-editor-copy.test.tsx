import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScopeRef } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  BASE,
  CH_RETAIL,
  CH_VIP,
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
 * Feature 174 (T116; `contracts/editor-ui.md` §8, §11, FR-086) — "Copy to other channels in
 * <language>": a per-field menu on a {G,C,CL} text field at Channel × language with an own value,
 * a dialog listing the member channels that offer the language, a dry run listing the values it
 * overwrites, then one audited copy (`POST …/scoped-values/copy`).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const COPY = `${BASE}/scoped-values/copy`;
const atCL = (language = 'pl-PL'): string =>
  `/catalog/products/${PRODUCT_ID}?scope=cl&channel=${CH_RETAIL}&language=${language}`;

const tr = (key: string, params: Record<string, string> = {}): string =>
  Object.entries(params).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), en[key] ?? key);

const NAME = en['productEditor.field.name']!;
const DESCRIPTION = en['productEditor.field.description']!;

function read(scope: ScopeRef, over: { name?: ReturnType<typeof scopedField<string>>; description?: ReturnType<typeof scopedField<string>> } = {}) {
  return scopedValuesResponse({
    scope,
    version: '5',
    validScopes: VALID_SCOPES,
    fields: {
      name: over.name ?? scopedField('Wiertarka', { source: 'set', ownValue: 'Wiertarka', required: true }),
      description: over.description ?? scopedField<string>('Opis', { source: 'inherited_channel' }),
    },
  });
}

function copyAnswer(over: { overwrites?: unknown[]; applied?: number; version?: string } = {}) {
  return { data: { overwrites: over.overwrites ?? [], applied: over.applied ?? 0, version: over.version ?? '5' } };
}

type User = ReturnType<typeof userEvent.setup>;

async function openCopy(user: User, field = NAME): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: tr('productEditor.copy.menu', { field }) }));
  await user.click(await screen.findByRole('menuitem', { name: tr('productEditor.copy.action', { language: 'Polish' }) }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  setUpEditorApi({ read: (scope) => read(scope) });
  api.post.mockImplementation(async (path: string, body: { dryRun?: boolean }) => {
    if (path !== COPY) return { data: null };
    return body.dryRun
      ? copyAnswer({ overwrites: [{ channelId: CH_VIP, currentValue: 'Wiertarka VIP' }] })
      : copyAnswer({ applied: 1, version: '6' });
  });
  api.put.mockImplementation(async (path: string) => (path.endsWith('/scoped-values') ? { ...read({ level: 'global' }), warnings: [] } : { data: null }));
});
afterEach(() => cleanup());

describe('copy to other channels (feature 174, T116, FR-086)', () => {
  it('lists the channels offering the language, dry-runs, names what it overwrites, then copies once', async () => {
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    expect(within(dialog).getByRole('heading', { name: tr('productEditor.copy.title', { field: NAME, language: 'Polish' }) })).toBeInTheDocument();
    // Retail PL is the source; B2B VIP is the one other channel offering Polish.
    const vip = within(dialog).getByRole('checkbox', { name: 'B2B VIP' });
    expect(vip).toBeChecked();
    expect(within(dialog).queryByRole('checkbox', { name: 'Retail PL' })).toBeNull();
    expect(within(dialog).getByText('Wiertarka')).toBeInTheDocument();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(COPY, {
        field: 'name',
        from: { channelId: CH_RETAIL, languageCode: 'pl-PL' },
        toChannelIds: [CH_VIP],
        version: '5',
        dryRun: true,
      }),
    );
    expect(await within(dialog).findByText(en['productEditor.copy.overwrites']!)).toBeInTheDocument();
    // One dry run per selection: StrictMode mounts the effect twice, a re-render loop would be more.
    await new Promise((r) => setTimeout(r, 100));
    expect(api.post.mock.calls.filter(([path]) => path === COPY).length).toBeLessThanOrEqual(2);
    const overwritten = within(dialog).getByRole('list', { name: en['productEditor.copy.overwrites']! });
    expect(overwritten).toHaveTextContent('B2B VIP');
    expect(overwritten).toHaveTextContent('Wiertarka VIP');

    await user.click(within(dialog).getByRole('button', { name: 'Copy to 1 channel' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(COPY, {
        field: 'name',
        from: { channelId: CH_RETAIL, languageCode: 'pl-PL' },
        toChannelIds: [CH_VIP],
        version: '5',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Copied Name to 1 channel.')).toBeInTheDocument();
    // Focus goes back to the field's menu button, not to the body.
    expect(screen.getByRole('button', { name: tr('productEditor.copy.menu', { field: NAME }) })).toHaveFocus();
  });

  it('the next Save sends the version the copy answered (the copy bumps it, R7)', async () => {
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Copy to 1 channel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const description = screen.getByRole('checkbox', { name: new RegExp(`for ${DESCRIPTION}$`) });
    await user.click(description);
    fireEvent.change(screen.getByLabelText(DESCRIPTION), { target: { value: 'Nowy opis' } });
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/scoped-values`, expect.objectContaining({ version: '6' })));
  });

  it('no overwrites: says nothing is overwritten', async () => {
    api.post.mockImplementation(async (_path: string, body: { dryRun?: boolean }) => copyAnswer({ applied: body.dryRun ? 0 : 1 }));
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    expect(await within(dialog).findByText(en['productEditor.copy.noOverwrites']!)).toBeInTheDocument();
  });

  it('loading: while the dry run is in flight the dialog says so and Copy waits', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    expect(within(dialog).getByText(en['productEditor.copy.checking']!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy to 1 channel' })).toHaveAttribute('aria-disabled', 'true');
    resolve(copyAnswer());
    expect(await within(dialog).findByText(en['productEditor.copy.noOverwrites']!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy to 1 channel' })).not.toHaveAttribute('aria-disabled');
  });

  it('error: a failed dry run shows the error with Try again, which re-runs it', async () => {
    let failing = true;
    api.post.mockImplementation(async () => {
      if (failing) throw new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } });
      return copyAnswer({ overwrites: [{ channelId: CH_VIP, currentValue: { empty: true } }] });
    });
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    expect(await within(dialog).findByText(en['productEditor.copy.checkError']!)).toBeInTheDocument();
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: en['productEditor.copy.retry']! }));
    expect(await within(dialog).findByText(en['productEditor.copy.overwrites']!)).toBeInTheDocument();
    // An own empty target value is named as such.
    expect(within(dialog).getByRole('list', { name: en['productEditor.copy.overwrites']! })).toHaveTextContent(en['productEditor.copy.currentEmpty']!);
  });

  it('a version conflict says the product changed and keeps the dialog open', async () => {
    api.post.mockImplementation(async (_path: string, body: { dryRun?: boolean }) => {
      if (body.dryRun) return copyAnswer();
      throw new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'changed' } });
    });
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Copy to 1 channel' }));
    expect(await within(dialog).findByText(en['productEditor.copy.conflict']!)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Not a dead end: the dialog offers to reload the product, which closes it and reads it again.
    const reads = api.get.mock.calls.filter(([path]) => String(path).startsWith(`${BASE}/scoped-values`)).length;
    await user.click(within(dialog).getByRole('button', { name: en['productEditor.save.reloadDiscarding']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([path]) => String(path).startsWith(`${BASE}/scoped-values`)).length).toBeGreaterThan(reads),
    );
  });

  it('empty target list: unticking every channel asks for one and Copy is unavailable', async () => {
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user);
    await user.click(within(dialog).getByRole('checkbox', { name: 'B2B VIP' }));
    expect(within(dialog).getByText(en['productEditor.copy.selectOne']!)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Copy to/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('an own empty value is offered on an optional field only (FR-086)', async () => {
    setUpEditorApi({
      read: (scope) =>
        read(scope, {
          name: scopedField('Wiertarka', { source: 'inherited_channel', required: true }),
          description: scopedField<string>(null, { source: 'set_empty', ownValue: null }),
        }),
    });
    api.post.mockResolvedValue(copyAnswer());
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: atCL() });
    const dialog = await openCopy(user, DESCRIPTION);
    expect(within(dialog).getByText(en['productEditor.copy.valueEmpty']!)).toBeInTheDocument();
    // Name inherits: no menu at all.
    expect(screen.queryByRole('button', { name: tr('productEditor.copy.menu', { field: NAME }) })).toBeNull();
  });

  it('an own empty value of a required field offers no copy', async () => {
    setUpEditorApi({ read: (scope) => read(scope, { name: scopedField<string>(null, { source: 'set_empty', ownValue: null, required: true }) }) });
    renderEditor(ProductEditor, { url: atCL() });
    await screen.findByLabelText(NAME);
    expect(screen.queryByRole('button', { name: tr('productEditor.copy.menu', { field: NAME }) })).toBeNull();
  });

  it('a staged change replaces the menu with "Save first to copy"', async () => {
    renderEditor(ProductEditor, { url: atCL() });
    const name = await screen.findByLabelText(NAME);
    fireEvent.change(name, { target: { value: 'Wiertarka 2' } });
    expect(screen.queryByRole('button', { name: tr('productEditor.copy.menu', { field: NAME }) })).toBeNull();
    expect(name).toHaveAccessibleDescription(expect.stringContaining(en['productEditor.copy.saveFirst']!));
  });

  it('absent when no other channel offers the language (Retail PL is the only channel in English)', async () => {
    renderEditor(ProductEditor, { url: atCL('en-US') });
    await screen.findByLabelText(NAME);
    expect(screen.queryByRole('button', { name: tr('productEditor.copy.menu', { field: NAME }) })).toBeNull();
  });

  it('absent at Global, at Channel, on the URL key and without catalog:write', async () => {
    const menu = { name: tr('productEditor.copy.menu', { field: NAME }) };
    const first = renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    await screen.findByLabelText(NAME);
    expect(screen.queryByRole('button', menu)).toBeNull();
    first.unmount();
    const second = renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=channel&channel=${CH_RETAIL}` });
    await screen.findByLabelText(NAME);
    expect(screen.queryByRole('button', menu)).toBeNull();
    second.unmount();
    setUpEditorApi({ read: (scope) => read(scope) });
    renderEditor(ProductEditor, { url: atCL(), permissions: ['catalog:read'] });
    await screen.findByLabelText(NAME);
    expect(screen.queryByRole('button', menu)).toBeNull();
    expect(screen.queryByRole('button', { name: tr('productEditor.copy.menu', { field: en['productEditor.field.urlKey']! }) })).toBeNull();
  });
});
