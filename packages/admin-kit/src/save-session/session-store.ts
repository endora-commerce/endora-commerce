/**
 * One save session's state, outside React (feature 180, `data-model.md` § *SaveSession*,
 * § *ParticipantEntry*; research R2).
 *
 * The session — not the panel — holds every participant's draft and baseline, so a panel that
 * unmounts (a tab switch) loses nothing, and its `validate` / `save` are kept with the entry so
 * an unmounted part can still be saved from another tab. A clean entry is removed when its panel
 * unmounts; a dirty one stays until it is saved, discarded or dropped.
 *
 * Every mutation replaces the snapshot, so `useSyncExternalStore` readers see a new value.
 */
import type { AdminZoneName } from '@endora-commerce/contracts';

import type { PermissionRequirement } from '../lib/surface-visibility.js';
import { onZoneContributionCrash } from './contribution-context.js';
import {
  runSave,
  type ParticipantIssues,
  type RunSaveOptions,
  type SaveContext,
  type SaveOutcome,
  type SavePart,
} from './run-save.js';

/** What a participant registers: pure functions of its draft, never of component state. */
export interface SaveParticipantHandlers<D> {
  /** Number of unsaved changes; 0 = clean. Pure. */
  changeCount(draft: D, baseline: D): number;
  /** All checks, local and the module's server pre-check. */
  validate(draft: D, ctx: SaveContext): Promise<ParticipantIssues>;
  /** Write the part through the module's own API. Returns the new baseline. */
  save(draft: D, ctx: SaveContext): Promise<D>;
}

export type ParticipantStatus = 'clean' | 'dirty' | 'invalid' | 'saving' | 'failed';

export interface ParticipantMeta {
  readonly module: string;
  /** `null` for a host-owned section. */
  readonly zone: AdminZoneName | null;
  readonly weight: number;
  readonly requiredPermission?: PermissionRequirement;
  readonly label: string;
  readonly writable: boolean;
  readonly handlers: SaveParticipantHandlers<unknown>;
}

export interface ParticipantEntry extends ParticipantMeta {
  readonly id: string;
  readonly baseline: unknown;
  readonly draft: unknown;
  readonly changeCount: number;
  readonly status: ParticipantStatus;
  readonly issues: ParticipantIssues | null;
  readonly error: string | null;
}

export interface SessionSnapshot {
  readonly entries: ReadonlyMap<string, ParticipantEntry>;
  readonly notices: readonly string[];
  readonly lastOutcome: SaveOutcome | null;
  readonly saving: boolean;
}

/** Translated texts the store needs; supplied by the provider, which owns translation. */
export interface SessionTexts {
  noticeModuleOff(label: string): string;
  noticeCrashed(label: string): string;
  describeError(error: unknown): ParticipantIssues;
}

function isCounted(entry: ParticipantEntry): boolean {
  return entry.writable && entry.changeCount > 0;
}

/** Host-owned sections first (they are the host's), then zone order: weight, module id, id. */
function compareEntries(left: ParticipantEntry, right: ParticipantEntry): number {
  const leftHost = left.zone === null ? 0 : 1;
  const rightHost = right.zone === null ? 0 : 1;
  return (
    leftHost - rightHost ||
    left.weight - right.weight ||
    left.module.localeCompare(right.module) ||
    left.id.localeCompare(right.id)
  );
}

let sessionCounter = 0;

export class SaveSessionStore {
  readonly handle: { readonly sessionId: string };
  readonly hostModule: string | null;

  #snapshot: SessionSnapshot = { entries: new Map(), notices: [], lastOutcome: null, saving: false };
  #mounts = new Map<string, number>();
  #listeners = new Set<() => void>();
  #texts: SessionTexts | null = null;
  #inFlight: Promise<SaveOutcome> | null = null;

  constructor(hostModule: string | null) {
    sessionCounter += 1;
    this.handle = Object.freeze({ sessionId: `save-session-${sessionCounter}` });
    this.hostModule = hostModule;
  }

  // -- subscription ---------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SessionSnapshot => this.#snapshot;

  /** Start listening for contribution crashes; returns the stop. */
  attach(): () => void {
    return onZoneContributionCrash(({ module, zone }) => {
      this.dropWhere(
        (entry) => entry.zone !== null && entry.module === module && entry.zone === zone,
        (label) => this.#texts?.noticeCrashed(label) ?? label,
      );
    });
  }

