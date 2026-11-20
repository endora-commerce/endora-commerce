import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApiError, useSaveParticipant, type SaveParticipantHandlers } from '@endora-commerce/admin-kit/lib';
import type { AdminZoneContribution, AdminZoneProps, ScopeRef } from '@endora-commerce/contracts';
import {
  IMMEDIATE_BADGE,
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  api,
  currentSearch,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Feature 180, WP-2 — the product editor's one Save covers its zone panels
 * (`specs/180-one-save-zone-editors/contracts/product-editor-save-ui.md`; US1–US4, FR-010…FR-035;
 * owner rulings OQ-1…OQ-4 and OQ-6 = A).
 *
 * The panel here is a **test-only participant** contributed by a module of its own to
 * `product.editor.pricing.before` (SC-006: it takes part with no host change). It writes through
 * `PUT /probe`, so the order of the writes is the order of `api.put`'s calls.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const CORE = shippedCoreBundle('en').core as Record<string, string>;
const AT_GLOBAL = `/catalog/products/${PRODUCT_ID}?tab=details`;

// --- the test-only participant ------------------------------------------------------------

interface ProbeDraft {
  readonly value: string;
}
const PROBE_LOADED: ProbeDraft = { value: 'stored' };
type ProbeValidate = (draft: ProbeDraft, ctx: unknown) => Promise<{ fields: Record<string, string> }>;
type ProbeSave = (draft: ProbeDraft, ctx: unknown) => Promise<ProbeDraft>;
const probe: { writable: boolean; validate: Mock<ProbeValidate>; save: Mock<ProbeSave> } = {
  writable: true,
  validate: vi.fn<ProbeValidate>(),
  save: vi.fn<ProbeSave>(),
};
const HANDLERS: SaveParticipantHandlers<ProbeDraft> = {
  changeCount: (draft, baseline) => (draft.value === baseline.value ? 0 : 1),
  validate: (draft, ctx) => probe.validate(draft, ctx),
  save: (draft, ctx) => probe.save(draft, ctx),
};

function ProbePanel(props: AdminZoneProps<'product.editor.pricing.before'>): ReactElement {
  const part = useSaveParticipant(props.saveSession, { key: 'probe', label: 'Probe part', writable: probe.writable, loaded: PROBE_LOADED }, HANDLERS);
  return (
    <div>
      <label>
        Probe value
        <input
          value={part.draft?.value ?? ''}
          aria-invalid={part.issues?.fields['value'] ? true : undefined}
          onChange={(event) => part.setDraft({ value: event.target.value })}
        />
      </label>
      {part.issues?.fields['value'] ? <span>{part.issues.fields['value']}</span> : null}
    </div>
  );
}

const PROBE: AdminZoneContribution = {
  zone: 'product.editor.pricing.before',
  weight: 0,
  component: () => Promise.resolve({ default: ProbePanel }),
};
const CONTRIBUTIONS = [{ moduleId: 'test_probe', contributions: { zones: [PROBE] } }];

// --- the editor's server ------------------------------------------------------------------

function read(scope: ScopeRef) {
  return scopedValuesResponse({
    scope,
    version: '9',
    validScopes: VALID_SCOPES,
    fields: {
      name: scopedField('Drill', { source: 'set', ownValue: 'Drill', required: true }),
      description: scopedField('Text', { source: 'set', ownValue: 'Text' }),
    },
  });
}

function apiError(status: number, code: string): ApiError {
  return new ApiError(status, { error: { code, message: code } } as never);
}

const writes = (): string[] => api.put.mock.calls.map(([path]) => String(path));
const scopedPuts = (): unknown[][] => api.put.mock.calls.filter(([path]) => path === `${BASE}/scoped-values`);
const saveButton = (): HTMLElement => screen.getByTestId('product-save');

beforeEach(() => {
  setUpEditorApi({ read });
  api.put.mockImplementation(async (path: string) => {
    if (path.endsWith('/scoped-values')) return { ...read({ level: 'global' }), warnings: [] };
    if (path === '/probe') return { data: null };
    return { data: null };
  });
  probe.writable = true;
  probe.validate = vi.fn<ProbeValidate>(async () => ({ fields: {} }));
  probe.save = vi.fn<ProbeSave>(async (draft: ProbeDraft) => {
    await api.put('/probe', draft);
    return draft;
  });
});
afterEach(() => cleanup());

function open(options: { permissions?: readonly string[] } = {}): ReturnType<typeof renderEditor> {
  return renderEditor(ProductEditor, {
    url: AT_GLOBAL,
    contributions: CONTRIBUTIONS,
    present: ['test_probe'],
    ...(options.permissions ? { permissions: options.permissions } : {}),
  });
}

async function stageName(value = 'Wiertarka'): Promise<void> {
  fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value } });
}

async function stageProbe(value = 'edited'): Promise<void> {
  await screen.findByLabelText(en['productEditor.field.name']!);
  fireEvent.click(await screen.findByRole('tab', { name: en['productEditor.tab.pricing']! }));
  fireEvent.change(await screen.findByLabelText('Probe value'), { target: { value } });
}

