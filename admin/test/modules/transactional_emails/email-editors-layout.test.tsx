import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { withLocalStorage } from '../../helpers/with-local-storage';
import { withViewportWidth } from '../../helpers/with-viewport-width';

/**
 * The transactional e-mail editor and the e-mail block / template editor in the
 * shell every Page Builder editor shares.
 *
 * These two are the shell's third shape. A CMS or blog editor has fields that
 * describe the entity — a name, a slug, a scope — and those go into a panel
 * that can be put away. An e-mail editor has none: the sales channel and the
 * language say **which message** is on the canvas, and the subject is the first
 * line of the message. Putting any of them behind a collapsed panel would hide
 * either what is being edited or part of what is being written, so the screen
 * has no panel and no control for one; what the tests below hold is that the
 * three stay with the canvas, in the order they are read, on a laptop as on a
 * wide monitor.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    useAuth: () => ({ hasPermission: () => true }),
  };
});

// Puck needs an iframe and a layout engine, and nothing here is about the canvas.
vi.mock(
  '../../../../packages/modules/transactional_emails/src/admin/components/EmailEditorPane',
  () => ({
    // Issue #1461 — the stub can emit a canvas edit.
    EmailEditorPane: ({ onChange }: { onChange?: (data: unknown) => void }): ReactElement => (
      <div data-testid="canvas-stub">
        canvas
        <button type="button" onClick={() => onChange?.({ root: { props: {} }, content: [{ type: 'Text', props: { id: 't1' } }] })}>
          edit-canvas
        </button>
      </div>
    ),
  }),
);

const { EmailEditor } = await import(
  '../../../../packages/modules/transactional_emails/src/admin/pages/EmailEditor'
);
const { EmailFragmentEditor } = await import(
  '../../../../packages/modules/transactional_emails/src/admin/pages/EmailFragmentEditor'
);

function bundleOf(pkg: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = bundleOf('transactional_emails', 'en');
const pl = bundleOf('transactional_emails', 'pl');
const core = bundleOf('_i18n', 'en');

/** The shipped `core` copy of the unsaved-changes guard (issue #1461). */
function ux(key: string): string {
  const value = core[`form.unsavedChanges.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "form.unsavedChanges.${key}"`);
  return value;
}

function copy(key: string): string {
  const value = en[key];
  if (!value) throw new Error(`transactional_emails/i18n/en.json carries no "${key}"`);
  return value;
}

/** The shipped English copy of the shared shell, which this screen must not render. */
function shell(key: string): string {
  const value = core[`pageBuilder.editorLayout.${key}`];
  if (!value) throw new Error(`_i18n/i18n/en.json carries no "pageBuilder.editorLayout.${key}"`);
  return value;
}

const content = { root: { props: {} }, content: [] };

const detail = {
  code: 'order_confirmation',
  name: 'Order confirmation',
  ownerModule: 'orders',
  group: 'orders',
  description: null,
  active: true,
  languages: ['en-US', 'pl-PL'],
  variables: [],
  scope: { salesChannelId: null, language: 'en-US' },
  effective: { subject: 'Your order {{var order.businessId}}', content, source: 'default' },
  default: { subject: 'Your order', content },
  hasGlobalOverride: false,
  hasChannelOverride: false,
  deactivatable: true,
  nonDeactivatableReason: null,
};

const fragment = {
  id: 'fragment-1',
  code: 'footer',
  name: 'Shop footer',
  languages: ['en-US', 'pl-PL'],
  content: { 'en-US': content },
  version: 2,
};

function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderAt(path: string, routePath: string, element: ReactElement): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>,
    { transactional_emails: en, core },
  );
}

