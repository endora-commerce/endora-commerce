import type { EntityManager } from '@mikro-orm/postgresql';
import type { CurrencyReadPort, LanguageReadPort } from '@endora-commerce/contracts';
import { DictionaryValidator } from '../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { CurrencyReadService } from '../../../packages/modules/currencies/src/backend/services/currency-ports.js';
import { LanguageReadService } from '../../../packages/modules/languages/src/backend/services/language-ports.js';
import { CurrencySeedService } from '../../../packages/modules/currencies/src/backend/services/currency-seed-service.js';
import { LanguageSeedService } from '../../../packages/modules/languages/src/backend/services/language-seed-service.js';
import {
  runDictionarySeedReconciler,
  type SeedReconcilerPorts,
  type SeedReconcilerSummary,
} from '../../../packages/modules/dictionaries/src/backend/services/seed-reconciler.js';

/**
 * The two read ports every `dictionaries` service takes — feature 075, Phase C.
 *
 * `dictionaries` owns `countries`, hosts the admin screen and the storefront
 * registry for `currencies` and `languages`, and owns neither of those tables.
 * Since the cut it asks their owners over the published read ports instead of
 * querying them, so a service built by hand needs both.
 *
 * Fourteen tests build one against a bare test database with no container to
 * resolve a port from. This is the one place that wiring is spelled, so a later
 * change to the seam is one edit rather than fourteen — and the implementations
 * are the ones `currencies` and `languages` register, so a test exercises the
 * real read path rather than a stub that cannot disagree with it.
 */
export function dictionaryReadPortsFor(emFactory: () => EntityManager): {
  currencies: CurrencyReadPort;
  languages: LanguageReadPort;
} {
  return {
    currencies: new CurrencyReadService(emFactory),
    languages: new LanguageReadService(emFactory),
  };
}

/** A `DictionaryValidator` over one `EntityManager`, with both read ports. */
export function dictionaryValidatorFor(emFactory: () => EntityManager): DictionaryValidator {
  const ports = dictionaryReadPortsFor(emFactory);
  return new DictionaryValidator(emFactory, ports.currencies, ports.languages);
}

/**
 * The four ports the seed reconciler takes — feature 077, D-87 drain.
 *
 * The reconciler seeds two tables `dictionaries` does not own, and it used to
 * write both with raw SQL. It goes through `currencies`' and `languages`'
 * published ports now, so a test that runs it against a bare database with no
 * container needs the same four implementations those two modules register.
 */
export function dictionarySeedPortsFor(
  emFactory: () => EntityManager,
): SeedReconcilerPorts {
  // The read ports use `em.find`, which MikroORM refuses on the **global**
  // EntityManager — and every caller of this helper seeds in `beforeAll`, from
  // `() => db.orm.em`, outside any transaction. A live composition hands its
  // modules a request-scoped fork, so forking here is what makes the test EM
  // the same shape rather than a special case: the seed statements this
  // replaced went through `getConnection()`, which took its own pooled
  // connection and committed immediately, exactly as an unwrapped fork does.
  const scoped = (): EntityManager => emFactory().fork();
  const reads = dictionaryReadPortsFor(scoped);
  return {
    currencySeed: new CurrencySeedService(scoped),
    currencyRead: reads.currencies,
    languageSeed: new LanguageSeedService(scoped),
    languageRead: reads.languages,
  };
}

/** `runDictionarySeedReconciler` with the ports a live composition would supply. */
export function runDictionarySeedReconcilerFor(
  emFactory: () => EntityManager,
): Promise<SeedReconcilerSummary> {
  return runDictionarySeedReconciler(emFactory, dictionarySeedPortsFor(emFactory));
}