describe('the product editor’s one Save with a zone participant (feature 180)', () => {
  it('counts the host’s and the panel’s changes together, and the Pricing tab says nothing applies immediately', async () => {
    open();
    await stageName();
    await stageProbe();
    expect(saveButton()).toHaveAccessibleName(/^Save 2 changes/);
    expect(within(screen.getByRole('tabpanel')).queryByText(IMMEDIATE_BADGE)).toBeNull();
    // SC-001: one Save on the page.
    expect(screen.getAllByRole('button', { name: /^Save/ })).toHaveLength(1);
  });

  it('has exactly one Save on every tab (SC-001)', async () => {
    open();
    await screen.findByLabelText(en['productEditor.field.name']!);
    // The Inventory tab reads warehouse stock this rig does not serve; it holds no Save of its own
    // for the panels either way (its settings are WP-4's).
    const tabs = screen.getAllByRole('tab').filter((tab) => tab.textContent !== en['productEditor.tab.inventory']);
    for (const tab of tabs) {
      fireEvent.click(tab);
      await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getAllByRole('button', { name: /^Save( |$)/ }).map((button) => button.getAttribute('data-testid'))).toEqual(['product-save']);
    }
  });

  it('keeps the panel’s change through tab switches and asks nothing (FR-003, FR-031)', async () => {
    open();
    await stageProbe();
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.details']! }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saveButton()).toHaveAccessibleName(/^Save 1 change/);
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.pricing']! }));
    expect(await screen.findByLabelText('Probe value')).toHaveValue('edited');
  });

  it('writes the host’s change first, then the panel’s (OQ-2 = A), and says so once', async () => {
    open();
    await stageName();
    await stageProbe();
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes()).toEqual([`${BASE}/scoped-values`, '/probe']));
    await waitFor(() => expect(saveButton()).toHaveAccessibleName(/^Save/));
    await waitFor(() => expect(screen.getByTestId('product-save-info')).toHaveTextContent('Saved 2 changes at Global.'));
  });

  it('a panel-only change writes the panel only — no scoped-values request', async () => {
    open();
    await stageProbe();
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes()).toEqual(['/probe']));
    expect(scopedPuts()).toHaveLength(0);
  });

  it('a refusal anywhere writes nothing and the summary takes the operator to the part (FR-011, SC-003)', async () => {
    probe.validate = vi.fn<ProbeValidate>(async () => ({ fields: { value: 'Not a valid probe' } }));
    open();
    await stageName();
    await stageProbe('bad');
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.details']! }));
    fireEvent.click(saveButton());

    const summary = await screen.findByTestId('product-save-summary');
    expect(writes()).toEqual([]);
    expect(summary).toHaveTextContent(CORE['saveSession.summary.refused']!);
    expect(summary).toHaveTextContent('Probe part — 1 problem');
    fireEvent.click(within(summary).getByRole('button', { name: /Probe part/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: en['productEditor.tab.pricing']! })).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByText('Not a valid probe')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Probe value')));
  });

  it('a failed panel write after the host’s keeps what saved; the next Save writes the panel only (OQ-1 = A)', async () => {
    probe.save = vi.fn<ProbeSave>(async () => {
      throw apiError(500, 'INTERNAL');
    });
    open();
    await stageName();
    await stageProbe();
    fireEvent.click(saveButton());

    const summary = await screen.findByTestId('product-save-summary');
    expect(summary).toHaveTextContent(CORE['saveSession.summary.partial']!);
    expect(summary).toHaveTextContent('Saved: Product fields.');
    expect(summary).toHaveTextContent('Not saved: Probe part');
    expect(saveButton()).toHaveAccessibleName(/^Save 1 change/);

    probe.save = vi.fn<ProbeSave>(async (draft: ProbeDraft) => {
      await api.put('/probe', draft);
      return draft;
    });
    api.put.mockClear();
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes()).toEqual(['/probe']));
  });

  it('a version conflict on the host’s write writes no panel; Reload discards every change (FR-015)', async () => {
    api.put.mockImplementation(async (path: string) => {
      if (path.endsWith('/scoped-values')) throw apiError(409, 'VERSION_CONFLICT');
      return { data: null };
    });
    open();
    await stageName();
    await stageProbe();
    fireEvent.click(saveButton());
    expect(await screen.findByText(en['productEditor.save.error.conflict']!)).toBeInTheDocument();
    expect(probe.save).not.toHaveBeenCalled();
    expect(screen.queryByTestId('product-save-summary')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en['productEditor.save.reloadDiscarding']! }));
    await waitFor(() => expect(saveButton()).toHaveAccessibleName(/^Save/));
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('a panel-only change: Back asks Save / Discard / Stay, and Discard drops it (FR-030)', async () => {
    open();
    await stageProbe();
    fireEvent.click(screen.getByRole('link', { name: en['productEditor.back']! }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.guard.discard']! }));
    expect(await screen.findByText('product list')).toBeInTheDocument();
  });

  it('a panel-only change: a scope switch asks first, and Stay keeps scope and change (OQ-4 = A)', async () => {
    const view = open();
    await stageProbe();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_RETAIL } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en['productEditor.guard.stay']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(currentSearch(view).get('channel')).toBeNull();
    expect(screen.getByLabelText('Probe value')).toHaveValue('edited');
  });

  it('a panel-only change: Save in the scope guard saves the panel, then switches', async () => {
    const view = open();
    await stageProbe();
    fireEvent.change(screen.getByLabelText(en['productEditor.scope.channelSelect']!), { target: { value: CH_RETAIL } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: en['productEditor.guard.save']! }));
    await waitFor(() => expect(currentSearch(view).get('channel')).toBe(CH_RETAIL));
    expect(writes()).toEqual(['/probe']);
  });

  it('a panel-only change triggers the browser’s leave prompt (FR-032)', async () => {
    open();
    await stageProbe();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('an operator who may write the panel but not the product sees Save, which writes the panel only (FR-035)', async () => {
    open({ permissions: ['catalog:read'] });
    await stageProbe();
    expect(saveButton()).toHaveAccessibleName(/^Save 1 change/);
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes()).toEqual(['/probe']));
  });

  it('a read-only operator with no writable panel sees no Save', async () => {
    probe.writable = false;
    open({ permissions: ['catalog:read'] });
    await screen.findByLabelText(en['productEditor.field.name']!);
    expect(screen.queryByTestId('product-save')).toBeNull();
  });
});
