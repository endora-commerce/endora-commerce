import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The longest name a page, block or template takes (`duplicateCmsRecordRequestSchema`). */
const NAME_MAX_LENGTH = 200;

/**
 * The navigation state a list hands the editor it opens on a fresh copy
 * (issue #1495, DEC-17): the editor then shows that a copy was made and puts
 * focus on its name, the next thing the operator does.
 */
export const DUPLICATED_STATE = { cmsDuplicated: true } as const;

/**
 * The copy's name in the operator's language: a name is the operator's data,
 * so the consumer chooses it and the server's English default is for API
 * callers only (`specs/conventions/module-i18n.md`).
 */
export function copyNameFor(name: string, t: Translate): string {
  return t('duplicate.copyName', { name }).slice(0, NAME_MAX_LENGTH);
}

function detail(err: ApiError, key: string): string {
  const details = err.envelope.error.details as Record<string, unknown> | undefined;
  const value = details?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * What a list says when a duplicate is refused. The server's sentence tells the
 * operator to choose another slug, which a duplicate gives them no field for,
 * so the refusals they can act on are worded here, with the way out; anything
 * else is the generic retry line. Exported for the tests.
 */
export function cmsDuplicateErrorMessage(err: unknown, t: Translate): string {
  if (!(err instanceof ApiError)) return t('duplicate.failed');
  switch (err.envelope.error.code) {
    case ERROR_CODES.CMS_SLUG_RESERVED:
      return t('duplicate.slugReserved', { segment: detail(err, 'segment') });
    case ERROR_CODES.CMS_SLUG_CONFLICT:
      return t('duplicate.slugConflict', { path: detail(err, 'path') });
    case ERROR_CODES.CMS_CODE_CONFLICT:
      return t('duplicate.codeConflict');
    case ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE:
      return err.envelope.error.message;
    default:
      return t('duplicate.failed');
  }
}

/**
 * A list's Duplicate row action: runs at once (the copy is derived and can be
 * deleted, so there is nothing to ask), ignores a second select while one is
 * pending, opens the copy's editor on success and keeps the list with a
 * translated message on failure.
 */
export function useDuplicateAction<Row extends { id: string; name: string }>(options: {
  run: (row: Row, body: { name: string }) => Promise<{ id: string }>;
  editorPath: (id: string) => string;
  t: Translate;
}): {
  duplicate: (row: Row) => Promise<void>;
  pendingId: string | null;
  error: string | null;
  clearError: () => void;
} {
  const navigate = useNavigate();
  const { run, editorPath, t } = options;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref as well as state: two selects in one tick both read the state before it re-renders.
  const pending = useRef(false);

  const duplicate = useCallback(
    async (row: Row): Promise<void> => {
      if (pending.current) return;
      pending.current = true;
      setPendingId(row.id);
      setError(null);
      try {
        const copy = await run(row, { name: copyNameFor(row.name, t) });
        navigate(editorPath(copy.id), { state: DUPLICATED_STATE });
      } catch (err) {
        setError(cmsDuplicateErrorMessage(err, t));
      } finally {
        pending.current = false;
        setPendingId(null);
      }
    },
    [run, editorPath, navigate, t],
  );

  return { duplicate, pendingId, error, clearError: useCallback(() => setError(null), []) };
}

/**
 * The editor's half: when it was opened on a fresh copy, reveal the settings
 * panel once the record has loaded and move focus to the name field. Answers
 * whether to show the "copy created" notice. The navigation state is consumed,
 * so a reload of the editor does not announce the copy again.
 */
export function useDuplicatedLanding(options: {
  ready: boolean;
  reveal: () => void;
  open: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
}): boolean {
  const location = useLocation();
  const navigate = useNavigate();
  const arrived = (location.state as { cmsDuplicated?: unknown } | null)?.cmsDuplicated === true;
  // The path the copy landed on: the router reuses an editor across `/:id`, so
  // the notice belongs to that record only.
  const [landedPath, setLandedPath] = useState<string | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  // One arrival is handled once. The effect below may run again before the
  // replaced navigation has cleared the state — a new `reveal` or `navigate`
  // identity is enough — and handling it twice would re-arm the focus forever.
  const handledKey = useRef<string | null>(null);
  const { ready, reveal, open, nameRef } = options;

  useEffect(() => {
    if (!arrived || !ready || handledKey.current === location.key) return;
    handledKey.current = location.key;
    setLandedPath(location.pathname);
    setFocusPending(true);
    reveal();
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [arrived, ready, reveal, navigate, location.key, location.pathname, location.search]);

  useEffect(() => {
    if (!focusPending || !open || !nameRef.current) return;
    nameRef.current.focus();
    setFocusPending(false);
  }, [focusPending, open, nameRef]);

  return landedPath === location.pathname;
}
