import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 085 (Phase A) — the `new -> paid` lifecycle edge.
 *
 * A payment method ships `status_on_pending = 'new'` and
 * `status_on_success = 'paid'`, so the happy path of every gateway payment asks
 * an order to move `new -> paid`. That pair was in neither the explicit default
 * set nor the universal (`on_hold` / `cancelled`) one, so the configured graph
 * forbade it: the settlement ingress only got away with it because it writes
 * `order.status` directly and never asks the graph, while an operator making the
 * same move by hand was refused with a 409. `DEFAULT_EXPLICIT_TRANSITIONS` gains
 * the pair for a fresh install; this migration gives it to a graph that already
 * exists.
 *
 * **Idempotent, and deliberately so.** The insert lands on
 * `order_status_transitions_pair_unique` and does nothing on a conflict, so it
 * is safe to re-run and safe on a database where an operator already added the
 * edge by hand — their row is kept exactly as they made it, including their
 * `is_system` value, rather than being replaced by this one.
 *
 * `is_system = false` matches how the seed stores it: `computeDefaultTransitions`
 * marks the explicit defaults `false` and reserves `true` for the universal edges
 * `materializeUniversalTransitions` derives. An operator may therefore delete
 * this edge again, which is the same authority they have over every other
 * explicit default.
 *
 * The reverse deletes only the exact pair, and only when it is still the
 * non-system row this migration inserts — an operator's own edge is not theirs
 * to lose on a rollback.
 */
export class Migration20260820T100201OrdersNewToPaidTransition extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      insert into "order_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at")
      values (gen_random_uuid(), 'new', 'paid', false, now())
      on conflict ("from_status_code", "to_status_code") do nothing;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      delete from "order_status_transitions"
      where "from_status_code" = 'new' and "to_status_code" = 'paid' and "is_system" = false;
    `);
  }
}
