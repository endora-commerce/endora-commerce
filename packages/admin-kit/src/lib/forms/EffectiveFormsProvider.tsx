/**
 * The effective forms, as the server computed them (`specs/193-admin-form-extensions/`
 * FR-023, FR-024, SC-007, `contracts/field-overrides.md` §2, D-300.9).
 *
 * Every override a declared form applies comes from here — the admin bundles
 * no second copy — and it is fetched **once per session refresh**, beside
 * module presence, never per form:
 *
 * - **Lazily.** Nothing is fetched until the first declared form mounts, so a
 *   session that never opens one costs no request, and a screen whose test
 *   renders no declared form needs no stub.
 * - **With presence.** Once fetched, it is fetched again whenever the presence
 *   projection is refreshed: a switched-off module's overrides leave with it
 *   (FR-052). The response carries an `ETag`, so a refresh that changed nothing
 *   is a revalidation the browser answers from its cache.
 * - **On demand.** `refresh()` after an operator-layout write (FR-024).
 *
 * **Fail-open to the declaration, which is presentation only.** While the
 * first answer is in flight, after a failed fetch, and without this provider
 * mounted at all, a declared form lays out its declaration with no override.
 * That shows a field an override would hide or relabel, never one the server
 * would refuse to accept: every rule is enforced by the server whatever the
 * form showed (FR-062). A slot's presence is decided by the presence
 * projection, which fails closed, and not here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EffectiveFormsResponse } from '@endora-commerce/contracts';
// `../api-client.js` and `../module-presence/…`, not the `./lib` barrel: see
// the note in `module-presence/api.ts` — a `vi.mock` of the barrel cannot reach
// a file the barrel itself exports, and this provider's seam is `initial`.
import { apiClient } from '../api-client.js';
import { useModulePresence } from '../module-presence/ModulePresenceProvider.js';
import type { EffectiveForm } from './layout.js';

/** `GET /api/v1/admin/effective-forms` (D-300.9). */
export async function getEffectiveForms(): Promise<EffectiveFormsResponse> {
  return apiClient.get<EffectiveFormsResponse>('/api/v1/admin/effective-forms');
}

export type EffectiveFormsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EffectiveFormsContextValue {
  readonly status: EffectiveFormsStatus;
  /** The effective form, or `undefined` while unknown or when the server does not serve it. */
  formOf(formId: string): EffectiveForm | undefined;
  /** Ask for the first fetch; a no-op once one was made. A declared form calls it on mount. */
  request(): void;
  /** Fetch again — after an operator-layout write. */
  refresh(): Promise<void>;
}

const EffectiveFormsContext = createContext<EffectiveFormsContextValue | null>(null);

/** What a declared form reads with no provider mounted: the declaration, nothing more. */
const UNAVAILABLE: EffectiveFormsContextValue = {
  status: 'idle',
  formOf: () => undefined,
  request: () => undefined,
  refresh: () => Promise.resolve(),
};

export interface EffectiveFormsProviderProps {
  /** A pre-supplied response; tests use it to skip the fetch, as `ModulePresenceProvider`'s `initial`. */
  readonly initial?: EffectiveFormsResponse;
  readonly children: ReactNode;
}

/** Mounted once by the admin application, inside `ModulePresenceProvider`. */
export function EffectiveFormsProvider({ initial, children }: EffectiveFormsProviderProps): ReactNode {
  const { modules } = useModulePresence();
  const [response, setResponse] = useState<EffectiveFormsResponse | null>(initial ?? null);
  const [status, setStatus] = useState<EffectiveFormsStatus>(initial === undefined ? 'idle' : 'ready');
  const [wanted, setWanted] = useState(initial !== undefined);
  const [tick, setTick] = useState(0);
  const seeded = useRef(initial !== undefined);
  const latest = useRef(0);

  // Callers of `refresh()` waiting for the fetch it starts: resolved when the
  // latest fetch lands or fails, so `await refresh()` reads the new forms.
  const waiting = useRef<(() => void)[]>([]);
  const settle = (): void => {
    const resolve = waiting.current;
    waiting.current = [];
    for (const done of resolve) done();
  };

  const request = useCallback((): void => setWanted(true), []);
  const refresh = useCallback(
    (): Promise<void> =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setWanted(true);
        setTick((n) => n + 1);
      }),
    [],
  );

  // A presence refresh after the first fetch is a refresh of the forms too.
  const presenceSeen = useRef(modules);
  useEffect(() => {
    if (presenceSeen.current === modules) return;
    presenceSeen.current = modules;
    if (wanted) setTick((n) => n + 1);
    // `wanted` is read, not followed: wanting the forms is not a presence change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

  useEffect(() => {
    if (!wanted) return;
    if (seeded.current && tick === 0) return;
    const call = ++latest.current;
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    void (async () => {
      try {
        const next = await getEffectiveForms();
        if (call !== latest.current) return;
        setResponse(next);
        setStatus('ready');
        settle();
      } catch (err) {
        if (call !== latest.current) return;
        // A refresh that failed keeps the forms it had; a first fetch that
        // failed leaves the declarations (see the header).
        setStatus((current) => (current === 'ready' ? current : 'error'));
        settle();
        if (import.meta.env.DEV) console.warn('[effective-forms] fetch failed', err);
      }
    })();
  }, [wanted, tick]);

  const value = useMemo<EffectiveFormsContextValue>(() => {
    const byId = new Map((response?.forms ?? []).map((form) => [form.id, form]));
    return { status, formOf: (formId) => byId.get(formId), request, refresh };
  }, [response, status, request, refresh]);

  return <EffectiveFormsContext.Provider value={value}>{children}</EffectiveFormsContext.Provider>;
}

/** The provider's value, or the declaration-only answer when none is mounted (see the header). */
export function useEffectiveForms(): EffectiveFormsContextValue {
  return useContext(EffectiveFormsContext) ?? UNAVAILABLE;
}

/** One form's effective state, asking for the first fetch on mount. */
export function useEffectiveForm(formId: string): { readonly form: EffectiveForm | undefined; readonly status: EffectiveFormsStatus } {
  const forms = useEffectiveForms();
  const { request } = forms;
  useEffect(() => {
    request();
  }, [request]);
  return { form: forms.formOf(formId), status: forms.status };
}
