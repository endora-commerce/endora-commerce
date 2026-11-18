import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CampaignDetail } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1462 (UX audit CONTENT-04) — *Send* e-mailed the whole audience on one
 * click. It now saves, then asks in the kit's `ConfirmDialog`, naming the
 * subject and how many subscribers the send reaches; the request runs inside
 * the dialog, so a failure stays where the operator is looking, and an
 * audience of nobody is refused before anything is asked.
 */

installOffsetParentShim();

const updateCampaign = vi.fn();
const sendCampaign = vi.fn();
const getCampaign = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

// The e-mail canvas is Puck; the dialog is what is under test, not the editor.
vi.mock('@endora-commerce/page-builder-admin/email', () => ({
  EmailEditorPane: (): ReactNode => <div data-testid="email-canvas" />,
  EmailSubjectWithVariables: ({ value }: { value: string }): ReactNode => <input aria-label="subject" value={value} readOnly />,
  EmailVariablesProvider: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
  listEmailTemplatesForApply: async () => [],
  loadEmailTemplateCanvas: async () => null,
  saveCanvasAsEmailTemplate: async () => undefined,
  mergeEmailVariables: () => [],
}));

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: async () => ({ items: [] }),
    listCustomFields: async () => ({ items: [] }),
    listSubscribers: async () => ({ items: [] }),
    getCampaign: (...args: unknown[]) => getCampaign(...args),
    updateCampaign: (...args: unknown[]) => updateCampaign(...args),
    setCampaignGroup: vi.fn(),
    createCampaign: vi.fn(),
    previewCampaign: vi.fn(),
    sendCampaign: (...args: unknown[]) => sendCampaign(...args),
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
    language: 'en-US',
    targetTagIds: [],
    trackingEnabled: true,
    audienceEstimate: 1240,
    stats: null,
    version: 3,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const BUNDLE = {
  newsletter: {
    ...passthroughBundle('newsletter', [
      'campaign.action.send',
      'campaign.send.title',
      'campaign.send.noAudience',
      'campaign.send.notice.sent',
      'campaign.send.notice.queued',
      'campaign.send.failed',
      'campaign.send.audience.all',
      'campaign.audience.title',
    ]).newsletter,
    'campaign.send.message.other': '{subject} → {count} ({audience})',
    'campaign.send.confirm.other': 'Send to {count} subscribers',
  },
  ...passthroughBundle('core', ['common.action.cancel', 'common.confirm.title']),
};

beforeEach(() => {
  getCampaign.mockReset().mockResolvedValue(detail({ version: 2 }));
  updateCampaign.mockReset().mockResolvedValue(detail());
  sendCampaign.mockReset();
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
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await screen.findByDisplayValue('Winter prices');
}

describe('CampaignEditor — send asks first, naming the audience (#1462)', () => {
  it('saves, then asks with the subject and recipient count, focus on Cancel; Cancel sends nothing', async () => {
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'campaign.action.send' }));

    const dialog = await screen.findByRole('dialog', { name: 'campaign.send.title' });
    expect(updateCampaign).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveTextContent('Winter prices → 1,240 (campaign.send.audience.all)');
    expect(within(dialog).getByRole('button', { name: 'Send to 1,240 subscribers' })).toBeInTheDocument();
    // An irreversible mass send is not defaulted into by Enter.
    expect(within(dialog).getByRole('button', { name: 'common.action.cancel' })).toHaveFocus();

    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('sends the saved version on confirm and closes with a notice', async () => {
    sendCampaign.mockResolvedValue(detail({ status: 'sent', version: 4, audienceEstimate: null }));
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'campaign.action.send' }));
    await answerConfirm(true);

    await waitFor(() => expect(sendCampaign).toHaveBeenCalledWith(ID, 3));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('campaign.send.notice.sent')).toBeInTheDocument();
  });

  it('keeps the dialog open with the error when the send fails, and blocks a second click while in flight', async () => {
    let reject: (err: Error) => void = () => undefined;
    sendCampaign.mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'campaign.action.send' }));
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Send to 1,240 subscribers' });
    await userEvent.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    reject(new Error('boom'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('campaign.send.failed');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirmButton).toBeEnabled();
    expect(sendCampaign).toHaveBeenCalledTimes(1);
  });

  it('refuses to ask when the audience reaches nobody', async () => {
    updateCampaign.mockResolvedValue(detail({ audienceEstimate: 0 }));
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'campaign.action.send' }));

    expect(await screen.findByText('campaign.send.noAudience')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('does not ask when the save before the send fails', async () => {
    updateCampaign.mockRejectedValue(new Error('conflict'));
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'campaign.action.send' }));

    expect(await screen.findByText('conflict')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it('puts the audience before the content, so the target is chosen first', async () => {
    await renderEditor();
    const audience = screen.getByText('campaign.audience.title');
    const canvas = screen.getByTestId('email-canvas');
    expect(audience.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
