/**
 * The per-scope store, the mount de-duplication and the optimistic write with
 * its rollback (feature 091, P4b) — the three things that were generic in the
 * 540-line control `pim_ergonode` shipped and the 559-line near-copy
 * `pim_pimcore` was going to.
 *
 * ## Why a module-scoped store and not a React context
 *
 * The controls belong **next to the fields**, which means a dozen of them
 * render on one product, in four tabs of a screen the integration does not own.
 * A context would have to wrap that screen's tree, and the wrap would be a
 * larger and more invasive edit to somebody else's component than the controls
 * themselves. As a zone contribution the point is sharper still: a contributor
 * is mounted by the host, at twelve independent mount points, and has nowhere
 * to put a provider above them.
 *
 * So the state lives here, keyed by `scopeKey`: every control on one record and
 * one integration subscribes to the same entry, the first to mount triggers the
 * single read, and the rest await the same promise. **Two integrations on one
 * product are two keys**, which is what stops the pair sharing a view neither
 * of them produced.
 *
 * ## What is *not* here
 *
 * No HTTP. `load` and `save` are the owner's functions, closing over the
 * owner's own admin client (R6's amendment). The one policy this file does keep
 * is what a rejected `load` means: not configured, not permitted, or
 * unreachable all mean the same thing to a control that is an *addition* —
 * there is nothing to offer here — and that is a property of the surface rather
 * than of any one integration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  FieldProtectionEntry,
  FieldProtectionPricePath,
  FieldProtectionSource,
  FieldProtectionView,
} from './types.js';

interface ProtectionState {
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly view: FieldProtectionView | null;
  readonly saving: boolean;
  readonly error: string | null;
}

const INITIAL: ProtectionState = { status: 'loading', view: null, saving: false, error: null };

interface ProtectionStore {
  state: ProtectionState;
  readonly listeners: Set<() => void>;
  loading: Promise<void> | null;
}

/**
 * Keyed by `scopeKey`, so the controls of one integration on one record share
 * one request. An entry is dropped when its last subscriber unmounts, which is
 * what stops a long admin session accumulating one per record ever opened — and
 * what makes a re-opened editor refetch rather than render yesterday's answer.
 */
const STORES = new Map<string, ProtectionStore>();

function storeFor(scopeKey: string): ProtectionStore {
  const existing = STORES.get(scopeKey);
  if (existing) return existing;
  const created: ProtectionStore = { state: INITIAL, listeners: new Set(), loading: null };
  STORES.set(scopeKey, created);
  return created;
}

function publish(store: ProtectionStore, next: Partial<ProtectionState>): void {
  store.state = { ...store.state, ...next };
  for (const listener of store.listeners) listener();
}

function beginLoad(scopeKey: string, load: () => Promise<FieldProtectionView>): Promise<void> {
  const store = storeFor(scopeKey);
  if (store.loading) return store.loading;
  store.loading = (async () => {
    try {
      publish(store, { status: 'ready', view: await load(), error: null });
    } catch {
      // Not configured, not permitted, or unreachable. All three mean the same
      // thing to this surface: there is nothing to offer here. It is not a
      // swallowed failure of the host's own work — the control is an addition,
      // and an addition that cannot load renders nothing.
      publish(store, { status: 'unavailable', view: null, error: null });
    } finally {
      store.loading = null;
    }
  })();
  return store.loading;
}

/** Equality on the primary key of a protection row. */
function sameEntry(
  entry: FieldProtectionEntry,
  fieldPath: string,
  languageCode: string | null,
): boolean {
  return entry.fieldPath === fieldPath && (entry.languageCode ?? null) === languageCode;
}

/** Everything a control needs to render and to operate itself. */
export interface FieldProtectionApi {
  /** True only once the owner has said a connection is enabled. */
  readonly available: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly integrationManaged: boolean;
  readonly lastSyncedAt: string | null;
  readonly sourceKind: string | null;
  readonly variantCount: number;
  readonly livePricePaths: readonly FieldProtectionPricePath[];
  readonly protections: readonly FieldProtectionEntry[];
  readonly isProtected: (fieldPath: string, languageCode?: string | null) => boolean;
  readonly setProtected: (
    fieldPath: string,
    languageCode: string | null,
    next: boolean,
  ) => Promise<void>;
}

/**
 * Subscribe to one integration's protections for one record.
 *
 * The effect depends on `scopeKey` alone: `load` and `save` are closures the
 * contributor rebuilds every render, and depending on their identity would
 * re-run the read on every parent render. They are read through a ref instead,
 * so the newest pair is always the one that runs — which is the same guarantee
 * a dependency array would give and none of the churn.
 */
export function useFieldProtection(source: FieldProtectionSource): FieldProtectionApi {
  const [, forceRender] = useState(0);
  const behaviour = useRef(source);
  behaviour.current = source;

  const { scopeKey } = source;

  useEffect(() => {
    const store = storeFor(scopeKey);
    const listener = (): void => forceRender((tick) => tick + 1);
    store.listeners.add(listener);
    if (store.state === INITIAL) void beginLoad(scopeKey, () => behaviour.current.load());
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0) STORES.delete(scopeKey);
    };
  }, [scopeKey]);

  const state = STORES.get(scopeKey)?.state ?? INITIAL;

  const isProtected = useCallback(
    (fieldPath: string, languageCode?: string | null): boolean => {
      const entries = state.view?.protections ?? [];
      // A whole-field protection covers every language, so a per-language
      // control renders as checked under it.
      if (entries.some((entry) => sameEntry(entry, fieldPath, null))) return true;
      if (languageCode == null) return false;
      return entries.some((entry) => sameEntry(entry, fieldPath, languageCode));
    },
    [state.view],
  );

  const setProtected = useCallback(
    async (fieldPath: string, languageCode: string | null, next: boolean): Promise<void> => {
      const store = STORES.get(scopeKey);
      if (!store?.state.view) return;
      const previous = store.state.view;
      const desired: readonly FieldProtectionEntry[] = next
        ? [...previous.protections, { fieldPath, languageCode }]
        : previous.protections.filter((entry) => !sameEntry(entry, fieldPath, languageCode));

      // Optimistic: the checkbox moves now. A control that waits for a round
      // trip feels broken, and one that stays moved after a refusal lies — so
      // the rollback below is not defensive, it is the other half of this.
      publish(store, { view: { ...previous, protections: desired }, saving: true, error: null });
      try {
        publish(store, { view: await behaviour.current.save(desired), saving: false });
      } catch {
        publish(store, { view: previous, saving: false, error: 'save_failed' });
      }
    },
    [scopeKey],
  );

  return useMemo(
    () => ({
      available: state.status === 'ready' && state.view?.connectionEnabled === true,
      saving: state.saving,
      error: state.error,
      integrationManaged: state.view?.integrationManaged === true,
      lastSyncedAt: state.view?.lastSyncedAt ?? null,
      sourceKind: state.view?.sourceKind ?? null,
      variantCount: state.view?.variantCount ?? 0,
      livePricePaths: state.view?.livePricePaths ?? [],
      protections: state.view?.protections ?? [],
      isProtected,
      setProtected,
    }),
    [state, isProtected, setProtected],
  );
}
