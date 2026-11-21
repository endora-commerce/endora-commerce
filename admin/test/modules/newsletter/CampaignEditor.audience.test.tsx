import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CampaignDetail } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import newsletterEn from '../../../../packages/modules/newsletter/i18n/en.json';

/**
 * Issue #1533 (UX audit CONTENT-15) — the campaign editor asks for its
 * settings first: name, language, subject and the audience share one card
 * above the e-mail canvas. A single tag is a radio group, not checkboxes that
 * behave like one; the manual group is a searchable picker that shows who is
 * already in it; the one preview is the builder's own, so there is no preview
 * card under the editor any more.
 */

installOffsetParentShim();

const getCampaign = vi.fn();
const getCampaignGroup = vi.fn();
const updateCampaign = vi.fn();
const setCampaignGroup = vi.fn();
const listSubscribers = vi.fn();
const paneProps = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('@endora-commerce/page-builder-admin/email', () => ({
  EmailEditorPane: (props: Record<string, unknown>): ReactNode => {
    paneProps(props);
    return <div data-testid="email-canvas" />;
  },
  EmailSubjectWithVariables: ({ id, value }: { id: string; value: string }): ReactNode => (
    <input id={id} value={value} readOnly />
  ),
  EmailVariablesProvider: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
  listEmailTemplatesForApply: async () => [],
  loadEmailTemplateCanvas: async () => null,
  saveCanvasAsEmailTemplate: async () => undefined,
  mergeEmailVariables: () => [],
}));

const TAGS = [
  { id: '00000000-0000-4000-8000-0000000000a1', code: 'vip', name: 'VIP', subscriberCount: 3 },
  { id: '00000000-0000-4000-8000-0000000000a2', code: 'b2b', name: 'B2B', subscriberCount: 5 },
];

const ANNA = { id: '00000000-0000-4000-8000-0000000000b1', email: 'anna@shop.test' };
const BOLEK = { id: '00000000-0000-4000-8000-0000000000b2', email: 'bolek@shop.test' };
const CELINA = { id: '00000000-0000-4000-8000-0000000000b3', email: 'celina@shop.test' };

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: async () => ({ items: TAGS }),
    listCustomFields: async () => ({ items: [] }),
    listSubscribers: (...args: unknown[]) => listSubscribers(...args),
    getCampaign: (...args: unknown[]) => getCampaign(...args),
    getCampaignGroup: (...args: unknown[]) => getCampaignGroup(...args),
    updateCampaign: (...args: unknown[]) => updateCampaign(...args),
    setCampaignGroup: (...args: unknown[]) => setCampaignGroup(...args),
    createCampaign: vi.fn(),
    previewCampaign: vi.fn(),
    sendCampaign: vi.fn(),
  },
}));

const { CampaignEditor } = await import('../../../../packages/modules/newsletter/src/admin/pages/CampaignEditor');

const ID = '11111111-1111-4111-8111-111111111111';