let put: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  withLocalStorage();
  // A laptop: the width at which the other editors start with their panel away.
  withViewportWidth(1440);
  vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({
        items: [{ id: 'channel-1', code: 'web', name: { 'en-US': 'Web shop', 'pl-PL': 'Sklep internetowy' } }],
        page: 1,
        pageSize: 100,
        total: 1,
      } as never);
    }
    if (path.startsWith('/api/v1/admin/transactional-emails/order_confirmation')) {
      return Promise.resolve({ data: detail } as never);
    }
    if (/\/transactional-emails\/(blocks|templates)\/fragment-1$/.test(path)) {
      return Promise.resolve({ data: fragment } as never);
    }
    return Promise.resolve({ data: { items: [] } } as never);
  });
  put = vi
    .spyOn(apiClient, 'put')
    .mockResolvedValue({ data: { ...detail.effective, ...fragment } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmailEditor in the shared editor shell', () => {
  async function open(): Promise<void> {
    renderAt('/transactional-emails/order_confirmation', '/transactional-emails/:code', <EmailEditor />);
    await screen.findByRole('heading', { level: 1, name: 'Order confirmation' });
    await waitFor(() => {
      expect((screen.getByLabelText(copy('editor.subject')) as HTMLInputElement).value).toBe(
        'Your order {{var order.businessId}}',
      );
    });
  }

  it('gives the canvas its own named region, without a card around it', async () => {
    await open();

    const builder = screen.getByRole('region', { name: copy('editor.content') });
    expect(within(builder).getByTestId('canvas-stub')).toBeTruthy();
    expect(within(builder).queryByLabelText(copy('editor.subject'))).toBeNull();
  });

  it('keeps the scope, the language and the subject with the canvas, in reading order', async () => {
    await open();

    const scope = screen.getByLabelText(copy('editor.scope'));
    const language = screen.getByLabelText(copy('editor.language'));
    const subject = screen.getByLabelText(copy('editor.subject'));
    const canvas = screen.getByTestId('canvas-stub');

    expect(precedes(scope, language)).toBe(true);
    expect(precedes(language, subject)).toBe(true);
    expect(precedes(subject, canvas)).toBe(true);
  });

  it('never hides them: no settings panel and no control for one, even on a laptop', async () => {
    await open();

    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: shell('showSettings') })).toBeNull();
    expect(screen.queryByRole('button', { name: shell('hideSettings') })).toBeNull();
    for (const label of ['editor.scope', 'editor.language', 'editor.subject']) {
      expect(screen.getByLabelText(copy(label)).closest('[hidden]')).toBeNull();
    }
  });

  it('says which message is on the canvas: the scope select names every channel and the default', async () => {
    await open();

    const scope = screen.getByLabelText(copy('editor.scope')) as HTMLSelectElement;
    await waitFor(() => expect(scope.options.length).toBe(2));
    expect(scope.options[0]?.textContent).toBe(copy('scope.global'));
    // By the channel's name, not its code (#1536, CONTENT-19).
    expect(scope.options[1]?.textContent).toBe('Web shop');
  });

  it('says where the content comes from in words, not as the API code (#1536)', async () => {
    await open();
    expect(screen.getByText(copy('source.default'))).toBeInTheDocument();
    expect(screen.queryByText('default')).toBeNull();
  });

  it('says the save is running while it runs (#1536)', async () => {
    let finish: (value: unknown) => void = () => undefined;
    put.mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    await open();

    fireEvent.click(screen.getByRole('button', { name: copy('editor.save') }));
    expect(await screen.findByRole('button', { name: copy('editor.saving') })).toBeInTheDocument();
    finish({ data: { ...detail.effective } });
    await waitFor(() => expect(screen.getByRole('button', { name: copy('editor.save') })).toBeInTheDocument());
  });

  it('saves the subject and the canvas in the request it always sent', async () => {
    await open();

    fireEvent.change(screen.getByLabelText(copy('editor.subject')), {
      target: { value: 'Thank you for your order' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy('editor.save') }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toContain('/api/v1/admin/transactional-emails/order_confirmation/content');
    expect(path).toContain('language=en-US');
    expect(body).toEqual({ subject: 'Thank you for your order', content });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(copy('editor.saved'));
    });
  });

  it('shows a refused save above the subject it is most often about', async () => {
    put.mockRejectedValue(new Error('Subject is required'));
    await open();

    fireEvent.click(screen.getByRole('button', { name: copy('editor.save') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Subject is required');
    expect(precedes(alert, screen.getByLabelText(copy('editor.subject')))).toBe(true);
  });

  it('refuses a save without a subject itself, says so, and puts the cursor in the field', async () => {
    await open();

    fireEvent.change(screen.getByLabelText(copy('editor.subject')), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: copy('editor.save') }));

    expect((await screen.findByRole('alert')).textContent).toContain(copy('editor.subjectRequired'));
    expect(put).not.toHaveBeenCalled();
    const subject = screen.getByLabelText(copy('editor.subject'));
    expect(document.activeElement).toBe(subject);
    expect(subject.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the save action outside the builder region', async () => {
    await open();
    expect(screen.getByRole('button', { name: copy('editor.save') }).closest('section')).toBeNull();
  });
});