  setTexts(texts: SessionTexts): void {
    this.#texts = texts;
  }

  #commit(next: Partial<SessionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next };
    for (const listener of this.#listeners) listener();
  }

  #withEntries(mutate: (entries: Map<string, ParticipantEntry>) => void, extra: Partial<SessionSnapshot> = {}): void {
    const entries = new Map(this.#snapshot.entries);
    mutate(entries);
    this.#commit({ ...extra, entries });
  }

  // -- participant side -----------------------------------------------------

  mount(id: string): void {
    this.#mounts.set(id, (this.#mounts.get(id) ?? 0) + 1);
  }

  unmount(id: string): void {
    const left = (this.#mounts.get(id) ?? 1) - 1;
    if (left > 0) {
      this.#mounts.set(id, left);
      return;
    }
    this.#mounts.delete(id);
    const entry = this.#snapshot.entries.get(id);
    if (entry !== undefined && entry.status === 'clean') {
      this.#withEntries((entries) => entries.delete(id));
    }
  }

  /**
   * Seed or refresh a participant from what its panel loaded. `loaded` replaces the baseline and
   * the draft only while the entry is clean: a remount with a dirty entry shows the kept draft.
   */
  seed(id: string, meta: ParticipantMeta, loaded: unknown): void {
    const known = this.#snapshot.entries.get(id);
    if (known !== undefined && (known.status !== 'clean' || known.baseline === loaded)) {
      this.updateMeta(id, meta);
      return;
    }
    this.#withEntries((entries) =>
      entries.set(id, {
        ...meta,
        id,
        baseline: loaded,
        draft: loaded,
        changeCount: 0,
        status: 'clean',
        issues: null,
        error: null,
      }),
    );
  }

  updateMeta(id: string, meta: ParticipantMeta): void {
    const entry = this.#snapshot.entries.get(id);
    if (entry === undefined) return;
    const unchanged =
      entry.label === meta.label &&
      entry.writable === meta.writable &&
      entry.handlers === meta.handlers &&
      entry.zone === meta.zone &&
      entry.weight === meta.weight;
    if (unchanged) return;
    const next: ParticipantEntry = meta.writable
      ? { ...entry, ...meta }
      : // A part that may not write is never dirty.
        { ...entry, ...meta, draft: entry.baseline, changeCount: 0, status: 'clean', issues: null, error: null };
    this.#withEntries((entries) => entries.set(id, next));
  }

