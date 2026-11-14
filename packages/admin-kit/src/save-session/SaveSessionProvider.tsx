/**
 * The save session: the host's provider and the two hooks (feature 180,
 * `specs/180-one-save-zone-editors/contracts/save-participation.md` §2–§3; FR-001…FR-006,
 * FR-034; research R2–R5, R8, R15).
 *
 * - The **host editor** wraps itself in `SaveSessionProvider resetKey=…`, passes
 *   `useSaveSession().handle` as the `saveSession` prop of every zone it mounts, adds
 *   `dirtyCount` to its own staged count and calls `run(hostPart)` from its Save.
 * - A **zone contribution** calls `useSaveParticipant(props.saveSession, …)` and edits its
 *   draft through it. Its module is read from the `AdminZone` that rendered it, never declared.
 * - A **host-owned section** calls the same hook outside any zone; it takes part under the
 *   provider's `hostModule`, and a provider without one refuses it.
 *
 * Presence (Principle XVII) needs no gating code here: a contribution of a module that is off is
 * never rendered by `useAdminZone`, so it never registers. What this file adds is the case the
 * zone cannot see — a draft that outlives its panel — re-checked whenever presence or
 * permissions change and before every Save.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { EditorSaveSessionHandle } from '@endora-commerce/contracts';

import { useTranslation } from '../i18n/useTranslation.js';
import { ApiError } from '../lib/api-client.js';
import { useSurfaceVisibility } from '../lib/surface-visibility.js';
import { useZoneContribution } from './contribution-context.js';
import type { ParticipantIssues, SaveOutcome, SavePart } from './run-save.js';
import {
  SaveSessionStore,
  type ParticipantStatus,
  type SaveParticipantHandlers,
  type SessionSnapshot,
} from './session-store.js';

/** The live session behind each handle; contracts carries only the opaque handle. */
const storeByHandle = new WeakMap<EditorSaveSessionHandle, SaveSessionStore>();

/**
 * The handle for a mount that offers no live session: a `useAdminZone` probe that passes
 * placeholder props, or a host whose editor does not run a session yet. A participant handed it
 * keeps a local draft and takes part in nothing.
 */
export const INERT_SAVE_SESSION: EditorSaveSessionHandle = { sessionId: 'inert' };

const SaveSessionContext = createContext<SaveSessionStore | null>(null);

export interface SaveSessionProviderProps {
  /**
   * The session's identity: a new value starts an empty session. The product editor passes its
   * scope key (OQ-4 = A); the other editors their record id.
   */
  readonly resetKey: string;
  /** The host's module, owner of host-owned sections (FR-006). */
  readonly hostModule?: string;
  readonly children: ReactNode;
}

function fieldsOf(details: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (detail !== null && typeof detail === 'object') {
        const { path, issue } = detail as { path?: unknown; issue?: unknown };
        if (typeof path === 'string' && typeof issue === 'string') fields[path] = issue;
      }
    }
    return fields;
  }
  if (details !== null && typeof details === 'object') {
    const nested = (details as { fields?: unknown }).fields;
    if (nested !== null && typeof nested === 'object') {
      for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
        if (typeof value === 'string') fields[key] = value;
      }
    }
  }
  return fields;
}

