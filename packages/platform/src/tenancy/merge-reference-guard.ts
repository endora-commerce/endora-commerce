import type { EventArgs, EventSubscriber } from '@mikro-orm/core';
import type { MergeParticipationReference, RecordMergeHostType } from '@endora-commerce/contracts';
import { mergeWriteRefusal } from './merge-freeze.js';

/**
 * `specs/192-organization-merge/` FR-047 — the freeze over **every** declared
 * reference to a mergeable record. The org write guard holds `@OrgScoped`
 * rows' `organizationId` only; a `@GlobalEntity` row carrying an
 * Organization id (`Webhook`, `Promotion`, `MfaOrganizationPolicy`, …), an id
 * array, a text key and a Project reference were written past the freeze, and
 * after completion nothing ever moved them.
 *
 * Two halves, one answer ({@link mergeWriteRefusal}):
 *
 *  - **the ORM flush** — this subscriber, over every entity a
 *    `merge.participates` reference names: a created row, and an updated row
 *    whose reference changed, naming a frozen record outside its merge or an
 *    archived one, is refused before the flush is sent;
 *  - **the module's own SQL** — a `native*` call or a statement that sets a
 *    declared reference is invisible here, so the participation declares
 *    `freeze: 'guarded'` and the call site asks {@link assertMergeWritable}
 *    first. `check:merge-participation` refuses a site that sets a declared
 *    reference outside an ORM flush without both.
 *
 * A `kept` reference is history (the audit log, the command outbox, a
 * delivery log): its rows stay with the archived record by design, and new
 * history about it may still be written.
 */

interface GuardedReference {
  readonly host: RecordMergeHostType;
  readonly property: string;
  readonly polymorphic?: { readonly discriminator: string; readonly value: string } | undefined;
}

/** What the guard reads of the composed declarations. */
export interface MergeReferenceDeclarationLike {
  readonly host: RecordMergeHostType;
  readonly references: readonly Pick<MergeParticipationReference, 'entity' | 'property' | 'polymorphic' | 'disposition'>[];
}

class MergeReferenceGuardState {
  #source: (() => readonly MergeReferenceDeclarationLike[]) | undefined;
  #byEntity: Map<string, GuardedReference[]> | undefined;

  /** Where the composed declarations come from; read on first use, after the registry is sealed. */
  use(source: () => readonly MergeReferenceDeclarationLike[]): void {
    this.#source = source;
    this.#byEntity = undefined;
  }

  referencesOf(className: string): readonly GuardedReference[] | undefined {
    if (this.#source === undefined) return undefined;
    if (this.#byEntity === undefined) {
      const byEntity = new Map<string, GuardedReference[]>();
      for (const declaration of this.#source()) {
        for (const reference of declaration.references) {
          if (reference.disposition === 'kept') continue;
          const list = byEntity.get(reference.entity) ?? [];
          list.push({ host: declaration.host, property: reference.property, polymorphic: reference.polymorphic });
          byEntity.set(reference.entity, list);
        }
      }
      // An empty registry (a root that composes no merge) is not cached, so a
      // source that is sealed later is still read.
      if (byEntity.size === 0) return undefined;
      this.#byEntity = byEntity;
    }
    return this.#byEntity.get(className);
  }
}

/** The process's view of the composed declarations; the record-merge runtime points it at its registry. */
export const mergeReferenceGuard = new MergeReferenceGuardState();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every id a reference value carries: an id, an id array (or JSON array), or a text key holding ids. */
function idsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(UUID)) out.push(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) idsIn(item, out);
  }
  return out;
}

/**
 * Throws the refusal a write naming `ids` gets — `409` with the host's merged
 * code and `details.survivorId` for an archived record, `409
 * RECORD_MERGE_IN_PROGRESS` for a frozen one outside its own merge. A module
 * calls it before a `native*` call or a SQL statement that sets a reference
 * its manifest declares with `freeze: 'guarded'`.
 */
export function assertMergeWritable(hostType: RecordMergeHostType, ids: unknown): void {
  for (const id of idsIn(ids)) {
    const refusal = mergeWriteRefusal(hostType, id);
    if (refusal !== null) throw refusal;
  }
}

export class MergeReferenceGuardSubscriber implements EventSubscriber<object> {
  /** Every entity: the declarations are read lazily, and a class nothing declares costs one map lookup. */
  getSubscribedEntities(): [] {
    return [];
  }

  async beforeCreate(args: EventArgs<object>): Promise<void> {
    this.#check(args, false);
  }

  async beforeUpdate(args: EventArgs<object>): Promise<void> {
    this.#check(args, true);
  }

  async beforeUpsert(args: EventArgs<object>): Promise<void> {
    this.#check(args, false);
  }

  #check(args: EventArgs<object>, changedOnly: boolean): void {
    const className = args.meta?.className ?? args.entity.constructor.name;
    const references = mergeReferenceGuard.referencesOf(className);
    if (references === undefined) return;
    const entity = args.entity as Record<string, unknown>;
    const changed = changedOnly ? (args.changeSet?.payload as Record<string, unknown> | undefined) : undefined;
    for (const reference of references) {
      if (changed !== undefined && !(reference.property in changed)) continue;
      if (reference.polymorphic && entity[reference.polymorphic.discriminator] !== reference.polymorphic.value) continue;
      assertMergeWritable(reference.host, entity[reference.property]);
    }
  }
}
