import { StrictMode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import quoteRequestsEn from '../../../../packages/modules/quote_requests/i18n/en.json';
import documentTemplatesEn from '../../../../packages/modules/document_templates/i18n/en.json';
import { BUNDLE as CORE_BUNDLE, RFQ_ID, rfqPayload } from './rfq-reference-fixtures';

const getSpy = vi.fn();
const putSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>('@endora-commerce/admin-kit/components');
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');
const { QuoteRequestPdfDialog } = await import('../../../../packages/modules/quote_requests/src/admin/components/QuoteRequestPdfDialog');

/**
 * `specs/153-quote-request-pdf-template/` T041, T063 — *Export PDF* and *Send
 * PDF to customer* (`contracts/admin-ui.md` §1, §1a): absent while document
 * templates are absent; the preselection rules; the language list following
 * the template; `templateId` sent only when the selection differs from what no
 * choice would use; the built-in layout forgetting a remembered template; the
 * missing-template warning and fallback notice; busy and error states; the
 * management link only with `document_templates:read`; and the send mode's
 * recipients, message and outcomes.
 */

const BUNDLE = {
  ...CORE_BUNDLE,
  quote_requests: quoteRequestsEn as Record<string, string>,
  document_templates: documentTemplatesEn as Record<string, string>,
};
const T1 = '00000000-0000-4000-8000-0000000001a1';
const T2 = '00000000-0000-4000-8000-0000000001a2';

const choices = (over: Record<string, unknown> = {}) => ({
  templates: [
    { id: T1, name: 'Channel quote', salesChannelId: '00000000-0000-4000-8000-0000000000d1', languages: ['pl-PL'], isDefault: true },
    { id: T2, name: 'Plain quote', salesChannelId: null, languages: ['en-US', 'pl-PL'], isDefault: false },
  ],
  rememberedTemplateId: null,
  rememberedTemplateMissing: false,
  effectiveDefaultId: T1,
  builtInLanguages: ['en-US', 'pl-PL'],
  suggestedLanguage: 'pl-PL',
  requesterEmail: 'buyer@example.com',
  ...over,
});

let fetchSpy: ReturnType<typeof vi.fn>;
function answerPdf(headers: Record<string, string> = {}, status = 200, body: unknown = null): void {
  fetchSpy.mockImplementation(async () =>
    status === 200
      ? new Response('%PDF-1.4', {
          status,
          headers: { 'content-disposition': 'attachment; filename="RFQ-0146.pdf"', 'x-document-template-missing': 'false', ...headers },
        })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  postSpy.mockReset();
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  URL.createObjectURL = vi.fn(() => 'blob:pdf');
  URL.revokeObjectURL = vi.fn();
  putSpy.mockResolvedValue({ data: { documentTemplateId: null } });
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog(
  mode: 'download' | 'send',
  options: { permissions?: string[]; choices?: Record<string, unknown> } = {},
): { onClose: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn>; container: HTMLElement } {
  getSpy.mockResolvedValue({ data: choices(options.choices) });
  const onClose = vi.fn();
  const onDone = vi.fn();
  const { container } = renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter>
          <QuoteRequestPdfDialog quoteRequestId={RFQ_ID} mode={mode} onClose={onClose} onDone={onDone} />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: options.permissions ?? ['rfqs:handle', 'document_templates:read'] }),
          presence: modulePresence({ present: ['quote_requests', 'document_templates', 'transactional_emails'] }),
          contributions: [],
        },
      )}
    </StrictMode>,
    BUNDLE,
  );
  return { onClose, onDone, container };
}

const templateSelect = () => screen.getByLabelText('Template') as HTMLSelectElement;
const languageSelect = () => screen.getByLabelText('Language') as HTMLSelectElement;
const pdfUrl = (): URL => new URL(String(fetchSpy.mock.calls.at(-1)![0]));

/**
 * Clicks `name` in the very microtask its loaded form commits enabled — before
 * any passive effect of that commit has run, which is the earliest a person (or
 * a loaded test host's `waitFor`) can reach it. A select whose controlled value
 * matches no option still *shows* its first option, so the DOM cannot tell a
 * language that is chosen from one that is merely displayed (issue #524); what
 * is sent can.
 */