  setDraft(id: string, update: (previous: unknown) => unknown): void {
    const entry = this.#snapshot.entries.get(id);
    if (entry === undefined || !entry.writable) return;
    const draft = update(entry.draft);
    const changeCount = entry.handlers.changeCount(draft, entry.baseline);
    this.#withEntries(
      (entries) =>
        entries.set(id, {
          ...entry,
          draft,
          changeCount,
          status: changeCount > 0 ? 'dirty' : 'clean',
          issues: null,
          error: null,
        }),
      // FR-016: the outcome is shown until the next edit.
      { lastOutcome: null },
    );
  }

  // -- host side ------------------------------------------------------------

  dirtyCount(): number {
    let total = 0;
    for (const entry of this.#snapshot.entries.values()) if (isCounted(entry)) total += entry.changeCount;
    return total;
  }

  hasWritableParticipant(): boolean {
    for (const entry of this.#snapshot.entries.values()) if (entry.writable) return true;
    return false;
  }

  dirtyEntries(): readonly ParticipantEntry[] {
    return [...this.#snapshot.entries.values()].filter(isCounted).sort(compareEntries);
  }

  clearOutcome(): void {
    if (this.#snapshot.lastOutcome !== null) this.#commit({ lastOutcome: null });
  }

  /** Every draft back to its baseline; an unmounted entry has nothing left to show and goes. */
  discardAll(): void {
    this.#withEntries(
      (entries) => {
        for (const [id, entry] of entries) {
          if ((this.#mounts.get(id) ?? 0) === 0) {
            entries.delete(id);
            continue;
          }
          entries.set(id, { ...entry, draft: entry.baseline, changeCount: 0, status: 'clean', issues: null, error: null });
        }
      },
      { notices: [], lastOutcome: null },
    );
  }

  /** Remove the entries `predicate` selects; a notice for each that held unsaved changes. */
  dropWhere(predicate: (entry: ParticipantEntry) => boolean, notice: (label: string) => string): void {
    const dropped = [...this.#snapshot.entries.values()].filter(predicate);
    if (dropped.length === 0) return;
    const notices = dropped.filter(isCounted).map((entry) => notice(entry.label));
    this.#withEntries(
      (entries) => {
        for (const entry of dropped) entries.delete(entry.id);
      },
      notices.length === 0 ? {} : { notices: [...this.#snapshot.notices, ...notices] },
    );
  }

  /** Drop the participants whose module the operator can no longer see (FR-034, R8). */
  dropInvisible(isVisible: (surface: { module: string; requiredPermission?: PermissionRequirement }) => boolean): void {
    this.dropWhere(
      (entry) =>
        entry.zone !== null &&
        !isVisible({
          module: entry.module,
          ...(entry.requiredPermission === undefined ? {} : { requiredPermission: entry.requiredPermission }),
        }),
      (label) => this.#texts?.noticeModuleOff(label) ?? label,
    );
  }

  /** The dirty participants as parts of a Save, in zone order. */
  dirtyParticipants(saved?: Map<string, { draft: unknown; baseline: unknown }>): readonly SavePart[] {
    return this.dirtyEntries().map((entry): SavePart => {
      const draft = entry.draft;
      const { handlers } = entry;
      return {
        id: entry.id,
        label: entry.label,
        blocking: false,
        count: entry.changeCount,
        validate: (ctx) => handlers.validate(draft, ctx),
        save: async (ctx) => {
          const baseline = await handlers.save(draft, ctx);
          saved?.set(entry.id, { draft, baseline });
        },
      };
    });
  }

  /**
   * `runSave([hostPart, ...dirtyParticipants()])`, then the outcome applied to the entries:
   * saved → clean at the returned baseline; refused → `invalid`; failed → `failed` with its
   * issues; not attempted → still staged. Pressed again while saving, it returns the run in
   * flight.
   */
  run(hostPart: SavePart | null, options: Pick<RunSaveOptions, 'stopOnFailure'> = {}): Promise<SaveOutcome> {
    if (this.#inFlight !== null) return this.#inFlight;
    const saved = new Map<string, { draft: unknown; baseline: unknown }>();
    const parts = [...(hostPart === null ? [] : [hostPart]), ...this.dirtyParticipants(saved)];
    const ids = new Set(parts.map((part) => part.id));
    this.#withEntries(
      (entries) => {
        for (const id of ids) {
          const entry = entries.get(id);
          if (entry !== undefined) entries.set(id, { ...entry, status: 'saving' });
        }
      },
      { saving: true, lastOutcome: null },
    );
    const describeError = this.#texts?.describeError;
    const flight = runSave(parts, {
      ...(options.stopOnFailure === undefined ? {} : { stopOnFailure: options.stopOnFailure }),
      ...(describeError === undefined ? {} : { describeError }),
    })
      .then((outcome) => {
        this.#apply(outcome, saved);
        return outcome;
      })
      .finally(() => {
        this.#inFlight = null;
      });
    this.#inFlight = flight;
    return flight;
  }

  #apply(outcome: SaveOutcome, saved: Map<string, { draft: unknown; baseline: unknown }>): void {
    this.#withEntries(
      (entries) => {
        for (const part of outcome.parts) {
          const entry = entries.get(part.id);
          if (entry === undefined) continue;
          if (part.result === 'saved') {
            const written = saved.get(part.id);
            if (written === undefined) continue;
            // An edit made while the write was in flight stays staged against the new baseline.
            const draft = entry.draft === written.draft ? written.baseline : entry.draft;
            const changeCount = entry.handlers.changeCount(draft, written.baseline);
            entries.set(part.id, {
              ...entry,
              baseline: written.baseline,
              draft,
              changeCount,
              status: changeCount > 0 ? 'dirty' : 'clean',
              issues: null,
              error: null,
            });
            if (changeCount === 0 && (this.#mounts.get(part.id) ?? 0) === 0) entries.delete(part.id);
            continue;
          }
          if (part.result === 'not-attempted') {
            entries.set(part.id, { ...entry, status: 'dirty' });
            continue;
          }
          entries.set(part.id, {
            ...entry,
            status: part.result === 'refused' ? 'invalid' : 'failed',
            issues: part.issues ?? null,
            error: part.message ?? null,
          });
        }
      },
      { saving: false, lastOutcome: outcome },
    );
  }
}
