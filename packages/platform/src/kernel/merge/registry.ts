import {
  RECORD_MERGE_HOST_PHASES,
  RECORD_MERGE_HOST_STRUCTURE_KEY,
  type MergeHostImplementation,
  type MergeParticipant,
  type RecordMergeHostType,
} from '@endora-commerce/contracts';
import {
  participationMoves,
  type MergeCompositionDeclarations,
  type MergeHostOwnership,
  type MergeParticipationOwnership,
} from './declarations.js';

/**
 * The record-merge registry (`specs/192-organization-merge/`,
 * `contracts/merge-mechanism.md` §1–§2, research R-1).
 *
 * One per composed application, shared by the merge runner and every
 * `ModuleContext`. A host module registers its implementation through
 * `ctx.merge.host`, a participant through `ctx.merge.participate`; the composer
 * **seals** the registry once the last module has registered, handing it the
 * manifests' `merge` declarations as data. Sealing is where every composition
 * refusal is raised; after it the registry is read-only.
 *
 * Presence is **not** decided here. A participant whose module is switched off
 * stays registered and is skipped by the runner per merge — its step deferred
 * (D-299, OQ-4) — so switching a module off or on needs no restart.
 */

/** A composition the merge mechanism refuses. Names the module(s). */
export class RecordMergeCompositionError extends Error {
  constructor(message: string) {
    super(`[record-merge] ${message}`);
    this.name = 'RecordMergeCompositionError';
  }
}

/** A sealed host: its implementation and the module that owns the record type. */
export interface ComposedMergeHost {
  readonly moduleId: string;
  readonly type: RecordMergeHostType;
  readonly phases: readonly string[];
  readonly implementation: MergeHostImplementation;
}

/** A sealed participant: its declaration and its implementation. */
export interface ComposedMergeParticipant extends MergeParticipationOwnership {
  readonly phase: string;
  readonly participant: MergeParticipant;
}

export interface RecordMergeRegistryOptions {
  /** Where a dropped participation is reported. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

/**
 * The host's own structure step key. A participation the host module declares
 * under it is fulfilled by the host's `applyStructureBatch`, not by a
 * registered participant; any other module may not use the key.
 */
export const HOST_STRUCTURE_STEP_KEY = RECORD_MERGE_HOST_STRUCTURE_KEY;

export class RecordMergeRegistry {
  readonly #warn: (message: string) => void;
  readonly #hostRegistrations: { moduleId: string; implementation: MergeHostImplementation }[] = [];
  readonly #participantRegistrations: {
    moduleId: string;
    host: RecordMergeHostType;
    key: string;
    participant: MergeParticipant;
  }[] = [];
  #sealed = false;
  #hosts = new Map<RecordMergeHostType, ComposedMergeHost>();
  #participants = new Map<RecordMergeHostType, readonly ComposedMergeParticipant[]>();
  #declarations = new Map<RecordMergeHostType, readonly MergeParticipationOwnership[]>();
  #allDeclarations: readonly MergeParticipationOwnership[] = [];

  constructor(options: RecordMergeRegistryOptions = {}) {
    this.#warn = options.warn ?? ((message: string): void => console.warn(message));
  }

  get isSealed(): boolean {
    return this.#sealed;
  }

  /** `ctx.merge.host` — the module id is stamped by the context. */
  registerHost(moduleId: string, implementation: MergeHostImplementation): void {
    this.#assertOpen(moduleId);
    this.#hostRegistrations.push({ moduleId, implementation });
  }

  /** `ctx.merge.participate` — the module id is stamped by the context. */
  registerParticipant<H extends RecordMergeHostType>(
    moduleId: string,
    host: H,
    key: string,
    participant: MergeParticipant<H>,
  ): void {
    this.#assertOpen(moduleId);
    if (participant.host !== host) {
      throw new RecordMergeCompositionError(
        `module '${moduleId}' registers participant '${key}' for host '${host}', but the participant ` +
          `declares host '${participant.host}'.`,
      );
    }
    this.#participantRegistrations.push({ moduleId, host, key, participant: participant as MergeParticipant });
  }

