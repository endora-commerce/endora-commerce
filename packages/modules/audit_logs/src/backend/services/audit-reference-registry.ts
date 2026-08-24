import type {
  AuditReferenceLabel,
  AuditReferenceRegistryPort,
  AuditReferenceResolver,
} from '@endora-commerce/contracts';

/**
 * In-process registry of "what is this audit row about, and where does it live?"
 * resolvers (feature 075, D-87 drain).
 *
 * Registered under `auditReferenceRegistry` and contributed to from other
 * modules' boot hooks. `RecentActivityService` is the only reader today.
 *
 * **Enumeration policy: an absent contributor's resolver is skipped.** The
 * reasoning is at `AuditReferenceRegistryPort` in `@endora-commerce/contracts`, and the
 * short of it is that the descriptor carries a deep link into the contributor's
 * own admin screen: a module that is not present contributes no screen, so
 * nothing may link to one. The audit row still renders — with the label the
 * entry's own snapshot carries, or the raw id, and no link.
 *
 * The predicate is injected rather than read from `effectiveState` here, because
 * a registry that answers a presence question is exactly the thing a unit test
 * has to be able to put in either state.
 */
export class AuditReferenceRegistry implements AuditReferenceRegistryPort {
  private readonly resolvers: AuditReferenceResolver[] = [];

  constructor(private readonly isModulePresent: (moduleId: string) => boolean) {}

  register(resolver: AuditReferenceResolver): void {
    if (this.resolvers.includes(resolver)) return;
    const claimed = this.resolvers.find((r) => r.referenceType === resolver.referenceType);
    if (claimed) {
      // Two answers for one type is not a degrade to pick a winner from: one of
      // the two modules is wrong about what it owns, and the reader would be
      // rendering whichever boot hook happened to run first.
      throw new Error(
        `Audit reference type '${resolver.referenceType}' is already resolved by ` +
          `'${claimed.ownerModuleId}'; '${resolver.ownerModuleId}' may not claim it too.`,
      );
    }
    this.resolvers.push(resolver);
  }

  owners(): readonly string[] {
    return this.resolvers.map((r) => r.ownerModuleId);
  }

  async resolve(
    referenceType: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AuditReferenceLabel>> {
    const out = new Map<string, AuditReferenceLabel>();
    if (ids.length === 0) return out;

    const resolver = this.resolvers.find((r) => r.referenceType === referenceType);
    // Enumeration policy, applied at the read rather than at registration: an
    // operator's flip has to take effect without a restart.
    if (!resolver || !this.isModulePresent(resolver.ownerModuleId)) return out;

    for (const row of await resolver.resolve(ids)) {
      if (row.label.length > 0) out.set(row.id, row);
    }
    return out;
  }
}