async function clickTheMomentItEnables(name: string): Promise<void> {
  const ready = (): HTMLButtonElement | null => {
    const button = screen.queryByRole('button', { name }) as HTMLButtonElement | null;
    return button && !button.disabled && screen.queryByLabelText('Language') ? button : null;
  };
  const button = ready() ?? (await new Promise<HTMLButtonElement>((resolve) => {
    const observer = new MutationObserver(() => {
      const found = ready();
      if (!found) return;
      observer.disconnect();
      resolve(found);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }));
  fireEvent.click(button);
}

describe('the quote request screen', () => {
  function renderDetail(present: string[]): void {
    getSpy.mockImplementation((url: string) =>
      url === `/api/v1/admin/quote-requests/${RFQ_ID}` ? Promise.resolve({ data: rfqPayload() }) : Promise.resolve({ data: {} }),
    );
    renderWithI18n(
      <StrictMode>
        {withSession(
          <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
            <Routes>
              <Route path="/quote-requests/:id" element={createElement(RfqDetail)} />
            </Routes>
          </MemoryRouter>,
          { session: adminSession({ permissions: ['rfqs:handle'] }), presence: modulePresence({ present }), contributions: [] },
        )}
      </StrictMode>,
      BUNDLE,
    );
  }

  it('offers Export PDF and Send PDF to customer while document templates and e-mails are present', async () => {
    renderDetail(['quote_requests', 'document_templates', 'transactional_emails']);
    // In the header's "More" menu since #1497 (SALES-12).
    fireEvent.pointerDown(await screen.findByRole('button', { name: /common\.action\.more|^More$/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: 'Export PDF' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Send PDF to customer' })).toBeTruthy();
  });

  it('offers no send while the transactional e-mails are absent, and still the export (FR-099)', async () => {
    renderDetail(['quote_requests', 'document_templates']);
    fireEvent.pointerDown(await screen.findByRole('button', { name: /common\.action\.more|^More$/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: 'Export PDF' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Send PDF to customer' })).toBeNull();
  });

  it('offers neither while document templates are absent (FR-060)', async () => {
    renderDetail(['quote_requests', 'transactional_emails']);
    await screen.findByText(/RFQ-0146|rfq\.detail\.title/);
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send PDF to customer' })).toBeNull();
  });
});

describe('Export PDF', () => {
  it('preselects the effective default, its languages, the channel’s language; no axe violation', async () => {
    const { container } = renderDialog('download');
    await waitFor(() => expect(templateSelect().value).toBe(T1));
    expect(within(templateSelect()).queryByRole('option', { name: 'Built-in layout' })).toBeNull();
    expect([...languageSelect().options].map((o) => o.value)).toEqual(['pl-PL']);
    expect(languageSelect().value).toBe('pl-PL');
    expect(screen.getByText('Your choice is remembered for this quote.')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('the remembered template wins; a missing one warns and falls back to the default', async () => {
    renderDialog('download', { choices: { rememberedTemplateId: T2 } });
    await waitFor(() => expect(templateSelect().value).toBe(T2));
    expect([...languageSelect().options].map((o) => o.value)).toEqual(['en-US', 'pl-PL']);
  });

  it('a missing remembered template warns and preselects the default', async () => {
    renderDialog('download', { choices: { rememberedTemplateId: '00000000-0000-4000-8000-0000000001ff', rememberedTemplateMissing: true } });
    expect(await screen.findByText('The template chosen for this quote no longer exists. The default is selected.')).toBeTruthy();
    expect(templateSelect().value).toBe(T1);
  });

  it('only the built-in layout when nothing else applies', async () => {
    renderDialog('download', { choices: { templates: [], effectiveDefaultId: null } });
    await waitFor(() => expect(templateSelect().value).toBe('__built_in__'));
    expect(within(templateSelect()).getByRole('option', { name: 'Built-in layout' })).toBeTruthy();
  });

  it('downloads without templateId when the preselected default is kept, so the quote is not pinned', async () => {
    answerPdf();
    const { onClose } = renderDialog('download');
    await waitFor(() => expect(templateSelect().value).toBe(T1));
    await waitFor(() => expect(languageSelect().value).toBe('pl-PL'));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pdfUrl().pathname).toBe(`/api/v1/admin/quote-requests/${RFQ_ID}/pdf`);
    expect(pdfUrl().searchParams.get('templateId')).toBeNull();
    expect(pdfUrl().searchParams.get('language')).toBe('pl-PL');
  });

  it('sends the preselected language even when Download is clicked the moment it enables (#524)', async () => {
    answerPdf();
    const { onClose } = renderDialog('download');
    await clickTheMomentItEnables('Download PDF');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pdfUrl().searchParams.get('language')).toBe('pl-PL');
  });

  it('sends templateId for a different choice, and says when the default had to be used', async () => {
    answerPdf({ 'x-document-template-missing': 'true' });
    const { onDone } = renderDialog('download');
    await waitFor(() => expect(templateSelect().value).toBe(T1));
    fireEvent.change(templateSelect(), { target: { value: T2 } });
    fireEvent.change(languageSelect(), { target: { value: 'en-US' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(pdfUrl().searchParams.get('templateId')).toBe(T2);
    expect(pdfUrl().searchParams.get('language')).toBe('en-US');
    expect(onDone).toHaveBeenCalledWith({ kind: 'warning', message: 'The chosen template no longer exists, so the default template was used.' });
  });

  it('choosing the built-in layout while a template is remembered forgets it first', async () => {
    answerPdf();
    renderDialog('download', { choices: { templates: [{ id: T2, name: 'Plain quote', salesChannelId: null, languages: ['en-US'], isDefault: false }], effectiveDefaultId: null, rememberedTemplateId: T2 } });
    await waitFor(() => expect(templateSelect().value).toBe(T2));
    fireEvent.change(templateSelect(), { target: { value: '__built_in__' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/quote-requests/${RFQ_ID}/document-template`, { documentTemplateId: null });
    expect(pdfUrl().searchParams.get('templateId')).toBeNull();
  });

  it('keeps the dialog open with a translated error; the buttons are busy while it works', async () => {
    let release: (value: Response) => void = () => undefined;
    fetchSpy.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    const { onClose } = renderDialog('download');
    await waitFor(() => expect(templateSelect().value).toBe(T1));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('button', { name: 'Preparing the PDF…' })).toHaveProperty('disabled', true);
    release(new Response(JSON.stringify({ error: { code: 'DOCUMENT_RENDER_FAILED', message: 'x' } }), { status: 503 }));
    expect(await screen.findByText(documentTemplatesEn['errors.DOCUMENT_RENDER_FAILED' as keyof typeof documentTemplatesEn] as string)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('links to the quote templates only with document_templates:read', async () => {
    renderDialog('download');
    expect((await screen.findByRole('link', { name: 'Manage PDF templates' })).getAttribute('href')).toBe(
      '/document-templates?type=quote_requests.quote_request',
    );
  });

  it('no management link without the permission', async () => {
    renderDialog('download', { permissions: ['rfqs:handle'] });
    await waitFor(() => expect(templateSelect().value).toBe(T1));
    expect(screen.queryByRole('link', { name: 'Manage PDF templates' })).toBeNull();
  });
});

describe('Send PDF to customer (owner answer Q4)', () => {
  it('preselects the requester; no axe violation', async () => {
    const { container } = renderDialog('send');
    expect(((await screen.findByLabelText('Recipient 1')) as HTMLInputElement).value).toBe('buyer@example.com');
    await expectNoAxeViolations(container);
  });

  it('refuses a malformed or duplicate address before sending, and stops at five', async () => {
    renderDialog('send');
    await screen.findByLabelText('Recipient 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Recipient 2'), { target: { value: 'not-an-address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Recipient 2'), { target: { value: 'BUYER@example.com' } });
    expect(await screen.findByText('This address is already on the list.')).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    expect((screen.getByRole('button', { name: 'Add recipient' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('You can send to at most 5 addresses at once.')).toBeTruthy();
  });

  it('sends the recipients, the message and the choice; reports a partial delivery', async () => {
    postSpy.mockResolvedValue({ data: { sent: ['buyer@example.com'], failed: ['two@example.com'], templateId: T2, templateSource: 'explicit', requestedTemplateMissing: false } });
    const { onDone, onClose } = renderDialog('send');
    await screen.findByLabelText('Recipient 1');
    fireEvent.change(templateSelect(), { target: { value: T2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Recipient 2'), { target: { value: 'two@example.com' } });
    fireEvent.change(screen.getByLabelText('Personal message (optional)'), { target: { value: 'Hello' } });
    expect(screen.getByText('5 / 2000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/quote-requests/${RFQ_ID}/pdf/send`, {
      recipients: ['buyer@example.com', 'two@example.com'],
      templateId: T2,
      language: 'pl-PL',
      message: 'Hello',
    });
    expect(onDone).toHaveBeenCalledWith({
      kind: 'warning',
      message: 'The quote PDF was sent to 1 recipient(s). It could not be delivered to: two@example.com.',
    });
  });

  it('sends the preselected language even when Send is clicked the moment it enables (#524)', async () => {
    postSpy.mockResolvedValue({ data: { sent: ['buyer@example.com'], failed: [], templateId: T1, templateSource: 'default', requestedTemplateMissing: false } });
    const { onClose } = renderDialog('send');
    await clickTheMomentItEnables('Send');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/quote-requests/${RFQ_ID}/pdf/send`, { recipients: ['buyer@example.com'], language: 'pl-PL' });
  });

  it('says why when the e-mail is switched off, and stays open', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE', message: 'x', details: { code: 'deactivated' } } } as never),
    );
    const { onClose } = renderDialog('send');
    await screen.findByLabelText('Recipient 1');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(quoteRequestsEn['errors.QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE.deactivated' as keyof typeof quoteRequestsEn] as string)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
