import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityAttachment } from '@endora-commerce/contracts';
import {
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * Attachments on the Opportunity screen (`specs/143-crm-sales-opportunities/`,
 * User Story 5 — task T081; FR-044 – FR-046): files of the media library linked
 * to an Opportunity. A file is uploaded **private**; a download link is
 * short-lived, so the list is read again right before one is opened.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const UPLOADED_ASSET_ID = '00000000-0000-4000-8000-00000000a55e';

/**
 * The kit's uploader posts multipart with a `fetch` of its own, past the mock
 * above. What this screen owes it is its props — above all `visibility:
 * 'private'`, without which the backend refuses the file — so the stub reports
 * the defaults it was given and "uploads" a fixed asset when pressed.
 */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    AssetUploader: (props: {
      defaults?: { visibility?: string };
      triggerLabel?: string;
      onUploaded: (asset: { id: string }) => void;
    }) => (
      <button
        type="button"
        data-visibility={props.defaults?.visibility ?? ''}
        onClick={(): void => props.onUploaded({ id: UPLOADED_ASSET_ID })}
      >
        {props.triggerLabel}
      </button>
    ),
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const ATTACHMENTS_PATH = `${DETAIL_PATH}/attachments`;
const ID = (n: number): string => `00000000-0000-4000-8000-0000000a700${n}`;
const WRITER = ['crm:read', 'crm:write', 'orders:read', 'assets.write'];

function attachment(overrides: Partial<OpportunityAttachment> = {}): OpportunityAttachment {
  return {
    id: ID(1),
    assetId: '00000000-0000-4000-8000-00000000a551',
    fileName: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2_621_440,
    url: 'https://files.test/brief.pdf?token=first',
    uploadedBy: { id: '00000000-0000-4000-8000-00000000ad01', name: 'Ada Min' },
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

let attachments: OpportunityAttachment[];
let failList = false;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const spy of [getSpy, postSpy, deleteSpy]) spy.mockReset();
  attachments = [attachment(), attachment({ id: ID(2), fileName: 'drawing.dwg', sizeBytes: 512 })];
  failList = false;
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path === ATTACHMENTS_PATH) {
      return failList
        ? Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }))
        : Promise.resolve({ data: attachments });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  openSpy.mockRestore();
});

async function openTab(permissions: readonly string[] = WRITER): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    permissions,
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.attachments') }));
  return screen.findByRole('tabpanel', { name: en('opportunity.tabs.attachments') });
}

const row = (panel: HTMLElement, name: string): HTMLElement =>
  within(panel).getByText(name).closest('tr') as HTMLElement;

function listReads(): number {
  return getSpy.mock.calls.filter(([path]) => path === ATTACHMENTS_PATH).length;
}

describe('the Attachments tab', () => {
  it('lists each file with its name, its size and who attached it', async () => {
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    expect(within(row(panel, 'brief.pdf')).getByText(/2[.,]5\s?MB/)).toBeInTheDocument();
    expect(within(row(panel, 'brief.pdf')).getByText('Ada Min')).toBeInTheDocument();
    expect(within(row(panel, 'drawing.dwg')).getByText(/512\s?(B|byte)/)).toBeInTheDocument();
  });

  it('says there are no attachments yet', async () => {
    attachments = [];
    const panel = await openTab();
    expect(await within(panel).findByText(en('attachments.empty'))).toBeInTheDocument();
  });

  it('says the attachments could not be loaded and tries again', async () => {
    failList = true;
    const panel = await openTab();
    expect(await within(panel).findByText('Boom.')).toBeInTheDocument();
    failList = false;
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.retry') }));
    expect(await within(panel).findByText('brief.pdf')).toBeInTheDocument();
  });

  it('uploads a file as private and attaches it', async () => {
    const added = attachment({ id: ID(3), assetId: UPLOADED_ASSET_ID, fileName: 'offer.pdf' });
    postSpy.mockImplementation(() => {
      attachments = [...attachments, added];
      return Promise.resolve({ data: added });
    });
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    const upload = within(panel).getByRole('button', { name: en('attachments.upload') });
    // The backend refuses an asset that is not private.
    expect(upload).toHaveAttribute('data-visibility', 'private');
    await userEvent.click(upload);

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(ATTACHMENTS_PATH, { assetId: UPLOADED_ASSET_ID }),
    );
    expect(await within(panel).findByText('offer.pdf')).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent(en('attachments.added'));
  });

  it('shows the refusal when the file cannot be attached', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'Only a private file can be attached.' } }),
    );
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    await userEvent.click(within(panel).getByRole('button', { name: en('attachments.upload') }));
    expect(await within(panel).findByText('Only a private file can be attached.')).toBeInTheDocument();
  });

  it('reads the list again right before a download and opens the fresh link', async () => {
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    const before = listReads();
    // The link the screen holds has expired; the list answers a new one.
    attachments = [attachment({ url: 'https://files.test/brief.pdf?token=fresh' }), attachments[1]!];
    await userEvent.click(
      within(row(panel, 'brief.pdf')).getByRole('button', {
        name: en('attachments.download', { name: 'brief.pdf' }),
      }),
    );
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(listReads()).toBe(before + 1);
    expect(openSpy.mock.calls[0]?.[0]).toBe('https://files.test/brief.pdf?token=fresh');
  });

  it('says so when the file is no longer in the media library, and opens nothing', async () => {
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    attachments = [attachment({ url: null }), attachments[1]!];
    await userEvent.click(
      within(row(panel, 'brief.pdf')).getByRole('button', {
        name: en('attachments.download', { name: 'brief.pdf' }),
      }),
    );
    expect(await within(panel).findByText(en('attachments.error.unavailable', { name: 'brief.pdf' }))).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('removes an attachment after asking, and says the file itself is kept', async () => {
    deleteSpy.mockImplementation(() => {
      attachments = attachments.filter((item) => item.id !== ID(1));
      return Promise.resolve(undefined);
    });
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    await userEvent.click(
      within(row(panel, 'brief.pdf')).getByRole('button', {
        name: en('attachments.remove', { name: 'brief.pdf' }),
      }),
    );
    const dialog = screen.getByRole('dialog', { name: en('attachments.remove.title') });
    expect(within(dialog).getByText(en('attachments.remove.body', { name: 'brief.pdf' }))).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('attachments.remove.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${ATTACHMENTS_PATH}/${ID(1)}`));
    await waitFor(() => expect(within(panel).queryByText('brief.pdf')).toBeNull());
    expect(within(panel).getByText('drawing.dwg')).toBeInTheDocument();
  });

  it('lets a reader download and offers nothing that changes anything', async () => {
    const panel = await openTab(['crm:read', 'orders:read']);
    await within(panel).findByText('brief.pdf');
    expect(
      within(panel).getByRole('button', { name: en('attachments.download', { name: 'brief.pdf' }) }),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: en('attachments.upload') })).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en('attachments.remove', { name: 'brief.pdf' }) }),
    ).toBeNull();
  });

  it('explains why there is no upload when the role may not upload to the media library', async () => {
    const panel = await openTab(['crm:read', 'crm:write', 'orders:read']);
    await within(panel).findByText('brief.pdf');
    expect(within(panel).queryByRole('button', { name: en('attachments.upload') })).toBeNull();
    expect(within(panel).getByText(en('attachments.uploadNotAllowed'))).toBeInTheDocument();
    // Removing an attachment needs no permission of the media library.
    expect(
      within(panel).getByRole('button', { name: en('attachments.remove', { name: 'brief.pdf' }) }),
    ).toBeInTheDocument();
  });
});
