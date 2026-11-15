'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';

/**
 * Issue #1252 — a quantity typed into a cart line saves itself.
 *
 * The cart line's stepper is a `<form action={updateAction}>`, so it works with JS off: Enter
 * (and "−" / "+") post the form and the server action redirects back to the cart. With JS on,
 * {@link CartLineQuantity} takes the same form over and saves the line through a non-redirecting
 * server action instead — after a short pause in typing, on blur, on Enter and on a step — so the
 * field keeps its focus; the action revalidates the cart, so its answer carries the re-read
 * page (totals, the header's count) and React applies it in place.
 *
 * {@link CartQuantityAutosave} is what keeps a typed quantity from being lost: while any line
 * holds an unsaved or in-flight value, every other form submit and every link click on the page
 * is held until that value is saved, and only then let through. A save the server refuses holds
 * the action back once and moves focus to the refused field, so the buyer reads why before
 * anything proceeds on the old quantity; the refusal stays beside the line and the next attempt
 * goes on.
 */

/** What saving one line's typed quantity answers. `message` is already in the page's language. */
export type CartQuantitySaveResult = { ok: true } | { ok: false; message: string };

/** How long typing has to pause before a typed quantity saves itself. */
export const CART_QUANTITY_AUTOSAVE_DELAY_MS = 700;

type LineStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

interface LineEntry {
  /** An unsaved value, a pause timer running, or a save in flight. */
  pending(): boolean;
  /** Save what the field holds now; `false` when the server refused it in this call. */
  flush(): Promise<boolean>;
  focus(): void;
}

interface AutosaveStrings {
  saving: string;
  saved: string;
  /** The generic failure — a save that threw rather than answered. */
  failed: string;
}

interface AutosaveContext {
  register(itemId: string, entry: LineEntry): () => void;
  flushAll(exceptItemId?: string): Promise<boolean>;
  statusOf(itemId: string): LineStatus | undefined;
  setStatus(itemId: string, status: LineStatus): void;
  strings: AutosaveStrings;
}

const Context = createContext<AutosaveContext | null>(null);

