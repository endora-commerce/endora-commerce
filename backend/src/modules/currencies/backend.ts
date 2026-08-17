import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { CurrencyService } from './services/currency-service.js';

/**
 * `currencies` — one service, where there were two (feature 072, wave 1).
 *
 * The module owns no routes: `dictionaries` serves
 * `/api/v1/admin/dictionary/currencies/*` and `languages` serves
 * `/api/v1/admin/currencies/*`. Both write the same table, and **each built its
 * own `CurrencyService` with different constructor arguments** — `dictionaries`
 * passed the dictionary invalidator, `languages` passed `undefined`.
 *
 * That is not a tidiness problem. `CurrencyService.setDefault` and `.remove`
 * call the invalidator, so the same delete performed through the second surface
 * left `DictionaryValidator`'s cache holding a code whose row was gone — and
 * the validator's job is to *accept or reject* codes, so the failure is a stale
 * **accept**: the next write referencing that currency passes validation and
 * lands a dangling reference. `test/integration/currencies/one-currency-service.test.ts`
 * pins it.
 *
 * One registration removes the class of bug rather than this instance of it.
 * The invalidator is read from the cradle at call time, because `dictionaries`
 * builds it inside its own factory and is not converted yet; resolving it
 * lazily is also what a port would do, so nothing here has to change again when
 * `dictionaries` converts.
 */

export interface CurrenciesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly eventBus: { emit: (event: string, payload: unknown) => void };
}

/** Emitted after any write that changes the set or shape of currencies. */
export const CURRENCY_CHANGED_EVENT = 'currencies.changed';

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    currencyService: ctx
      .asFunction(({ emFactory, auditLogService }: CurrenciesCradle) => {
        // Announce, do not call. Whoever caches currency data subscribes and
        // drops its own; this module does not learn who they are, which is
        // what keeps the dependency graph acyclic and the module detachable
        // (Constitution I).
        const announce = async (): Promise<void> => {
          ctx.cradle<CurrenciesCradle>().eventBus.emit(CURRENCY_CHANGED_EVENT, {});
        };
        return new CurrencyService(emFactory, announce, auditLogService);
      })
      .singleton(),
  });
}