export function SaveSessionProvider({ resetKey, hostModule, children }: SaveSessionProviderProps): ReactNode {
  const t = useTranslation('core');
  // One store per `resetKey`: a new key is a new, empty session, and a new handle the zones pass
  // on. `resetKey` is the memo's identity on purpose; the body does not read it.
  const store = useMemo(
    () => new SaveSessionStore(hostModule ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resetKey` is the session's identity.
    [resetKey, hostModule],
  );
  storeByHandle.set(store.handle, store);
  store.setTexts({
    noticeModuleOff: (label) => t('saveSession.notice.moduleOff', { label }),
    noticeCrashed: (label) => t('saveSession.notice.crashed', { label }),
    describeError: (error): ParticipantIssues => {
      if (error instanceof ApiError) {
        if (error.envelope.error.code === 'MODULE_DISABLED') {
          return { fields: {}, message: t('saveSession.error.moduleOff') };
        }
        return { fields: fieldsOf(error.envelope.error.details), message: error.envelope.error.message };
      }
      return { fields: {}, message: error instanceof Error ? error.message : String(error) };
    },
  });

  useEffect(() => store.attach(), [store]);

  const isVisible = useSurfaceVisibility();
  useEffect(() => {
    store.dropInvisible(isVisible);
  }, [store, isVisible]);

  return <SaveSessionContext.Provider value={store}>{children}</SaveSessionContext.Provider>;
}

function useStoreSnapshot(store: SaveSessionStore | null): SessionSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => (store === null ? () => undefined : store.subscribe(listener)),
    [store],
  );
  const getSnapshot = useCallback(() => (store === null ? null : store.getSnapshot()), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface SaveSessionValue {
  readonly handle: EditorSaveSessionHandle;
  /** Participants only; the host adds its own staged count. */
  readonly dirtyCount: number;
  readonly hasWritableParticipant: boolean;
  /** The dirty participants as parts of a Save, in zone order. */
  dirtyParticipants(): readonly SavePart[];
  discardAll(): void;
  /** Clears the last outcome — the host calls it on an edit of its own (FR-016). */
  clearOutcome(): void;
  readonly saving: boolean;
  readonly notices: readonly string[];
  readonly lastOutcome: SaveOutcome | null;
  run(hostPart: SavePart | null, options?: { readonly stopOnFailure?: boolean }): Promise<SaveOutcome>;
}

/** The host's side of the session. Must be called under `SaveSessionProvider`. */
export function useSaveSession(): SaveSessionValue {
  const store = useContext(SaveSessionContext);
  if (store === null) {
    throw new Error('[save-session] useSaveSession() called outside <SaveSessionProvider>.');
  }
  const snapshot = useStoreSnapshot(store) as SessionSnapshot;
  const isVisible = useSurfaceVisibility();
  return useMemo(
    (): SaveSessionValue => ({
      handle: store.handle,
      dirtyCount: store.dirtyCount(),
      hasWritableParticipant: store.hasWritableParticipant(),
      dirtyParticipants: () => store.dirtyParticipants(),
      discardAll: () => store.discardAll(),
      clearOutcome: () => store.clearOutcome(),
      saving: snapshot.saving,
      notices: snapshot.notices,
      lastOutcome: snapshot.lastOutcome,
      run: (hostPart, options) => {
        // A module switched off since the last render takes no part (FR-034).
        store.dropInvisible(isVisible);
        return store.run(hostPart, options);
      },
    }),
    // `snapshot` is the store's version: every mutation replaces it.
    [store, snapshot, isVisible],
  );
}

export interface SaveParticipantSpec<D> {
  /** Local to the module; the participant's id is `${module}:${key}`. */
  readonly key: string;
  /** Translated part name, e.g. "Base prices". */
  readonly label: string;
  /** False → the part is read-only and never dirty (FR-035). */
  readonly writable: boolean;
  /**
   * What the panel loaded; `null` while loading. Seeds the draft only while it is clean, and
   * by identity: pass the value a read put in state, not an object literal built each render.
   */
  readonly loaded: D | null;
}

export interface SaveParticipant<D> {
  /** `null` until `loaded` is first non-null. */
  readonly draft: D | null;
  setDraft(next: D | ((previous: D) => D)): void;
  readonly issues: ParticipantIssues | null;
  readonly status: ParticipantStatus;
  readonly error: string | null;
}

function resolveNext<D>(next: D | ((previous: D) => D), previous: D): D {
  return typeof next === 'function' ? (next as (previous: D) => D)(previous) : next;
}

/**
 * A zone contribution's — or a host-owned section's — part in its host's Save.
 *
 * `handlers` must be pure of component state: they are kept with the session's entry and may
 * run after the panel has unmounted.
 */
export function useSaveParticipant<D>(
  handle: EditorSaveSessionHandle,
  spec: SaveParticipantSpec<D>,
  handlers: SaveParticipantHandlers<D>,
): SaveParticipant<D> {
  const resolved = storeByHandle.get(handle) ?? null;
  const contribution = useZoneContribution();
  const module = contribution?.module ?? resolved?.hostModule ?? null;
  const refused = resolved !== null && module === null;
  const store = module === null ? null : resolved;
  const id = `${module ?? ''}:${spec.key}`;
  const { label, writable, loaded } = spec;
  const zone = contribution?.zone ?? null;
  const weight = contribution?.weight ?? 0;
  const requiredPermission = contribution?.requiredPermission;

  const meta = useMemo(
    () => ({
      module: module ?? '',
      zone,
      weight,
      ...(requiredPermission === undefined ? {} : { requiredPermission }),
      label,
      writable,
      handlers: handlers as SaveParticipantHandlers<unknown>,
    }),
    [module, zone, weight, requiredPermission, label, writable, handlers],
  );

  useEffect(() => {
    if (store === null) return undefined;
    store.mount(id);
    return () => store.unmount(id);
  }, [store, id]);

  useEffect(() => {
    if (store === null || loaded === null) return;
    store.seed(id, meta, loaded);
    // `meta` changes are applied by the next effect; seeding re-runs only on a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id, loaded]);

  useEffect(() => {
    store?.updateMeta(id, meta);
  }, [store, id, meta]);

  const snapshot = useStoreSnapshot(store);
  const entry = snapshot?.entries.get(id);

  // No live session: a local draft that takes part in nothing.
  const [local, setLocal] = useState<{ loaded: D | null; draft: D | null }>({ loaded, draft: loaded });
  const localDraft = local.loaded === loaded ? local.draft : loaded;

  const setDraft = useCallback(
    (next: D | ((previous: D) => D)) => {
      if (store !== null) {
        store.setDraft(id, (previous) => resolveNext(next, previous as D));
        return;
      }
      setLocal((current) => {
        const base = current.loaded === loaded ? current.draft : loaded;
        return base === null ? current : { loaded, draft: resolveNext(next, base) };
      });
    },
    [store, id, loaded],
  );

  if (refused) {
    throw new Error(
      `[save-session] '${spec.key}' takes part outside any zone, and the session's ` +
        '<SaveSessionProvider> declares no hostModule to own it (FR-006).',
    );
  }
  if (store === null) {
    return { draft: localDraft, setDraft, issues: null, status: 'clean', error: null };
  }
  return {
    draft: entry === undefined ? loaded : (entry.draft as D),
    setDraft,
    issues: entry?.issues ?? null,
    status: entry?.status ?? 'clean',
    error: entry?.error ?? null,
  };
}
