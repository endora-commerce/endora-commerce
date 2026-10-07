import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityReference } from '@endora-commerce/contracts';
import { ADMIN_ID, ORDER_ID, ORGANIZATION_ID, caretAt, crmLookupResponse, en, renderCrm, storedText } from './crm-fixtures';
import {
  chipBeside,
  domPositionOf,
  readReferenceText,
  renderReferenceText,
  textOffsetOf,
  type DescribeToken,
} from '../../../../packages/modules/crm/src/admin/lib/reference-editor-dom';

/**
 * The field a description, a note or a message is written in
 * (`specs/143-crm-sales-opportunities/`, User Story 18; research N-M11): it
 * shows names, never tokens, and what it stores is the token text unchanged.
 *
 * What is proven here is what a DOM without layout can express: what the field
 * draws for a text, what it reads back, and what each edit does to the stored
 * text. That the caret *looks* right around a chip, that the arrow keys step
 * over one, and where the list is drawn are the browser walk's
 * (`research.md` N-M11).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ReferenceField } = await import('../../../../packages/modules/crm/src/admin/components/ReferenceField');
const { Label } = await import('@endora-commerce/admin-kit/ui');

const PRODUCT_ID = '00000000-0000-4000-8000-00000000aa01';
const HIDDEN_ORDER_ID = '00000000-0000-4000-8000-0000000000c7';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000ffff';
const person = `[[admin_user:${ADMIN_ID}]]`;
const order = `[[order:${ORDER_ID}]]`;
const product = `[[product:${PRODUCT_ID}]]`;
const hidden = `[[order:${HIDDEN_ORDER_ID}]]`;
const unknown = `[[admin_user:${UNKNOWN_ID}]]`;

const REFERENCES: OpportunityReference[] = [
  { type: 'admin_user', id: ADMIN_ID, available: true, label: 'Anna Nowak', url: null },
  { type: 'order', id: ORDER_ID, available: true, label: 'ORD-1001', url: `/orders/${ORDER_ID}` },
  { type: 'product', id: PRODUCT_ID, available: true, label: 'Cargo van L2', url: `/catalog/products/${PRODUCT_ID}` },
  { type: 'order', id: HIDDEN_ORDER_ID, available: false, label: null, url: null },
];

const changes = vi.fn();

function Harness(props: {
  initial?: string;
  maxLength?: number;
  disabled?: boolean;
  references?: OpportunityReference[];
}): ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <div>
      <Label htmlFor="walk-field">Description</Label>
      <ReferenceField
        id="walk-field"
        value={value}
        organizationId={ORGANIZATION_ID}
        references={props.references ?? REFERENCES}
        placeholder="Write here"
        {...(props.maxLength ? { maxLength: props.maxLength } : {})}
        {...(props.disabled ? { disabled: true } : {})}
        onValueChange={(next): void => {
          changes(next);
          setValue(next);
        }}
      />
      <button type="button" onClick={(): void => setValue('')}>
        reset
      </button>
      <output data-testid="stored">{value}</output>
    </div>
  );
}

function mount(props: Parameters<typeof Harness>[0] = {}): HTMLElement {
  renderCrm(<Harness {...props} />);
  return screen.getByLabelText('Description');
}

const chips = (field: HTMLElement): string[] =>
  Array.from(field.querySelectorAll('[data-crm-token]')).map((chip) => chip.textContent ?? '');
const sent = (): string => screen.getByTestId('stored').textContent ?? '';

beforeEach(() => {
  getSpy.mockReset();
  changes.mockReset();
  getSpy.mockImplementation((path: string) => crmLookupResponse(path) ?? Promise.resolve({ data: [] }));
});

describe('the field’s content and the text it stands for', () => {
  const describeToken: DescribeToken = (token) =>
    token.id === UNKNOWN_ID
      ? null
      : token.id === HIDDEN_ORDER_ID
        ? { type: token.type, available: false, text: 'Order unavailable' }
        : { type: token.type, available: true, text: token.type === 'admin_user' ? '@Anna Nowak' : 'ORD-1001' };
  const root = (text: string): HTMLElement => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    renderReferenceText(element, text, describeToken);
    return element;
  };

  it.each([
    ['plain text', 'Call back on Friday.'],
    ['nothing', ''],
    ['lines', 'one\ntwo\n\nfour'],
    ['a line break at the end', 'one\n'],
    ['only line breaks', '\n\n'],
    ['a chip between words', `Ask ${person} about ${order}.`],
    ['a chip at the start, at the end and next to another', `${person}${order} and ${person}`],
    ['a chip on a line of its own', `first\n${person}\nlast`],
    ['a target the reader may not see', `See ${hidden}.`],
    ['a token the field has no name for', `Ask ${unknown} today`],
    ['markup, as the characters it is', '<b>bold</b> & [[order:nope]]'],
  ])('reads back exactly what it drew: %s', (_name, text) => {
    expect(readReferenceText(root(text))).toBe(text);
  });

  it('draws a name for a token it knows, the characters for one it does not, and says unavailable for one out of reach', () => {
    const element = root(`${person} ${unknown} ${hidden}`);
    expect(element.textContent).toBe(`@Anna Nowak ${unknown} Order unavailable`);
    const drawn = Array.from(element.querySelectorAll('[data-crm-token]'));
    expect(drawn.map((chip) => chip.getAttribute('contenteditable'))).toEqual(['false', 'false']);
    expect(drawn.map((chip) => chip.getAttribute('data-crm-token'))).toEqual([person, hidden]);
  });

  it('never draws markup: a text is text nodes, line breaks and chips', () => {
    const element = root('<img src=x onerror=alert(1)>\n<script>1</script>');
    expect(element.querySelector('img, script')).toBeNull();
    expect(Array.from(element.children).map((child) => child.tagName)).toEqual(['BR']);
  });

  it('counts a chip as its token and a line break as one character, both ways', () => {
    const text = `a${person}b\nc`;
    const element = root(text);
    const after = `a${person}`.length;
    for (const offset of [0, 1, after, after + 1, after + 2, text.length]) {
      const position = domPositionOf(element, offset);
      expect(textOffsetOf(element, position.node, position.offset), `offset ${offset}`).toBe(offset);
    }
    // There is no place inside a chip: one asked for is the place after it.
    const inside = domPositionOf(element, 5);
    expect(textOffsetOf(element, inside.node, inside.offset)).toBe(after);
  });

  it('finds the chip a caret touches, on the side asked', () => {
    const element = root(`a${person}b`);
    const end = 1 + person.length;
    expect(chipBeside(element, end, 'before')).toEqual({ start: 1, end });
    expect(chipBeside(element, 1, 'after')).toEqual({ start: 1, end });
    expect(chipBeside(element, 1, 'before')).toBeNull();
    expect(chipBeside(element, end, 'after')).toBeNull();
    expect(chipBeside(element, 0, 'before')).toBeNull();
  });

  it('reads what a browser left behind — a block per line, a placeholder break — as the lines they show', () => {
    const element = document.createElement('div');
    element.innerHTML = 'one<div>two</div><div><br></div><div>four</div>';
    expect(readReferenceText(element)).toBe('one\ntwo\n\nfour');
    element.innerHTML = '<br>';
    expect(readReferenceText(element)).toBe('');
  });
});

describe('a text opened for editing', () => {
  it('shows every reference by name — a person, an Order, a Product — and no token', () => {
    const text = `Ask ${person} about ${order} and ${product}.`;
    const field = mount({ initial: text });
    expect(field).toHaveTextContent('Ask @Anna Nowak about ORD-1001 and Cargo van L2.');
    expect(field.textContent).not.toContain('[[');
    expect(chips(field)).toEqual(['@Anna Nowak', 'ORD-1001', 'Cargo van L2']);
    // Nothing was changed by showing it.
    expect(storedText(field)).toBe(text);
    expect(changes).not.toHaveBeenCalled();
  });

  it('says unavailable for a target the reader may not see, and keeps its token through an edit', async () => {
    const text = `See ${hidden} first.`;
    const field = mount({ initial: text });
    expect(chips(field)).toEqual([en('references.unavailable.order')]);
    caretAt(field, text.length);
    await userEvent.type(field, ' Then call.');
    expect(sent()).toBe(`${text} Then call.`);
  });

  it('leaves a token it has no name for as the characters it is, and sends it unchanged', async () => {
    const text = `Ask ${unknown}`;
    const field = mount({ initial: text });
    expect(field.textContent).toBe(text);
    expect(chips(field)).toEqual([]);
    caretAt(field, text.length);
    await userEvent.type(field, '!');
    expect(sent()).toBe(`${text}!`);
  });

  it('is a multi-line text box under its label, and the label focuses it', async () => {
    const field = mount({ initial: 'Hello' });
    expect(field).toHaveAttribute('role', 'textbox');
    expect(field).toHaveAttribute('aria-multiline', 'true');
    expect(field).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByRole('textbox', { name: 'Description' })).toBe(field);
    expect(field).toHaveAttribute('aria-placeholder', 'Write here');
    await userEvent.click(screen.getByText('Description'));
    expect(field).toHaveFocus();
  });

  it('marks an empty field so its placeholder shows, and a filled one so it does not', async () => {
    const field = mount();
    expect(field).toHaveAttribute('data-empty', 'true');
    await userEvent.type(field, 'x');
    expect(field).toHaveAttribute('data-empty', 'false');
  });

  it('cannot be typed into while disabled, and says so', () => {
    const field = mount({ initial: `Ask ${person}`, disabled: true });
    expect(field).toHaveAttribute('contenteditable', 'false');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(field).toHaveAttribute('tabindex', '-1');
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });

  it('follows a value set from outside — the form cleared after a message was sent', async () => {
    const field = mount({ initial: `Ask ${person}` });
    await userEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(field.textContent).toBe('');
    expect(field).toHaveAttribute('data-empty', 'true');
  });
});

describe('editing around a chip', () => {
  it('Backspace after a chip takes the whole of it, and nothing else', async () => {
    const text = `Ask ${person} now`;
    const field = mount({ initial: text });
    caretAt(field, `Ask ${person}`.length);
    await userEvent.keyboard('{Backspace}');
    expect(sent()).toBe('Ask  now');
    expect(chips(field)).toEqual([]);
    // The next Backspace is an ordinary one.
    await userEvent.keyboard('{Backspace}');
    expect(sent()).toBe('Ask now');
  });

  it('Delete before a chip takes the whole of it', async () => {
    const text = `Ask ${person} now`;
    const field = mount({ initial: text });
    caretAt(field, 4);
    await userEvent.keyboard('{Delete}');
    expect(sent()).toBe('Ask  now');
  });

  it('typing next to a chip leaves the chip alone', async () => {
    const field = mount({ initial: `${person}` });
    caretAt(field, person.length);
    await userEvent.type(field, ' - take this over', { skipClick: true });
    expect(sent()).toBe(`${person} - take this over`);
    expect(field).toHaveTextContent('@Anna Nowak - take this over');
    caretAt(field, 0);
    await userEvent.type(field, 'Hi ', { skipClick: true });
    expect(sent()).toBe(`Hi ${person} - take this over`);
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });

  it('Enter is a line break in the text — never a block element', async () => {
    const field = mount();
    await userEvent.type(field, 'one{Enter}two{Enter}');
    expect(sent()).toBe('one\ntwo\n');
    expect(field.querySelector('div, p')).toBeNull();
    await userEvent.type(field, 'three', { skipClick: true });
    expect(sent()).toBe('one\ntwo\nthree');
  });
});

describe('pasting', () => {
  it('takes the plain text of what is pasted, lines kept, and none of its markup', async () => {
    const field = mount({ initial: 'Start: ' });
    caretAt(field, 7);
    const clipboardData = {
      getData: (type: string): string =>
        type === 'text/plain' ? 'first line\r\nsecond <b>line</b>\nthird' : '<p>first line</p><script>x</script>',
    };
    fireEvent.paste(field, { clipboardData });
    expect(sent()).toBe('Start: first line\nsecond <b>line</b>\nthird');
    expect(field.querySelector('b, p, script, div')).toBeNull();
    expect(field.querySelectorAll('br')).toHaveLength(2);
  });

  it('draws a pasted token it has a name for as a chip, and leaves one it has none for as typed', async () => {
    const field = mount();
    field.focus();
    fireEvent.paste(field, { clipboardData: { getData: (): string => `Ask ${person} or ${unknown}` } });
    expect(sent()).toBe(`Ask ${person} or ${unknown}`);
    expect(chips(field)).toEqual(['@Anna Nowak']);
    expect(field.textContent).toBe(`Ask @Anna Nowak or ${unknown}`);
  });

  it('draws a token typed by hand as a chip the moment it is whole', async () => {
    const field = mount();
    await userEvent.type(field, `See ${order.replace(/\[/g, '[[')}`);
    expect(sent()).toBe(`See ${order}`);
    expect(chips(field)).toEqual(['ORD-1001']);
  });

  it('copies the text itself, so a chip copied here is a chip where it is pasted', () => {
    const text = `Ask ${person} now`;
    const field = mount({ initial: text });
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const setData = vi.fn();
    fireEvent.copy(field, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', text);
  });
});

describe('the length limit', () => {
  it('counts the stored text, refuses what does not fit and says so', async () => {
    const field = mount({ initial: person, maxLength: person.length + 3 });
    caretAt(field, person.length);
    await userEvent.type(field, 'abcd', { skipClick: true });
    expect(sent()).toBe(`${person}abc`);
    expect(screen.getByRole('alert')).toHaveTextContent(en('references.error.tooLong'));
    expect(chips(field)).toEqual(['@Anna Nowak']);
  });

  it('cuts a paste to what fits', () => {
    const field = mount({ initial: 'ab', maxLength: 5 });
    caretAt(field, 2);
    fireEvent.paste(field, { clipboardData: { getData: (): string => 'cdefgh' } });
    expect(sent()).toBe('abcde');
    expect(screen.getByRole('alert')).toHaveTextContent(en('references.error.tooLong'));
  });
});

describe('undo and redo', () => {
  it('step back over a removed chip and a pasted text, and forward again', async () => {
    const text = `Ask ${person}`;
    const field = mount({ initial: text });
    caretAt(field, text.length);
    await userEvent.keyboard('{Backspace}');
    expect(sent()).toBe('Ask ');
    fireEvent.paste(field, { clipboardData: { getData: (): string => 'everybody' } });
    expect(sent()).toBe('Ask everybody');

    await userEvent.keyboard('{Control>}z{/Control}');
    expect(sent()).toBe('Ask ');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(sent()).toBe(text);
    expect(chips(field)).toEqual(['@Anna Nowak']);
    // Nothing before the text the field opened with.
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(sent()).toBe(text);

    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(sent()).toBe('Ask ');
    await userEvent.keyboard('{Control>}y{/Control}');
    expect(sent()).toBe('Ask everybody');
  });

  it('a mention chosen from the list is one step', async () => {
    const field = mount();
    await userEvent.type(field, 'Hi @an');
    await userEvent.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(sent()).toBe(`Hi ${person} `));
    expect(field).toHaveTextContent('Hi @Anna Nowak');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(sent()).not.toContain('[[');
    expect(chips(field)).toEqual([]);
  });
});