export function CartQuantityAutosave({
  strings,
  children,
}: {
  strings: AutosaveStrings;
  children: ReactNode;
}): ReactNode {
  const entries = useRef(new Map<string, LineEntry>());
  const [statuses, setStatuses] = useState<Record<string, LineStatus>>({});

  const register = useCallback((itemId: string, entry: LineEntry) => {
    entries.current.set(itemId, entry);
    return () => {
      if (entries.current.get(itemId) === entry) entries.current.delete(itemId);
    };
  }, []);

  const flushAll = useCallback(async (exceptItemId?: string): Promise<boolean> => {
    let refused: LineEntry | null = null;
    // One at a time: the saves write the same cart.
    for (const [itemId, entry] of [...entries.current]) {
      if (itemId === exceptItemId) continue;
      const ok = await entry.flush();
      if (!ok && refused === null) refused = entry;
    }
    refused?.focus();
    return refused === null;
  }, []);

  const setStatus = useCallback((itemId: string, status: LineStatus) => {
    setStatuses((prev) => ({ ...prev, [itemId]: status }));
  }, []);

  // Hold every other submit and link click on the page while a typed quantity is unsaved. The
  // listeners sit on `document` in the capture phase, so they run before React's own (bubble)
  // dispatch of a form action or a `next/link` click — stopping the event there keeps both from
  // running, and the event is replayed once the quantity is saved.
  useEffect(() => {
    const released = new WeakSet<EventTarget>();
    const anyPending = (): boolean => [...entries.current.values()].some((entry) => entry.pending());

    const onSubmit = (event: Event): void => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (released.delete(form)) return;
      // A line's own stepper flushes the other lines itself (`CartLineQuantity`).
      const own = form.dataset.cartQuantityForm;
      if (own !== undefined && entries.current.has(own)) return;
      if (!anyPending()) return;
      event.preventDefault();
      event.stopPropagation();
      const submitter = (event as SubmitEvent).submitter;
      void flushAll().then((ok) => {
        if (!ok || !form.isConnected) return;
        released.add(form);
        form.requestSubmit(submitter instanceof HTMLElement && form.contains(submitter) ? submitter : undefined);
      });
    };

    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (released.delete(anchor)) return;
      if (!anyPending()) return;
      event.preventDefault();
      event.stopPropagation();
      void flushAll().then((ok) => {
        if (!ok || !anchor.isConnected) return;
        released.add(anchor);
        anchor.click();
      });
    };

    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [flushAll]);

  const value = useMemo<AutosaveContext>(
    () => ({
      register,
      flushAll,
      statusOf: (itemId) => statuses[itemId],
      setStatus,
      strings,
    }),
    [register, flushAll, statuses, setStatus, strings],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * The line's quantity message — the polite live region beside the line (U4, WCAG 4.1.3). It
 * carries the server's refusal from the address (`serverMessage`, the no-JS path) until the
 * buyer edits the line here; from then on it says saving, saved, or the refusal of this save.
 */
export function CartLineQuantityStatus({
  itemId,
  id,
  serverMessage,
}: {
  itemId: string;
  id: string;
  serverMessage: string | null;
}): ReactNode {
  const ctx = useContext(Context);
  const status = ctx?.statusOf(itemId);
  const text =
    status === undefined
      ? (serverMessage ?? '')
      : status.kind === 'saving'
        ? ctx!.strings.saving
        : status.kind === 'saved'
          ? ctx!.strings.saved
          : status.kind === 'error'
            ? status.message
            : '';
  const tone = status === undefined || status.kind === 'error' ? 'font-semibold text-bad' : 'text-muted';
  return (
    <p id={id} role="status" className={`m-0 text-[12px] ${tone}`}>
      {text}
    </p>
  );
}

const WHOLE = /^\d+$/;

/** A whole number written in its plain form (`"007"` → `"7"`); anything else as it was typed. */
function canonical(raw: string): string {
  const trimmed = raw.trim();
  return WHOLE.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? String(Number(trimmed)) : raw;
}

export interface CartLineQuantityProps {
  itemId: string;
  /** The line's saved quantity, as the cart read answers it. */
  quantity: number;
  /** The lowest quantity "−" steps to (`cartLineFloor`). */
  floor: number;
  /** What the field shows first: a refused edit's typed value, else the quantity. */
  initialValue: string;
  /** The server refused `initialValue` (the U4 address error): it is not saved again unasked. */
  initialRefused: boolean;
  /** The no-JS path — the form's own action. */
  updateAction: (formData: FormData) => Promise<void>;
  /** The JS path — saves a typed quantity without leaving the page. Absent: the form posts. */
  saveQuantity?: ((typed: string) => Promise<CartQuantitySaveResult>) | undefined;
  qtyLabel: string;
  /** The line's below-minimum sentence id, when it has one. */
  belowId: string | null;
  /** The live region {@link CartLineQuantityStatus} renders. */
  statusId: string;
  /** The server's address error for this line (the no-JS refusal). */
  serverError: boolean;
  /** The product's minimum, stated under the stepper. */
  minimumHint: string | null;
  floorId: string;
}

/**
 * The cart line's stepper form: "−", the quantity field and "+". Without
 * {@link CartQuantityAutosave} above it (or without `saveQuantity`) it is the plain form.
 */
export function CartLineQuantity({
  itemId,
  quantity,
  floor,
  initialValue,
  initialRefused,
  updateAction,
  saveQuantity,
  qtyLabel,
  belowId,
  statusId,
  serverError,
  minimumHint,
  floorId,
}: CartLineQuantityProps): ReactNode {
  const ctx = useContext(Context);
  const enhanced = ctx !== null && saveQuantity !== undefined;
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const savedRef = useRef(String(quantity));
  const refusedRef = useRef<string | null>(initialRefused ? canonical(initialValue) : null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest of what the callbacks below read, so the entry registered once stays current.
  const latest = useRef({ ctx, saveQuantity, floor, quantity });
  latest.current = { ctx, saveQuantity, floor, quantity };

  const write = useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(
    (raw: string): Promise<boolean> => {
      const { ctx: c, saveQuantity: save } = latest.current;
      if (!c || !save) return Promise.resolve(true);
      const run: Promise<boolean> = (async () => {
        c.setStatus(itemId, { kind: 'saving' });
        let result: CartQuantitySaveResult;
        try {
          result = await save(raw);
        } catch {
          result = { ok: false, message: c.strings.failed };
        }
        if (result.ok) {
          savedRef.current = raw;
          refusedRef.current = null;
          // A value typed while this one was saving is not "saved" yet.
          c.setStatus(itemId, canonical(valueRef.current) === raw ? { kind: 'saved' } : { kind: 'idle' });
          return true;
        }
        refusedRef.current = raw;
        c.setStatus(itemId, { kind: 'error', message: result.message });
        return false;
      })().finally(() => {
        if (inflightRef.current === run) inflightRef.current = null;
      });
      inflightRef.current = run;
      return run;
    },
    [itemId],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    let ok = true;
    for (;;) {
      const running = inflightRef.current;
      if (running) {
        ok = await running;
        continue;
      }
      const raw = canonical(valueRef.current);
      // Nothing new: saved already, or refused already — that refusal is on the page.
      if (raw === savedRef.current || raw === refusedRef.current) return ok;
      ok = await start(raw);
    }
  }, [clearTimer, start]);

  const pending = useCallback((): boolean => {
    if (timerRef.current !== null || inflightRef.current !== null) return true;
    const raw = canonical(valueRef.current);
    return raw !== savedRef.current && raw !== refusedRef.current;
  }, []);

  // `register` is stable while the context value changes with every status, so a line
  // registers once; `latest` carries the current context into the callbacks.
  const register = ctx?.register;
  useEffect(() => {
    if (!enhanced || !register) return;
    return register(itemId, { pending, flush, focus: () => inputRef.current?.focus() });
  }, [enhanced, register, itemId, pending, flush]);

  // The cart was re-read: take the saved quantity, and show it unless the field holds
  // something of the buyer's that is not settled yet.
  useEffect(() => {
    savedRef.current = String(quantity);
    if (timerRef.current === null && inflightRef.current === null && refusedRef.current === null) {
      write(String(quantity));
    }
  }, [quantity, write]);

  useEffect(() => clearTimer, [clearTimer]);

  const onChange = (raw: string): void => {
    // Issue #351 (ruling R4) — a value past the bound is saved at the bound, and the field
    // shows the bound at once.
    const next = WHOLE.test(raw.trim()) && Number(raw) > LINE_QUANTITY_MAX ? String(LINE_QUANTITY_MAX) : raw;
    write(next);
    if (!enhanced) return;
    ctx!.setStatus(itemId, { kind: 'idle' });
    clearTimer();
    // The pause saves only a whole quantity at or above the floor: "15" over a floor of 10 is
    // not refused on its "1". Anything else waits for blur or Enter, and the server says why.
    const trimmed = next.trim();
    if (WHOLE.test(trimmed) && Number(trimmed) >= Math.max(1, floor)) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, CART_QUANTITY_AUTOSAVE_DELAY_MS);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    if (!enhanced) return;
    // Not posted: the redirect would remount the page under the buyer's cursor.
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const step = submitter instanceof HTMLElement ? Number(submitter.dataset.step ?? 0) : 0;
    void (async () => {
      if (!(await ctx!.flushAll(itemId))) return;
      if (step !== 0) {
        const typed = canonical(valueRef.current);
        const base = WHOLE.test(typed) ? Number(typed) : latest.current.quantity;
        const f = latest.current.floor;
        const next = step < 0 ? Math.max(f, base - 1) : Math.min(LINE_QUANTITY_MAX, Math.max(base + 1, f));
        write(String(next));
      }
      const ok = await flush();
      if (!ok) inputRef.current?.focus();
    })();
  };

  const status = ctx?.statusOf(itemId);
  const refused = status === undefined ? serverError : status.kind === 'error';
  const current = WHOLE.test(value.trim()) ? Number(value.trim()) : quantity;
  const minusDisabled = current <= floor;
  const describedBy = [refused ? statusId : null, belowId].filter((id): id is string => id !== null).join(' ');

  return (
    // `noValidate`: the browser's own `min` bubble speaks the browser's language and refuses
    // the 0 that removes the line (FR-007). The server action validates and the buyer reads
    // our sentence beside the field instead (U4).
    <form
      action={updateAction}
      onSubmit={onSubmit}
      noValidate
      data-cart-quantity-form={itemId}
      className="max-[720px]:[grid-area:stepper]"
    >
      <input type="hidden" name="itemId" value={itemId} />
      {/* The form's default button: Enter in the quantity input submits the first
          submit button in tree order. Nameless, so the typed `quantity` is what
          posts; without it Enter pressed "−" (a step down, or nothing at the floor). */}
      <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
        {qtyLabel}
      </button>
      <div className="qty__stepper" role="group" aria-label={qtyLabel}>
        {/* The steppers post `step`, not `quantity`: the input posts `quantity` too and
            sits between them, so the first `quantity` in the form data would be the
            input's for "+" (a no-op, or a refusal on a line below its minimum). */}
        <button
          type="submit"
          name="step"
          value={Math.max(floor, quantity - 1)}
          data-step="-1"
          disabled={minusDisabled}
          formNoValidate
          aria-label="−"
          title="−"
          {...(minusDisabled && minimumHint ? { 'aria-describedby': floorId } : {})}
        >
          −
        </button>
        <input
          ref={inputRef}
          type="number"
          name="quantity"
          min={floor}
          max={LINE_QUANTITY_MAX}
          value={value}
          onChange={(e): void => onChange(e.target.value)}
          onBlur={(): void => {
            if (enhanced) void flush();
          }}
          aria-label={qtyLabel}
          {...(belowId || refused ? { 'aria-invalid': true } : {})}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        />
        <button
          type="submit"
          name="step"
          value={Math.max(quantity + 1, floor)}
          data-step="1"
          formNoValidate
          aria-label="+"
          title="+"
        >
          +
        </button>
      </div>
      {minimumHint ? (
        <p id={floorId} className="m-0 mt-1 text-[11px] text-muted">{minimumHint}</p>
      ) : null}
    </form>
  );
}