describe.each(['block', 'template'] as const)('EmailFragmentEditor (%s) in the shared editor shell', (kind) => {
  async function open(): Promise<void> {
    renderAt(
      `/transactional-emails/${kind}s/fragment-1`,
      `/transactional-emails/${kind}s/:id`,
      <EmailFragmentEditor kind={kind} />,
    );
    await screen.findByRole('heading', { level: 1, name: 'Shop footer' });
  }

  it('gives the canvas its own named region with the language switch above it and no panel', async () => {
    await open();

    const builder = screen.getByRole('region', { name: copy('editor.content') });
    const language = screen.getByLabelText(copy('editor.language'));
    expect(within(builder).getByTestId('canvas-stub')).toBeTruthy();
    expect(precedes(language, builder)).toBe(true);
    expect(builder.contains(language)).toBe(false);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('saves the canvas in the request it always sent', async () => {
    await open();

    fireEvent.click(screen.getByRole('button', { name: copy('editor.save') }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/api/v1/admin/transactional-emails/${kind}s/fragment-1/content/en-US`);
    expect(body).toEqual({ content, expectedVersion: 2 });
  });
});

describe('the e-mail editor copy ships in both languages', () => {
  it.each([
    'editor.scope',
    'editor.language',
    'editor.subject',
    'editor.content',
    'editor.save',
    'editor.saveAndExit',
    'editor.saved',
    'editor.subjectRequired',
    'editor.reset',
    'editor.resetConfirm',
    'editor.resetDone',
    'editor.saving',
    'source.default',
    'source.global',
    'source.channel',
    'editor.noPermission',
    'editor.blockContent',
    'editor.templateContent',
    'scope.global',
  ])('%s', (key) => {
    expect(en[key]).toBeTruthy();
    expect(pl[key]).toBeTruthy();
  });

  it('is translated, not copied, where Polish has its own words', () => {
    for (const key of ['editor.scope', 'editor.language', 'editor.saved', 'editor.resetConfirm']) {
      expect(pl[key]).not.toBe(en[key]);
    }
  });
});

/**
 * Issue #1461 (UX audit CONTENT-02) — an e-mail editor compares its subject and
 * canvas with what was loaded. A switch of channel or language reloads the
 * canvas, so it asks Save / Discard / Stay first, as a link out of the editor does.
 */
describe('EmailEditor — unsaved changes', () => {
  async function open(): Promise<void> {
    renderAt('/transactional-emails/order_confirmation', '/transactional-emails/:code', <EmailEditor />);
    await screen.findByRole('heading', { level: 1, name: 'Order confirmation' });
    await waitFor(() => {
      expect((screen.getByLabelText(copy('editor.subject')) as HTMLInputElement).value).toBe(
        'Your order {{var order.businessId}}',
      );
    });
  }

  it('is clean as loaded and says so once the subject is edited', async () => {
    await open();
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.change(screen.getByLabelText(copy('editor.subject')), { target: { value: 'Thanks' } });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
  });

  it('asks before a language switch would reload over the edit; Stay keeps both', async () => {
    await open();
    fireEvent.change(screen.getByLabelText(copy('editor.subject')), { target: { value: 'Thanks' } });
    fireEvent.change(screen.getByLabelText(copy('editor.language')), { target: { value: 'pl-PL' } });
    const dialog = screen.getByRole('dialog', { name: ux('title') });
    fireEvent.click(within(dialog).getByRole('button', { name: ux('stay') }));
    expect((screen.getByLabelText(copy('editor.subject')) as HTMLInputElement).value).toBe('Thanks');
    expect((screen.getByLabelText(copy('editor.language')) as HTMLSelectElement).value).toBe('en-US');
  });

  it('Save and continue saves, then switches', async () => {
    await open();
    fireEvent.change(screen.getByLabelText(copy('editor.subject')), { target: { value: 'Thanks' } });
    fireEvent.change(screen.getByLabelText(copy('editor.language')), { target: { value: 'pl-PL' } });
    fireEvent.click(screen.getByRole('button', { name: ux('save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ subject: 'Thanks' });
  });
});

describe('EmailFragmentEditor — unsaved changes', () => {
  it('a canvas edit is unsaved; a language switch asks and Discard switches', async () => {
    renderAt('/transactional-emails/blocks/fragment-1', '/transactional-emails/blocks/:id', <EmailFragmentEditor kind="block" />);
    await screen.findByRole('heading', { level: 1, name: 'Shop footer' });
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'edit-canvas' }));
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(ux('hint'));
    fireEvent.change(screen.getByLabelText(copy('editor.language')), { target: { value: 'pl-PL' } });
    fireEvent.click(screen.getByRole('button', { name: ux('discard') }));
    expect((screen.getByLabelText(copy('editor.language')) as HTMLSelectElement).value).toBe('pl-PL');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
