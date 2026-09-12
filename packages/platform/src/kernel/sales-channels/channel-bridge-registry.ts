import { ERROR_CODES, type ChannelMemberEntityType } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';

/**
 * Which table holds a channel-scoped entity type's memberships, said by the
 * module that owns that entity type (feature 120, FR-015; D-226).
 *
 * ## What this replaces, and why it was a defect rather than a tidiness question
 *
 * `SalesChannelMembershipService` held a literal map **total** over
 * `ChannelMemberEntityTypeSchema` — nine `{ table, entityIdColumn }` triples,
 * naming `catalog`'s, `cms`', `promotions`' and six other modules' tables from
 * inside the platform. `tsc` kept it honest precisely *because* it was total,
 * and that totality is the defect: the platform named nine module concepts, so
 * D-52/D-53's prohibition was expressed in a contract instead of in an import
 * and no check in the estate could see it. On an instance that never installed
 * `cms`, a membership call for `cms-page` executed SQL against a relation that
 * is not there.
 *
 * A second copy of the same nine triples lived in `sales_channels`' own admin
 * service, on the channel-**delete** path, justified by a circular import that
 * had not existed since feature 072's T019 moved the membership service into the
 * kernel. Both are gone; this registry is what they became.
 *
 * ## The two axes, and which one this answers
 *
 * A registration is a statement about **schema**: *this entity type's
 * memberships live in this table, keyed by this column*. It is contributed once
 * per composition by the module whose migrations create the table, which makes
 * it an answer on the **platform-availability** axis — a module that is not
 * composed contributes nothing, and {@link ChannelBridgeRegistry.require}
 * refuses rather than reaching a relation that may not exist (FR-017).
 *
 * It is deliberately **not** an answer on the operator-activation axis. The
 * rows survive an operator switching the owning module off, so the bridge must
 * still be readable — which is the same reasoning the asset-reference and
 * language-reference registries state for their own contributions: a
 * contribution is inert, and probing presence in the hook that makes one would
 * make runtime activation require a restart (D-62/D-68). The activation axis is
 * answered where it belongs, at the owning module's own routes and ports.
 *
 * ## Why it is not published on the kernel barrel
 *
 * Nothing here needs an address a module compiles against: a module contributes
 * by resolving `salesChannelBridgeRegistry` from the container, which is a
 * runtime name and not an import. Publishing the registry would enlarge the
 * platform's published surface — which `check:platform-surface` judges and
 * `PUBLISHED_SUBPATHS` pins — for a seam whose whole purpose is to *remove* a
 * platform-held map.
 */
export interface ChannelBridgeRegistration {
  /** The published vocabulary member this bridge serves. */
  readonly entityType: ChannelMemberEntityType;
  /** The M:N bridge table, created by the contributing module's own migration. */
  readonly table: string;
  /** The column in it holding the entity's id; `sales_channel_id` holds the other side. */
  readonly entityIdColumn: string;
}

export class ChannelBridgeRegistry {
  private readonly bridges = new Map<ChannelMemberEntityType, ChannelBridgeRegistration>();

  /**
   * Declare the bridge this module owns.
   *
   * **A conflicting second registration is refused, never silently
   * overwritten**: two modules claiming one member of the vocabulary is an
   * ownership collision, and the last composer winning would decide which
   * table a membership write lands in by module order.
   *
   * Re-declaring the **same** triple is a no-op rather than a refusal, and the
   * distinction is the design rather than a leniency. A registration is a
   * statement of fact about the schema, not a capability instance: nothing is
   * overwritten by repeating it, and a process legitimately composes more than
   * once — the test harness builds a platform per file, and several unit files
   * compose the whole module list twice to compare two compositions. Refusing
   * an identical repeat would make this seam fail for a reason that has nothing
   * to do with what it guards.
   */
  register(bridge: ChannelBridgeRegistration): void {
    const held = this.bridges.get(bridge.entityType);
    if (held !== undefined) {
      if (held.table === bridge.table && held.entityIdColumn === bridge.entityIdColumn) return;
      throw new Error(
        `sales-channel bridge '${bridge.entityType}' is already registered as ` +
          `"${held.table}"."${held.entityIdColumn}" and cannot be re-registered as ` +
          `"${bridge.table}"."${bridge.entityIdColumn}" — two modules claim one member of the ` +
          'channel-membership vocabulary',
      );
    }
    this.bridges.set(bridge.entityType, bridge);
  }

  /**
   * The bridge for `entityType`, or a refusal (FR-017).
   *
   * The refusal is the whole point of the registry: on an instance that did not
   * install the module owning this entity type there is no table to read, and
   * the honest answer is *"this platform cannot serve that capability"* rather
   * than a Postgres `relation … does not exist` from inside a transaction that
   * has already written something else.
   *
   * `MODULE_DISABLED` is the code because it is the one the platform already
   * publishes and translates for *"a capability this platform is not currently
   * serving"*, and a consumer branching on it needs no new vocabulary. The
   * module is **not** named in the details, because the honest answer is that
   * no module registered it: naming one would be a guess about which package an
   * operator was expected to install.
   */
  require(entityType: ChannelMemberEntityType): ChannelBridgeRegistration {
    const bridge = this.bridges.get(entityType);
    if (bridge === undefined) {
      throw new HttpError(
        503,
        ERROR_CODES.MODULE_DISABLED,
        `Sales-channel membership for '${entityType}' is not available on this platform: no ` +
          'installed module contributes that bridge.',
        [{ path: 'entityType', issue: entityType }],
      );
    }
    return bridge;
  }

  /** The registered bridges, in registration order. Empty in a process that composed nothing. */
  list(): readonly ChannelBridgeRegistration[] {
    return [...this.bridges.values()];
  }
}

/**
 * The registry a composition uses unless it is handed another.
 *
 * Process-level, on `inProcessCaches`' precedent, and for the same reason: the
 * contributors are modules and the reader is the kernel, so threading one
 * handle through every composition root — and through every test that
 * constructs the membership service against a bare database — is a lot of
 * wiring for a table that is a property of the build rather than of a
 * composition. {@link ChannelBridgeRegistry.register}'s idempotence is what
 * makes one-per-process safe.
 */
export const channelBridges = new ChannelBridgeRegistry();
