import type {
  SalesChannelAttribution,
  SalesChannelAttributionDescriptor,
  SalesChannelAttributionRegistryPort,
} from '@endora-commerce/contracts';

/**
 * In-process registry of "who is still attributed to this sales channel?"
 * counters (feature 075, D-87 drain).
 *
 * Registered under `salesChannelAttributionRegistry` and contributed to from
 * other modules' boot hooks. `SalesChannelsService.delete` is the only reader
 * today, and it used to answer the question itself — one raw statement naming
 * `orders` and `quote_requests`, two other modules' tables, invisible to the
 * import-level boundary check because SQL names no specifier.
 *
 * **Enumeration policy: honoured while the contributing module is absent.**
 * The reasoning is at `SalesChannelAttributionRegistryPort` in
 * `@endora-commerce/contracts`, and the short of it is that this is referential integrity
 * rather than a surface: a switched-off module still owns the rows carrying the
 * channel id, so skipping its counter would let an operator delete the channel
 * underneath them. That is why this class takes no presence predicate — unlike
 * `AuditReferenceRegistry`, which resolves a deep link into a contributor's own
 * admin screen and therefore has one.
 */
export class SalesChannelAttributionRegistry implements SalesChannelAttributionRegistryPort {
  private readonly descriptors: SalesChannelAttributionDescriptor[] = [];

  register(descriptor: SalesChannelAttributionDescriptor): void {
    if (!this.descriptors.includes(descriptor)) {
      this.descriptors.push(descriptor);
    }
  }

  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[] {
    return this.descriptors.map((d) => d.ownerModuleId);
  }

  async countForChannel(salesChannelId: string): Promise<SalesChannelAttribution[]> {
    const found: SalesChannelAttribution[] = [];
    for (const descriptor of this.descriptors) {
      const count = await descriptor.countForChannel(salesChannelId);
      // A consumer that points at nothing is not an attribution. Reporting it
      // would put a module's name in a refusal message that is not refusing.
      if (count <= 0) continue;
      found.push({
        ownerModuleId: descriptor.ownerModuleId,
        consumer: descriptor.consumer,
        tableName: descriptor.tableName,
        columnName: descriptor.columnName,
        count,
      });
    }
    return found;
  }
}
