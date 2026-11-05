import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityComment, OpportunityReference } from '@endora-commerce/contracts';
import {
  ADMIN_ID,
  EVERY_CRM_PERMISSION,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  OTHER_ADMIN_ID,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  storedText,
} from './crm-fixtures';

/**
 * Mentioning a person, an Order or a Product by typing `@`, `@@`, `@@@`
 * (`specs/143-crm-sales-opportunities/`, User Story 18 — FR-081, FR-082): the
 * list that opens under the field, the keys that work it, what it leaves alone,
 * and a mention as it is read.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      delete: vi.fn(),
    },
  };
});

const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const COMMENTS_PATH = `${DETAIL_PATH}/comments`;
const MENTIONABLE_PATH = '/api/v1/admin/crm/lookups/mentionable';
const DOCUMENTS_PATH = '/api/v1/admin/crm/lookups/documents';
const PRODUCT_ID = '00000000-0000-4000-8000-00000000aa01';
const GONE_ADMIN_ID = '00000000-0000-4000-8000-0000000000af';
const ME = '00000000-0000-4000-8000-00000000ad01';
/** A comment body's limit — `commentBodySchema` in `@endora-commerce/contracts`. */
const COMMENT_MAX_LENGTH = 10_000;
const WITH_CATALOG = [...EVERY_CRM_PERMISSION, 'catalog:read'];

const note = (body: string, references: OpportunityReference[] = []): OpportunityComment => ({
  id: '00000000-0000-4000-8000-0000000c0001',
  kind: 'note',
  author: { id: ME, name: 'Ada Min' },
  body,
  references,
  editedAt: null,
  createdAt: '2026-10-05T10:00:00.000Z',
});

let notes: OpportunityComment[];
let failPeople = false;
/** A test's own answer to a GET, tried before the shared ones; `undefined` falls through. */
let intercept: ((path: string) => Promise<unknown> | undefined) | null = null;

const asked = (prefix: string): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(prefix));

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  notes = [];
  failPeople = false;
  intercept = null;
  getSpy.mockImplementation((path: string) => {
    const own = intercept?.(path);
    if (own) return own;
    if (failPeople && path.startsWith(MENTIONABLE_PATH)) return Promise.reject(new Error('down'));
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) {
      const q = new URLSearchParams(path.split('?')[1] ?? '').get('q') ?? '';
      return Promise.resolve({
        data: [{ id: ORDER_ID, businessId: 'ORD-1001', status: 'new', total: 990, currency: 'PLN' }].filter((order) =>
          order.businessId.toLowerCase().includes(q.toLowerCase()),
        ),
      });
    }
    if (path.startsWith('/api/v1/admin/catalog/products?')) {
      return Promise.resolve({
        data: [{ id: PRODUCT_ID, sku: 'VAN-L2', slug: 'cargo-van-l2', status: 'active', name: 'Cargo van L2' }],
        pagination: { page: 0, pageSize: 20, total: 1 },
      });
    }
    if (path.startsWith(`${COMMENTS_PATH}?`)) return Promise.resolve({ data: notes });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function composer(permissions?: readonly string[]): Promise<{ panel: HTMLElement; field: HTMLElement }> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.notes') }));
  const panel = await screen.findByRole('tabpanel', { name: en('opportunity.tabs.notes') });
  const field = (await within(panel).findByLabelText(
    en('comments.notes.composer.label'),
  )) as HTMLElement;
  return { panel, field };
}

const people = (panel: HTMLElement): Promise<HTMLElement> =>
  within(panel).findByRole('listbox', { name: core('references.suggest.title.person') });

