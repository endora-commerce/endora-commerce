import type { OrderStatusDefinitionRecord, ProjectRecordKind, SupportedLanguage } from '@endora-commerce/contracts';
import type { LinkedRecordPorts } from './linked-records.js';

/**
 * A linked record's status by the name its owner gives it, in the reader's
 * language (issue #455) — never the stored code, and never a copy of the
 * owner's wording kept here. Each owner is asked through its own read port:
 * `orders` publishes its configured definitions (`findStatusDefinition`),
 * `quote_requests` and `crm` name a status themselves (`statusName`).
 *
 * Ask only for a record already found — its owner is then present; this
 * decides no presence and catches nothing.
 *
 * A function rather than an object literal at the composition site:
 * `check:port-catches` follows the ports through the value.
 */
export interface LinkedRecordStatusNames {
  nameOf(kind: ProjectRecordKind, status: string, language: SupportedLanguage): Promise<string>;
  /** Several at once, keyed `<kind>:<status>`; each distinct status is asked once. */
  namesOf(
    records: ReadonlyArray<{ kind: ProjectRecordKind; status: string }>,
    language: SupportedLanguage,
  ): Promise<Map<string, string>>;
}

/**
 * An Order status's name: the configured name in `language`, else a regional
 * variant of it (`pl` → `pl-PL`), else the default name, else the code — the
 * order `crm`'s screens name an Order status in.
 */
function orderStatusName(definition: OrderStatusDefinitionRecord | null, code: string, language: string): string {
  if (!definition) return code;
  const regional = Object.keys(definition.name).find((key) => key.startsWith(`${language}-`));
  return (
    definition.name[language] || (regional ? definition.name[regional] : undefined) || definition.defaultName || code
  );
}

export function createLinkedRecordStatusNames(ports: LinkedRecordPorts): LinkedRecordStatusNames {
  const nameOf = async (kind: ProjectRecordKind, status: string, language: SupportedLanguage): Promise<string> => {
    if (kind === 'order') return orderStatusName(await ports.orders.findStatusDefinition(status), status, language);
    if (kind === 'quote_request') return ports.quoteRequests.statusName(status, language);
    return ports.opportunities.statusName(status, language);
  };
  return {
    nameOf,
    async namesOf(records, language) {
      const keys = new Map(records.map((record) => [`${record.kind}:${record.status}`, record]));
      const named = await Promise.all(
        [...keys].map(async ([key, record]) => [key, await nameOf(record.kind, record.status, language)] as const),
      );
      return new Map(named);
    },
  };
}
