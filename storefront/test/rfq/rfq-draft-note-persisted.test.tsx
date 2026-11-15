// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #1253 — the quote-request draft note survives a reload the way the draft lines do: it is
 * kept in `localStorage` beside them (`lib/rfqDraft`), read back when the view hydrates, and
 * forgotten with the draft — on "Clear all" and once the request is submitted.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submitted: unknown[] = [];

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('../../app/(commerce)/quote-request/actions', () => ({
  readDraftMinimums: async () => ({}),
  submitQuoteRequest: async (input: unknown) => {
    submitted.push(input);
    return { ok: true, id: 'rfq-1' };
  },
}));

const { RfqDraftView } = await import('../../components/rfq/RfqDraftView');
const { RFQ_DRAFT_STORAGE_KEY, RFQ_DRAFT_NOTE_STORAGE_KEY, clearRfqDraft, readRfqDraftNote } = await import(
  '../../lib/rfqDraft'
);

let host: HTMLElement | null = null;
let root: Root | null = null;

function seedDraft(): void {
  window.localStorage.setItem(
    RFQ_DRAFT_STORAGE_KEY,
    JSON.stringify([{ productId: 'prod-1', slug: 'widget', name: 'Widget', quantity: 3 }]),
  );
}

async function mount(): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<RfqDraftView locale="en-US" priceProposalsAllowed />));
  return host;
}

function unmount(): void {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function noteField(el: HTMLElement): HTMLTextAreaElement {
  return el.querySelector<HTMLTextAreaElement>('#rfq-note')!;
}

/**
 * An in-memory `Storage`: under this jsdom the window's own is not there (Node's experimental
 * global `localStorage` shadows it without a backing file), and the test is about what is kept.
 */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
  submitted.length = 0;
});

afterEach(() => unmount());

describe('the quote-request draft note (issue #1253)', () => {
  it('survives a reload, like the draft lines', async () => {
    seedDraft();
    typeInto(noteField(await mount()), 'Delivery to the north gate, please.');
    unmount();

    const reloaded = await mount();
    expect(noteField(reloaded).value).toBe('Delivery to the north gate, please.');
    expect(readRfqDraftNote()).toBe('Delivery to the north gate, please.');
  });

  it('is forgotten with the draft on "Clear all"', async () => {
    seedDraft();
    const el = await mount();
    typeInto(noteField(el), 'A note');
    expect(window.localStorage.getItem(RFQ_DRAFT_NOTE_STORAGE_KEY)).toBe('A note');
    const clear = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Clear all')!;
    act(() => clear.click());
    expect(window.localStorage.getItem(RFQ_DRAFT_NOTE_STORAGE_KEY)).toBeNull();
  });

  it('is sent with the request and forgotten once it is submitted', async () => {
    seedDraft();
    const el = await mount();
    typeInto(noteField(el), '  Urgent  ');
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Submit quote request')!;
    await act(async () => submit.click());
    expect(submitted).toEqual([expect.objectContaining({ headerNote: 'Urgent' })]);
    expect(readRfqDraftNote()).toBe('');
  });

  it('clearRfqDraft drops a stored note', () => {
    window.localStorage.setItem(RFQ_DRAFT_NOTE_STORAGE_KEY, 'left over');
    clearRfqDraft();
    expect(readRfqDraftNote()).toBe('');
  });
});