describe('typing @ in a text of an Opportunity', () => {
  it('opens a list of people under the field, narrows it as letters are typed, and Enter puts the mention in', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    const list = await people(panel);
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Anna Nowak',
      'Piotr Zielony',
    ]);
    // People who may see this Opportunity's Organization are who is asked for.
    expect(asked(MENTIONABLE_PATH)[0]).toBe(`${MENTIONABLE_PATH}?organizationId=${ORGANIZATION_ID}`);

    await userEvent.type(field, 'pio');
    await waitFor(() =>
      expect(within(panel).getAllByRole('option').map((option) => option.textContent)).toEqual(['Piotr Zielony']),
    );
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(storedText(field)).toBe(`[[admin_user:${OTHER_ADMIN_ID}]] `));
    expect(within(panel).queryByRole('listbox')).toBeNull();
    // The sentence is simply carried on, as the owner wrote it.
    await userEvent.type(field, '- take this over');
    expect(storedText(field)).toBe(`[[admin_user:${OTHER_ADMIN_ID}]] - take this over`);
    expect(within(panel).queryByRole('listbox')).toBeNull();
  });

  it('is worked with the arrow keys, and says which option is active to assistive technology', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, 'Hello @');
    const list = await people(panel);
    const options = within(list).getAllByRole('option');

    expect(field).toHaveAttribute('role', 'combobox');
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(field).toHaveAttribute('aria-autocomplete', 'list');
    expect(field).toHaveAttribute('aria-controls', list.id);
    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowDown}');
    expect(field).toHaveAttribute('aria-activedescendant', options[1]!.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    // Past the last one is the first again, and back.
    await userEvent.keyboard('{ArrowDown}');
    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowUp}');
    expect(field).toHaveAttribute('aria-activedescendant', options[1]!.id);
    // The focus never left the field.
    expect(field).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field)).toBe(`Hello [[admin_user:${OTHER_ADMIN_ID}]] `));
    // Closed, it is the multi-line text box it was.
    expect(field).toHaveAttribute('role', 'textbox');
    expect(field).not.toHaveAttribute('aria-activedescendant');
  });

  it('keeps the option the arrow keys reach in view — a list longer than its window scrolls with them', async () => {
    // jsdom lays nothing out and has no `scrollIntoView`; what is held is that
    // the active option is asked to come into view, by the nearest edge.
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown): void {
      scrolled.push(`${this.id}:${JSON.stringify(options)}`);
    };
    try {
      const { panel, field } = await composer();
      await userEvent.type(field, '@');
      const options = within(await people(panel)).getAllByRole('option');
      // Opened under a field low on the screen, the list itself may be out of view.
      await waitFor(() => expect(scrolled).toContain(`${options[0]!.id}:{"block":"nearest"}`));

      await userEvent.keyboard('{ArrowDown}');
      await waitFor(() => expect(scrolled.at(-1)).toBe(`${options[1]!.id}:{"block":"nearest"}`));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('leaves Enter to an input method that is composing a character — it confirms the character, not a person', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@pio');
    await within(panel).findByRole('option', { name: 'Piotr Zielony' });

    // As a browser sends it: the keys of a composition arrive between its start and its end.
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(storedText(field)).toBe('@pio');
    expect(within(panel).getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(field, { key: 'Tab', isComposing: true });
    expect(storedText(field)).toBe('@pio');
    fireEvent.compositionEnd(field);
    // jsdom reports itself as Safari, where the editor also ignores the one
    // Enter that arrives within half a second of a composition's end — the key
    // that confirmed the character. A later Enter is the operator's.
    await new Promise((resolve) => setTimeout(resolve, 550));

    // Positive control: the same key, once the composition is over, chooses.
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(storedText(field)).toBe(`[[admin_user:${OTHER_ADMIN_ID}]] `));
  });

  it('drops an answer that arrives after a later search was answered — the list is never the older one', async () => {
    // The answer to "p" is held back until "pi" has been asked and answered.
    let releaseOlder: (() => void) | null = null;
    intercept = (path) => {
      const q = new URLSearchParams(path.split('?')[1] ?? '').get('q');
      if (!path.startsWith(MENTIONABLE_PATH) || q !== 'p') return undefined;
      return new Promise((resolve) => {
        releaseOlder = (): void =>
          resolve({ data: [{ id: GONE_ADMIN_ID, name: 'Pia Stale' }, { id: OTHER_ADMIN_ID, name: 'Piotr Zielony' }] });
      });
    };
    const { panel, field } = await composer();
    await userEvent.type(field, '@p');
    await waitFor(() => expect(releaseOlder).not.toBeNull());
    await userEvent.type(field, 'i');
    await waitFor(() => expect(asked(MENTIONABLE_PATH).some((path) => path.endsWith('q=pi'))).toBe(true));
    await waitFor(() =>
      expect(within(panel).getAllByRole('option').map((option) => option.textContent)).toEqual(['Piotr Zielony']),
    );

    releaseOlder!();
    // Long enough for the late answer to have been rendered, had it been taken.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(panel).getAllByRole('option').map((option) => option.textContent)).toEqual(['Piotr Zielony']);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field)).toBe(`[[admin_user:${OTHER_ADMIN_ID}]] `));
  });

  // `specs/163-projects-and-tasks/` FR-044: `@@` is the document list now —
  // CRM's own `lookups/documents` — where it was `orders`' Order list.
  it('never offers the people it listed as documents while the documents are still being fetched', async () => {
    let releaseDocuments: (() => void) | null = null;
    intercept = (path) => {
      if (!path.startsWith(DOCUMENTS_PATH)) return undefined;
      return new Promise((resolve) => {
        releaseDocuments = (): void =>
          resolve({ groups: [{ kind: 'order', items: [{ id: ORDER_ID, label: 'ORD-1001' }] }] });
      });
    };
    const { panel, field } = await composer(WITH_CATALOG);
    await userEvent.type(field, '@');
    await people(panel);
    await userEvent.type(field, '@');
    await waitFor(() => expect(releaseDocuments).not.toBeNull());

    // Under the documents' title nothing is listed yet, and Enter is a new line — not `[[order:<a person's id>]]`.
    expect(await within(panel).findByText(core('references.suggest.title.document'))).toBeInTheDocument();
    expect(within(panel).queryByRole('option')).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(storedText(field)).toBe('@@\n');
    const askedBefore = asked(DOCUMENTS_PATH).length;
    await userEvent.keyboard('{Backspace}');
    // The run is back, and asks again after its pause: that is the answer to release.
    await waitFor(() => expect(asked(DOCUMENTS_PATH).length).toBe(askedBefore + 1));

    releaseDocuments!();
    const documents = await within(panel).findByRole('listbox', { name: core('references.suggest.title.document') });
    expect(within(documents).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('ORD-1001'),
    ]);
  });

  it('refuses a choice that would not fit the field, says so, and leaves the text as typed', async () => {
    const { panel, field } = await composer();
    // Ten characters short of the limit: the letters fit, a token of 51 does not.
    const filler = 'x'.repeat(COMMENT_MAX_LENGTH - 10);
    field.focus();
    fireEvent.paste(field, { clipboardData: { getData: (type: string): string => (type === 'text/plain' ? filler : '') } });
    expect(storedText(field)).toHaveLength(COMMENT_MAX_LENGTH - 10);
    await userEvent.type(field, ' @pio');
    await within(panel).findByRole('option', { name: 'Piotr Zielony' });
    await userEvent.keyboard('{Enter}');

    expect(await within(panel).findByText(core('references.error.tooLong'))).toBeInTheDocument();
    expect(storedText(field)).toBe(`${filler} @pio`);
  });

  it('takes Escape for itself while the list is open, and leaves it alone when it is not', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    await people(panel);
    // `fireEvent` answers false when the event's default was prevented.
    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(false);
    await waitFor(() => expect(within(panel).queryByRole('listbox')).toBeNull());
    expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true);
  });

  it('closes the list when the field loses the focus, and keeps what was typed', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    await people(panel);
    await userEvent.click(screen.getByRole('heading', { level: 1 }));
    await waitFor(() => expect(within(panel).queryByText(core('references.suggest.title.person'))).toBeNull());
    expect(storedText(field)).toBe('@');
  });

  it('takes a click on a person as well, and keeps the focus in the field', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@an');
    await userEvent.click(await within(panel).findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(storedText(field)).toBe(`[[admin_user:${ADMIN_ID}]] `));
    expect(field).toHaveFocus();
  });

  it('Escape closes the list and leaves what was typed; the next @ opens it again', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@pio');
    await people(panel);
    await userEvent.keyboard('{Escape}');
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(storedText(field)).toBe('@pio');
    // Typing on does not bring it back, and Enter is a new line again.
    await userEvent.type(field, 't');
    expect(within(panel).queryByRole('listbox')).toBeNull();
    await userEvent.type(field, '{Enter}@');
    expect(storedText(field)).toBe('@piot\n@');
    await people(panel);
  });

  it('a space right after the @ leaves it the character it is', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    await people(panel);
    await userEvent.type(field, ' noon');
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(storedText(field)).toBe('@ noon');
  });

  it('does not open for an e-mail address, and asks nobody', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, 'Write to jan.kowalski@example.com about it');
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(within(panel).queryByText(core('references.suggest.title.person'))).toBeNull();
    expect(asked(MENTIONABLE_PATH)).toEqual([]);
    expect(storedText(field)).toBe('Write to jan.kowalski@example.com about it');
  });

  it('closes by itself once the typing has gone past every match, and the text stays', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@home tomorrow');
    await waitFor(() => expect(within(panel).queryByText(core('references.suggest.title.person'))).toBeNull());
    expect(storedText(field)).toBe('@home tomorrow');
  });

  it('says so when nobody matches, and when the search fails — and lists nothing', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@xyz');
    expect(await within(panel).findByText(core('references.suggest.empty.person'))).toBeInTheDocument();
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(field).toHaveAttribute('role', 'textbox');

    failPeople = true;
    await userEvent.type(field, 'q');
    expect(await within(panel).findByText(core('references.suggest.error'))).toBeInTheDocument();
  });

  it('@@ searches this Opportunity`s documents and @@@ the Products', async () => {
    const { panel, field } = await composer(WITH_CATALOG);
    await userEvent.type(field, '@@ord');
    const documents = await within(panel).findByRole('listbox', { name: core('references.suggest.title.document') });
    expect(within(documents).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('ORD-1001'),
    ]);
    expect(asked(DOCUMENTS_PATH).some((path) => path.includes(`opportunityId=${OPPORTUNITY_ID}`))).toBe(true);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field)).toBe(`[[order:${ORDER_ID}]] `));

    await userEvent.type(field, 'and @@@cargo');
    const products = await within(panel).findByRole('listbox', { name: core('references.suggest.title.product') });
    expect(within(products).getByRole('option', { name: /Cargo van L2/ })).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(storedText(field)).toBe(`[[order:${ORDER_ID}]] and [[product:${PRODUCT_ID}]] `));
  });

  it('typed quickly, @@@ shows neither the people nor the documents on its way, and asks for neither', async () => {
    const { panel, field } = await composer(WITH_CATALOG);
    const titles: string[] = [];
    const watch = new MutationObserver(() => {
      for (const key of ['person', 'document', 'product']) {
        const title = core(`references.suggest.title.${key}`);
        if (within(panel).queryByText(title) && !titles.includes(title)) titles.push(title);
      }
    });
    watch.observe(panel, { childList: true, subtree: true });
    await userEvent.type(field, '@@@');
    await within(panel).findByRole('listbox', { name: core('references.suggest.title.product') });
    watch.disconnect();
    expect(titles).toEqual([core('references.suggest.title.product')]);
    // The documents' title never showing is what says no document search was
    // listed; who may be mentioned was never asked at all.
    expect(asked(MENTIONABLE_PATH)).toEqual([]);
  });

  it('a bare @ followed by a pause still opens the people list', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    expect(within(panel).queryByText(core('references.suggest.title.person'))).toBeNull();
    await people(panel);
  });

  it('leaves @@ and @@@ as typed for a role that may read neither documents nor Products, and asks neither', async () => {
    const { panel, field } = await composer(['crm:read', 'crm:write']);
    await userEvent.type(field, '@@ord and @@@cargo');
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(within(panel).queryByText(core('references.suggest.title.document'))).toBeNull();
    expect(asked(DOCUMENTS_PATH)).toEqual([]);
    expect(asked('/api/v1/admin/orders?')).toEqual([]);
    expect(asked('/api/v1/admin/catalog/products')).toEqual([]);
    expect(storedText(field)).toBe('@@ord and @@@cargo');
    // Positive control: the same role is offered people.
    await userEvent.type(field, ' @');
    await people(panel);
  });

  it('names the shortcuts it offers beside the field, and ties them to it', async () => {
    const { panel, field } = await composer(WITH_CATALOG);
    const list = [
      core('references.shortcut.person'),
      core('references.shortcut.document'),
      core('references.shortcut.product'),
    ].join(', ');
    const hint = within(panel).getByText(core('references.shortcuts', { list }));
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(hint.parentElement!.id);
  });

  it('names only the shortcuts the role has', async () => {
    const { panel } = await composer(['crm:read', 'crm:write']);
    expect(
      within(panel).getByText(core('references.shortcuts', { list: core('references.shortcut.person') })),
    ).toBeInTheDocument();
  });

  it('the Mention a person button searches people and writes the mention where the caret was', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, 'Over to you: ');
    await userEvent.click(within(panel).getByRole('button', { name: core('references.insert.person') }));
    await userEvent.click(await within(panel).findByRole('combobox', { name: core('references.search.person') }));
    await userEvent.click(await screen.findByRole('option', { name: 'Piotr Zielony' }));
    await waitFor(() => expect(storedText(field)).toBe(`Over to you: [[admin_user:${OTHER_ADMIN_ID}]]`));
    expect(within(panel).queryByRole('combobox', { name: core('references.search.person') })).toBeNull();
  });

  it('sends the token, and shows the saved mention as @ and the person`s name — not a link', async () => {
    postSpy.mockImplementation((_path: string, body: { body: string }) =>
      Promise.resolve({
        data: note(body.body, [
          { type: 'admin_user', id: OTHER_ADMIN_ID, available: true, label: 'Piotr Zielony', url: null },
        ]),
      }),
    );
    const { panel, field } = await composer();
    await userEvent.type(field, '@pio');
    await within(panel).findByRole('option', { name: 'Piotr Zielony' });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field)).toBe(`[[admin_user:${OTHER_ADMIN_ID}]] `));
    await userEvent.type(field, '- take this over');
    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));

    const body = `[[admin_user:${OTHER_ADMIN_ID}]] - take this over`;
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { kind: 'note', body }));
    const saved = (await within(panel).findByText('- take this over', { exact: false })).closest('li') as HTMLElement;
    expect(saved).toHaveTextContent('@Piotr Zielony - take this over');
    expect(saved).not.toHaveTextContent(OTHER_ADMIN_ID);
    expect(within(saved).queryByRole('link', { name: /Piotr Zielony/ })).toBeNull();
  });
});

describe('a mention as it is read', () => {
  it('marks a person who was removed or deactivated as unavailable — no name, no id', async () => {
    notes = [
      note(`Ask [[admin_user:${GONE_ADMIN_ID}]] and [[admin_user:${ADMIN_ID}]].`, [
        { type: 'admin_user', id: GONE_ADMIN_ID, available: false, label: null, url: null },
        { type: 'admin_user', id: ADMIN_ID, available: true, label: 'Anna Nowak', url: null },
      ]),
    ];
    const { panel } = await composer();
    const shown = (await within(panel).findByText(core('references.unavailable.admin_user'))).closest('li') as HTMLElement;
    expect(shown).toHaveTextContent('@Anna Nowak');
    expect(shown).not.toHaveTextContent(GONE_ADMIN_ID);
    expect(shown).not.toHaveTextContent('[[');
  });

  it('keeps the loading word out of a list that has answered', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@');
    await people(panel);
    expect(within(panel).queryByText(core('common.state.loading'))).toBeNull();
  });
});
