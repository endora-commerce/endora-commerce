'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';

/**
 * Issue #1253 — the quick-order page's fields that outlive the reload of a form they are not in.
 *
 * The page is server-rendered and its forms are separate — the pasted list, the search, and each
 * search result's quantity + *Add* — so submitting one reloads the page and drops what was typed
 * into the others. These fields keep what the buyer typed in the tab's `sessionStorage` and put it
 * back after the reload: the pasted list survives a search, and the quantities typed in the other
 * result rows survive an *Add* on one. The row whose *Add* was pressed starts again at 1, as it
 * always did; a finished build (`forget`) forgets both, and empties the paste box it re-renders
 * in place (issue #1325). A refused build keeps them.
 *
 * Progressive enhancement: the server renders the same plain `<textarea>` / `<input>` the page
 * always had, so without JavaScript the forms post exactly as before. `sessionStorage` rather than
 * `localStorage`: the text is the buyer's work in progress in this tab, not a draft to find again
 * next week — that is what the preview, kept on the backend, is for.
 */

export const QUICK_ORDER_PASTE_STORAGE_KEY = 'b2b:quick-order:paste';
export const QUICK_ORDER_QUANTITIES_STORAGE_KEY = 'b2b:quick-order:quantities';

/** The tab's storage, or `null` when the browser refuses it (privacy mode, a sandboxed frame). */
function tabStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readItem(key: string): string | null {
  try {
    return tabStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    const storage = tabStorage();
    if (!storage) return;
    if (value === null || value === '') storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // A full or refused storage is not fatal: the field simply is not kept.
  }
}

function readQuantities(): Record<string, string> {
  try {
    const parsed = JSON.parse(readItem(QUICK_ORDER_QUANTITIES_STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function writeQuantity(productId: string, value: string | null): void {
  const quantities = readQuantities();
  if (value === null) delete quantities[productId];
  else quantities[productId] = value;
  writeItem(QUICK_ORDER_QUANTITIES_STORAGE_KEY, Object.keys(quantities).length > 0 ? JSON.stringify(quantities) : null);
}

/** The paste box — a plain `<textarea>` whose text is kept across the page's reloads. */
export function QuickOrderPasteField(props: {
  id: string;
  name: string;
  rows: number;
  placeholder: string;
  /** A build has used the list: forget it. */
  forget: boolean;
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.forget) {
      writeItem(QUICK_ORDER_PASTE_STORAGE_KEY, null);
      // Issue #1325 — the build's redirect re-renders the page in place, so the box is still
      // mounted with the list in it: empty it too, or a second Preview + Send builds it twice.
      if (ref.current) ref.current.value = '';
      return;
    }
    const kept = readItem(QUICK_ORDER_PASTE_STORAGE_KEY);
    // Never over what the buyer typed before the page hydrated.
    if (kept && ref.current && ref.current.value === '') ref.current.value = kept;
  }, [props.forget]);
  return (
    <textarea
      ref={ref}
      id={props.id}
      name={props.name}
      rows={props.rows}
      placeholder={props.placeholder}
      style={{ fontFamily: 'monospace' }}
      onChange={(e): void => writeItem(QUICK_ORDER_PASTE_STORAGE_KEY, e.target.value)}
    />
  );
}

/** The value a result row's quantity starts at — and goes back to once it was added. */
const START_QUANTITY = '1';

/**
 * A search result's quantity — a plain number input in that row's *Add* form, whose typed value is
 * kept across the page's reloads until its own *Add* sends it.
 */
export function QuickOrderResultQuantity(props: {
  productId: string;
  ariaLabel: string;
  /** A build is done: forget every typed quantity. */
  forget: boolean;
}): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const { productId, forget } = props;
  useEffect(() => {
    if (forget) {
      writeItem(QUICK_ORDER_QUANTITIES_STORAGE_KEY, null);
      return;
    }
    const input = ref.current;
    if (!input) return;
    const kept = readQuantities()[productId];
    if (kept !== undefined && input.value === START_QUANTITY) input.value = kept;
    // This row's own Add sends the quantity, so it is no longer the buyer's to keep.
    const form = input.form;
    const sent = (): void => writeQuantity(productId, null);
    form?.addEventListener('submit', sent);
    return () => form?.removeEventListener('submit', sent);
  }, [productId, forget]);
  return (
    <input
      ref={ref}
      type="number"
      name="quantity"
      min={1}
      max={LINE_QUANTITY_MAX}
      defaultValue={START_QUANTITY}
      style={{ width: 64 }}
      aria-label={props.ariaLabel}
      onChange={(e): void => writeQuantity(productId, e.target.value === START_QUANTITY ? null : e.target.value)}
    />
  );
}
