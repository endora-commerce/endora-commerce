import { useCallback, useRef, useState } from 'react';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';

/** A row a batch reorder moves: held by its code, listed by its weight. */
export interface ReorderableRow {
  code: string;
  weight: number;
}

/** What the screen says after a reorder that did not go through. */
export interface ReorderNotice {
  /** `stale` — somebody else changed the list and it was reloaded; `failed` — the move was rolled back. */
  kind: 'stale' | 'failed';
  message: string;
}

export interface UseServerReorderOptions<T extends ReorderableRow> {
  /** The rows as shown, in list order. */
  rows: readonly T[];
  /** Puts rows on the screen — the optimistic move, or the rollback. */
  show: (rows: T[]) => void;
  /** Sends the whole list in its new order and shows what the server answered. */
  save: (orderedCodes: string[]) => Promise<void>;
  /** Reloads the list from the server and shows it. */
  reload: () => Promise<void>;
  /** The sentence for a 409 `ORDER_STALE`. */
  staleMessage: string;
  /** The sentence for any other refusal. */
  failedMessage: (error: unknown) => string;
}

export interface UseServerReorderResult {
  /** A reorder is in flight: every move control is disabled until it settles. */
  busy: boolean;
  notice: ReorderNotice | null;
  /** Move `code` by `delta` places (−1 up, +1 down). Ignored while busy or past either end. */
  move: (code: string, delta: number) => void;
}

/**
 * The batch reorder of a configuration list (issue #1560, the architect's
 * ruling): the row moves at once (optimistic), **one** `PUT …/order` carries
 * the whole list, a refusal puts the list back as it was and says so, and a
 * 409 `ORDER_STALE` — the list changed under the operator — reloads it and
 * says that instead. The screen's weights are rewritten in the new order, so
 * a table sorted by weight shows the move before the server answers.
 */
export function useServerReorder<T extends ReorderableRow>(options: UseServerReorderOptions<T>): UseServerReorderResult {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ReorderNotice | null>(null);
  // The latest options, so `move` stays stable and still reads the rows it is called on.
  const latest = useRef(options);
  latest.current = options;
  const inFlight = useRef(false);

  const move = useCallback((code: string, delta: number): void => {
    const { rows, show, save, reload, staleMessage, failedMessage } = latest.current;
    if (inFlight.current) return;
    const from = rows.findIndex((row) => row.code === code);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= rows.length) return;

    const previous = [...rows];
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    const stepped = next.map((row, index) => ({ ...row, weight: (index + 1) * 10 }));

    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    show(stepped);
    void (async (): Promise<void> => {
      try {
        await save(stepped.map((row) => row.code));
      } catch (error) {
        if (error instanceof ApiError && error.envelope.error.code === ERROR_CODES.ORDER_STALE) {
          setNotice({ kind: 'stale', message: staleMessage });
          try {
            await reload();
          } catch {
            show(previous);
          }
        } else {
          show(previous);
          setNotice({ kind: 'failed', message: failedMessage(error) });
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  }, []);

  return { busy, notice, move };
}
