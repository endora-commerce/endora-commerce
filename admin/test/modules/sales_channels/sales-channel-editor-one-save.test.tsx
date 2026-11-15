import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminZoneContribution, AdminZoneProps, SalesChannelDetail } from '@endora-commerce/contracts';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Feature 180, WP-9 — the sales-channel editor offers its save session to
 * `sales_channel.editor.after` (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md`
 * §4; US10, FR-070; OQ-10 = A).
 *
 * No module contributes a participant to that zone today, so the participant here is a
 * **test-only** one contributed by a module of its own (US10 #2: it joins the identity form's
 * Save with no host change). `inventory`'s warehouse routing is the real contribution and stays
 * immediate, under an "Applies immediately" badge (US10 #1).
 *
 * Every write lands in one ordered log, so "the channel first, then the participant" is the
 * order of that log.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const writes: string[] = [];

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => {
        writes.push(`POST ${String(args[0])}`);
        return postSpy(...args);
      },
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const getByCodeSpy = vi.fn();
const updateSpy = vi.fn();

vi.mock('../../../../packages/modules/sales_channels/src/admin/api/sales-channels-client', () => ({
  salesChannelsClient: {
    getByCode: (...a: unknown[]) => getByCodeSpy(...a),
    update: (...a: unknown[]) => {
      writes.push('PATCH channel');
      return updateSpy(...a);
    },
    create: vi.fn(),
    list: vi.fn(),
  },
}));

const { useSaveParticipant, ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);
type Handlers = import('@endora-commerce/admin-kit/lib').SaveParticipantHandlers<ProbeDraft>;
const { SalesChannelEditPage } = await import(
  '../../../../packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage'
);
const inventory = await import('@endora-commerce/mod-inventory/admin');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/sales_channels/i18n/en.json');
const pl = read('../packages/modules/sales_channels/i18n/pl.json');
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const inventoryEn = read('../packages/modules/inventory/i18n/en.json');
const inventoryPl = read('../packages/modules/inventory/i18n/pl.json');
const bundle = { sales_channels: en, core: coreEn, inventory: inventoryEn };

const CHANNEL_ID = '00000000-0000-4000-8000-000000000001';
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555501';

// --- the test-only participant ------------------------------------------------------------

interface ProbeDraft {
  readonly value: string;
}
const PROBE_LOADED: ProbeDraft = { value: 'stored' };
type ProbeSave = (draft: ProbeDraft) => Promise<ProbeDraft>;
const probe: { save: Mock<ProbeSave> } = { save: vi.fn<ProbeSave>() };
const HANDLERS: Handlers = {
  changeCount: (draft, baseline) => (draft.value === baseline.value ? 0 : 1),
  validate: async () => ({ fields: {} }),
  save: (draft) => {
    writes.push('PUT probe');
    return probe.save(draft);
  },
};

function ProbePanel(props: AdminZoneProps<'sales_channel.editor.after'>): ReactElement {
  const part = useSaveParticipant(
    props.saveSession,
    { key: 'probe', label: 'Probe part', writable: true, loaded: PROBE_LOADED },
    HANDLERS,
  );
  return (
    <label>
      Probe value
      <input value={part.draft?.value ?? ''} onChange={(event) => part.setDraft({ value: event.target.value })} />
    </label>
  );
}

const PROBE: AdminZoneContribution = {
  zone: 'sales_channel.editor.after',
  weight: 0,
  component: () => Promise.resolve({ default: ProbePanel }),
};

// --- the editor's server ------------------------------------------------------------------

function channel(over: Partial<SalesChannelDetail> = {}): SalesChannelDetail {
  return {
    id: CHANNEL_ID,
    code: 'serwis-a',
    name: { 'en-US': 'Serwis A' },
    active: true,
    anonymousAccess: true,
    prefixDefaultLanguage: true,
    systemDefault: false,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    version: 3,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    languages: ['pl-PL'],
    currencies: ['PLN'],
    logoUrl: null,
    ...over,
  };
}

function renderPage(options: { probe?: boolean; path?: string } = {}): void {
  const contributions = [
    { moduleId: 'inventory', contributions: inventory.contributions },
    ...(options.probe === false ? [] : [{ moduleId: 'test_probe', contributions: { zones: [PROBE] } }]),
  ];
  renderWithSession(
    <MemoryRouter initialEntries={[options.path ?? '/sales-channels/serwis-a']}>
      <Routes>
        <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
        <Route path="/sales-channels" element={<p>Channel list</p>} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['sales_channels', 'inventory', 'test_probe'] }),
      contributions,
      bundle,
    },
  );
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Save/ });
}

async function nameField(): Promise<HTMLInputElement> {
  const input = (await screen.findByLabelText(en['identity.name.label']!)) as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe('Serwis A'));
  return input;
}

async function changeProbe(value = 'edited'): Promise<void> {
  fireEvent.change(await screen.findByLabelText('Probe value'), { target: { value } });
}

beforeEach(() => {
  writes.length = 0;
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/dictionary/')) return { data: [] };
    if (url.startsWith('/api/v1/admin/warehouses?')) {
      return {
        items: [{ id: WAREHOUSE_ID, code: 'wh-b', name: 'Warehouse B' }],
        page: 1,
        pageSize: 200,
        total: 1,
      };
    }
    if (url === `/api/v1/admin/sales-channels/${CHANNEL_ID}/warehouses`) return { items: [] };
    throw new Error(`unexpected request: ${url}`);
  });
  postSpy.mockReset().mockResolvedValue({});
  getByCodeSpy.mockReset().mockResolvedValue(channel());
  updateSpy.mockReset().mockImplementation(async (_code: string, body: { name: Record<string, string> }) =>
    channel({ name: body.name, version: 4 }),
  );
  probe.save.mockReset().mockImplementation(async (draft) => draft);
});
afterEach(() => cleanup());

describe('bundle', () => {
  it('ships the host part label and the immediate badge in English and Polish', () => {
    expect(en['channelEditor.save.hostPartLabel']).toBe('Sales channel');
    expect(pl['channelEditor.save.hostPartLabel']).toBeTruthy();
    expect(inventoryEn['warehouses.channel.immediateBadge']).toBe('Applies immediately');
    expect(inventoryPl['warehouses.channel.immediateBadge']).toBeTruthy();
  });
});

describe('sales-channel editor — one Save covers the zone (feature 180, WP-9)', () => {
  it('reads "Save" and writes nothing while nothing changed', async () => {
    renderPage();
    await nameField();
    await screen.findByLabelText('Probe value');
    expect(saveButton()).toHaveTextContent(/^Save$/);
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(saveButton());
    await new Promise((settled) => setTimeout(settled, 20));
    expect(writes).toEqual([]);
  });

  it("counts a participant's change, and the identity Save writes only that part", async () => {
    renderPage();
    await nameField();
    await changeProbe();
    expect(saveButton()).toHaveTextContent('Save 1 change');
    fireEvent.click(saveButton());
    await waitFor(() => expect(probe.save).toHaveBeenCalledTimes(1));
    expect(probe.save.mock.calls[0]?.[0]).toEqual({ value: 'edited' });
    expect(updateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton()).toHaveTextContent(/^Save$/));
  });

  it('writes the channel first, then the participant', async () => {
    renderPage();
    fireEvent.change(await nameField(), { target: { value: 'Serwis B' } });
    await changeProbe();
    expect(saveButton()).toHaveTextContent('Save 2 changes');
    fireEvent.click(saveButton());
    await waitFor(() => expect(probe.save).toHaveBeenCalledTimes(1));
    expect(writes).toEqual(['PATCH channel', 'PUT probe']);
    expect(updateSpy.mock.calls[0]?.[1]).toMatchObject({ expectedVersion: 3, name: { 'en-US': 'Serwis B' } });
    await waitFor(() => expect(saveButton()).toHaveTextContent(/^Save$/));
  });

  it('writes no participant when the channel write is refused', async () => {
    updateSpy.mockRejectedValue(
      new ApiError(412, { error: { code: 'VERSION_CONFLICT', message: 'The channel changed meanwhile.', requestId: 'r' } } as never),
    );
    renderPage();
    fireEvent.change(await nameField(), { target: { value: 'Serwis B' } });
    await changeProbe();
    fireEvent.click(saveButton());
    expect(await screen.findByText('The channel changed meanwhile.')).toBeInTheDocument();
    expect(probe.save).not.toHaveBeenCalled();
    expect(saveButton()).toHaveTextContent('Save 2 changes');
  });

  it('keeps the channel saved when the participant fails, and retries only the participant', async () => {
    probe.save.mockRejectedValueOnce(new Error('probe down'));
    renderPage();
    fireEvent.change(await nameField(), { target: { value: 'Serwis B' } });
    await changeProbe();
    fireEvent.click(saveButton());
    expect(await screen.findByText(coreEn['saveSession.summary.partial']!)).toBeInTheDocument();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()).toHaveTextContent('Save 1 change'));

    fireEvent.click(saveButton());
    await waitFor(() => expect(probe.save).toHaveBeenCalledTimes(2));
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('Cancel discards every change without asking and returns to the list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    await nameField();
    await changeProbe();
    fireEvent.click(screen.getByRole('button', { name: en['identity.action.cancel']! }));
    expect(await screen.findByText('Channel list')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    confirmSpy.mockRestore();
  });
});

describe('sales-channel editor — leave guard (feature 180, WP-9)', () => {
  function unloadPrevented(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('does not ask while nothing changed', async () => {
    renderPage();
    await nameField();
    expect(unloadPrevented()).toBe(false);
  });

  it("asks before the tab closes over an identity-form change (the form had no guard)", async () => {
    renderPage({ probe: false });
    fireEvent.change(await nameField(), { target: { value: 'Serwis B' } });
    await waitFor(() => expect(unloadPrevented()).toBe(true));
  });

  it("asks before the tab closes over a participant's change", async () => {
    renderPage();
    await nameField();
    await changeProbe();
    await waitFor(() => expect(unloadPrevented()).toBe(true));
  });

  it('asks before an in-app link leaves the page with unsaved changes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await nameField();
    await changeProbe();
    fireEvent.click(screen.getByRole('link', { name: en['identity.anonymousAccess.pricesLink']! }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});

describe('sales-channel editor — warehouse routing stays immediate (feature 180, OQ-10 = A)', () => {
  it('carries the "Applies immediately" badge and assigns at once, leaving Save untouched', async () => {
    renderPage({ probe: false });
    await nameField();
    const heading = await screen.findByRole('heading', { name: new RegExp(coreEn['warehouses.channel.title']!) });
    expect(heading).toHaveTextContent(inventoryEn['warehouses.channel.immediateBadge']!);

    fireEvent.change(await screen.findByLabelText(coreEn['warehouses.channel.field.warehouse']!), {
      target: { value: WAREHOUSE_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: coreEn['warehouses.channel.action.add']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([`POST /api/v1/admin/sales-channels/${CHANNEL_ID}/warehouses`]);
    expect(saveButton()).toHaveTextContent(/^Save$/);
  });
});

describe('sales-channel create form (feature 180, edge case)', () => {
  it('mounts no zone and keeps its Create button', async () => {
    renderPage({ path: '/sales-channels/new' });
    expect(await screen.findByRole('button', { name: en['identity.action.create']! })).toBeInTheDocument();
    expect(screen.queryByLabelText('Probe value')).toBeNull();
    expect(getSpy.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/warehouses'))).toEqual([]);
  });
});