function detail(overrides: Partial<CampaignDetail> = {}): CampaignDetail {
  return {
    id: ID,
    name: 'November',
    subject: 'Winter prices',
    status: 'draft',
    targetType: 'all',
    scheduledAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    content: { root: { props: {} }, content: [] },
    salesChannelId: null,
    language: 'pl-PL',
    targetTagIds: [],
    trackingEnabled: true,
    audienceEstimate: 3,
    stats: null,
    version: 3,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const BUNDLE = {
  ...passthroughBundle('newsletter', Object.keys(newsletterEn)),
  ...passthroughBundle('core', ['common.action.save', 'common.action.cancel']),
};

beforeEach(() => {
  getCampaign.mockReset().mockResolvedValue(detail());
  getCampaignGroup.mockReset().mockResolvedValue({ items: [] });
  updateCampaign.mockReset().mockImplementation(async (_id: string, body: Partial<CampaignDetail>) =>
    detail({ ...body, version: 4 } as Partial<CampaignDetail>),
  );
  setCampaignGroup.mockReset().mockResolvedValue(detail({ targetType: 'group', version: 4 }));
  listSubscribers.mockReset().mockResolvedValue({ items: [ANNA, BOLEK], total: 2 });
  paneProps.mockReset();
});

async function renderEditor(): Promise<void> {
  renderWithI18n(
    <MemoryRouter initialEntries={[`/newsletter/campaigns/${ID}`]}>
      <Routes>
        <Route path="/newsletter/campaigns/:id" element={<CampaignEditor />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
  await screen.findByDisplayValue('Winter prices');
}

function audienceSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'campaign.field.audience' }) as HTMLSelectElement;
}

describe('CampaignEditor — settings before content (#1533)', () => {
  it('puts name, language, subject and audience in one settings card above the canvas', async () => {
    await renderEditor();
    const settings = screen.getByRole('region', { name: 'campaign.settings.title' });
    for (const name of ['campaign.field.name', 'campaign.field.subject']) {
      expect(within(settings).getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(within(settings).getByRole('combobox', { name: 'campaign.field.language' })).toBeInTheDocument();
    expect(within(settings).getByRole('combobox', { name: 'campaign.field.audience' })).toBeInTheDocument();
    expect(within(settings).queryByTestId('email-canvas')).toBeNull();

    const canvas = screen.getByTestId('email-canvas');
    expect(settings.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has one preview — the builder\'s own, in the campaign\'s language — and no preview card', async () => {
    await renderEditor();
    expect(screen.queryByRole('button', { name: 'campaign.action.preview' })).toBeNull();
    expect(screen.queryByTitle('campaign.preview.frame')).toBeNull();
    expect(paneProps).toHaveBeenLastCalledWith(expect.objectContaining({ previewLanguage: 'pl-PL' }));
  });

  it('says "Saved" beside the actions in a polite status, not as a banner', async () => {
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'common.action.save' }));
    const saved = await screen.findByText('common.saved');
    expect(saved.closest('[role="status"]')).not.toBeNull();
    expect(saved.closest('[data-slot="alert"], [role="alert"]')).toBeNull();
  });
});

describe('CampaignEditor — tag audiences (#1533)', () => {
  it('offers a single tag as radios: picking one replaces the other', async () => {
    getCampaign.mockResolvedValue(detail({ targetType: 'tag', targetTagIds: [TAGS[0]!.id] }));
    await renderEditor();
    const group = await screen.findByRole('group', { name: 'campaign.audience.tag' });
    const vip = within(group).getByRole('radio', { name: 'VIP' });
    const b2b = within(group).getByRole('radio', { name: 'B2B' });
    expect(vip).toBeChecked();
    expect(within(group).queryByRole('checkbox')).toBeNull();

    await userEvent.click(b2b);
    expect(b2b).toBeChecked();
    expect(vip).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'common.action.save' }));
    await waitFor(() =>
      expect(updateCampaign).toHaveBeenCalledWith(ID, expect.objectContaining({ targetTagIds: [TAGS[1]!.id] })),
    );
  });

  it('offers a tag list as checkboxes, and keeps one tag when narrowed to a single tag', async () => {
    getCampaign.mockResolvedValue(detail({ targetType: 'tag_list', targetTagIds: [TAGS[0]!.id, TAGS[1]!.id] }));
    await renderEditor();
    const group = await screen.findByRole('group', { name: 'campaign.audience.tags' });
    expect(within(group).getAllByRole('checkbox', { checked: true })).toHaveLength(2);

    await userEvent.selectOptions(audienceSelect(), 'tag');
    const radios = within(await screen.findByRole('group', { name: 'campaign.audience.tag' })).getAllByRole('radio', { checked: true });
    expect(radios).toHaveLength(1);
    expect(radios[0]).toHaveAccessibleName('VIP');
  });
});

describe('CampaignEditor — the manual group (#1533)', () => {
  it('shows who is already in the group and adds a subscriber found by search', async () => {
    getCampaign.mockResolvedValue(detail({ targetType: 'group' }));
    getCampaignGroup.mockResolvedValue({ items: [CELINA] });
    await renderEditor();

    const picker = await screen.findByRole('combobox', { name: 'campaign.audience.subscribers' });
    // Celina is not among the active subscribers loaded, and is still named.
    await screen.findByText('celina@shop.test');
    expect(screen.getByText('campaign.audience.selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.action.save' })).toBeInTheDocument();

    await userEvent.type(picker, 'bol');
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: /anna/ })).toBeNull();
    await userEvent.click(within(listbox).getByRole('option', { name: /bolek/ }));

    await userEvent.click(screen.getByRole('button', { name: 'common.action.save' }));
    await waitFor(() => expect(setCampaignGroup).toHaveBeenCalledWith(ID, [CELINA.id, BOLEK.id]));
  });

  it('does not rewrite an untouched group on save', async () => {
    getCampaign.mockResolvedValue(detail({ targetType: 'group' }));
    getCampaignGroup.mockResolvedValue({ items: [CELINA] });
    await renderEditor();
    await screen.findByText('celina@shop.test');
    await userEvent.click(screen.getByRole('button', { name: 'common.action.save' }));
    await waitFor(() => expect(updateCampaign).toHaveBeenCalled());
    expect(setCampaignGroup).not.toHaveBeenCalled();
  });

  it('locks the picker and says why when the group cannot be read, so a save cannot empty it', async () => {
    getCampaign.mockResolvedValue(detail({ targetType: 'group' }));
    getCampaignGroup.mockRejectedValue(new Error('offline'));
    await renderEditor();
    expect(await screen.findByText('campaign.audience.groupUnavailable')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'campaign.audience.subscribers' })).toBeDisabled();
  });
});