  /**
   * Validate the registrations against the composed declarations. Called once
   * by `composeModules`, after the decoration drain and before the boot phase.
   */
  seal(input: { readonly declarations: MergeCompositionDeclarations }): void {
    if (this.#sealed) throw new RecordMergeCompositionError('the registry is already sealed.');
    const { hosts, participations } = input.declarations;

    const hostOwners = new Map<RecordMergeHostType, MergeHostOwnership[]>();
    for (const host of hosts) {
      const list = hostOwners.get(host.type) ?? [];
      list.push(host);
      hostOwners.set(host.type, list);
    }
    for (const [type, owners] of hostOwners) {
      if (owners.length > 1) {
        throw new RecordMergeCompositionError(
          `host type '${type}' is declared by ${owners.map((owner) => `'${owner.moduleId}'`).join(' and ')}; ` +
            'exactly one module owns a record type.',
        );
      }
    }

    const composedHosts = new Map<RecordMergeHostType, ComposedMergeHost>();
    for (const registration of this.#hostRegistrations) {
      const type = registration.implementation.host;
      const owner = hostOwners.get(type)?.[0];
      if (owner === undefined || owner.moduleId !== registration.moduleId) {
        throw new RecordMergeCompositionError(
          `module '${registration.moduleId}' registers the merge host '${type}' with ctx.merge.host, but its ` +
            `manifest declares no \`merge.hosts\` entry for it` +
            (owner ? ` — module '${owner.moduleId}' does.` : '.'),
        );
      }
      if (composedHosts.has(type)) {
        throw new RecordMergeCompositionError(
          `module '${registration.moduleId}' registers the merge host '${type}' twice.`,
        );
      }
      composedHosts.set(type, {
        moduleId: registration.moduleId,
        type,
        phases: RECORD_MERGE_HOST_PHASES[type],
        implementation: registration.implementation,
      });
    }
    for (const [type, owners] of hostOwners) {
      if (!composedHosts.has(type)) {
        throw new RecordMergeCompositionError(
          `module '${owners[0]?.moduleId ?? '?'}' declares the merge host '${type}' and registers no ` +
            'implementation — call ctx.merge.host from registerModule.',
        );
      }
    }

    const declared = new Map<string, MergeParticipationOwnership>();
    const keyOf = (moduleId: string, host: string, key: string): string => `${moduleId}/${host}/${key}`;
    const kept: MergeParticipationOwnership[] = [];
    for (const participation of participations) {
      if (!hostOwners.has(participation.host)) {
        // 188 FR-004's precedent: the host's module may be platform-unavailable
        // in this deployment, which is not the participant's fault.
        this.#warn(
          `[record-merge] module '${participation.moduleId}' declares merge participation ` +
            `'${participation.key}' for host '${participation.host}', which no composed module hosts; it is dropped.`,
        );
        continue;
      }
      kept.push(participation);
      if (participation.key === HOST_STRUCTURE_STEP_KEY) {
        const owner = hostOwners.get(participation.host)?.[0];
        if (owner?.moduleId !== participation.moduleId || participation.phase !== 'structure') {
          throw new RecordMergeCompositionError(
            `module '${participation.moduleId}' declares merge participation '${HOST_STRUCTURE_STEP_KEY}' for host ` +
              `'${participation.host}'; that key is the host module's own structure step, in the structure phase.`,
          );
        }
        continue;
      }
      if (participationMoves(participation)) {
        declared.set(keyOf(participation.moduleId, participation.host, participation.key), participation);
      }
    }

    const composed = new Map<RecordMergeHostType, ComposedMergeParticipant[]>();
    const registered = new Set<string>();
    for (const registration of this.#participantRegistrations) {
      const key = keyOf(registration.moduleId, registration.host, registration.key);
      if (registered.has(key)) {
        throw new RecordMergeCompositionError(
          `module '${registration.moduleId}' registers merge participant '${registration.key}' for host ` +
            `'${registration.host}' twice.`,
        );
      }
      registered.add(key);
      const declaration = declared.get(key);
      if (declaration === undefined) {
        if (!hostOwners.has(registration.host)) continue; // dropped with its declaration, above
        throw new RecordMergeCompositionError(
          `module '${registration.moduleId}' registers merge participant '${registration.key}' for host ` +
            `'${registration.host}', and its manifest declares no \`merge.participates\` entry that moves ` +
            'records under that key.',
        );
      }
      const list = composed.get(registration.host) ?? [];
      list.push({ ...declaration, phase: declaration.phase ?? '', participant: registration.participant });
      composed.set(registration.host, list);
    }
    for (const [key, declaration] of declared) {
      if (!registered.has(key)) {
        throw new RecordMergeCompositionError(
          `module '${declaration.moduleId}' declares merge participation '${declaration.key}' for host ` +
            `'${declaration.host}' and registers no participant — call ctx.merge.participate from registerModule.`,
        );
      }
    }

    this.#hosts = composedHosts;
    for (const [host, list] of composed) {
      list.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.key.localeCompare(b.key));
      this.#participants.set(host, Object.freeze(list));
    }
    for (const participation of kept) {
      const list = [...(this.#declarations.get(participation.host) ?? []), participation];
      this.#declarations.set(participation.host, list);
    }
    this.#allDeclarations = Object.freeze(kept);
    this.#sealed = true;
  }

  /** The composed host of a record type, or `undefined` when no module hosts it. */
  hostOf(type: RecordMergeHostType): ComposedMergeHost | undefined {
    return this.#hosts.get(type);
  }

  /** Every composed participant of a host, by module id then key. Presence is the caller's to ask. */
  participantsOf(type: RecordMergeHostType): readonly ComposedMergeParticipant[] {
    return this.#participants.get(type) ?? [];
  }

  /** Every composed declaration of a host, `kept`-only ones included — the completeness twin's input. */
  declarationsOf(type: RecordMergeHostType): readonly MergeParticipationOwnership[] {
    return this.#declarations.get(type) ?? [];
  }

  /** Every composed declaration, of every host. */
  allDeclarations(): readonly MergeParticipationOwnership[] {
    return this.#allDeclarations;
  }

  #assertOpen(moduleId: string): void {
    if (this.#sealed) {
      throw new RecordMergeCompositionError(
        `the registry is sealed — module '${moduleId}' tried to register after composition. Register from registerModule.`,
      );
    }
  }
}
