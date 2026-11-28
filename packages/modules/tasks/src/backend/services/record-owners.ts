import type { OpportunityReadPort, ProjectReadPort, QuoteRequestReadPort } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

/**
 * The records of the three operator-switchable owners a Task refers to
 * (`specs/165-task-management/` research R-5, R-16) — the **one door** to
 * `quote_requests`, `crm` and `projects`, so that every caller decides an
 * owner's **presence first**.
 *
 * This module only *degrades* without each of them (the manifest's
 * `degrades-without` edges): a referenced record of an absent owner renders as
 * unavailable and the `@@` list offers none. Nothing here, and nothing that
 * calls this, catches a closed gate as a signal — ask
 * {@link TaskRecordOwners.isPresent} before anything else.
 *
 * Every read runs under the caller's tenant scope, as the owners' ports do; a
 * Project the caller may not see is not returned by its port either. Which
 * caller may read which kind at all is `owner-read-permissions.ts`'.
 *
 * A function rather than an object literal at the composition site:
 * `check:port-catches` follows the ports through the value.
 */

/** The kinds whose owner an operator may switch off. */
export type SwitchableRecordKind = 'quote_request' | 'opportunity' | 'project';

/** The module that owns each switchable kind. */
export const RECORD_OWNER: Readonly<Record<SwitchableRecordKind, string>> = {
  quote_request: 'quote_requests',
  opportunity: 'crm',
  project: 'projects',
};

/** A record as a reference or a picker names it. */
export interface OwnedRecordLabel {
  id: string;
  /** Its number. */
  label: string;
  /** A second, quieter line — a title. */
  sublabel?: string;
}

export interface TaskRecordOwners {
  /** Whether the module that owns `kind` is effectively present. Ask before anything else here. */
  isPresent(kind: SwitchableRecordKind): boolean;
  /**
   * The records of `ids` the caller may reach, keyed by the id asked. **Only
   * while present.** A merged Project answers its survivor's record under the
   * loser's id.
   */
  labels(kind: SwitchableRecordKind, ids: readonly string[]): Promise<Map<string, OwnedRecordLabel>>;
  /**
   * What the `@@` list offers for `q`, newest first, at most `limit`. A Quote
   * Request is offered only by its number typed in full: its port publishes no
   * search, and a Task belongs to no Organization whose open requests could be
   * listed. **Only while present.**
   */
  search(kind: SwitchableRecordKind, q: string, limit: number): Promise<OwnedRecordLabel[]>;
}

export interface TaskRecordOwnerPorts {
  quoteRequests: QuoteRequestReadPort;
  opportunities: OpportunityReadPort;
  projects: ProjectReadPort;
}

export function createTaskRecordOwners(ports: TaskRecordOwnerPorts): TaskRecordOwners {
  const exactQuoteRequest = async (typed: string): Promise<OwnedRecordLabel[]> => {
    const trimmed = typed.trim();
    if (trimmed === '') return [];
    // Numbers are stored upper-case; a person types them either way.
    const found =
      (await ports.quoteRequests.findByBusinessId(trimmed)) ??
      (trimmed.toUpperCase() !== trimmed ? await ports.quoteRequests.findByBusinessId(trimmed.toUpperCase()) : null);
    return found ? [{ id: found.id, label: found.businessId }] : [];
  };

  return {
    isPresent: (kind) => effectiveState.isPresent(RECORD_OWNER[kind]),
    async labels(kind, ids) {
      const unique = [...new Set(ids)];
      const out = new Map<string, OwnedRecordLabel>();
      if (unique.length === 0) return out;
      if (kind === 'opportunity') {
        for (const record of await ports.opportunities.findByIds(unique)) {
          out.set(record.id, { id: record.id, label: record.number, sublabel: record.title });
        }
      } else if (kind === 'project') {
        // A Project merged into another one is named by its survivor, under
        // the id asked (`specs/192-organization-merge/` FR-093): a mention is
        // never rewritten, it resolves when rendered.
        const survivors = await Promise.all(unique.map((id) => ports.projects.resolveMerged(id)));
        const targetOf = new Map(unique.map((id, index) => [id, survivors[index] ?? id]));
        const found = new Map(
          (await ports.projects.findByIds([...new Set(targetOf.values())])).map((record) => [record.id, record]),
        );
        for (const id of unique) {
          const record = found.get(targetOf.get(id) ?? id);
          if (record) out.set(id, { id: record.id, label: record.number, sublabel: record.title });
        }
      } else {
        // The quote desk's port reads one at a time; a text names a few.
        for (const id of unique) {
          const record = await ports.quoteRequests.findById(id);
          if (record) out.set(record.id, { id: record.id, label: record.businessId });
        }
      }
      return out;
    },
    async search(kind, q, limit) {
      if (kind === 'quote_request') return (await exactQuoteRequest(q)).slice(0, limit);
      const query = { ...(q.trim() !== '' ? { q: q.trim() } : {}), limit };
      const found =
        kind === 'opportunity' ? await ports.opportunities.search(query) : await ports.projects.search(query);
      return found.map((record) => ({ id: record.id, label: record.number, sublabel: record.title }));
    },
  };
}
