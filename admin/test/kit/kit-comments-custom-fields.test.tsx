import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * Issue #2005 — a note is a custom-field host (`opportunity_note`,
 * `project_note`), so the kit's `CommentThread` offers the host's fields in the
 * note composer and in a note's edit form, and shows a compact line of the
 * stored values on each note. A message has no fields: the thread neither asks
 * for definitions nor draws any. The inputs are `CustomFieldValuesPanel`'s
 * (Principle IX), so a refusal shows at its field.
 *
 * The mock is file-wide (`apiClient` through the kit's `lib` barrel, as
 * `kit-custom-field-values.test.tsx` explains), which is why this proof has a
 * file of its own.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { CommentThread } = await import('@endora-commerce/admin-kit/components');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');
type Api = import('@endora-commerce/admin-kit/components').CommentThreadApi;
type Comment = import('@endora-commerce/admin-kit/components').RecordComment;

const CORE = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const ME = '00000000-0000-4000-8000-00000000ad01';

function core(key: string): string {
  const template = CORE[key];
  if (template === undefined) throw new Error(`the shipped core bundle has no key "${key}"`);
  return template;
}

const COPY = {
  title: 'Notes',
  empty: 'No notes yet.',
  composerLabel: 'New note',
  composerPlaceholder: 'Write a note',
  composerSubmit: 'Add note',
  added: 'The note was added.',
  deleteBody: 'The note disappears from this list.',
};

function definition(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-00000000d001',
    entityType: 'opportunity_note',
    key: 'note_type',
    label: { en: 'Type' },
    labelDefault: 'Type',
    valueType: 'select',
    required: false,
    sortOrder: 0,
    config: {},
    options: [
      { id: '00000000-0000-4000-8000-00000000e001', value: 'call', label: { en: 'Call' }, labelDefault: 'Call', isDefault: false, sortOrder: 0 },
      { id: '00000000-0000-4000-8000-00000000e002', value: 'meeting', label: { en: 'Meeting' }, labelDefault: 'Meeting', isDefault: false, sortOrder: 1 },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function entry(overrides: Partial<Comment> = {}): Comment {
  return {
    id: '00000000-0000-4000-8000-0000000c0001',
    kind: 'note',
    author: { id: ME, name: 'Ada Min' },
    body: 'First call went well.',
    references: [],
    editedAt: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    customFieldValues: {},
    ...overrides,
  };
}

const list = vi.fn<Api['list']>();
const add = vi.fn<Api['add']>();
const update = vi.fn<Api['update']>();
const remove = vi.fn<Api['remove']>();
const API: Api = { list, add, update, remove };

beforeEach(() => {
  for (const spy of [list, add, update, remove, getSpy]) spy.mockReset();
  list.mockResolvedValue([]);
  getSpy.mockResolvedValue({ data: [definition()] });
});

function mount(ui: ReactElement): void {
  renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions: ['*'], id: ME }) },
    ),
    { core: CORE },
  );
}

function thread(kind: 'note' | 'message' = 'note'): ReactElement {
  return (
    <CommentThread
      kind={kind}
      canWrite
      api={API}
      copy={COPY}
      referenceKinds={[]}
      lookups={{}}
      customFieldEntityType="opportunity_note"
    />
  );
}

describe('CommentThread — custom fields on notes (issue #2005)', () => {
  it('asks for the host’s definitions and offers them in the note composer', async () => {
    mount(thread());
    const composer = (await screen.findByLabelText(COPY.composerLabel)).closest('form') as HTMLElement;
    expect(await within(composer).findByLabelText('Type')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/custom-fields/definitions?entityType=opportunity_note');
  });

  it('sends the chosen values with the note, and clears them once it is added', async () => {
    add.mockImplementation(async (body, values) => entry({ id: '00000000-0000-4000-8000-0000000c0009', body, customFieldValues: values ?? {} }));
    mount(thread());
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(COPY.composerLabel), 'Met the buyer.');
    const composer = screen.getByLabelText(COPY.composerLabel).closest('form') as HTMLElement;
    await user.selectOptions(await within(composer).findByLabelText('Type'), 'meeting');
    await user.click(screen.getByRole('button', { name: COPY.composerSubmit }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0]).toEqual(['Met the buyer.', { note_type: 'meeting' }]);
    await waitFor(() => expect(within(composer).getByLabelText('Type')).toHaveValue(''));
  });

  it('shows a refused value at its field and keeps what was typed', async () => {
    add.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
          message: 'One or more custom fields are invalid.',
          details: [{ path: 'note_type', issue: 'Choose one of the options.' }],
        },
      }),
    );
    mount(thread());
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(COPY.composerLabel), 'Met the buyer.');
    await user.click(screen.getByRole('button', { name: COPY.composerSubmit }));

    expect(await screen.findByText('Choose one of the options.')).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.composerLabel)).toHaveTextContent('Met the buyer.');
  });

  it('shows a compact line of a note’s stored values, by label', async () => {
    list.mockResolvedValue([entry({ customFieldValues: { note_type: 'call' } }), entry({ id: '00000000-0000-4000-8000-0000000c0002' })]);
    mount(thread());
    const items = within(await screen.findByRole('list', { name: COPY.title })).getAllByRole('listitem');
    await waitFor(() => expect(items[0]).toHaveTextContent('Type'));
    expect(items[0]).toHaveTextContent('Call');
    // A note with no value shows no line.
    expect(items[1]).not.toHaveTextContent('Type');
  });

  it('edits a note’s values with its text, sending only what changed', async () => {
    const stored = entry({ customFieldValues: { note_type: 'call' } });
    list.mockResolvedValue([stored]);
    update.mockImplementation(async (id, body, values) => ({ ...stored, id, body, customFieldValues: { ...stored.customFieldValues, ...values } }));
    mount(thread());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: core('comments.edit') }));
    const editor = screen.getByLabelText(core('comments.edit.label')).closest('li') as HTMLElement;
    const select = await within(editor).findByLabelText('Type');
    expect(select).toHaveValue('call');
    await user.selectOptions(select, 'meeting');
    await user.click(within(editor).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]).toEqual([stored.id, stored.body, { note_type: 'meeting' }]);
  });

  it('offers no field on a message, and asks for no definition', async () => {
    mount(thread('message'));
    await screen.findByLabelText(COPY.composerLabel);
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
