import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  CommentComposer,
  CommentThread,
  type CommentThreadApi,
  type CommentThreadCopy,
  type RecordComment,
} from '@endora-commerce/admin-kit/components';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * The notes or messages of one record, promoted from CRM into the kit
 * (`specs/163-projects-and-tasks/` research R-17; T099). The thread knows no
 * module: its requests are an adapter (`api`), whether the reader may write is
 * a prop, and the sentences of its one tab are `copy`.
 */

const CORE: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

function core(key: string): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return template;
}

const ME = '00000000-0000-4000-8000-00000000ad01';
const COLLEAGUE = '00000000-0000-4000-8000-00000000ad02';

const COPY: CommentThreadCopy = {
  title: 'Notes',
  empty: 'No notes yet.',
  hint: 'Notes are internal.',
  composerLabel: 'New note',
  composerPlaceholder: 'Write a note',
  composerSubmit: 'Add note',
  added: 'The note was added.',
  deleteBody: 'The note disappears from this list.',
};

function entry(overrides: Partial<RecordComment> = {}): RecordComment {
  return {
    id: '00000000-0000-4000-8000-0000000c0001',
    kind: 'note',
    author: { id: ME, name: 'Ada Min' },
    body: 'First call went well.',
    references: [],
    editedAt: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

const list = vi.fn<CommentThreadApi['list']>();
const add = vi.fn<CommentThreadApi['add']>();
const update = vi.fn<CommentThreadApi['update']>();
const remove = vi.fn<CommentThreadApi['remove']>();
const API: CommentThreadApi = { list, add, update, remove };
const counted = vi.fn();

beforeEach(() => {
  for (const spy of [list, add, update, remove, counted]) spy.mockReset();
  list.mockResolvedValue([]);
});

function mount(ui: ReactElement): void {
  renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions: ['*'], id: ME }) }),
    { core: CORE },
  );
}

function thread(props: { kind?: 'note' | 'message'; canWrite?: boolean; keepDeleted?: boolean } = {}): ReactElement {
  return (
    <CommentThread
      kind={props.kind ?? 'note'}
      canWrite={props.canWrite ?? true}
      {...(props.keepDeleted ? { keepDeleted: true } : {})}
      api={API}
      copy={COPY}
      referenceKinds={[]}
      lookups={{}}
      onCountChange={counted}
    />
  );
}

