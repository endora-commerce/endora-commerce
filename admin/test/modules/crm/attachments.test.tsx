import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OPPORTUNITY_ATTACHMENT_MAX_BYTES, type OpportunityAttachment } from '@endora-commerce/contracts';
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
 * to an Opportunity. A file is added through CRM's own upload, which asks for
 * `crm:write` and nothing of the media library's; a download link is
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
 * The upload is multipart, which the JSON client above does not speak, so the
 * screen sends it with `fetch`. The suite's own `fetch` refuses every request;
 * this one answers the upload and records what it was sent.
 */
const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const ATTACHMENTS_PATH = `${DETAIL_PATH}/attachments`;
const ID = (n: number): string => `00000000-0000-4000-8000-0000000a700${n}`;
const UPLOAD_PATH = `${ATTACHMENTS_PATH}/upload`;
/** Exactly what a Sales Rep holds: nothing of the media library's. */
const WRITER = ['crm:read', 'crm:write', 'orders:read'];

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
  for (const spy of [getSpy, postSpy, deleteSpy, fetchSpy]) spy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
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
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fileInput = (panel: HTMLElement): HTMLInputElement =>
  panel.querySelector('input[type="file"]') as HTMLInputElement;

const pdf = (name: string, size?: number): File => {
  const file = new File(['%PDF-1.4 offer'], name, { type: 'application/pdf' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};

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

  it('adds a file with crm:write alone, through CRM\'s own upload', async () => {
    const added = attachment({ id: ID(3), assetId: UPLOADED_ASSET_ID, fileName: 'offer.pdf' });
    fetchSpy.mockImplementation(() => {
      attachments = [...attachments, added];
      return Promise.resolve(json(201, { data: added }));
    });
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    expect(within(panel).getByRole('button', { name: en('attachments.upload') })).toBeEnabled();

    await userEvent.upload(fileInput(panel), pdf('offer.pdf'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`${UPLOAD_PATH}$`));
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    const sent = (init?.body as FormData).get('file') as File;
    expect(sent.name).toBe('offer.pdf');
    // One request does both halves: nothing is attached by id afterwards, and
    // the media library's own endpoints are never asked.
    expect(postSpy).not.toHaveBeenCalled();
    expect(await within(panel).findByText('offer.pdf')).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent(en('attachments.added'));
  });

  it('says a file is being uploaded and takes no second one meanwhile', async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => (finish = resolve)));
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    await userEvent.upload(fileInput(panel), pdf('offer.pdf'));

    const button = await within(panel).findByRole('button', { name: en('attachments.upload') });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).getByText(en('attachments.uploading', { name: 'offer.pdf' }))).toBeInTheDocument();

    finish(json(201, { data: attachment({ id: ID(3), fileName: 'offer.pdf' }) }));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('shows the refusal when the file is not accepted', async () => {
    fetchSpy.mockResolvedValue(
      json(415, { error: { code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED', message: 'This file type is not allowed.' } }),
    );
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    await userEvent.upload(fileInput(panel), pdf('macro.pdf'));
    expect(await within(panel).findByText('This file type is not allowed.')).toBeInTheDocument();
    expect(within(panel).queryByText('macro.pdf')).toBeNull();
  });

  it('refuses a file over the limit before sending it', async () => {
    const panel = await openTab();
    await within(panel).findByText('brief.pdf');
    await userEvent.upload(fileInput(panel), pdf('scan.pdf', OPPORTUNITY_ATTACHMENT_MAX_BYTES + 1));
    expect(
      await within(panel).findByText(en('attachments.error.tooLarge', { name: 'scan.pdf', max: '25 MB' })),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(fileInput(panel)).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en('attachments.remove', { name: 'brief.pdf' }) }),
    ).toBeNull();
  });
});