describe('CommentThread', () => {
  it('lists the entries with author, time and the edited mark, under the hint', async () => {
    list.mockResolvedValue([
      entry(),
      entry({ id: '00000000-0000-4000-8000-0000000c0002', author: { id: COLLEAGUE, name: 'Piotr' }, body: 'Agreed.', editedAt: '2026-10-05T11:00:00.000Z' }),
    ]);
    mount(thread());
    const items = within(await screen.findByRole('list', { name: COPY.title })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ada Min');
    expect(items[0]).toHaveTextContent('First call went well.');
    expect(items[1]).toHaveTextContent(core('comments.edited'));
    expect(screen.getByText(COPY.hint)).toBeInTheDocument();
  });

  it('says it is empty, in the words it was given', async () => {
    mount(thread());
    expect(await screen.findByText(COPY.empty)).toBeInTheDocument();
  });

  it('offers Edit and Delete on a note only to its author', async () => {
    list.mockResolvedValue([
      entry(),
      entry({ id: '00000000-0000-4000-8000-0000000c0002', author: { id: COLLEAGUE, name: 'Piotr' }, body: 'Theirs.' }),
    ]);
    mount(thread());
    const items = within(await screen.findByRole('list', { name: COPY.title })).getAllByRole('listitem');
    expect(within(items[0]!).getByRole('button', { name: core('comments.edit') })).toBeInTheDocument();
    expect(within(items[0]!).getByRole('button', { name: core('comments.delete') })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button')).toBeNull();
  });

  it('offers neither on a message, not even to its author', async () => {
    list.mockResolvedValue([entry({ kind: 'message' })]);
    mount(thread({ kind: 'message' }));
    const item = within(await screen.findByRole('list', { name: COPY.title })).getByRole('listitem');
    expect(within(item).queryByRole('button')).toBeNull();
  });

  it('adds an entry through the adapter, says so, and reports one more', async () => {
    add.mockImplementation((body) => Promise.resolve(entry({ id: '00000000-0000-4000-8000-0000000c0009', body })));
    mount(thread());
    const field = await screen.findByLabelText(COPY.composerLabel);
    await userEvent.type(field, '  Send the offer  ');
    await userEvent.click(screen.getByRole('button', { name: COPY.composerSubmit }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('Send the offer'));
    expect(await screen.findByText('Send the offer')).toBeInTheDocument();
    expect(screen.getByText(COPY.added)).toBeInTheDocument();
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty entry without asking the server', async () => {
    mount(thread());
    await screen.findByLabelText(COPY.composerLabel);
    await userEvent.click(screen.getByRole('button', { name: COPY.composerSubmit }));
    expect(await screen.findByText(core('comments.error.empty'))).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('edits a note through the adapter', async () => {
    list.mockResolvedValue([entry()]);
    update.mockImplementation((id, body) => Promise.resolve(entry({ id, body, editedAt: '2026-10-06T10:00:00.000Z' })));
    mount(thread());
    await userEvent.click(await screen.findByRole('button', { name: core('comments.edit') }));
    const editor = screen.getByLabelText(core('comments.edit.label'));
    // The field focuses itself with the caret after the text, but the editor applies that focus
    // in an animation frame, which a loaded runner can delay past the first keystroke: the text
    // then landed in front (issue #529). Wait for the focus, then type where the caret is.
    await waitFor(() => expect(editor).toHaveFocus());
    await userEvent.keyboard(' Twice.');
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000c0001', 'First call went well. Twice.'),
    );
    expect(await screen.findByText(core('comments.updated'))).toBeInTheDocument();
    expect(counted).not.toHaveBeenCalled();
  });

  it('deletes a note after asking, in the words it was given, and reports one fewer', async () => {
    list.mockResolvedValue([entry()]);
    remove.mockResolvedValue(undefined);
    mount(thread());
    await userEvent.click(await screen.findByRole('button', { name: core('comments.delete') }));
    const dialog = screen.getByRole('dialog', { name: core('comments.delete.title') });
    expect(dialog).toHaveTextContent(COPY.deleteBody);
    await userEvent.click(within(dialog).getByRole('button', { name: core('comments.delete.confirm') }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000c0001'));
    expect(await screen.findByText(COPY.empty)).toBeInTheDocument();
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it('keeps a deleted entry in its place, marked, with nothing to change, when asked to (Tasks, 165 R-6)', async () => {
    list.mockResolvedValue([
      entry({ body: '', deletedAt: '2026-10-06T10:00:00.000Z' }),
      entry({ id: '00000000-0000-4000-8000-0000000c0002', body: 'Still here.' }),
    ]);
    mount(thread({ keepDeleted: true }));
    const items = within(await screen.findByRole('list', { name: COPY.title })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Ada Min');
    expect(items[0]).toHaveTextContent(core('comments.removedEntry'));
    expect(within(items[0]!).queryByRole('button')).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: core('comments.edit') })).toBeInTheDocument();
  });

  it('marks an entry deleted in place, when asked to, and still reports one fewer', async () => {
    list.mockResolvedValue([entry()]);
    remove.mockResolvedValue(undefined);
    mount(thread({ keepDeleted: true }));
    await userEvent.click(await screen.findByRole('button', { name: core('comments.delete') }));
    const dialog = screen.getByRole('dialog', { name: core('comments.delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: core('comments.delete.confirm') }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000c0001'));
    const item = within(await screen.findByRole('list', { name: COPY.title })).getByRole('listitem');
    expect(item).toHaveTextContent(core('comments.removedEntry'));
    expect(item).not.toHaveTextContent('First call went well.');
    expect(within(item).queryByRole('button')).toBeNull();
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it('shows no composer to a reader who may not write', async () => {
    mount(thread({ canWrite: false }));
    await screen.findByText(COPY.empty);
    expect(screen.queryByLabelText(COPY.composerLabel)).toBeNull();
  });

  it('says the list could not be read, and reads it again on Retry', async () => {
    list.mockRejectedValueOnce(new Error('down'));
    mount(thread());
    expect(await screen.findByText(core('comments.error.load'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByText(COPY.empty)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('CommentComposer', () => {
  it('keeps what was typed when the adapter refuses it, and shows the refusal', async () => {
    const submit = vi.fn<(body: string) => Promise<void>>().mockRejectedValue(new Error('offline'));
    mount(
      <CommentComposer
        label="New message"
        placeholder="Write"
        submitLabel="Send"
        referenceKinds={[]}
        lookups={{}}
        onSubmit={submit}
      />,
    );
    const field = screen.getByLabelText('New message');
    await userEvent.type(field, 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(core('comments.error.save'))).toBeInTheDocument();
    expect(field).toHaveTextContent('Hello');
  });
});
